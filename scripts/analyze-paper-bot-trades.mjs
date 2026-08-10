#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
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

const file = resolve(args.get('file') ?? 'paper-bot-trades.csv')
const modeFilter = args.get('mode')?.toLowerCase()
const minTrades = numberArg('min-trades', 100)
const equity = numberArg('equity', Number.NaN)
const outOfSampleSince = args.get('since') ? Date.parse(args.get('since')) : Number.NaN
const maxDrawdownPctLimit = numberArg('max-drawdown-pct', Number.NaN)
const targetAnnualReturn = numberArg('target-annual-return', Number.NaN)
const watchMode = flags.has('watch')
const intervalSeconds = Math.max(5, numberArg('interval-seconds', 60))
let lastFingerprint = null

if (flags.has('help')) {
  printHelp()
  process.exit(0)
}

if (watchMode) {
  console.log(`[paper-bot-analyzer] watching ${file}; interval ${intervalSeconds}s`)
  runWatchCycle(true)
  setInterval(() => runWatchCycle(false), intervalSeconds * 1000)
} else {
  const status = runOnce({ quietWaiting: false })
  process.exit(status)
}

function runWatchCycle(force) {
  const fingerprint = fileFingerprint()
  if (!force && fingerprint === lastFingerprint) return
  lastFingerprint = fingerprint
  runOnce({ quietWaiting: true })
}

function fileFingerprint() {
  if (!existsSync(file)) return 'missing'
  const stat = statSync(file)
  return `${stat.size}:${Math.round(stat.mtimeMs)}`
}

function runOnce({ quietWaiting }) {
  if (!existsSync(file)) {
    const line = `No trade log found at ${file}; waiting for the first closed trade.`
    if (watchMode || quietWaiting) console.log(`[paper-bot-analyzer] ${line}`)
    else console.error(line)
    return watchMode || quietWaiting ? 0 : 1
  }

  const rows = parseCsv(readFileSync(file, 'utf8'))
  if (rows.length === 0) {
    const line = `Trade log ${file} has no data rows yet.`
    if (watchMode || quietWaiting) console.log(`[paper-bot-analyzer] ${line}`)
    else console.error(line)
    return watchMode || quietWaiting ? 0 : 1
  }

  const closedTrades = rows
    .map(cleanRow)
    .filter((row) => row !== null)
    .filter((row) => !modeFilter || row.mode.toLowerCase() === modeFilter)
    .filter((row) => Number.isNaN(outOfSampleSince) || row.timestampMs >= outOfSampleSince)
    .sort((a, b) => a.timestampMs - b.timestampMs)

  if (closedTrades.length === 0) {
    const line = 'No closed trades matched the requested filters.'
    if (watchMode || quietWaiting) console.log(`[paper-bot-analyzer] ${line}`)
    else console.error(line)
    return watchMode || quietWaiting ? 0 : 1
  }

  const summary = summarize(closedTrades)
  const issues = promotionIssues(summary)

  printSummary(summary)
  printBuckets('By mode', bucketBy(closedTrades, (row) => row.mode))
  printBuckets('By asset class', bucketBy(closedTrades, (row) => row.assetClass || 'unknown'))
  printBuckets('By score bucket', bucketBy(closedTrades, scoreBucket))
  printBuckets('By volume-pulse bucket', bucketBy(closedTrades, pulseBucket))
  printBuckets('By exit reason', bucketBy(closedTrades, (row) => row.exitReason || 'unknown'))

  console.log('\nPromotion checklist')
  for (const issue of issues) {
    console.log(`${issue.level}: ${issue.text}`)
  }

  return issues.some((issue) => issue.level === 'FAIL') ? 2 : 0
}

