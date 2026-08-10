export type ConnectorState = 'live' | 'degraded' | 'not-configured'

declare const process: {
  env: Record<string, string | undefined>
}

export type FredSeriesObservation = {
  id: string
  label: string
  value: number
  previous: number | null
  delta: number | null
  units: string
  observationDate: string
  realtimeStart: string
}

export type MarketBarSnapshot = {
  symbol: string
  close: number
  changePct: number | null
  volume: number
  asOf: string
}

export type HistoricalMarketDataset = {
  ticker: string
  benchmark: string
  provider: string
  feed: string
  fetchedAt: string
  target: Array<{ date: string; close: number; volume: number }>
  benchmarkBars: Array<{ date: string; close: number; volume: number }>
}

export type FreeResearchAlternative = {
  target: string
  replacement: string
  coverage: string
  limitation: string
}

export type LiveResearchSnapshot = {
  ok: boolean
  generatedAt: string
  fred: {
    configured: boolean
    state: ConnectorState
    provider: string
    series: FredSeriesObservation[]
    netLiquidityBillions: number | null
    netLiquidityDeltaBillions: number | null
    message: string
  }
  market: {
    configured: boolean
    state: ConnectorState
    provider: string
    feed: string
    bars: MarketBarSnapshot[]
    message: string
  }
  alternatives: FreeResearchAlternative[]
}

type FredResponse = {
  observations?: Array<{
    date?: string
    realtime_start?: string
    value?: string
  }>
}

type AlpacaSnapshot = {
  dailyBar?: { c?: number; v?: number; t?: string }
  prevDailyBar?: { c?: number }
  latestTrade?: { p?: number; t?: string }
}

type AlpacaHistoricalBar = {
  t?: string
  c?: number
  v?: number
}

type AlpacaHistoricalResponse = {
  bars?: Record<string, AlpacaHistoricalBar[]>
  next_page_token?: string | null
}

type YahooChartResponse = {
  chart?: {
    error?: { description?: string } | null
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>
          volume?: Array<number | null>
        }>
        adjclose?: Array<{
          adjclose?: Array<number | null>
        }>
      }
    }>
  }
}

const FRED_SERIES = [
  { id: 'WALCL', label: 'Fed balance sheet', units: 'USD millions' },
  { id: 'WTREGEN', label: 'Treasury General Account', units: 'USD millions' },
  { id: 'RRPONTSYD', label: 'Overnight reverse repo', units: 'USD billions' },
] as const

const MARKET_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA']
const CACHE_MS = 5 * 60 * 1000
let cache: { at: number; value: LiveResearchSnapshot } | null = null

