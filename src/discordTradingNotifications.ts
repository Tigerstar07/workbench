import type { MomentumCandidate } from './momentumCore'

declare const process:
  | {
      env?: Record<string, string | undefined>
      cpuUsage?: () => { user: number; system: number }
      memoryUsage?: () => { rss: number; heapUsed: number; heapTotal: number }
      uptime?: () => number
    }
  | undefined

type DiscordField = { name: string; value: string; inline?: boolean }
type DiscordEmbed = {
  title: string
  description?: string
  color: number
  fields?: DiscordField[]
  timestamp: string
  footer: { text: string }
}

type DiscordWebhookMessage = {
  id?: string
}

type DiscordWebhookKind = 'alerts' | 'trades' | 'bot'

type TradeNotification = {
  time: string
  symbol: string
  side: 'buy' | 'sell'
  reason: string
  qty: number | null
  notional: number | null
  price: number | null
  pnl: number | null
  pnlPct: number | null
  outcome: 'open' | 'win' | 'loss' | 'flat'
  mode: string
}

type StatusNotification = {
  running: boolean
  mode: string
  modeLabel: string
  stockSessionTradable: boolean
  equity: number | null
  cash: number | null
  positions: Array<{
    symbol: string
    unrealizedPl: number
    unrealizedPlPct: number
  }>
  watch: Array<{
    symbol: string
    status: string
    state: string
    note: string
  }>
  armed: number
  triggered: number
  closedTrades: number
  realizedPl: number
  netRealizedPl: number
  lastError: string | null
}

type SignalMemory = {
  status: string
  fingerprint: string
  sentAt: number
}

type WatchDigestEntry = {
  candidate: MomentumCandidate
  firstSeen: number
  lastSeen: number
}

type DiscordRuntime = {
  queue: Promise<void>
  lastStatusAt: number
  lastBotStatusAt: number
  lastBotStatusMessageId: string | null
  lastBotStatusMessageAt: number
  lastWatchDigestAt: number
  lastWatchDigestMessageId: string | null
  lastWatchDigestMessageAt: number
  watchDigest: Map<string, WatchDigestEntry>
  watchFlushTimer: ReturnType<typeof setTimeout> | null
  signals: Map<string, SignalMemory>
  sentCount: number
  editCount: number
  tradeSentCount: number
  botStatusSentCount: number
  botStatusEditCount: number
  lastSuccessAt: string | null
  lastError: string | null
  tradeLastSuccessAt: string | null
  tradeLastError: string | null
  vitalCpuSample: { user: number; system: number; at: number } | null
}

type DiscordRuntimeGlobal = typeof globalThis & {
  __discordTradingRuntime?: DiscordRuntime
}

const FOOTER = 'Alpaca paper trading · stocks + crypto · research alerts'
const TRADE_FOOTER = 'Alpaca paper trading - bot trade updates - research'
const GREEN = 0x2ecc71
const RED = 0xe74c3c
const AMBER = 0xf1c40f
const BLUE = 0x3498db

function envValue(name: string) {
  return typeof process !== 'undefined' ? process?.env?.[name]?.trim() : undefined
}

