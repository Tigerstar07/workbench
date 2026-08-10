import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import {
  buildMomentumSnapshot,
  MOMENTUM_RULES,
  refreshMomentumCandidates,
  type MomentumCandidate,
  type MomentumStatus,
} from './src/momentumCore'
import { applySignalStability } from './src/signalStability'
import {
  getBotState,
  startBot,
  stopBot,
  resetBot,
  setBotMode,
  ensureBotLoop,
  windDownBot,
  liquidateAndStopBot,
} from './src/paperBotCore'
import { binanceSelfTest } from './src/binanceExec'
import { discordNotificationConfiguration } from './src/discordTradingNotifications'
import { buildLiveResearchSnapshot } from './src/researchDataIngestion'
import { runRobustnessSimulation, type PipelineParams, type RegimePreset } from './src/stockPredictionLabCore'
import {
  getResearchJob,
  listResearchExperiments,
  loadResearchExperiment,
  startResearchExperiment,
} from './src/researchExperimentServer'
import type { ResearchExperimentConfig, SearchDepth } from './src/researchExperimentEngine'

const USER_AGENT = 'ProjectDawnPassiveScanner/0.1 (+defensive authorized assessment)'
const MAX_BYTES = 300_000
const TIMEOUT_MS = 12_000
const CONTROL_HEADER = 'x-dawn-control'
const CONTROL_HEADER_VALUE = 'local'

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.end(JSON.stringify(payload))
}

function requireControlRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'Use POST for bot controls.' })
    return false
  }
  const value = req.headers[CONTROL_HEADER]
  const submitted = Array.isArray(value) ? value[0] : value
  if (submitted !== CONTROL_HEADER_VALUE) {
    writeJson(res, 403, { ok: false, error: 'Missing local control header.' })
    return false
  }
  return true
}

function isBlockedHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '0.0.0.0') return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  const m = h.match(/^172\.(\d{1,3})\./)
  if (m) {
    const n = Number(m[1])
    if (n >= 16 && n <= 31) return true
  }
  return false
}

async function fetchTarget(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Enter a valid URL, for example https://example.com' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported.' }
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, error: 'Local, loopback, and private-network targets are blocked.' }
  }

  try {
    const response = await fetch(url.href, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/json,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const contentType = response.headers.get('content-type') || ''
    let html = ''
    if (!contentType || /text|html|json|xml|javascript/i.test(contentType)) {
      const buffer = await response.arrayBuffer()
      html = Buffer.from(buffer.slice(0, MAX_BYTES)).toString('utf8')
    }

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    let setCookie: string[] = []
    try {
      if (typeof response.headers.getSetCookie === 'function') {
        setCookie = response.headers.getSetCookie()
      } else if (headers['set-cookie']) {
        setCookie = [headers['set-cookie']]
      }
    } catch {
      setCookie = []
    }

    return {
      ok: true,
      status: response.status,
      finalUrl: response.url || url.href,
      requestedUrl: url.href,
      contentType,
      headers,
      setCookie,
      html,
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: 'Target did not respond within 12 seconds.' }
    }
    const message = error instanceof Error ? error.message : 'network error'
    return { ok: false, error: `Request failed: ${message}` }
  }
}

async function scanHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  try {
    const url = new URL(req.url || '', 'http://localhost').searchParams.get('url')
    if (!url) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: 'Missing url parameter.' }))
      return
    }
    const result = await fetchTarget(url)
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (error) {
    res.statusCode = 500
    const message = error instanceof Error ? error.message : 'server error'
    res.end(JSON.stringify({ ok: false, error: message }))
  }
}

// Re-tally status counts after the stabilization layer may have held some raw
// CHECK NOW rows back to WATCH, so the snapshot's own counters stay truthful.
function recountStatuses(candidates: MomentumCandidate[]): Record<MomentumStatus, number> {
  const counts: Record<MomentumStatus, number> = { IGNORE: 0, WATCH: 0, 'CHECK NOW': 0, 'DATA ERROR': 0 }
  for (const candidate of candidates) counts[candidate.status] += 1
  return counts
}

async function momentumHandler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  try {
    const snapshot = await buildMomentumSnapshot()
    // Smooth the radar-facing signals through the confirmation state machine so
    // a one-tick breakout can never flash "BUY NOW". The bot path does not go
    // through here, so it keeps reacting to the raw, instantaneous signal.
    const candidates = applySignalStability(snapshot.candidates)
    const byTicker = new Map(candidates.map((candidate) => [candidate.ticker, candidate]))
    const shortlist = snapshot.shortlist.map((candidate) => byTicker.get(candidate.ticker) ?? candidate)
    const statusCounts = recountStatuses(candidates)
    res.statusCode = 200
    res.end(JSON.stringify({ ...snapshot, candidates, shortlist, statusCounts }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market data source failed.'
    res.statusCode = 502
    res.end(JSON.stringify({ ok: false, error: message }))
  }
}

async function researchIntakeHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  try {
    const force = new URL(req.url || '', 'http://localhost').searchParams.get('refresh') === '1'
    const snapshot = await buildLiveResearchSnapshot(force)
    res.statusCode = 200
    res.end(JSON.stringify(snapshot))
  } catch (error) {
    res.statusCode = 502
    const message = error instanceof Error ? error.message : 'Research data intake failed.'
    res.end(JSON.stringify({ ok: false, error: message }))
  }
}

