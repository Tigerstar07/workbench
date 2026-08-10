import { Type } from 'typebox'
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin'

type JsonObject = Record<string, unknown>

const DEFAULT_BASE_URL = 'http://127.0.0.1:5173'

const configSchema = Type.Object({
  baseUrl: Type.Optional(
    Type.String({
      description: 'Loopback URL for the local momentum radar and Alpaca paper bot.',
      default: DEFAULT_BASE_URL,
    }),
  ),
})

function record(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function loopbackBaseUrl(value: string | undefined) {
  const parsed = new URL(value || DEFAULT_BASE_URL)
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (parsed.protocol !== 'http:' || !loopbackHosts.has(parsed.hostname)) {
    throw new Error('Trading Ops only permits a local http://127.0.0.1, localhost, or ::1 endpoint.')
  }
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

async function fetchLocalJson(baseUrl: string | undefined, path: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(`${loopbackBaseUrl(baseUrl)}${path}`, {
    headers: { accept: 'application/json' },
    signal: combined,
  })
  if (!response.ok) throw new Error(`Local trading service ${path} returned HTTP ${response.status}.`)
  return record(await response.json())
}

function compactCandidate(value: unknown) {
  const candidate = record(value)
  const signal = record(candidate.signal)
  return {
    assetClass: text(candidate.assetClass),
    symbol: text(candidate.displaySymbol) ?? text(candidate.ticker),
    company: text(candidate.company),
    strategy: text(candidate.strategy) ?? 'momentum',
    session: text(candidate.marketStatusLabel) ?? text(candidate.marketStatus),
    status: text(candidate.status),
    action: text(signal.action),
    score: number(candidate.score),
    price: number(candidate.price),
    changePct: number(candidate.changePct),
    marketCap: number(candidate.marketCap),
    spreadPct: number(candidate.spreadPct),
    premarketHigh: number(candidate.premarketHigh),
    premarketVolume: number(candidate.premarketVolume),
    premarketDollarVolume: number(candidate.premarketDollarVolume),
    dataQuality: text(candidate.dataQuality),
    entryTrigger: number(signal.entryTrigger),
    stopLoss: number(signal.stopLoss),
    targetOne: number(signal.targetOne),
    blockers: array(candidate.blockers).filter((item): item is string => typeof item === 'string').slice(0, 3),
  }
}

function radarSummary(snapshot: JsonObject, limit: number) {
  const candidates = array(snapshot.candidates).map(record)
  const stockCandidates = candidates.filter((candidate) => candidate.assetClass === 'stock')
  const stockShortlist = array(snapshot.shortlist).map(record).filter((candidate) => candidate.assetClass === 'stock')
  const premarket = stockCandidates
    .filter((candidate) => candidate.marketStatus === 'PRE_MARKET')
    .sort((a, b) => (number(b.score) ?? 0) - (number(a.score) ?? 0))
  const statusCounts = stockCandidates.reduce<Record<string, number>>((counts, candidate) => {
    const status = text(candidate.status) ?? 'UNKNOWN'
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
  return {
    generatedAt: text(snapshot.generatedAt),
    scope: 'stocks-only (the Alpaca paper bot does not trade radar crypto rows)',
    provider: text(snapshot.provider),
    stockCoverage: record(snapshot.stockCoverage),
    statusCounts,
    premarket: {
      scanned: premarket.length,
      strict: premarket.filter((candidate) => candidate.status === 'WATCH' || candidate.status === 'CHECK NOW').length,
      leaders: premarket.slice(0, limit).map(compactCandidate),
    },
    strictSetups: stockShortlist.slice(0, limit).map(compactCandidate),
    excludedCryptoRows: candidates.length - stockCandidates.length,
    note: 'Stocks-only research context. CHECK NOW/WATCH still require the deterministic bot gates; context rows are not trade instructions.',
  }
}

function botSummary(state: JsonObject) {
  const account = record(state.account)
  const diagnostics = record(state.diagnostics)
  return {
    running: state.running === true,
    draining: state.draining === true,
    lastTickAt: text(state.lastTickAt),
    lastError: text(state.lastError),
    mode: text(state.mode),
    modeLabel: text(state.modeLabel),
    cryptoVenueLabel: text(state.cryptoVenueLabel),
    account: {
      currency: text(account.currency),
      cash: number(account.cash),
      equity: number(account.equity),
      buyingPower: number(account.buyingPower),
    },
    positions: array(state.positions).map((item) => {
      const position = record(item)
      return {
        symbol: text(position.displaySymbol) ?? text(position.symbol),
        assetClass: text(position.assetClass),
        qty: number(position.qty),
        marketValue: number(position.marketValue),
        unrealizedPl: number(position.unrealizedPl),
        unrealizedPlPct: number(position.unrealizedPlPct),
        stop: number(position.stop),
        target1: number(position.target1),
        target2: number(position.target2),
      }
    }),
    watch: array(state.watch).slice(0, 12).map((item) => {
      const row = record(item)
      return {
        symbol: text(row.symbol),
        state: text(row.state),
        status: text(row.status),
        score: number(row.score),
        waitingFor: text(row.waitingFor),
        nextCheck: text(row.nextCheck),
      }
    }),
    evidence: {
      closedTrades: number(diagnostics.closedTrades),
      winRate: number(diagnostics.winRate),
      netRealizedPl: number(diagnostics.netRealizedPl),
      netExpectancy: number(diagnostics.netExpectancy),
      netProfitFactor: number(diagnostics.netProfitFactor),
    },
  }
}

function modeAssessment(state: JsonObject) {
  const diagnostics = record(state.diagnostics)
  const closedTrades = number(diagnostics.closedTrades) ?? 0
  const expectancy = number(diagnostics.netExpectancy)
  const profitFactor = number(diagnostics.netProfitFactor)
  if (closedTrades >= 200 && expectancy !== null && expectancy > 0 && profitFactor !== null && profitFactor >= 1.4) {
    return { recommendedMode: 'active', reason: 'Large positive paper sample supports cautious active-mode validation. Turbo remains a stress lab.' }
  }
  if (closedTrades >= 100 && expectancy !== null && expectancy > 0 && profitFactor !== null && profitFactor >= 1.2) {
    return { recommendedMode: 'safe', reason: 'Positive paper evidence exists, but safe mode remains appropriate until the sample is larger.' }
  }
  return {
    recommendedMode: 'safe',
    reason: `Only ${closedTrades} post-reset closed trades with no proven positive net expectancy. Use safe mode to collect clean evidence; do not optimize for trade count.`,
  }
}

export default defineToolPlugin({
  id: 'roberts-trading-ops',
  name: 'Roberts Trading Ops',
  description: 'Read-only operational tools for the local momentum radar and Alpaca paper bot.',
  configSchema,
  tools: (tool) => [
    tool({
      name: 'trading_radar_snapshot',
      label: 'Trading Radar Snapshot',
      description: 'Read the current strict setups, market-cap coverage, and pre-market mover coverage from the local radar.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 8 })),
      }),
      async execute({ limit }, config, context) {
        context.signal?.throwIfAborted()
        const snapshot = await fetchLocalJson(config.baseUrl, '/api/momentum', context.signal)
        return radarSummary(snapshot, limit ?? 8)
      },
    }),
    tool({
      name: 'trading_bot_status',
      label: 'Trading Bot Status',
      description: 'Read sanitized bot health, account totals, positions, blockers, and performance evidence. Cannot place or close orders.',
      parameters: Type.Object({}),
      async execute(_params, config, context) {
        context.signal?.throwIfAborted()
        return botSummary(await fetchLocalJson(config.baseUrl, '/api/paper-bot/state', context.signal))
      },
    }),
    tool({
      name: 'trading_research_report',
      label: 'Trading Research Report',
      description: 'Combine radar and bot evidence into a conservative paper-trading research report and mode assessment.',
      parameters: Type.Object({}),
      async execute(_params, config, context) {
        context.signal?.throwIfAborted()
        const [snapshot, state] = await Promise.all([
          fetchLocalJson(config.baseUrl, '/api/momentum', context.signal),
          fetchLocalJson(config.baseUrl, '/api/paper-bot/state', context.signal),
        ])
        return {
          generatedAt: new Date().toISOString(),
          assessment: modeAssessment(state),
          bot: botSummary(state),
          radar: radarSummary(snapshot, 5),
          disclaimer: 'Paper-trading research only. Positive expectancy must be demonstrated out of sample before risking real capital.',
        }
      },
    }),
  ],
})