function envMinutes(name: string, fallback: number) {
  const value = Number(envValue(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function webhookEnvNames(kind: DiscordWebhookKind) {
  if (kind === 'bot') return ['DISCORD_BOT_WEBHOOK_URL', 'DISCORD_TRADE_WEBHOOK_URL', 'DISCORD_TRADING_WEBHOOK_URL']
  if (kind === 'trades') return ['DISCORD_TRADE_WEBHOOK_URL', 'DISCORD_TRADING_WEBHOOK_URL']
  return ['DISCORD_TRADING_WEBHOOK_URL']
}

function webhookUrl(kind: DiscordWebhookKind = 'alerts') {
  const names = webhookEnvNames(kind)
  const raw = names.map((name) => envValue(name)).find((value): value is string => Boolean(value))
  if (!raw) return null
  const parsed = new URL(raw)
  const validHost = parsed.hostname === 'discord.com' || parsed.hostname.endsWith('.discord.com')
  if (parsed.protocol !== 'https:' || !validHost || !parsed.pathname.startsWith('/api/webhooks/')) {
    throw new Error(`${names[0]} must be an HTTPS discord.com webhook URL.`)
  }
  parsed.searchParams.set('wait', 'true')
  return parsed.toString()
}

function webhookConfigured(kind: DiscordWebhookKind) {
  try {
    return webhookUrl(kind) !== null
  } catch {
    return false
  }
}

function webhookMessageUrl(messageId: string, kind: DiscordWebhookKind = 'alerts') {
  const url = webhookUrl(kind)
  if (!url) return null
  const parsed = new URL(url)
  parsed.search = ''
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/messages/${encodeURIComponent(messageId)}`
  return parsed.toString()
}

function runtime() {
  const globalRuntime = globalThis as DiscordRuntimeGlobal
  if (!globalRuntime.__discordTradingRuntime) {
    globalRuntime.__discordTradingRuntime = {
      queue: Promise.resolve(),
      lastStatusAt: 0,
      lastBotStatusAt: 0,
      lastBotStatusMessageId: null,
      lastBotStatusMessageAt: 0,
      lastWatchDigestAt: 0,
      lastWatchDigestMessageId: null,
      lastWatchDigestMessageAt: 0,
      watchDigest: new Map(),
      watchFlushTimer: null,
      signals: new Map(),
      sentCount: 0,
      editCount: 0,
      tradeSentCount: 0,
      botStatusSentCount: 0,
      botStatusEditCount: 0,
      lastSuccessAt: null,
      lastError: null,
      tradeLastSuccessAt: null,
      tradeLastError: null,
      vitalCpuSample: null,
    }
  }
  globalRuntime.__discordTradingRuntime.lastBotStatusAt ??= 0
  globalRuntime.__discordTradingRuntime.lastBotStatusMessageId ??= null
  globalRuntime.__discordTradingRuntime.lastBotStatusMessageAt ??= 0
  globalRuntime.__discordTradingRuntime.lastWatchDigestAt ??= 0
  globalRuntime.__discordTradingRuntime.lastWatchDigestMessageId ??= null
  globalRuntime.__discordTradingRuntime.lastWatchDigestMessageAt ??= 0
  globalRuntime.__discordTradingRuntime.watchDigest ??= new Map()
  globalRuntime.__discordTradingRuntime.watchFlushTimer ??= null
  globalRuntime.__discordTradingRuntime.editCount ??= 0
  globalRuntime.__discordTradingRuntime.tradeSentCount ??= 0
  globalRuntime.__discordTradingRuntime.botStatusSentCount ??= 0
  globalRuntime.__discordTradingRuntime.botStatusEditCount ??= 0
  globalRuntime.__discordTradingRuntime.tradeLastSuccessAt ??= null
  globalRuntime.__discordTradingRuntime.tradeLastError ??= null
  globalRuntime.__discordTradingRuntime.vitalCpuSample ??= null
  return globalRuntime.__discordTradingRuntime
}

function money(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function price(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return value >= 100 ? `$${value.toFixed(2)}` : value >= 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(6)}`
}

function percent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 'n/a'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unit = 0
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024
    unit += 1
  }
  return `${current >= 10 || unit === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unit]}`
}

function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'n/a'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function processCpuPct() {
  if (typeof process === 'undefined' || typeof process.cpuUsage !== 'function') return null
  const state = runtime()
  const now = Date.now()
  const current = process.cpuUsage()
  const previous = state.vitalCpuSample
  state.vitalCpuSample = { user: current.user, system: current.system, at: now }
  if (!previous) return null
  const elapsedMs = Math.max(1, now - previous.at)
  const cpuMicros = current.user + current.system - previous.user - previous.system
  return Math.max(0, (cpuMicros / (elapsedMs * 1000)) * 100)
}

function serverVitalsText() {
  const memory = typeof process !== 'undefined' && typeof process.memoryUsage === 'function'
    ? process.memoryUsage()
    : null
  const cpuPct = processCpuPct()
  const uptimeSeconds = typeof process !== 'undefined' && typeof process.uptime === 'function'
    ? process.uptime()
    : 0
  return [
    `Bot CPU ${cpuPct === null ? 'warming up' : `${cpuPct.toFixed(1)}%`}`,
    `Bot RSS ${memory ? bytes(memory.rss) : 'n/a'}`,
    `Heap ${memory ? `${bytes(memory.heapUsed)} / ${bytes(memory.heapTotal)}` : 'n/a'}`,
    `Bot uptime ${duration(uptimeSeconds)}`,
  ].join('\n')
}

function compact(value: string, max = 1000) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function webhookPayload(embed: DiscordEmbed, kind: DiscordWebhookKind = 'alerts') {
  return JSON.stringify({
    username: kind === 'bot' ? 'Dawn Bot Watch' : kind === 'trades' ? 'Dawn Trade Bot' : 'Dawn Trading Radar',
    allowed_mentions: { parse: [] },
    embeds: [embed],
  })
}

async function executeWebhook(embed: DiscordEmbed, kind: DiscordWebhookKind = 'alerts'): Promise<DiscordWebhookMessage | null> {
  const url = webhookUrl(kind)
  if (!url) return null
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: webhookPayload(embed, kind),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200)
    throw new Error(`Discord webhook returned HTTP ${response.status}: ${detail}`)
  }
  return (await response.json().catch(() => null)) as DiscordWebhookMessage | null
}