function numericParam(search: URLSearchParams, name: string) {
  const value = Number(search.get(name))
  return Number.isFinite(value) ? value : undefined
}

async function researchRobustnessHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  try {
    const search = new URL(req.url || '', 'http://localhost').searchParams
    const regimeValue = search.get('regime')
    const regime: RegimePreset | undefined =
      regimeValue === 'balanced' || regimeValue === 'trend' || regimeValue === 'stress' || regimeValue === 'noisy'
        ? regimeValue
        : undefined
    const tickerValue = (search.get('ticker') ?? '').toUpperCase()
    const input: Partial<PipelineParams> = {
      ticker: /^[A-Z]{1,6}$/.test(tickerValue) ? tickerValue : undefined,
      regime,
      days: numericParam(search, 'days'),
      cusumThreshold: numericParam(search, 'cusumThreshold'),
      horizon: numericParam(search, 'horizon'),
      profitTake: numericParam(search, 'profitTake'),
      stopLoss: numericParam(search, 'stopLoss'),
      folds: numericParam(search, 'folds'),
      embargoPct: numericParam(search, 'embargoPct'),
      metaThreshold: numericParam(search, 'metaThreshold'),
      seed: numericParam(search, 'seed'),
    }
    res.statusCode = 200
    res.end(JSON.stringify(runRobustnessSimulation(input, 50)))
  } catch (error) {
    res.statusCode = 500
    const message = error instanceof Error ? error.message : 'Robustness simulation failed.'
    res.end(JSON.stringify({ ok: false, error: message }))
  }
}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 500_000): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

async function researchExperimentsHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  try {
    if (req.method === 'POST') {
      const body = await readJsonBody<Partial<ResearchExperimentConfig>>(req, 20_000)
      const ticker = String(body.ticker ?? '').trim().toUpperCase()
      const years = body.years === 3 || body.years === 5 || body.years === 8 ? body.years : 5
      const depth: SearchDepth = body.depth === 'quick' || body.depth === 'deep' ? body.depth : 'standard'
      if (!/^[A-Z]{1,6}$/.test(ticker)) {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: 'Ticker must contain 1-6 letters.' }))
        return
      }
      const job = startResearchExperiment({ ticker, years, depth })
      res.statusCode = 202
      res.end(JSON.stringify({ id: job.id, status: job.status, progress: job.progress }))
      return
    }

    if (req.method === 'GET') {
      const id = new URL(req.url || '', 'http://localhost').searchParams.get('id') ?? ''
      if (!id) {
        res.statusCode = 200
        res.end(JSON.stringify(await listResearchExperiments()))
        return
      }
      const job = getResearchJob(id)
      if (job) {
        res.statusCode = 200
        res.end(JSON.stringify(job))
        return
      }
      const result = await loadResearchExperiment(id)
      if (!result) {
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'Experiment not found.' }))
        return
      }
      res.statusCode = 200
      res.end(JSON.stringify({ id, status: 'complete', result }))
      return
    }

    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, error: 'Use GET or POST.' }))
  } catch (error) {
    res.statusCode = 500
    const message = error instanceof Error ? error.message : 'Research experiment request failed.'
    res.end(JSON.stringify({ ok: false, error: message }))
  }
}

async function momentumLiveHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, error: 'Use POST for live shortlist refresh.' }))
    return
  }

  try {
    const body = await readJsonBody<{ candidates?: MomentumCandidate[] }>(req)
    const submitted = Array.isArray(body.candidates) ? body.candidates : []
    const cryptoEnabled = ['1', 'true', 'yes', 'on'].includes(
      (process.env.BOT_ENABLE_CRYPTO ?? '').trim().toLowerCase(),
    )
    const candidates = cryptoEnabled ? submitted : submitted.filter((candidate) => candidate.assetClass === 'stock')
    if (candidates.length === 0) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: 'Missing candidates for live refresh.' }))
      return
    }

    const refreshed = applySignalStability(await refreshMomentumCandidates(candidates))
    res.statusCode = 200
    res.end(
      JSON.stringify({
        ok: true,
        generatedAt: new Date().toISOString(),
        nextLiveSeconds: candidates.some((candidate) => candidate.assetClass === 'stock' && candidate.sourceLabel === 'Alpaca')
          ? MOMENTUM_RULES.alpacaLiveRefreshSeconds
          : MOMENTUM_RULES.liveRefreshSeconds,
        candidates: refreshed,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live market refresh failed.'
    res.statusCode = 502
    res.end(JSON.stringify({ ok: false, error: message }))
  }
}

async function paperBotStateHandler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  try {
    const state = await getBotState()
    res.statusCode = 200
    res.end(JSON.stringify(state))
  } catch (error) {
    res.statusCode = 502
    const text = error instanceof Error ? error.message : 'Paper bot state failed.'
    res.end(JSON.stringify({ ok: false, error: text }))
  }
}

