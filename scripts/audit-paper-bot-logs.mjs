#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = new Map()
const flags = new Set()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const key = arg.slice(2)
  const next = process.argv[i + 1]
  if (next && !next.startsWith('--')) {
    args.set(key, next)
    i += 1
  } else {
    flags.add(key)
  }
}

if (flags.has('help')) {
  printHelp()
  process.exit(0)
}

const files = {
  log: resolve(args.get('log') ?? 'logs/bot-server.log'),
  trades: resolve(args.get('trades') ?? 'paper-bot-trades.csv'),
  review: resolve(args.get('review') ?? 'paper-bot-review.jsonl'),
  equity: resolve(args.get('equity') ?? 'paper-bot-equity.json'),
  decisions: resolve(args.get('decisions') ?? 'paper-bot-decisions.jsonl'),
}
const stateUrl = args.get('state-url') ?? 'http://127.0.0.1:5173/api/paper-bot/state'
const recentLines = Math.max(100, numberArg('recent-lines', 1200))
const maxSkipPct = numberArg('max-skip-pct', 5)
const maxHeartbeatAgeMinutes = numberArg('max-heartbeat-age-minutes', 10)
const maxHeartbeatGapMinutes = numberArg('max-heartbeat-gap-minutes', 30)

const findings = []
const context = {}

await main()

async function main() {
  auditServerLog()
  auditTrades()
  auditReview()
  auditEquityHeartbeat()
  auditDecisionTrail()
  await auditCurrentState()
  printReport()
  process.exit(findings.some((finding) => finding.level === 'FAIL') ? 2 : 0)
}

function auditServerLog() {
  const log = readText(files.log)
  if (log === null) {
    add('FAIL', 'Server log missing', `No bot server log found at ${files.log}.`)
    return
  }
  const lines = log.split(/\r?\n/).filter(Boolean)
  // The supervisor can restart Vite without restarting the outer Windows
  // launcher. Treat the latest child-process start as the current run so an old
  // hot-reload timeout remains historical instead of poisoning today's health
  // rate until hundreds of new tick lines have accumulated.
  const lastProcessStart = findLastIndex(lines, /Windows server launcher starting|\[dev-forever [^\]]+\] starting Vite/)
  const recentStart = Math.max(lastProcessStart >= 0 ? lastProcessStart : 0, lines.length - recentLines)
  const recent = lines.slice(recentStart)
  const totalActiveTicks = countLines(lines, /TICK active \|/)
  const totalSkippedTicks = countLines(lines, /previous tick still running/)
  const recentActiveTicks = countLines(recent, /TICK active \|/)
  const recentSkippedTicks = countLines(recent, /previous tick still running/)
  const recentTickTotal = recentActiveTicks + recentSkippedTicks
  const recentSkipPct = recentTickTotal > 0 ? (recentSkippedTicks / recentTickTotal) * 100 : 0
  const fetchFailures = countLines(lines, /ERROR Tick failed: fetch failed/)
  const zeroQuantitySkips = countLines(lines, /Sized quantity 0 is 0; skipping entry/)
  const seriousErrors = lines.filter((line) =>
    /\[paper-bot\] ERROR|unhandledRejection|Buy failed|Sell failed|rejected/i.test(stripAnsi(line)),
  )
  const recentSeriousErrors = recent.filter((line) =>
    /\[paper-bot\] ERROR|unhandledRejection|Buy failed|Sell failed|rejected|MaxListenersExceededWarning/i.test(stripAnsi(line)),
  )
  const starts = countLines(lines, /started: Active|started: Safe|started: Turbo/)
  const launcherStarts = countLines(lines, /Windows server launcher starting/)

  context.server = {
    totalActiveTicks,
    totalSkippedTicks,
    recentActiveTicks,
    recentSkippedTicks,
    recentSkipPct,
    fetchFailures,
    zeroQuantitySkips,
    seriousErrors: seriousErrors.length,
    recentSeriousErrors: recentSeriousErrors.length,
    starts,
    launcherStarts,
  }

  if (recentTickTotal === 0) {
    add('WARN', 'No recent tick lines', `The last ${recent.length} log line(s) do not contain active/scanning tick summaries.`)
  } else if (recentSkipPct > maxSkipPct) {
    add(
      'WARN',
      'Skipped tick rate high',
      `Recent skipped ticks are ${recentSkippedTicks}/${recentTickTotal} (${pct(recentSkipPct)}), above the ${pct(maxSkipPct)} review limit.`,
    )
  } else {
    add(
      'PASS',
      'Skipped tick rate acceptable',
      `Recent skipped ticks are ${recentSkippedTicks}/${recentTickTotal} (${pct(recentSkipPct)}).`,
    )
  }

  if (fetchFailures > 0) {
    add('WARN', 'Network/data fetch failures observed', `${fetchFailures} tick-level fetch failure(s) exist in the server log.`)
  } else {
    add('PASS', 'No tick fetch failures logged', 'The server log has no tick-level fetch failures.')
  }

  if (recentSeriousErrors.length > 0) {
    add('WARN', 'Recent error lines need review', `${recentSeriousErrors.length} error/rejection/warning line(s) exist in the last ${recent.length} server log line(s).`)
  } else if (seriousErrors.length > 0) {
    add('INFO', 'Historical error lines exist', `${seriousErrors.length} older error/rejection line(s) exist in the full server log.`)
  } else {
    add('PASS', 'No serious server errors logged', 'No error/rejection lines were found in the full server log.')
  }

  if (zeroQuantitySkips > 0) {
    add(
      'WARN',
      'Triggered entries can be unsizeable',
      `${zeroQuantitySkips} zero-quantity skip(s) were logged. This usually means an expensive stock triggered but the current paper whole-share/risk budget could not buy 1 share.`,
    )
  }
}