async function editWebhookMessage(messageId: string, embed: DiscordEmbed, kind: DiscordWebhookKind = 'alerts') {
  const url = webhookMessageUrl(messageId, kind)
  if (!url) return false
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: webhookPayload(embed, kind),
    signal: AbortSignal.timeout(12_000),
  })
  if (response.status === 404) return false
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200)
    throw new Error(`Discord webhook edit returned HTTP ${response.status}: ${detail}`)
  }
  return true
}

function enqueue(embed: DiscordEmbed, kind: DiscordWebhookKind = 'alerts') {
  const state = runtime()
  state.queue = state.queue
    .then(async () => {
      const sent = await executeWebhook(embed, kind)
      if (sent) {
        state.sentCount += 1
        if (kind === 'trades') {
          state.tradeSentCount += 1
          state.tradeLastSuccessAt = new Date().toISOString()
          state.tradeLastError = null
        } else {
          state.lastSuccessAt = new Date().toISOString()
          state.lastError = null
        }
      }
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      if (kind === 'trades') state.tradeLastError = detail
      else state.lastError = detail
      console.error(`[discord-trading] ${kind} notification failed: ${detail}`)
    })
}

function enqueueWatchDigest(embed: DiscordEmbed) {
  const state = runtime()
  state.queue = state.queue
    .then(async () => {
      const now = Date.now()
      let edited = false
      if (
        state.lastWatchDigestMessageId &&
        state.lastWatchDigestMessageAt > 0 &&
        now - state.lastWatchDigestMessageAt <= watchDigestEditWindowMs()
      ) {
        edited = await editWebhookMessage(state.lastWatchDigestMessageId, embed)
        if (edited) {
          state.editCount += 1
          state.lastSuccessAt = new Date().toISOString()
          state.lastError = null
        } else {
          state.lastWatchDigestMessageId = null
          state.lastWatchDigestMessageAt = 0
        }
      }

      if (!edited) {
        const sent = await executeWebhook(embed)
        if (sent) {
          state.sentCount += 1
          state.lastWatchDigestMessageId = typeof sent.id === 'string' ? sent.id : null
          state.lastWatchDigestMessageAt = Date.now()
          state.lastSuccessAt = new Date().toISOString()
          state.lastError = null
        }
      }
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      state.lastError = detail
      console.error(`[discord-trading] WATCH digest failed: ${detail}`)
    })
}