function discordNotificationStatusHandler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true, ...discordNotificationConfiguration() }))
}

function makePaperBotControl(action: 'start' | 'stop' | 'reset') {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    if (!requireControlRequest(req, res)) return
    try {
      if (action === 'start') startBot()
      else if (action === 'stop') {
        const mode = new URL(req.url || '', 'http://localhost').searchParams.get('mode')
        if (mode === 'drain' || mode === 'wind-down') windDownBot()
        else if (mode === 'plain') stopBot()
        else await liquidateAndStopBot()
      }
      else resetBot()
      res.statusCode = 200
      res.end(JSON.stringify({ ok: true, action }))
    } catch (error) {
      res.statusCode = 500
      const text = error instanceof Error ? error.message : 'Paper bot control failed.'
      res.end(JSON.stringify({ ok: false, error: text }))
    }
  }
}

// Binance testnet connectivity check. Read-only: public ping works with no
// keys; account + a dry-run (non-executing) test order light up once keys are
// added. Crypto execution is controlled separately by BOT_CRYPTO_VENUE.
async function binanceTestHandler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  const cryptoEnabled = ['1', 'true', 'yes', 'on'].includes(
    (process.env.BOT_ENABLE_CRYPTO ?? '').trim().toLowerCase(),
  )
  if (!cryptoEnabled) {
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, disabled: true, message: 'Crypto/Binance is disabled by BOT_ENABLE_CRYPTO.' }))
    return
  }
  try {
    const result = await binanceSelfTest()
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (error) {
    res.statusCode = 502
    const text = error instanceof Error ? error.message : 'Binance self-test failed.'
    res.end(JSON.stringify({ ok: false, error: text }))
  }
}

function paperBotModeHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  if (!requireControlRequest(req, res)) return
  const mode = new URL(req.url || '', 'http://localhost').searchParams.get('mode')
  if (mode !== 'safe' && mode !== 'active' && mode !== 'turbo') {
    res.statusCode = 400
    res.end(JSON.stringify({ ok: false, error: 'mode must be "safe", "active", or "turbo".' }))
    return
  }
  setBotMode(mode)
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true, mode }))
}

// Mounts the scanner + paper-bot endpoints in both `vite dev` and `vite preview`
// so everything works locally exactly like the serverless function does in
// production. The bot loop is started at boot and keeps ticking (gated on its
// own running flag) for as long as the server process is alive.
function dawnScanApi(): Plugin {
  const mount = (mountRoute: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void) => {
    mountRoute('/api/momentum/live', momentumLiveHandler)
    mountRoute('/api/scan', scanHandler)
    mountRoute('/api/momentum', momentumHandler)
    mountRoute('/api/research/intake', researchIntakeHandler)
    mountRoute('/api/research/robustness', researchRobustnessHandler)
    mountRoute('/api/research/experiments', researchExperimentsHandler)
    mountRoute('/api/paper-bot/state', paperBotStateHandler)
    mountRoute('/api/discord/status', discordNotificationStatusHandler)
    mountRoute('/api/paper-bot/start', makePaperBotControl('start'))
    mountRoute('/api/paper-bot/stop', makePaperBotControl('stop'))
    mountRoute('/api/paper-bot/reset', makePaperBotControl('reset'))
    mountRoute('/api/paper-bot/mode', paperBotModeHandler)
    mountRoute('/api/binance/test', binanceTestHandler)
    ensureBotLoop()
  }
  return {
    name: 'dawn-scan-api',
    configureServer(server: ViteDevServer) {
      mount((path, handler) => server.middlewares.use(path, handler))
    },
    configurePreviewServer(server: PreviewServer) {
      mount((path, handler) => server.middlewares.use(path, handler))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [react(), dawnScanApi()],
    // framer-motion pulls in React internally; dedupe + pre-bundle so the app
    // and the library share a single React instance (avoids "Invalid hook call").
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-runtime', 'framer-motion'],
    },
  }
})