function auditTrades() {
  const text = readText(files.trades)
  if (text === null) {
    add('WARN', 'Trade CSV missing', `No closed-trade CSV found at ${files.trades}.`)
    return
  }
  const trades = parseCsv(text).map(cleanTrade).filter(Boolean)
  context.trades = summarizeTrades(trades)
  if (trades.length === 0) {
    add('WARN', 'No closed trades', 'The CSV exists, but there are no closed trades to audit yet.')
    return
  }

  const summary = context.trades
  if (trades.length < 30) {
    add('WARN', 'Trade sample very small', `${trades.length} closed trade(s) is not enough to judge edge quality.`)
  }
  if (summary.netPnl < 0) {
    add('FAIL', 'Closed-trade expectancy is negative', `Net P/L is ${money(summary.netPnl)} over ${trades.length} trade(s), ${money(summary.netExpectancy)} per trade.`)
  } else {
    add('PASS', 'Closed-trade expectancy is positive', `Net P/L is ${money(summary.netPnl)}, ${money(summary.netExpectancy)} per trade.`)
  }
  if (summary.netProfitFactor < 1) {
    add('FAIL', 'Net profit factor below 1.0', `Net profit factor is ${ratio(summary.netProfitFactor)}; losses exceed wins after modeled costs.`)
  } else if (summary.netProfitFactor < 1.1) {
    add('WARN', 'Net profit factor is thin', `Net profit factor is ${ratio(summary.netProfitFactor)}; require more cushion before trusting it.`)
  } else {
    add('PASS', 'Net profit factor clears minimum', `Net profit factor is ${ratio(summary.netProfitFactor)}.`)
  }

  const losersThatNeverMoved = trades.filter((trade) => trade.netPnl < 0 && finiteOr(trade.maxFavorableR, 0) <= 0.25)
  if (losersThatNeverMoved.length > 0) {
    add(
      'WARN',
      'Entries often failed immediately',
      `${losersThatNeverMoved.length}/${summary.losses} losing trade(s) had <= 0.25R favorable excursion before exit: ${symbols(losersThatNeverMoved)}.`,
    )
  }

  const beyondOneR = trades.filter((trade) => trade.netPnl < 0 && finiteOr(trade.maxAdverseR, 0) > 1.05)
  if (beyondOneR.length > 0) {
    add(
      'WARN',
      'Losses exceeded planned 1R',
      `${beyondOneR.length} losing trade(s) went beyond 1.05R adverse excursion: ${symbols(beyondOneR)}.`,
    )
  }

  const lowPulseEntries = trades.filter((trade) => trade.assetClass === 'stock' && finiteOr(trade.volumePulse, 0) < 1.25)
  if (lowPulseEntries.length > 0) {
    add(
      'INFO',
      'Low live-pulse stock entries present',
      `${lowPulseEntries.length} stock trade(s) had live pulse <1.25x. These may be allowed by time-adjusted rVol, but deserve watch-list review: ${symbols(lowPulseEntries)}.`,
    )
  }
}