function enqueueBotStatus(embed: DiscordEmbed) {
  const state = runtime()
  state.queue = state.queue
    .then(async () => {
      const now = Date.now()
      let edited = false
      if (
        state.lastBotStatusMessageId &&
        state.lastBotStatusMessageAt > 0 &&
        now - state.lastBotStatusMessageAt <= botStatusEditWindowMs()
      ) {
        edited = await editWebhookMessage(state.lastBotStatusMessageId, embed, 'bot')
        if (edited) {
          state.botStatusEditCount += 1
          state.tradeLastSuccessAt = new Date().toISOString()
          state.tradeLastError = null
        } else {
          state.lastBotStatusMessageId = null
          state.lastBotStatusMessageAt = 0
        }
      }

      if (!edited) {
        const sent = await executeWebhook(embed, 'bot')
        if (sent) {
          state.sentCount += 1
          state.tradeSentCount += 1
          state.botStatusSentCount += 1
          state.lastBotStatusMessageId = typeof sent.id === 'string' ? sent.id : null
          state.lastBotStatusMessageAt = Date.now()
          state.tradeLastSuccessAt = new Date().toISOString()
          state.tradeLastError = null
        }
      }
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      state.tradeLastError = detail
      console.error(`[discord-trading] bot status update failed: ${detail}`)
    })
}

function signalFingerprint(candidate: MomentumCandidate) {
  const signal = candidate.signal
  return [
    candidate.status,
    candidate.strategy,
    signal.entryTrigger ?? '-',
    signal.stopLoss ?? '-',
    signal.targetOne ?? '-',
    signal.targetTwo ?? '-',
  ].join(':')
}

function signalKey(candidate: MomentumCandidate) {
  return `${candidate.ticker}:${candidate.strategy}`
}

function watchDigestIntervalMs() {
  return envMinutes('DISCORD_WATCH_DIGEST_INTERVAL_MINUTES', 5) * 60_000
}

function watchDigestEditWindowMs() {
  return envMinutes('DISCORD_WATCH_DIGEST_EDIT_WINDOW_MINUTES', 60) * 60_000
}

function watchDigestStaleMs() {
  return Math.max(watchDigestIntervalMs(), envMinutes('DISCORD_WATCH_DIGEST_STALE_MINUTES', 8) * 60_000)
}

function botStatusIntervalMs() {
  return envMinutes('DISCORD_BOT_STATUS_INTERVAL_MINUTES', 3) * 60_000
}

function botStatusEditWindowMs() {
  return envMinutes('DISCORD_BOT_STATUS_EDIT_WINDOW_MINUTES', 360) * 60_000
}

function watchDigestLine(entry: WatchDigestEntry) {
  const candidate = entry.candidate
  const trigger = candidate.signal.entryTrigger === null ? 'n/a' : price(candidate.signal.entryTrigger)
  const blockers = candidate.blockers.length ? candidate.blockers.slice(0, 2).join(', ') : candidate.signal.label
  return `${candidate.displaySymbol}: ${price(candidate.price)} | score ${candidate.score} | trigger ${trigger} | ${blockers}`
}