function numberFrom(value: string | number | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function fetchFredSeries(apiKey: string, series: (typeof FRED_SERIES)[number]): Promise<FredSeriesObservation> {
  const query = new URLSearchParams({
    series_id: series.id,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: '2',
  })
  const response = await fetch(`https://api.stlouisfed.org/fred/series/observations?${query}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`FRED ${series.id} returned ${response.status}`)
  const payload = (await response.json()) as FredResponse
  const rows = (payload.observations ?? []).filter((row) => numberFrom(row.value) !== null)
  const latest = rows[0]
  if (!latest) throw new Error(`FRED ${series.id} returned no numeric observations`)
  const value = numberFrom(latest.value) as number
  const previous = rows[1] ? numberFrom(rows[1].value) : null
  return {
    id: series.id,
    label: series.label,
    value,
    previous,
    delta: previous === null ? null : value - previous,
    units: series.units,
    observationDate: latest.date ?? 'unknown',
    realtimeStart: latest.realtime_start ?? latest.date ?? 'unknown',
  }
}

async function loadFred(): Promise<LiveResearchSnapshot['fred']> {
  const apiKey = process.env.FRED_API_KEY?.trim() ?? ''
  if (!apiKey) {
    return {
      configured: false,
      state: 'not-configured',
      provider: 'FRED / ALFRED',
      series: [],
      netLiquidityBillions: null,
      netLiquidityDeltaBillions: null,
      message: 'FRED_API_KEY is not configured.',
    }
  }

  try {
    const series = await Promise.all(FRED_SERIES.map((definition) => fetchFredSeries(apiKey, definition)))
    const byId = new Map(series.map((observation) => [observation.id, observation]))
    const walcl = byId.get('WALCL')
    const tga = byId.get('WTREGEN')
    const rrp = byId.get('RRPONTSYD')
    const current = walcl && tga && rrp ? walcl.value / 1000 - tga.value / 1000 - rrp.value : null
    const previous =
      walcl?.previous !== null && tga?.previous !== null && rrp?.previous !== null
        ? (walcl?.previous ?? 0) / 1000 - (tga?.previous ?? 0) / 1000 - (rrp?.previous ?? 0)
        : null
    return {
      configured: true,
      state: 'live',
      provider: 'FRED / ALFRED',
      series,
      netLiquidityBillions: current,
      netLiquidityDeltaBillions: current !== null && previous !== null ? current - previous : null,
      message: 'Latest released observations loaded with realtime_start metadata.',
    }
  } catch (error) {
    return {
      configured: true,
      state: 'degraded',
      provider: 'FRED / ALFRED',
      series: [],
      netLiquidityBillions: null,
      netLiquidityDeltaBillions: null,
      message: error instanceof Error ? error.message : 'FRED request failed.',
    }
  }
}

async function fetchAlpacaSnapshots(key: string, secret: string, feed: string): Promise<MarketBarSnapshot[]> {
  const query = new URLSearchParams({ symbols: MARKET_SYMBOLS.join(','), feed })
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?${query}`, {
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Alpaca snapshots returned ${response.status}`)
  const payload = (await response.json()) as Record<string, AlpacaSnapshot>
  return MARKET_SYMBOLS.flatMap((symbol) => {
    const snapshot = payload[symbol]
    const close = numberFrom(snapshot?.latestTrade?.p) ?? numberFrom(snapshot?.dailyBar?.c)
    if (close === null) return []
    const previousClose = numberFrom(snapshot?.prevDailyBar?.c)
    return [{
      symbol,
      close,
      changePct: previousClose && previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : null,
      volume: numberFrom(snapshot?.dailyBar?.v) ?? 0,
      asOf: snapshot?.latestTrade?.t ?? snapshot?.dailyBar?.t ?? 'unknown',
    }]
  })
}

export async function loadAlpacaHistoricalDataset(
  tickerInput: string,
  years: number,
): Promise<HistoricalMarketDataset> {
  const ticker = tickerInput.trim().toUpperCase()
  if (!/^[A-Z]{1,6}$/.test(ticker)) throw new Error('Ticker must contain 1-6 letters.')
  const key = (process.env.ALPACA_API_KEY_ID ?? process.env.APCA_API_KEY_ID ?? '').trim()
  const secret = (process.env.ALPACA_API_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY ?? '').trim()
  const feed = (process.env.ALPACA_DATA_FEED ?? 'iex').trim().toLowerCase()
  if (!key || !secret) return loadYahooHistoricalDataset(ticker, years, 'Alpaca credentials were not configured.')
  try {
    return await loadAlpacaHistoricalDatasetStrict(ticker, years, key, secret, feed)
  } catch (error) {
    return loadYahooHistoricalDataset(ticker, years, error instanceof Error ? error.message : 'Alpaca historical bars failed.')
  }
}

async function loadAlpacaHistoricalDatasetStrict(
  ticker: string,
  years: number,
  key: string,
  secret: string,
  feed: string,
): Promise<HistoricalMarketDataset> {
  if (!key || !secret) throw new Error('Alpaca credentials from the paper bot are not configured.')
  const benchmark = 'SPY'
  const symbols = ticker === benchmark ? [benchmark] : [ticker, benchmark]
  const end = new Date()
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - Math.max(1, Math.min(10, Math.round(years))))
  const collected = new Map(symbols.map((symbol) => [symbol, [] as AlpacaHistoricalBar[]]))
  let pageToken = ''

  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe: '1Day',
      start: start.toISOString(),
      end: end.toISOString(),
      adjustment: 'all',
      feed,
      sort: 'asc',
      limit: '10000',
    })
    if (pageToken) query.set('page_token', pageToken)
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
      headers: {
        accept: 'application/json',
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`Alpaca historical bars returned ${response.status}`)
    const payload = (await response.json()) as AlpacaHistoricalResponse
    for (const symbol of symbols) collected.get(symbol)?.push(...(payload.bars?.[symbol] ?? []))
    pageToken = payload.next_page_token ?? ''
    if (!pageToken) break
  }

  const normalize = (symbol: string) => (collected.get(symbol) ?? []).flatMap((bar) => {
    const close = numberFrom(bar.c)
    const timestamp = bar.t
    if (close === null || !timestamp) return []
    return [{ date: timestamp.slice(0, 10), close, volume: numberFrom(bar.v) ?? 0 }]
  })
  const targetRows = normalize(ticker)
  const benchmarkRows = normalize(benchmark)
  const benchmarkDates = new Set(benchmarkRows.map((row) => row.date))
  const sharedDates = new Set(targetRows.filter((row) => benchmarkDates.has(row.date)).map((row) => row.date))
  const target = targetRows.filter((row) => sharedDates.has(row.date))
  const alignedBenchmark = benchmarkRows.filter((row) => sharedDates.has(row.date))
  if (target.length < 500 || alignedBenchmark.length !== target.length) {
    throw new Error(`Alpaca returned only ${target.length} aligned daily bars for ${ticker} and ${benchmark}.`)
  }
  return {
    ticker,
    benchmark,
    provider: 'Alpaca Market Data',
    feed,
    fetchedAt: new Date().toISOString(),
    target,
    benchmarkBars: alignedBenchmark,
  }
}

async function fetchYahooDailyBars(symbol: string, years: number) {
  const end = new Date()
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - Math.max(1, Math.min(10, Math.round(years))))
  const query = new URLSearchParams({
    period1: String(Math.floor(start.getTime() / 1000)),
    period2: String(Math.floor(end.getTime() / 1000)),
    interval: '1d',
    events: 'history',
  })
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Yahoo chart returned ${response.status} for ${symbol}`)
  const payload = (await response.json()) as YahooChartResponse
  const result = payload.chart?.result?.[0]
  if (!result || payload.chart?.error) {
    throw new Error(payload.chart?.error?.description || `Yahoo chart returned no result for ${symbol}`)
  }
  const timestamps = result.timestamp ?? []
  const quote = result.indicators?.quote?.[0]
  const closes = result.indicators?.adjclose?.[0]?.adjclose ?? quote?.close ?? []
  const volumes = quote?.volume ?? []
  return timestamps.flatMap((timestamp, index) => {
    const close = numberFrom(closes[index])
    if (close === null || close <= 0) return []
    return [{
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close,
      volume: numberFrom(volumes[index]) ?? 0,
    }]
  })
}

async function loadYahooHistoricalDataset(
  ticker: string,
  years: number,
  fallbackReason: string,
): Promise<HistoricalMarketDataset> {
  const benchmark = 'SPY'
  const targetPromise = fetchYahooDailyBars(ticker, years)
  const benchmarkPromise = ticker === benchmark ? targetPromise : fetchYahooDailyBars(benchmark, years)
  const [targetRows, benchmarkRows] = await Promise.all([targetPromise, benchmarkPromise])
  const benchmarkDates = new Set(benchmarkRows.map((row) => row.date))
  const sharedDates = new Set(targetRows.filter((row) => benchmarkDates.has(row.date)).map((row) => row.date))
  const target = targetRows.filter((row) => sharedDates.has(row.date))
  const alignedBenchmark = benchmarkRows.filter((row) => sharedDates.has(row.date))
  if (target.length < 500 || alignedBenchmark.length !== target.length) {
    throw new Error(`Yahoo fallback returned only ${target.length} aligned daily bars for ${ticker} and ${benchmark}.`)
  }
  return {
    ticker,
    benchmark,
    provider: `Yahoo Finance chart fallback (${fallbackReason})`,
    feed: 'chart-1d',
    fetchedAt: new Date().toISOString(),
    target,
    benchmarkBars: alignedBenchmark,
  }
}

async function loadMarket(): Promise<LiveResearchSnapshot['market']> {
  const key = (process.env.ALPACA_API_KEY_ID ?? process.env.APCA_API_KEY_ID ?? '').trim()
  const secret = (process.env.ALPACA_API_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY ?? '').trim()
  const feed = (process.env.ALPACA_DATA_FEED ?? 'iex').trim().toLowerCase()
  if (!key || !secret) {
    return {
      configured: false,
      state: 'not-configured',
      provider: 'Alpaca Market Data',
      feed,
      bars: [],
      message: 'The paper bot Alpaca credentials are not configured.',
    }
  }

  let bars: MarketBarSnapshot[] = []
  let failure = ''
  try {
    bars = await fetchAlpacaSnapshots(key, secret, feed)
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Alpaca snapshots failed.'
  }
  return {
    configured: true,
    state: bars.length === MARKET_SYMBOLS.length ? 'live' : bars.length > 0 ? 'degraded' : 'degraded',
    provider: 'Alpaca Market Data',
    feed,
    bars,
    message:
      bars.length > 0
        ? `${bars.length}/${MARKET_SYMBOLS.length} daily OHLCV snapshots loaded from the bot data account.`
        : failure || 'Alpaca is configured but no snapshots were returned.',
  }
}

const alternatives: FreeResearchAlternative[] = [
  {
    target: 'Earnings estimates / revisions',
    replacement: 'SEC Companyfacts + filing timestamps + price reaction',
    coverage: 'Actual EPS/revenue releases and PEAD-style drift features',
    limitation: 'Not a true analyst-consensus or revisions history.',
  },
  {
    target: 'Options / consolidated OFI',
    replacement: 'Alpaca IEX trades/quotes + delayed option-chain snapshots',
    coverage: 'Signed trade imbalance, spread pressure, put/call and IV proxies',
    limitation: 'Not full-market TAQ, OPRA history, dealer gamma, or sub-second depth.',
  },
  {
    target: 'Institutional reference data',
    replacement: 'SEC 13F + exchange symbol directories + corporate-action checks',
    coverage: 'Quarterly holdings and a reproducible current security master',
    limitation: 'Historical delistings and CUSIP mapping remain incomplete without paid PIT data.',
  },
]

export async function buildLiveResearchSnapshot(force = false): Promise<LiveResearchSnapshot> {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_MS) return cache.value
  const [fred, market] = await Promise.all([loadFred(), loadMarket()])
  const value: LiveResearchSnapshot = {
    ok: fred.state === 'live' || market.state === 'live',
    generatedAt: new Date().toISOString(),
    fred,
    market,
    alternatives,
  }
  cache = { at: now, value }
  return value
}