function numberArg(name, fallback) {
  if (!args.has(name)) return fallback
  const value = Number(args.get(name))
  return Number.isFinite(value) ? value : fallback
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

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
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

function cleanRow(row) {
  const timestampMs = Date.parse(row.timestamp)
  const grossPnl = numberCell(row.grossPnl)
  const estCost = numberCell(row.estCost)
  const netPnl = numberCell(row.netPnl)
  if (!Number.isFinite(timestampMs) || !Number.isFinite(grossPnl) || !Number.isFinite(netPnl)) return null
  return {
    timestamp: row.timestamp,
    timestampMs,
    mode: row.mode || 'unknown',
    symbol: row.symbol || '',
    assetClass: row.assetClass || 'unknown',
    exitReason: row.exitReason || 'unknown',
    outcome: row.outcome || '',
    holdSeconds: numberCell(row.holdSeconds),
    notional: numberCell(row.notional),
    spreadPct: numberCell(row.spreadPct),
    score: numberCell(row.score),
    aboveVwap: row.aboveVwap === '1',
    volumePulse: numberCell(row.volumePulse),
    grossPnl,
    estCost: Number.isFinite(estCost) ? estCost : Math.max(0, grossPnl - netPnl),
    netPnl,
    maxFavorableR: numberCell(row.maxFavorableR),
    maxAdverseR: numberCell(row.maxAdverseR),
  }
}

function numberCell(value) {
  if (value === null || value === undefined || value === '') return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function summarize(trades) {
  const grossPnl = sum(trades, (row) => row.grossPnl)
  const estCost = sum(trades, (row) => row.estCost)
  const netPnl = sum(trades, (row) => row.netPnl)
  const netWins = trades.filter((row) => row.netPnl > 0)
  const netLosses = trades.filter((row) => row.netPnl < 0)
  const grossWins = trades.filter((row) => row.grossPnl > 0)
  const grossLosses = trades.filter((row) => row.grossPnl < 0)
  const startMs = trades[0].timestampMs
  const endMs = trades[trades.length - 1].timestampMs
  const days = Math.max(1 / 24, (endMs - startMs) / 86_400_000)
  const drawdown = maxDrawdown(trades)
  const annualizedReturnPct =
    Number.isFinite(equity) && equity > 0 ? ((netPnl / equity) * (365 / days)) * 100 : Number.NaN

  return {
    trades,
    count: trades.length,
    startMs,
    endMs,
    days,
    grossPnl,
    estCost,
    netPnl,
    netExpectancy: netPnl / trades.length,
    grossExpectancy: grossPnl / trades.length,
    netWinRate: netWins.length / trades.length,
    grossWinRate: grossWins.length / trades.length,
    avgNetWin: netWins.length ? sum(netWins, (row) => row.netPnl) / netWins.length : 0,
    avgNetLoss: netLosses.length ? sum(netLosses, (row) => row.netPnl) / netLosses.length : 0,
    grossProfitFactor: profitFactor(grossWins, grossLosses, (row) => row.grossPnl),
    netProfitFactor: profitFactor(netWins, netLosses, (row) => row.netPnl),
    maxDrawdown: drawdown,
    maxDrawdownPct: Number.isFinite(equity) && equity > 0 ? (drawdown / equity) * 100 : Number.NaN,
    annualizedReturnPct,
  }
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0)
}

function profitFactor(wins, losses, selector) {
  const grossWin = sum(wins, selector)
  const grossLoss = Math.abs(sum(losses, selector))
  if (grossLoss === 0) return grossWin > 0 ? Number.POSITIVE_INFINITY : 0
  return grossWin / grossLoss
}

function maxDrawdown(trades) {
  let equityCurve = 0
  let peak = 0
  let worst = 0
  for (const trade of trades) {
    equityCurve += trade.netPnl
    peak = Math.max(peak, equityCurve)
    worst = Math.max(worst, peak - equityCurve)
  }
  return worst
}

function promotionIssues(summary) {
  const issues = []
  if (summary.count < minTrades) {
    issues.push({ level: 'FAIL', text: `${summary.count} closed trades is below the ${minTrades}-trade minimum.` })
  } else {
    issues.push({ level: 'PASS', text: `${summary.count} closed trades meets the sample-size floor.` })
  }

  if (summary.netExpectancy <= 0) {
    issues.push({ level: 'FAIL', text: `Net expectancy is ${money(summary.netExpectancy)} per trade; it must be positive after modeled costs.` })
  } else {
    issues.push({ level: 'PASS', text: `Net expectancy is positive at ${money(summary.netExpectancy)} per trade.` })
  }

  if (summary.netProfitFactor < 1.1) {
    issues.push({ level: 'FAIL', text: `Net profit factor is ${ratio(summary.netProfitFactor)}; require at least 1.10 before trusting the edge.` })
  } else if (summary.netProfitFactor < 1.25) {
    issues.push({ level: 'WARN', text: `Net profit factor is only ${ratio(summary.netProfitFactor)}; this is thin for live execution.` })
  } else {
    issues.push({ level: 'PASS', text: `Net profit factor is ${ratio(summary.netProfitFactor)}.` })
  }

  if (summary.days < 20) {
    issues.push({ level: 'WARN', text: `Sample spans only ${summary.days.toFixed(1)} calendar days; regime coverage is weak.` })
  }

  if (Number.isFinite(maxDrawdownPctLimit) && Number.isFinite(summary.maxDrawdownPct)) {
    if (summary.maxDrawdownPct > maxDrawdownPctLimit) {
      issues.push({
        level: 'FAIL',
        text: `Max drawdown ${pct(summary.maxDrawdownPct)} exceeds the ${pct(maxDrawdownPctLimit)} limit.`,
      })
    } else {
      issues.push({ level: 'PASS', text: `Max drawdown ${pct(summary.maxDrawdownPct)} is within the configured limit.` })
    }
  }

  if (Number.isFinite(targetAnnualReturn) && Number.isFinite(summary.annualizedReturnPct)) {
    const targetPct = targetAnnualReturn * 100
    if (summary.annualizedReturnPct < targetPct) {
      issues.push({
        level: 'WARN',
        text: `Annualized net return extrapolates to ${pct(summary.annualizedReturnPct)}, below the ${pct(targetPct)} target.`,
      })
    } else {
      issues.push({
        level: 'PASS',
        text: `Annualized net return extrapolates to ${pct(summary.annualizedReturnPct)} on the provided equity base.`,
      })
    }
  }

  issues.push({
    level: 'NOTE',
    text: 'Use this only on a frozen rule set. If thresholds changed during the sample, restart the out-of-sample clock.',
  })
  return issues
}

function bucketBy(trades, keyFn) {
  const map = new Map()
  for (const trade of trades) {
    const key = keyFn(trade)
    const bucket = map.get(key) ?? []
    bucket.push(trade)
    map.set(key, bucket)
  }
  return [...map.entries()]
    .map(([key, values]) => ({ key, ...summarize(values) }))
    .sort((a, b) => a.netExpectancy - b.netExpectancy || b.count - a.count)
}

function scoreBucket(row) {
  if (!Number.isFinite(row.score)) return 'score unknown'
  if (row.score >= 90) return 'score 90+'
  if (row.score >= 80) return 'score 80-89'
  if (row.score >= 70) return 'score 70-79'
  return 'score <70'
}

function pulseBucket(row) {
  if (!Number.isFinite(row.volumePulse)) return 'pulse unknown'
  if (row.volumePulse >= 3) return 'pulse 3x+'
  if (row.volumePulse >= 2) return 'pulse 2-3x'
  if (row.volumePulse >= 1.25) return 'pulse 1.25-2x'
  return 'pulse <1.25x'
}

function printSummary(summary) {
  console.log('\nPaper bot trade analysis')
  console.log(`File: ${file}`)
  console.log(`Filter: ${modeFilter ? `mode=${modeFilter}` : 'all modes'}${Number.isNaN(outOfSampleSince) ? '' : `, since=${new Date(outOfSampleSince).toISOString()}`}`)
  console.log(`Sample: ${summary.count} closed trades, ${new Date(summary.startMs).toISOString()} -> ${new Date(summary.endMs).toISOString()} (${summary.days.toFixed(1)} days)`)
  console.log(`Gross P/L: ${money(summary.grossPnl)} (${money(summary.grossExpectancy)}/trade), PF ${ratio(summary.grossProfitFactor)}, win ${pct(summary.grossWinRate * 100)}`)
  console.log(`Modeled costs: ${money(summary.estCost)}`)
  console.log(`Net P/L: ${money(summary.netPnl)} (${money(summary.netExpectancy)}/trade), PF ${ratio(summary.netProfitFactor)}, win ${pct(summary.netWinRate * 100)}`)
  console.log(`Avg net win/loss: ${money(summary.avgNetWin)} / ${money(summary.avgNetLoss)}`)
  console.log(`Max net drawdown: ${money(summary.maxDrawdown)}${Number.isFinite(summary.maxDrawdownPct) ? ` (${pct(summary.maxDrawdownPct)} of equity)` : ''}`)
  if (Number.isFinite(summary.annualizedReturnPct)) {
    console.log(`Annualized net return on ${money(equity)} equity: ${pct(summary.annualizedReturnPct)}`)
  }
}

function printBuckets(title, buckets) {
  console.log(`\n${title}`)
  for (const bucket of buckets.slice(0, 8)) {
    console.log(
      `${bucket.key}: ${bucket.count} trades, net ${money(bucket.netPnl)}, exp ${money(bucket.netExpectancy)}, PF ${ratio(bucket.netProfitFactor)}, DD ${money(bucket.maxDrawdown)}`,
    )
  }
}

function money(value) {
  if (!Number.isFinite(value)) return 'n/a'
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toFixed(2)}`
}

function ratio(value) {
  if (value === Number.POSITIVE_INFINITY) return 'inf'
  if (!Number.isFinite(value)) return 'n/a'
  return value.toFixed(2)
}

function pct(value) {
  if (!Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(2)}%`
}

function printHelp() {
  console.log(`
Usage:
  node scripts/analyze-paper-bot-trades.mjs [options]

Options:
  --file <path>                 Trade CSV path. Default: paper-bot-trades.csv
  --mode <safe|active|turbo>    Analyze one bot mode only.
  --since <YYYY-MM-DD>          Ignore older trades for out-of-sample review.
  --min-trades <number>         Promotion sample-size floor. Default: 100
  --equity <number>             Starting equity for drawdown and annualized return.
  --max-drawdown-pct <number>   Fail if net drawdown exceeds this equity percent.
  --target-annual-return <num>  Warn against an annual target, for example 0.25.
  --watch                       Keep running and re-analyze when the trade log changes.
  --interval-seconds <number>   Watch polling interval. Default: 60
  --help                        Show this message.
`)
}