function flushWatchDigest() {
  const state = runtime()
  state.watchFlushTimer = null
  if (!webhookConfigured('alerts')) return

  const now = Date.now()
  const freshEntries = [...state.watchDigest.values()]
    .filter((entry) => now - entry.lastSeen <= watchDigestStaleMs())
    .sort((a, b) => b.candidate.score - a.candidate.score)

  state.watchDigest.clear()
  for (const entry of freshEntries) state.watchDigest.set(signalKey(entry.candidate), entry)
  if (freshEntries.length === 0) return
  if (state.lastWatchDigestAt > 0 && now - state.lastWatchDigestAt < watchDigestIntervalMs()) return

  state.lastWatchDigestAt = now
  const visible = freshEntries.slice(0, 10)
  const more = freshEntries.length > visible.length ? `\n+${freshEntries.length - visible.length} more WATCH row(s)` : ''
  enqueueWatchDigest({
    title: `WATCH DIGEST - ${freshEntries.length} setup(s)`,
    description: compact(`${visible.map(watchDigestLine).join('\n')}${more}`, 3500),
    color: AMBER,
    fields: [
      {
        name: 'Meaning',
        value: 'Grouped WATCH rows only. These are not entries; CHECK NOW still sends as its own immediate alert.',
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `${FOOTER} - grouped every ${envMinutes('DISCORD_WATCH_DIGEST_INTERVAL_MINUTES', 5)} min` },
  })
}

function scheduleWatchDigestFlush() {
  const state = runtime()
  if (state.watchFlushTimer) return
  const now = Date.now()
  const elapsed = state.lastWatchDigestAt === 0 || now - state.lastWatchDigestAt >= watchDigestIntervalMs()
  if (!elapsed) return
  state.watchFlushTimer = setTimeout(flushWatchDigest, 1_500)
}

function rememberWatchCandidate(candidate: MomentumCandidate) {
  const state = runtime()
  const now = Date.now()
  const key = signalKey(candidate)
  const previous = state.watchDigest.get(key)
  state.watchDigest.set(key, {
    candidate,
    firstSeen: previous?.firstSeen ?? now,
    lastSeen: now,
  })
  scheduleWatchDigestFlush()
}

export function maybeNotifyDiscordSignal(candidate: MomentumCandidate) {
  // Both asset classes alert here now: with crypto enabled (and especially while
  // the US stock session is closed) the radar's WATCH/CHECK NOW crypto rows are
  // exactly what the signals webhook should surface.
  if (candidate.assetClass !== 'stock' && candidate.assetClass !== 'crypto') return
  if (candidate.status !== 'WATCH' && candidate.status !== 'CHECK NOW') return
  if (candidate.signal.action !== 'BUY' && candidate.signal.action !== 'WAIT') return
  if (!webhookConfigured('alerts')) return

  if (candidate.status === 'WATCH') {
    runtime().signals.set(signalKey(candidate), {
      status: candidate.status,
      fingerprint: signalFingerprint(candidate),
      sentAt: Date.now(),
    })
    rememberWatchCandidate(candidate)
    return
  }

  const state = runtime()
  const key = signalKey(candidate)
  const fingerprint = signalFingerprint(candidate)
  const previous = state.signals.get(key)
  const now = Date.now()
  if (previous?.status === 'CHECK NOW' && previous.fingerprint === fingerprint) return

  state.signals.set(key, { status: candidate.status, fingerprint, sentAt: now })
  const strict = true
  enqueue({
    title: `${strict ? '📡 CHECK NOW' : '👀 WATCH'} · ${candidate.displaySymbol}`,
    description: compact(`${candidate.company} — ${candidate.signal.thesis}`),
    color: strict ? GREEN : AMBER,
    fields: [
      { name: 'Price / move', value: `${price(candidate.price)} · ${percent(candidate.changePct)}`, inline: true },
      { name: 'Score / strategy', value: `${candidate.score} · ${candidate.strategy}`, inline: true },
      { name: 'Session', value: candidate.marketStatusLabel, inline: true },
      { name: 'Entry trigger', value: price(candidate.signal.entryTrigger), inline: true },
      { name: 'Stop', value: price(candidate.signal.stopLoss), inline: true },
      { name: 'Targets', value: `${price(candidate.signal.targetOne)} / ${price(candidate.signal.targetTwo)}`, inline: true },
      {
        name: 'Important',
        value: strict
          ? 'Signal only. The deterministic bot still checks spread, confirmation, buying power, duplication, and broker acceptance.'
          : 'Watch only—not an entry. Wait for CHECK NOW and the bot execution gates.',
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: FOOTER },
  })
}

export function notifyDiscordTrade(trade: TradeNotification) {
  if (!webhookConfigured('trades')) return
  const opened = trade.side === 'buy'
  enqueue({
    title: `${opened ? '🟢 PAPER TRADE OPENED' : '🔴 PAPER TRADE CLOSED'} · ${trade.symbol}`,
    description: compact(trade.reason),
    color: opened ? GREEN : trade.pnl !== null && trade.pnl >= 0 ? BLUE : RED,
    fields: [
      { name: 'Mode', value: trade.mode, inline: true },
      { name: 'Fill price', value: price(trade.price), inline: true },
      { name: 'Quantity', value: trade.qty === null ? 'n/a' : String(trade.qty), inline: true },
      { name: 'Notional', value: money(trade.notional), inline: true },
      { name: 'P&L', value: opened ? 'Open' : `${money(trade.pnl)} (${percent(trade.pnlPct)})`, inline: true },
      { name: 'Outcome', value: trade.outcome, inline: true },
    ],
    timestamp: trade.time,
    footer: { text: TRADE_FOOTER },
  }, 'trades')
}

function statusPositionsText(status: StatusNotification) {
  return status.positions.length
    ? status.positions
        .slice(0, 8)
        .map((position) => `${position.symbol}: ${money(position.unrealizedPl)} (${percent(position.unrealizedPlPct)})`)
        .join('\n')
    : 'No open positions'
}

function statusRowsText(rows: StatusNotification['watch']) {
  return rows.length
    ? rows
        .slice(0, 8)
        .map((row) => `${row.symbol}: ${row.status} - ${row.state} - ${row.note}`)
        .join('\n')
    : 'No active rows'
}

function closedPnlText(status: StatusNotification) {
  return `${status.closedTrades} closed\nGross ${money(status.realizedPl)}\nModeled net ${money(status.netRealizedPl)}`
}

function maybeNotifyAlertStatus(status: StatusNotification) {
  if (!webhookConfigured('alerts') || !status.running || !status.stockSessionTradable) return
  const state = runtime()
  const now = Date.now()
  const intervalMs = envMinutes('DISCORD_STATUS_INTERVAL_MINUTES', 10) * 60_000
  if (now - state.lastStatusAt < intervalMs) return
  state.lastStatusAt = now

  const positionText = status.positions.length
    ? status.positions
        .slice(0, 8)
        .map((position) => `${position.symbol}: ${money(position.unrealizedPl)} (${percent(position.unrealizedPlPct)})`)
        .join('\n')
    : 'No open positions'
  const watchText = status.watch.length
    ? status.watch
        .slice(0, 8)
        .map((row) => `${row.symbol}: ${row.status} · ${row.state} · ${row.note}`)
        .join('\n')
    : 'No active WATCH/CHECK rows'

  enqueue({
    title: `📊 BOT STATUS · ${status.mode.toUpperCase()}`,
    description: status.lastError ? `⚠️ ${compact(status.lastError, 300)}` : `${status.modeLabel} · healthy`,
    color: status.lastError ? RED : BLUE,
    fields: [
      { name: 'Account', value: `Equity ${money(status.equity)}\nCash ${money(status.cash)}`, inline: true },
      { name: 'Activity', value: `Armed ${status.armed}\nTriggered ${status.triggered}`, inline: true },
      { name: 'Closed P/L', value: closedPnlText(status), inline: true },
      { name: 'Positions', value: compact(positionText) },
      { name: 'Radar watch', value: compact(watchText) },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `${FOOTER} · automatic 10-minute update` },
  })
}

function maybeNotifyTradeBotStatus(status: StatusNotification) {
  if (!webhookConfigured('bot') || !status.running) return
  const state = runtime()
  const now = Date.now()
  if (now - state.lastBotStatusAt < botStatusIntervalMs()) return
  state.lastBotStatusAt = now

  const activeRows = status.watch.filter(
    (row) => row.state === 'holding' || row.state === 'triggered' || row.state === 'armed',
  )
  const blockedRows = status.watch.filter(
    (row) => row.state !== 'holding' && row.state !== 'triggered' && row.state !== 'armed',
  )
  const description = status.lastError
    ? `WARNING: ${compact(status.lastError, 300)}`
    : `${status.modeLabel} - ${status.stockSessionTradable ? 'market tradable' : 'market not tradable'}`
  const color = status.lastError ? RED : status.positions.length > 0 ? GREEN : activeRows.length > 0 ? AMBER : BLUE

  enqueueBotStatus({
    title: `BOT WATCH - ${status.mode.toUpperCase()}`,
    description,
    color,
    fields: [
      { name: 'Account', value: `Equity ${money(status.equity)}\nCash ${money(status.cash)}`, inline: true },
      { name: 'Activity', value: `Armed ${status.armed}\nTriggered ${status.triggered}`, inline: true },
      { name: 'Closed P/L', value: closedPnlText(status), inline: true },
      { name: 'Server vitals', value: serverVitalsText(), inline: true },
      { name: 'Positions', value: compact(statusPositionsText(status), 1000) },
      { name: 'Triggered / armed / holding', value: compact(statusRowsText(activeRows), 1000) },
      { name: 'Watching / blocked', value: compact(statusRowsText(blockedRows), 1200) },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `${TRADE_FOOTER} - live bot view every ${envMinutes('DISCORD_BOT_STATUS_INTERVAL_MINUTES', 3)} min` },
  })
}

export function maybeNotifyDiscordStatus(status: StatusNotification) {
  maybeNotifyAlertStatus(status)
  maybeNotifyTradeBotStatus(status)
}

export async function sendDiscordTestNotification() {
  const sent = await executeWebhook({
    title: '✅ Dawn trading notifications connected',
    description: 'Discord will receive WATCH/CHECK NOW signals, confirmed paper-trade entries/exits, and 10-minute status updates during tradable US stock sessions.',
    color: GREEN,
    timestamp: new Date().toISOString(),
    footer: { text: FOOTER },
  })
  if (sent) {
    const state = runtime()
    state.sentCount += 1
    state.lastSuccessAt = new Date().toISOString()
    state.lastError = null
  }
  return Boolean(sent)
}

export function discordNotificationConfiguration() {
  const state = runtime()
  const configured = webhookConfigured('alerts')
  const tradeConfigured = webhookConfigured('trades')
  const botConfigured = webhookConfigured('bot')
  return {
    configured,
    tradeConfigured,
    botConfigured,
    statusIntervalMinutes: envMinutes('DISCORD_STATUS_INTERVAL_MINUTES', 10),
    botStatusIntervalMinutes: envMinutes('DISCORD_BOT_STATUS_INTERVAL_MINUTES', 3),
    botStatusEditWindowMinutes: envMinutes('DISCORD_BOT_STATUS_EDIT_WINDOW_MINUTES', 360),
    signalCooldownMinutes: envMinutes('DISCORD_SIGNAL_COOLDOWN_MINUTES', 30),
    watchDigestIntervalMinutes: envMinutes('DISCORD_WATCH_DIGEST_INTERVAL_MINUTES', 5),
    watchDigestEditWindowMinutes: envMinutes('DISCORD_WATCH_DIGEST_EDIT_WINDOW_MINUTES', 60),
    watchDigestRowsQueued: state.watchDigest.size,
    watchDigestMessageActive: state.lastWatchDigestMessageId !== null,
    sentCount: state.sentCount,
    editCount: state.editCount,
    tradeSentCount: state.tradeSentCount,
    botStatusSentCount: state.botStatusSentCount,
    botStatusEditCount: state.botStatusEditCount,
    botStatusMessageActive: state.lastBotStatusMessageId !== null,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    tradeLastSuccessAt: state.tradeLastSuccessAt,
    tradeLastError: state.tradeLastError,
  }
}