function auditReview() {
  const text = readText(files.review)
  if (text === null) return
  const rows = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const issueCounts = new Map()
  let lowScoreReversionEntries = 0
  for (const row of rows) {
    const issue = row.review?.primaryIssue
    if (!issue) continue
    issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1)
  }
  for (const row of rows) {
    if (row.eventType !== 'entry') continue
    if (row.trade?.mode !== 'active') continue
    if (row.setup?.entryMode === 'reversion' && Number(row.setup?.score) < 90) lowScoreReversionEntries += 1
  }
  context.review = { rows: rows.length, issueCounts: [...issueCounts.entries()] }
  const topIssue = [...issueCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topIssue) {
    add('INFO', 'Repeated review issue', `${topIssue[1]} review row(s): ${topIssue[0]}`)
  }
  if (lowScoreReversionEntries > 0) {
    add(
      'INFO',
      'Reversion uses a separate score floor',
      `${lowScoreReversionEntries} active reversion entry/entries scored below the active 90+ momentum floor. Current code allows reversion down to 70+ and now exposes that separate floor in the API/UI.`,
    )
  }
}

function auditEquityHeartbeat() {
  const text = readText(files.equity)
  if (text === null) {
    add('WARN', 'Equity heartbeat missing', `No equity heartbeat file found at ${files.equity}.`)
    return
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    add('WARN', 'Equity heartbeat unreadable', 'paper-bot-equity.json is not valid JSON.')
    return
  }
  const points = Array.isArray(parsed.points)
    ? parsed.points
        .map((point) => ({ ...point, tMs: Date.parse(point.t) }))
        .filter((point) => Number.isFinite(point.tMs))
        .sort((a, b) => a.tMs - b.tMs)
    : []
  if (points.length === 0) {
    add('WARN', 'No equity heartbeat points', 'The equity heartbeat file has no timestamped points.')
    return
  }
  const latest = points[points.length - 1]
  const ageMinutes = (Date.now() - latest.tMs) / 60_000
  let maxGapMinutes = 0
  let maxGapAfter = null
  for (let i = 1; i < points.length; i += 1) {
    const gap = (points[i].tMs - points[i - 1].tMs) / 60_000
    if (gap > maxGapMinutes) {
      maxGapMinutes = gap
      maxGapAfter = points[i - 1].t
    }
  }
  context.equity = { points: points.length, latest: latest.t, ageMinutes, maxGapMinutes, maxGapAfter }
  if (ageMinutes > maxHeartbeatAgeMinutes) {
    add('FAIL', 'Live heartbeat stale', `Latest equity point is ${minutes(ageMinutes)} old (${latest.t}).`)
  } else {
    add('PASS', 'Live heartbeat fresh', `Latest equity point is ${minutes(ageMinutes)} old (${latest.t}).`)
  }
  if (maxGapMinutes > maxHeartbeatGapMinutes) {
    add(
      'WARN',
      'Historical heartbeat gaps exist',
      `Largest equity heartbeat gap is ${minutes(maxGapMinutes)} after ${maxGapAfter}. This indicates the bot/server was not continuously sampling at least once.`,
    )
  }
}

function auditDecisionTrail() {
  if (!existsSync(files.decisions)) {
    add(
      'WARN',
      'No per-candidate decision trail',
      'Current logs summarize counts and final trades, but do not durably record each symbol state per tick. That limits post-mortems for armed-then-vanished cases.',
    )
  } else {
    add('PASS', 'Per-candidate decision trail present', `Found ${files.decisions}.`)
  }
}

