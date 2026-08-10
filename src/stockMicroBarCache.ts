export type StockMicroBar = {
  symbol: string
  bucketStart: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  samples: number
  source: string
  updatedAt: string
}

export type StockMicroBarContext = {
  intervalSeconds: 10
  provider: string
  bars: number
  latestClose: number | null
  tenSecondMovePct: number | null
  oneMinuteMovePct: number | null
  threeMinuteMovePct: number | null
  microVolumePulse: number | null
  latestBarVolume: number | null
  averageBarVolume: number | null
  lastUpdated: string | null
  source: string
}

type StockSample = {
  symbol: string
  price: number
  cumulativeVolume: number | null
  timestamp: Date
  source: string
}

type LastSample = {
  dayKey: string
  cumulativeVolume: number | null
}

const INTERVAL_MS = 10_000
const MAX_BARS_PER_SYMBOL = 2160 // six hours of 10s bars
const MAX_BAR_AGE_MS = 2 * 24 * 60 * 60 * 1000

const barsBySymbol = new Map<string, StockMicroBar[]>()
const lastSampleBySymbol = new Map<string, LastSample>()

function round(value: number, digits = 6) {
  const power = 10 ** digits
  return Math.round(value * power) / power
}

function normSymbol(symbol: string) {
  return symbol.trim().toUpperCase()
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function bucketStart(date: Date) {
  return new Date(Math.floor(date.getTime() / INTERVAL_MS) * INTERVAL_MS).toISOString()
}

function volumeDelta(symbol: string, cumulativeVolume: number | null, timestamp: Date) {
  if (cumulativeVolume === null || !Number.isFinite(cumulativeVolume) || cumulativeVolume <= 0) return 0
  const key = dayKey(timestamp)
  const last = lastSampleBySymbol.get(symbol)
  lastSampleBySymbol.set(symbol, { dayKey: key, cumulativeVolume })
  if (!last || last.dayKey !== key || last.cumulativeVolume === null) return 0
  return Math.max(0, Math.round(cumulativeVolume - last.cumulativeVolume))
}

function pctMove(from: number | null | undefined, to: number | null | undefined) {
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0) {
    return null
  }
  return round(((to - from) / from) * 100, 3)
}

export function recordStockMicroBarSample(sample: StockSample): StockMicroBarContext | null {
  const symbol = normSymbol(sample.symbol)
  if (!symbol || !Number.isFinite(sample.price) || sample.price <= 0) return microBarContext(symbol)
  const start = bucketStart(sample.timestamp)
  const updatedAt = sample.timestamp.toISOString()
  const bars = barsBySymbol.get(symbol) ?? []
  const delta = volumeDelta(symbol, sample.cumulativeVolume, sample.timestamp)
  const last = bars[bars.length - 1]

  if (last && last.bucketStart === start) {
    last.high = round(Math.max(last.high, sample.price))
    last.low = round(Math.min(last.low, sample.price))
    last.close = round(sample.price)
    last.volume += delta
    last.samples += 1
    last.source = sample.source
    last.updatedAt = updatedAt
  } else {
    bars.push({
      symbol,
      bucketStart: start,
      open: round(sample.price),
      high: round(sample.price),
      low: round(sample.price),
      close: round(sample.price),
      volume: delta,
      samples: 1,
      source: sample.source,
      updatedAt,
    })
  }

  const cutoff = sample.timestamp.getTime() - MAX_BAR_AGE_MS
  const pruned = bars.filter((bar) => Date.parse(bar.bucketStart) >= cutoff).slice(-MAX_BARS_PER_SYMBOL)
  barsBySymbol.set(symbol, pruned)
  return microBarContext(symbol)
}

export function microBarsForSymbol(symbol: string, limit = 72): StockMicroBar[] {
  return (barsBySymbol.get(normSymbol(symbol)) ?? []).slice(-limit)
}

export function microBarContext(symbol: string): StockMicroBarContext | null {
  const bars = microBarsForSymbol(symbol, 72)
  if (bars.length === 0) return null
  const latest = bars[bars.length - 1]
  const latestClose = latest.close
  const volumes = bars.map((bar) => bar.volume).filter((value) => value > 0)
  const latestVolume = latest.volume > 0 ? latest.volume : null
  const baseline = volumes.slice(Math.max(0, volumes.length - 13), Math.max(0, volumes.length - 1))
  const averageBarVolume =
    baseline.length > 0 ? Math.round(baseline.reduce((total, value) => total + value, 0) / baseline.length) : null
  const microVolumePulse =
    latestVolume !== null && averageBarVolume !== null && averageBarVolume > 0 ? round(latestVolume / averageBarVolume, 2) : null
  const closeAt = (barsBack: number) => {
    const index = bars.length - 1 - barsBack
    return index >= 0 ? bars[index].close : null
  }

  return {
    intervalSeconds: 10,
    provider: latest.source,
    bars: bars.length,
    latestClose,
    tenSecondMovePct: pctMove(closeAt(1), latestClose),
    oneMinuteMovePct: pctMove(closeAt(6), latestClose),
    threeMinuteMovePct: pctMove(closeAt(18), latestClose),
    microVolumePulse,
    latestBarVolume: latestVolume,
    averageBarVolume,
    lastUpdated: latest.updatedAt,
    source: latest.source,
  }
}