async function auditCurrentState() {
  if (flags.has('no-state')) return
  let state
  try {
    const response = await fetch(stateUrl, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    state = await response.json()
  } catch (error) {
    add('WARN', 'Live state endpoint unavailable', `${stateUrl} could not be read: ${error.message}`)
    return
  }
  const lastTickMs = Date.parse(state.lastTickAt)
  const lastTickAgeSeconds = Number.isFinite(lastTickMs) ? (Date.now() - lastTickMs) / 1000 : Number.NaN
  const currentTriggered = Array.isArray(state.watch) ? state.watch.filter((row) => row.state === 'triggered').length : 0
  const stateLog = Array.isArray(state.log) ? state.log : []
  const liveZeroQuantitySkips = stateLog.filter((row) => /Sized quantity 0 is 0; skipping entry/.test(String(row.message ?? '')))
  context.state = {
    running: state.running,
    mode: state.mode,
    armed: state.armed,
    triggered: state.triggered,
    currentTriggered,
    positions: Array.isArray(state.positions) ? state.positions.length : 0,
    lastTickAgeSeconds,
    lastError: state.lastError ?? null,
    liveZeroQuantitySkips: liveZeroQuantitySkips.length,
  }
  if (!state.running) {
    add('FAIL', 'Bot is not running', `Live state reports running=${state.running}.`)
  } else if (Number.isFinite(lastTickAgeSeconds) && lastTickAgeSeconds > 45) {
    add('WARN', 'Live tick is lagging', `Last tick is ${lastTickAgeSeconds.toFixed(0)}s old.`)
  } else {
    add('PASS', 'Live bot state healthy', `Mode=${state.mode}, armed=${state.armed}, session entries=${state.triggered}, current triggered rows=${currentTriggered}.`)
  }
  if (state.lastError) {
    add('WARN', 'Live state reports lastError', String(state.lastError))
  }
  if (liveZeroQuantitySkips.length > 0) {
    const symbolsText = [...new Set(liveZeroQuantitySkips.map((row) => row.symbol).filter(Boolean))].join(', ')
    add(
      'WARN',
      'Live triggered setup cannot size',
      `${liveZeroQuantitySkips.length} recent live log row(s) show zero-quantity entry skips${symbolsText ? ` for ${symbolsText}` : ''}. This explains a triggered row that does not become an order.`,
    )
  }
}

function summarizeTrades(trades) {
  const wins = trades.filter((trade) => trade.netPnl > 0)
  const losses = trades.filter((trade) => trade.netPnl < 0)
  const netPnl = sum(trades, (trade) => trade.netPnl)
  const grossPnl = sum(trades, (trade) => trade.grossPnl)
  const estimatedCost = sum(trades, (trade) => trade.estCost)
  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    netPnl,
    grossPnl,
    estimatedCost,
    netExpectancy: trades.length ? netPnl / trades.length : 0,
    winRate: trades.length ? wins.length / trades.length : 0,
    netProfitFactor: profitFactor(wins, losses),
  }
}

function parseCsv(content) {
  const records = []
  let field = ''
  let row = []
  let quoted = false
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    const next = content[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  const header = records.shift()?.map((cell) => cell.trim()) ?? []
  return records
    .filter((record) => record.some((cell) => cell.trim() !== ''))
    .map((record) => Object.fromEntries(header.map((key, index) => [key, record[index] ?? ''])))
}

function cleanTrade(row) {
  const timestampMs = Date.parse(row.timestamp)
  const grossPnl = numberCell(row.grossPnl)
  const netPnl = numberCell(row.netPnl)
  if (!Number.isFinite(timestampMs) || !Number.isFinite(grossPnl) || !Number.isFinite(netPnl)) return null
  return {
    timestamp: row.timestamp,
    symbol: row.symbol || 'unknown',
    assetClass: row.assetClass || 'unknown',
    exitReason: row.exitReason || 'unknown',
    outcome: row.outcome || 'unknown',
    score: numberCell(row.score),
    volumePulse: numberCell(row.volumePulse),
    maxFavorableR: numberCell(row.maxFavorableR),
    maxAdverseR: numberCell(row.maxAdverseR),
    grossPnl,
    estCost: numberCell(row.estCost),
    netPnl,
  }
}

function readText(file) {
  if (!existsSync(file)) return null
  const buffer = readFileSync(file)
  const sample = buffer.subarray(0, Math.min(buffer.length, 2000))
  let nulBytes = 0
  for (const byte of sample) {
    if (byte === 0) nulBytes += 1
  }
  return nulBytes > sample.length * 0.1 ? buffer.toString('utf16le') : buffer.toString('utf8')
}

function add(level, title, detail) {
  findings.push({ level, title, detail })
}

function findLastIndex(items, pattern) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (pattern.test(stripAnsi(items[index]))) return index
  }
  return -1
}

function countLines(lines, pattern) {
  return lines.reduce((count, line) => count + (pattern.test(stripAnsi(line)) ? 1 : 0), 0)
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function numberArg(name, fallback) {
  const value = Number(args.get(name))
  return Number.isFinite(value) ? value : fallback
}

function numberCell(value) {
  if (value === null || value === undefined || value === '') return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0)
}

function profitFactor(wins, losses) {
  const grossWin = sum(wins, (trade) => trade.netPnl)
  const grossLoss = Math.abs(sum(losses, (trade) => trade.netPnl))
  if (grossLoss === 0) return grossWin > 0 ? Number.POSITIVE_INFINITY : 0
  return grossWin / grossLoss
}

function symbols(trades) {
  return [...new Set(trades.map((trade) => trade.symbol))].slice(0, 8).join(', ')
}

function money(value) {
  if (!Number.isFinite(value)) return 'n/a'
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toFixed(2)}`
}

function pct(value) {
  if (!Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(2)}%`
}

function ratio(value) {
  if (value === Number.POSITIVE_INFINITY) return 'inf'
  if (!Number.isFinite(value)) return 'n/a'
  return value.toFixed(2)
}

function minutes(value) {
  if (!Number.isFinite(value)) return 'n/a'
  if (value < 1) return `${Math.max(0, value * 60).toFixed(0)}s`
  if (value < 120) return `${value.toFixed(1)}m`
  return `${(value / 60).toFixed(1)}h`
}

function printReport() {
  const order = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 }
  console.log('\nPaper bot operational audit')
  console.log(`State URL: ${flags.has('no-state') ? 'skipped' : stateUrl}`)
  if (context.trades) {
    console.log(
      `Trades: ${context.trades.count}, win ${pct(context.trades.winRate * 100)}, net ${money(context.trades.netPnl)}, PF ${ratio(context.trades.netProfitFactor)}`,
    )
  }
  if (context.server) {
    console.log(
      `Server: recent skips ${context.server.recentSkippedTicks}/${context.server.recentActiveTicks + context.server.recentSkippedTicks} (${pct(context.server.recentSkipPct)}), recent errors ${context.server.recentSeriousErrors}, fetch failures ${context.server.fetchFailures}, zero-qty skips ${context.server.zeroQuantitySkips}`,
    )
  }
  console.log('\nFindings')
  for (const finding of [...findings].sort((a, b) => order[a.level] - order[b.level])) {
    console.log(`${finding.level}: ${finding.title} - ${finding.detail}`)
  }
  console.log('\nAudit note: this script changes no strategy settings and places no orders.')
}

function printHelp() {
  console.log(`
Usage:
  node scripts/audit-paper-bot-logs.mjs [options]

Options:
  --log <path>                         Server log path. Default: logs/bot-server.log
  --trades <path>                      Trade CSV path. Default: paper-bot-trades.csv
  --review <path>                      Review JSONL path. Default: paper-bot-review.jsonl
  --equity <path>                      Equity heartbeat JSON path. Default: paper-bot-equity.json
  --decisions <path>                   Decision JSONL path. Default: paper-bot-decisions.jsonl
  --state-url <url>                    Live state endpoint. Default: http://127.0.0.1:5173/api/paper-bot/state
  --no-state                           Do not query the live state endpoint.
  --recent-lines <number>              Log tail size for skip-rate check. Default: 1200
  --max-skip-pct <number>              Warn above this recent skipped-tick percent. Default: 5
  --max-heartbeat-age-minutes <number> Fail above this live heartbeat age. Default: 10
  --max-heartbeat-gap-minutes <number> Warn above this historical heartbeat gap. Default: 30
  --help                               Show this message.
`)
}
