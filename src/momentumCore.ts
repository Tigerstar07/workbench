import { recordStockMicroBarSample, type StockMicroBarContext } from './stockMicroBarCache'
import { configuredStockProviders, type StockProviderCapability, type StockProviderId } from './marketDataProviders'

export type MarketFilter = 'all' | 'stocks' | 'crypto'
export type AssetClass = 'stock' | 'crypto'
export type MomentumStatus = 'IGNORE' | 'WATCH' | 'CHECK NOW' | 'DATA ERROR'
export type MarketSession = 'OPEN' | 'PRE_MARKET' | 'AFTER_HOURS' | 'CLOSED' | 'WEEKEND' | 'CRYPTO_24_7'
export type DataQualityStatus = 'VERIFIED' | 'DATA ERROR' | 'UNVERIFIED'
export type SignalAction = 'BUY' | 'WAIT' | 'AVOID'
export type MarketDataCoverage = 'CONSOLIDATED' | 'SINGLE_EXCHANGE' | 'PUBLIC_FALLBACK' | 'CRYPTO_EXCHANGE'

export type SignalPlan = {
  action: SignalAction
  label: string
  thesis: string
  entryTrigger: number | null
  entryZoneLow: number | null
  entryZoneHigh: number | null
  stopLoss: number | null
  targetOne: number | null
  targetTwo: number | null
  invalidation: string
  sellPlan: string
  riskReward: number | null
}

export type MicroPullbackState = 'NONE' | 'FORMING' | 'READY' | 'FAILED' | 'EXTENDED'

export type MicroPullbackAnalysis = {
  state: MicroPullbackState
  label: string
  score: number
  trigger: number | null
  stop: number | null
  pullbackLow: number | null
  pullbackHigh: number | null
  pullbackCandles: number
  pullbackDepthPct: number | null
  ema9: number | null
  ema20: number | null
  atr: number | null
  nearestSupport: number | null
  nearestResistance: number | null
  supportDistancePct: number | null
  resistanceDistancePct: number | null
  notes: string[]
}

export type StockSessionVolumeProfile = {
  minuteOfDay: number | null
  expectedVolumeProgressPct: number | null
  expectedVolumeSoFar: number | null
  timeAdjustedRelativeVolume: number | null
  latestBarVolumeRatio: number | null
  label: string
  notes: string[]
}

// Confirmation state machine phases (see signalStability.ts). A raw breakout
// must pass through triggered -> confirming before it is allowed to surface as
// a CHECK NOW / BUY signal, so a single price tick can never flash "BUY NOW".
export type SignalPhase = 'armed' | 'triggered' | 'confirming' | 'confirmed' | 'failed'

export type SignalEvent = {
  phase: SignalPhase
  at: string
  note: string
  price: number
}

// The smoothed, time-aware signal state attached to a candidate by the radar's
// stabilization layer. The paper bot does NOT use this, it keeps reacting to
// the raw, instantaneous score so it stays stricter and independent.
export type SignalStability = {
  phase: SignalPhase
  label: string
  detail: string
  since: string
  holds: number
  holdsNeeded: number
  confirmedAt: string | null
  failedAt: string | null
  cooldownUntil: string | null
  history: SignalEvent[]
}

export type MomentumCandidate = {
  assetClass: AssetClass
  ticker: string
  displaySymbol: string
  company: string
  exchange: string
  exchangeDisplay: string
  sector: string
  price: number
  changePct: number
  secondaryMovePct: number | null
  secondaryMoveLabel: string
  oneHourMovePct: number | null
  fifteenMinuteMovePct: number | null
  vwapExtensionPct: number | null
  rangePositionPct: number | null
  volume: number
  quoteVolume: number | null
  averageVolume: number | null
  relativeVolume: number
  volumePulse: number | null
  sessionVolume: StockSessionVolumeProfile | null
  microBars: StockMicroBarContext | null
  recentQuoteVolume: number | null
  trades: number | null
  marketCap: number | null
  sharesOutstanding: number | null
  catalyst: string
  catalystPublisher: string | null
  catalystAgeMinutes: number | null
  newsUrl: string | null
  highOfDay: number
  distanceFromHighPct: number
  vwap: number
  aboveVwap: boolean
  spreadPct: number
  // `spreadPct` remains numeric for cost math, but it must never be interpreted
  // as executable when the upstream source did not provide a valid bid/ask.
  // This explicit flag closes the dangerous "missing BBO = 0.00% tight spread"
  // path while keeping old persisted/test candidates backwards compatible.
  spreadAvailable?: boolean
  marketDataCoverage?: MarketDataCoverage
  tradingHalted?: boolean
  tradingHaltReason?: string | null
  quoteTimestamp: string | null
  quoteAgeMinutes: number | null
  marketStatus: MarketSession
  marketStatusLabel: string
  dataQuality: DataQualityStatus
  dataError: string | null
  primarySource: string
  secondarySource: string | null
  secondaryPrice: number | null
  priceDiffPct: number | null
  validationNotes: string[]
  score: number
  confidence: number
  status: MomentumStatus
  signal: SignalPlan
  // Present only on radar-facing candidates (set by the stabilization layer at
  // the HTTP boundary). Undefined for bot-facing candidates.
  signalPhase?: SignalStability
  reasons: string[]
  blockers: string[]
  tradingViewUrl: string
  sourceUrl: string
  sourceLabel: string
  updatedAt: string

  // Phase 1 stock enhancements
  catalystScore: number
  catalystTags: string[]
  catalystQuality: 'none' | 'positive' | 'negative' | 'mixed' | 'unmatched'

  premarketHigh: number | null
  premarketVolume: number | null
  premarketDollarVolume: number | null

  openingRangeHigh: number | null
  openingRangeLow: number | null
  orbBreakoutConfirmed: boolean

  estimatedFreeFloat: number | null
  floatTurnover: number | null
  shortInterestPct: number | null

  latestBarVolume: number | null
  averageRecentBarVolume: number | null
  microPullback?: MicroPullbackAnalysis

  // Which strategy produced this candidate. Undefined is treated as 'momentum'
  // everywhere, so all existing momentum code is unchanged; only the
  // mean-reversion builder sets 'reversion'. A reversion candidate is, by
  // definition, BELOW VWAP and far from the high, the opposite of a momentum
  // setup, so the bot/radar branch on this tag instead of bending the scorer.
  strategy?: 'momentum' | 'reversion'
  // Intraday oversold/structure context computed from the 5m chart, used by the
  // mean-reversion path (RSI gate + swing-low stop). Optional so momentum and
  // crypto candidates can omit it.
  intradayRsi?: number | null
  intradayLow?: number | null
}

declare const process:
  | {
      env?: Record<string, string | undefined>
    }
  | undefined

export type IndexSymbol = 'SPY' | 'QQQ' | 'IWM'

export type IndexMarketTape = {
  dailyTrendPct: number | null
  sessionMovePct: number | null
  recentTrendPct: number | null
  drawdownFromHighPct: number | null
  recoveryFromLowPct: number | null
}

export type MomentumSnapshot = {
  ok: true
  provider: string
  generatedAt: string
  nextScanSeconds: number
  liveRefreshSeconds: number
  shortlistLimit: number
  candidates: MomentumCandidate[]
  shortlist: MomentumCandidate[]
  ignoredCount: number
  dataErrorCount: number
  hiddenSignalCount: number
  statusCounts: Record<MomentumStatus, number>
  assetCounts: Record<AssetClass, number>
  stockCoverage: {
    scanned: number
    microSmallCap: number
    midCap: number
    largeCap: number
    unknownCap: number
    actionableMicroSmallCap: number
    actionableLargeCap: number
  }
  rules: {
    checkNowScore: number
    watchScore: number
    shortlistLimit: number
    checkNowRequires: string[]
  }
  sourceNote: string
  keyAdvice: string
  disclaimer: string
  marketContext: {
    indices: Record<IndexSymbol, IndexMarketTape>
    spyTrendPct: number | null
    qqqTrendPct: number | null
    iwmTrendPct: number | null
    fetchedAt: string | null
  }
  dataProviders: Array<{
    id: StockProviderId
    label: string
    role: 'active' | 'fallback' | 'planned'
    configured: boolean
    capabilities: StockProviderCapability[]
  }>
}

export type StockCapBand = 'micro-small' | 'mid' | 'large' | 'unknown'

// One shared definition for scanner coverage and execution risk. Market-cap data
// can be unavailable on an otherwise valid live quote, so "unknown" stays an
// explicit band instead of being silently treated as either safe or speculative.
export function stockCapBand(
  candidate: Pick<MomentumCandidate, 'assetClass' | 'marketCap'>,
): StockCapBand {
  if (candidate.assetClass !== 'stock' || candidate.marketCap === null || candidate.marketCap <= 0) return 'unknown'
  if (candidate.marketCap <= 2_000_000_000) return 'micro-small'
  if (candidate.marketCap < 10_000_000_000) return 'mid'
  return 'large'
}

type ScreenerQuote = {
  symbol?: string
  shortName?: string
  longName?: string
  displayName?: string
  fullExchangeName?: string
  exchange?: string
  quoteType?: string
  sector?: string
  regularMarketPrice?: number
  regularMarketChangePercent?: number
  regularMarketTime?: number
  regularMarketPreviousClose?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketVolume?: number
  averageDailyVolume3Month?: number
  averageDailyVolume10Day?: number
  marketCap?: number
  sharesOutstanding?: number
  bid?: number
  ask?: number
  marketState?: string
  quoteSourceName?: string
  sourceInterval?: number
  exchangeDataDelayedBy?: number
}

type NewsItem = {
  title?: string
  publisher?: string
  link?: string
  providerPublishTime?: number
  relatedTickers?: string[]
}

type ChartResult = {
  meta?: {
    regularMarketPrice?: number
    regularMarketTime?: number
    previousClose?: number
    chartPreviousClose?: number
    regularMarketDayHigh?: number
    regularMarketDayLow?: number
    regularMarketVolume?: number
    exchangeName?: string
    fullExchangeName?: string
    shortName?: string
    longName?: string
  }
  timestamp?: number[]
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>
      high?: Array<number | null>
      low?: Array<number | null>
      close?: Array<number | null>
      volume?: Array<number | null>
    }>
  }
}

type BinanceTicker = {
  symbol: string
  priceChangePercent: string
  lastPrice: string
  weightedAvgPrice: string
  highPrice: string
  volume: string
  quoteVolume: string
  count: number
  bidPrice: string
  askPrice: string
  closeTime?: number
}

type CnbcQuickQuote = {
  symbol?: string
  last?: string
  change_pct?: string
  high?: string
  low?: string
  volume?: string
  fullVolume?: string
  name?: string
  exchange?: string
  source?: string
  provider?: string
  previous_day_closing?: string
  last_time_msec?: string
  reg_last_time?: string
  curmktstatus?: string
  trading_day_type?: string
  mainmktstatus?: string
  realTime?: string
  FundamentalData?: {
    sharesout?: string
    mktcap?: string
    MPreviousClose?: string
    shortinterest?: string
    shortInterest?: string
  }
}

type AlpacaMover = {
  symbol?: string
  price?: number
  change?: number
  percent_change?: number
}

type AlpacaBar = {
  c?: number
  h?: number
  l?: number
  o?: number
  v?: number
  n?: number
  vw?: number
  t?: string
}

type AlpacaQuote = {
  ap?: number
  bp?: number
  t?: string
}

type AlpacaTrade = {
  p?: number
  t?: string
}

type AlpacaSnapshot = {
  dailyBar?: AlpacaBar
  minuteBar?: AlpacaBar
  prevDailyBar?: AlpacaBar
  latestQuote?: AlpacaQuote
  latestTrade?: AlpacaTrade
}

type AlpacaStreamMessage = {
  T?: string
  S?: string
  p?: number
  bp?: number
  ap?: number
  o?: number
  h?: number
  l?: number
  c?: number
  v?: number
  n?: number
  vw?: number
  t?: string
  msg?: string
  code?: number
  sc?: string
  sm?: string
  rc?: string
  rm?: string
}

type AlpacaRealtimeSample = {
  symbol: string
  price: number | null
  bid: number | null
  ask: number | null
  timestamp: string | null
  receivedAt: string
  latestBar: AlpacaBar | null
  source: string
  tradingHalted: boolean
  tradingHaltReason: string | null
}

type NormalizedAlpacaMover = {
  symbol: string
  price: number
  percentChange: number
}

type RawCandidate = Omit<
  MomentumCandidate,
  | 'distanceFromHighPct'
  | 'aboveVwap'
  | 'score'
  | 'confidence'
  | 'status'
  | 'signal'
  | 'reasons'
  | 'blockers'
  | 'tradingViewUrl'
  | 'sourceUrl'
  | 'updatedAt'
>

type SecondaryStockQuote = {
  source: string
  price: number | null
  previousClose: number | null
  high: number | null
  volume: number | null
  marketCap: number | null
  sharesOutstanding: number | null
  shortInterestPct: number | null
  timestamp: string | null
  marketStatus: MarketSession
  exchange: string
  company: string | null
  rawSource: string | null
}

type StockValidation = {
  dataQuality: DataQualityStatus
  dataError: string | null
  secondarySource: string | null
  secondaryPrice: number | null
  priceDiffPct: number | null
  quoteAgeMinutes: number | null
  validationNotes: string[]
}

export const MOMENTUM_RULES = {
  nextScanSeconds: 60,
  liveRefreshSeconds: 5,
  alpacaLiveRefreshSeconds: 2,
  shortlistLimit: 12,
  checkNowScore: 84,
  watchScore: 68,
  stock: {
    minMovePct: 6,
    minVolume: 1_000_000,
    minRelativeVolume: 1.8,
    maxDistanceFromHighPct: 10,
    maxSpreadPct: 2.5,
  },
  crypto: {
    minMovePct: 3,
    minFourHourMovePct: 1.2,
    minQuoteVolume: 20_000_000, // shortlist floor, below this it isn't even watched
    // Buy-confirmation liquidity floor. Higher than the shortlist floor so a BUY is
    // a stricter bar than mere inclusion, but well below the old $50M: the bot's
    // size is tiny, spread is gated separately (maxSpreadPct), so this only needs to
    // screen out spoofable thin-book pumps, not guarantee fill depth. Tune here.
    minConfirmationQuoteVolume: 30_000_000,
    minVolumePulse: 1.15,
    maxDistanceFromHighPct: 7,
    maxPullbackDistanceFromHighPct: 10,
    maxVwapExtensionPct: 9,
    maxSpreadPct: 0.35,
  },
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'
const STOCK_SCREENERS = ['day_gainers', 'small_cap_gainers', 'most_actives']

// ---- mean-reversion (large-cap VWAP reclaim) ------------------------------
// Curated liquid large caps we always watch for a controlled "buy the stretched
// dip back to VWAP" setup (the honest version of "Palantir/ASML will bounce").
// ASML/SAP etc. trade as US ADRs the bot can already execute (see US_LISTED_ADRS).
// Editable, these are scanned by symbol regardless of any screener.
const MEGACAP_REVERSION_SYMBOLS = [
  'PLTR', 'ASML', 'NVDA', 'AAPL', 'MSFT', 'META', 'GOOGL', 'AMZN', 'AMD', 'TSLA',
  'NFLX', 'AVGO', 'CRM', 'ADBE', 'COST', 'NVO', 'SAP',
]
// Dynamic discovery floor: only fade large, liquid decliners (not small caps, 
// those are knives). Used to filter the day_losers screener.
const REVERSION_MIN_MARKET_CAP = 10_000_000_000
const REVERSION_DISCOVERY_LIMIT = 8
const REVERSION = {
  // VWAP-deviation band: deep enough to be a real stretch, shallow enough that
  // it isn't a falling knife. Beyond the max we stay out.
  minBelowVwapPct: 1.0,
  maxBelowVwapPct: 3.5,
  // Oversold gate (intraday 5m RSI). Megacaps rarely print a classic <30, so the
  // hard gate is generous and the score rewards genuinely deep readings.
  maxRsi: 42,
  // A "reclaim" = short-term tape turning back up (15m move no longer negative).
  reclaimMinFifteenMinMovePct: 0,
  // Don't fade a name that is collapsing on the day even if intraday-stretched.
  maxAdverseDayChangePct: -7,
} as const
const CRYPTO_QUOTE_ASSETS = ['USDT']
const EXCLUDED_CRYPTO_BASES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDP', 'EUR', 'EURI'])
const EXCLUDED_LEVERAGED_TOKENS = /(UP|DOWN|BULL|BEAR|[235]L|[235]S)USDT$/
const STANDARD_CRYPTO_SYMBOL = /^[A-Z0-9]+USDT$/
const STANDARD_STOCK_SYMBOL = /^[A-Z]{1,5}$/
const EXCLUDED_STOCK_SUFFIXES = /[UW]$/
const STOCK_PRICE_TOLERANCE_PCT = 5
const STOCK_FRESH_QUOTE_MINUTES = 5

function cryptoRadarEnabled() {
  const raw = typeof process !== 'undefined' ? process.env?.BOT_ENABLE_CRYPTO : undefined
  return ['1', 'true', 'yes', 'on'].includes((raw ?? '').trim().toLowerCase())
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2) {
  const power = 10 ** digits
  return Math.round(value * power) / power
}

export function classifyCatalyst(headline: string | null | undefined): {
  score: number
  tags: string[]
  quality: 'none' | 'positive' | 'negative' | 'mixed'
} {
  if (!headline) return { score: 0, tags: [], quality: 'none' }
  const text = headline.toLowerCase()
  const tags: string[] = []
  let posScore = 0
  let negScore = 0

  // 1. Positive Catalysts
  // FDA Approval/Clearance (but not delayed/halted/rejected)
  if (/\b(fda\s+(approval|clearance|approved))\b/i.test(text) && !/\b(delay|delayed|halt|rejected|rejects|news|probe|denied|denies|holds|hold)\b/i.test(text)) {
    posScore += 12
    tags.push('FDA Approval')
  }
  // Earnings/Revenue beat or guidance raise
  if (/\b(earnings\s+beat|eps\s+beat|revenue\s+beat|guidance\s+(raise|upward|upgraded|raised))\b/i.test(text)) {
    posScore += 10
    tags.push('Earnings Beat')
  }
  // Acquisition/Buyout/Merger (but not canceled/failed/rejected)
  if (/\b(acquisition|buyout|merger|mergers)\b/i.test(text) && !/\b(canceled|cancelled|failed|rejected|terminated|halts|halt)\b/i.test(text)) {
    posScore += 10
    tags.push('Acquisition')
  }
  // Contract win / partnership
  if (/\b(contract\s+win|major\s+partnership|deal)\b/i.test(text)) {
    posScore += 8
    tags.push('Contract/Partnership')
  }
  // Analyst upgrade
  if (/\b(analyst\s+upgrade|upgraded\s+to)\b/i.test(text)) {
    posScore += 4
    tags.push('Analyst Upgrade')
  }

  // 2. Negative Catalysts
  // Offering / Dilution / Private placement
  if (/\b(offering|dilution|private\s+placement|share\s+offering|public\s+offering|debt)\b/i.test(text) && !/\b(repay|paying\s+down)\b/i.test(text)) {
    negScore -= 12
    tags.push('Dilution/Offering')
  }
  // Debt concern / going concern / delisting
  if (/\b(going\s+concern|delisting|bankruptcy|debt\s+concern)\b/i.test(text)) {
    negScore -= 12
    tags.push('Going Concern/Delisting')
  }
  // Investigation / SEC probe
  if (/\b(investigation|sec\s+probe|class\s+action)\b/i.test(text)) {
    negScore -= 10
    tags.push('Investigation')
  }

  const score = posScore + negScore
  let quality: 'none' | 'positive' | 'negative' | 'mixed' = 'none'
  if (posScore > 0 && negScore < 0) {
    quality = 'mixed'
  } else if (posScore > 0) {
    quality = 'positive'
  } else if (negScore < 0) {
    quality = 'negative'
  }

  return { score, tags, quality }
}

function safeNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'string' ? Number(value.replace(/[$,%]/g, '').replace(/,/g, '').trim()) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function envValue(name: string) {
  return typeof process !== 'undefined' ? process?.env?.[name]?.trim() : undefined
}

function alpacaCredentials() {
  const key = envValue('ALPACA_API_KEY_ID') || envValue('APCA_API_KEY_ID')
  const secret = envValue('ALPACA_API_SECRET_KEY') || envValue('APCA_API_SECRET_KEY')
  return key && secret ? { key, secret, feed: envValue('ALPACA_DATA_FEED') || 'iex' } : null
}

// Configuration only proves keys exist, not that they authenticate. The most
// recent request health prevents the UI from claiming Alpaca is active while
// the scanner has silently fallen back to public sources.
let alpacaMarketDataError: string | null = null

function reason(label: string, points: number) {
  return `${label} +${points}`
}

function distanceFromHigh(price: number, high: number) {
  if (!price || !high) return 100
  return round(Math.max(0, ((high - price) / high) * 100), 1)
}

function priceDigits(price: number) {
  return price < 1 ? 6 : price < 10 ? 3 : 2
}

function roundPrice(value: number | null, referencePrice: number) {
  return value === null || !Number.isFinite(value) ? null : round(value, priceDigits(referencePrice))
}

function isoFromSeconds(value: unknown) {
  const seconds = safeNumber(value)
  if (!seconds || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

function isoFromMilliseconds(value: unknown) {
  const milliseconds = safeNumber(value)
  if (!milliseconds || milliseconds <= 0) return null
  return new Date(milliseconds).toISOString()
}

function firstIso(...values: Array<string | null | undefined>) {
  return values.find((value) => value && !Number.isNaN(Date.parse(value))) ?? null
}

function minutesSince(timestamp: string | null, now: Date) {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Math.round((now.getTime() - parsed) / 60_000))
}

function dateFromIso(value: string | null, fallback: Date) {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed) : fallback
}

const ALPACA_STREAM_MAX_AGE_MS = 15_000
const ALPACA_STREAM_RECONNECT_MS = 5_000
const ALPACA_STREAM_SYMBOL_LIMIT = 30

const alpacaRealtimeSamples = new Map<string, AlpacaRealtimeSample>()
let alpacaStreamSocket: WebSocket | null = null
let alpacaStreamAuthed = false
let alpacaStreamFeed: string | null = null
let alpacaStreamLastAttempt = 0
let alpacaStreamSubscribing = false
const alpacaStreamWanted = new Set<string>()
const alpacaStreamSubscribed = new Set<string>()

function normalizeStreamSymbol(symbol: string) {
  return symbol.trim().toUpperCase()
}

function websocketOpen(socket: WebSocket | null) {
  return Boolean(socket && socket.readyState === 1)
}

function websocketConnecting(socket: WebSocket | null) {
  return Boolean(socket && socket.readyState === 0)
}

function alpacaStreamSource() {
  return `Alpaca ${(alpacaStreamFeed ?? alpacaCredentials()?.feed ?? 'iex').toUpperCase()} stream`
}

function parseAlpacaStreamPayload(data: unknown): unknown {
  try {
    if (typeof data === 'string') return JSON.parse(data)
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data))
  } catch {
    return null
  }
  return null
}

function updateAlpacaRealtimeSample(symbol: string, update: Partial<AlpacaRealtimeSample>) {
  const normalized = normalizeStreamSymbol(symbol)
  if (!normalized) return
  const current = alpacaRealtimeSamples.get(normalized)
  const receivedAt = new Date().toISOString()
  const next: AlpacaRealtimeSample = {
    symbol: normalized,
    price: update.price ?? current?.price ?? null,
    bid: update.bid ?? current?.bid ?? null,
    ask: update.ask ?? current?.ask ?? null,
    timestamp: firstIso(update.timestamp ?? null, current?.timestamp ?? null),
    receivedAt,
    latestBar: update.latestBar ?? current?.latestBar ?? null,
    source: update.source ?? current?.source ?? alpacaStreamSource(),
    tradingHalted: update.tradingHalted ?? current?.tradingHalted ?? false,
    tradingHaltReason: update.tradingHaltReason ?? current?.tradingHaltReason ?? null,
  }
  alpacaRealtimeSamples.set(normalized, next)
}

function handleAlpacaStreamMessage(message: AlpacaStreamMessage) {
  const type = message.T
  if (type === 'success' && message.msg === 'authenticated') {
    alpacaStreamAuthed = true
    subscribeWantedAlpacaStreamSymbols()
    return
  }
  if (type === 'error') return

  const symbol = normalizeStreamSymbol(message.S ?? '')
  if (!symbol) return

  if (type === 't') {
    const price = safeNumber(message.p)
    if (price !== null) {
      updateAlpacaRealtimeSample(symbol, {
        price,
        timestamp: message.t ?? null,
        source: alpacaStreamSource(),
      })
    }
  } else if (type === 'q') {
    const bid = safeNumber(message.bp)
    const ask = safeNumber(message.ap)
    const midpoint = bid !== null && ask !== null && ask >= bid ? (bid + ask) / 2 : null
    updateAlpacaRealtimeSample(symbol, {
      bid,
      ask,
      price: midpoint,
      timestamp: message.t ?? null,
      source: alpacaStreamSource(),
    })
  } else if (type === 'b' || type === 'u') {
    const close = safeNumber(message.c)
    updateAlpacaRealtimeSample(symbol, {
      price: close,
      timestamp: message.t ?? null,
      latestBar: {
        c: close ?? undefined,
        h: safeNumber(message.h) ?? undefined,
        l: safeNumber(message.l) ?? undefined,
        o: safeNumber(message.o) ?? undefined,
        v: safeNumber(message.v) ?? undefined,
        n: safeNumber(message.n) ?? undefined,
        vw: safeNumber(message.vw) ?? undefined,
        t: message.t,
      },
      source: alpacaStreamSource(),
    })
  } else if (type === 's') {
    // Alpaca status messages use H/2 for halts and Q/T/3 for quotation or
    // trading resumption across the UTP/CTA tapes. Retain the state on the live
    // sample so every downstream signal and order gate can veto a halted name.
    const code = (message.sc ?? '').toUpperCase()
    const halted = code === 'H' || code === '2'
    const resumed = code === 'Q' || code === 'T' || code === '3'
    if (halted || resumed) {
      updateAlpacaRealtimeSample(symbol, {
        tradingHalted: halted,
        tradingHaltReason: halted ? message.sm ?? message.rm ?? `market status ${code}` : null,
        timestamp: message.t ?? null,
        source: alpacaStreamSource(),
      })
    }
  }
}

function handleAlpacaStreamPayload(payload: unknown) {
  const messages = Array.isArray(payload) ? payload : [payload]
  for (const message of messages) {
    if (message && typeof message === 'object') {
      handleAlpacaStreamMessage(message as AlpacaStreamMessage)
    }
  }
}

function sendAlpacaStream(payload: Record<string, unknown>) {
  if (!websocketOpen(alpacaStreamSocket)) return
  try {
    alpacaStreamSocket?.send(JSON.stringify(payload))
  } catch {
    // The next live refresh will reconnect if the socket has gone away.
  }
}

function subscribeWantedAlpacaStreamSymbols() {
  if (!alpacaStreamAuthed || !websocketOpen(alpacaStreamSocket) || alpacaStreamSubscribing) return
  const symbols = [...alpacaStreamWanted]
    .filter((symbol) => !alpacaStreamSubscribed.has(symbol))
    .slice(0, ALPACA_STREAM_SYMBOL_LIMIT)
  if (symbols.length === 0) return
  alpacaStreamSubscribing = true
  sendAlpacaStream({ action: 'subscribe', trades: symbols, quotes: symbols, bars: symbols, statuses: symbols })
  for (const symbol of symbols) alpacaStreamSubscribed.add(symbol)
  alpacaStreamSubscribing = false
}

function connectAlpacaStream() {
  const credentials = alpacaCredentials()
  if (!credentials || typeof WebSocket === 'undefined') return
  const feed = credentials.feed || 'iex'
  const now = Date.now()
  if (
    alpacaStreamFeed === feed &&
    (websocketOpen(alpacaStreamSocket) || websocketConnecting(alpacaStreamSocket))
  ) {
    return
  }
  if (now - alpacaStreamLastAttempt < ALPACA_STREAM_RECONNECT_MS) return

  alpacaStreamLastAttempt = now
  alpacaStreamFeed = feed
  alpacaStreamAuthed = false
  alpacaStreamSubscribed.clear()

  try {
    alpacaStreamSocket?.close()
  } catch {
    // ignore close errors
  }

  try {
    const socket = new WebSocket(`wss://stream.data.alpaca.markets/v2/${feed}`)
    alpacaStreamSocket = socket
    socket.addEventListener('open', () => {
      sendAlpacaStream({ action: 'auth', key: credentials.key, secret: credentials.secret })
    })
    socket.addEventListener('message', (event) => {
      const payload = parseAlpacaStreamPayload(event.data)
      if (payload !== null) handleAlpacaStreamPayload(payload)
    })
    socket.addEventListener('close', () => {
      if (alpacaStreamSocket === socket) {
        alpacaStreamAuthed = false
        alpacaStreamSocket = null
        alpacaStreamSubscribed.clear()
      }
    })
    socket.addEventListener('error', () => {
      if (alpacaStreamSocket === socket) {
        alpacaStreamAuthed = false
      }
    })
  } catch {
    alpacaStreamSocket = null
    alpacaStreamAuthed = false
  }
}

function primeAlpacaRealtime(symbols: string[]) {
  const normalized = symbols
    .map(normalizeStreamSymbol)
    .filter((symbol) => STANDARD_STOCK_SYMBOL.test(symbol))
    .slice(0, ALPACA_STREAM_SYMBOL_LIMIT)
  if (!alpacaCredentials()) return
  if (normalized.length === 0) {
    const staleSubscribed = [...alpacaStreamSubscribed]
    if (staleSubscribed.length > 0 && alpacaStreamAuthed && websocketOpen(alpacaStreamSocket)) {
      sendAlpacaStream({ action: 'unsubscribe', trades: staleSubscribed, quotes: staleSubscribed, bars: staleSubscribed, statuses: staleSubscribed })
    }
    alpacaStreamWanted.clear()
    alpacaStreamSubscribed.clear()
    return
  }
  const nextWanted = new Set(normalized)
  const staleSubscribed = [...alpacaStreamSubscribed].filter((symbol) => !nextWanted.has(symbol))
  if (staleSubscribed.length > 0 && alpacaStreamAuthed && websocketOpen(alpacaStreamSocket)) {
    sendAlpacaStream({ action: 'unsubscribe', trades: staleSubscribed, quotes: staleSubscribed, bars: staleSubscribed, statuses: staleSubscribed })
  }
  for (const symbol of staleSubscribed) alpacaStreamSubscribed.delete(symbol)
  alpacaStreamWanted.clear()
  for (const symbol of normalized) alpacaStreamWanted.add(symbol)
  connectAlpacaStream()
  subscribeWantedAlpacaStreamSymbols()
}

function freshAlpacaRealtimeSample(symbol: string, now: Date) {
  const sample = alpacaRealtimeSamples.get(normalizeStreamSymbol(symbol))
  if (!sample) return null
  const parsed = Date.parse(sample.receivedAt)
  if (!Number.isFinite(parsed) || now.getTime() - parsed > ALPACA_STREAM_MAX_AGE_MS) return null
  return sample
}

function easternClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    day: dayMap[part('weekday')] ?? 0,
    minutes: (Number(part('hour')) || 0) * 60 + (Number(part('minute')) || 0),
  }
}

export function computedStockMarketStatus(now: Date): MarketSession {
  const { day, minutes } = easternClock(now)
  if (day === 0 || day === 6) return 'WEEKEND'
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'PRE_MARKET'
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'OPEN'
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'AFTER_HOURS'
  return 'CLOSED'
}

function europeanClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    day: dayMap[part('weekday')] ?? 0,
    minutes: (Number(part('hour')) || 0) * 60 + (Number(part('minute')) || 0),
  }
}

// Core continental European cash session (Xetra / Euronext ~09:00-17:30 CET, which
// also broadly covers London's 08:00-16:30 GMT day). Used only to tag the radar's
// European rows so they read as live during European hours instead of being
// suppressed by the US "market closed" rule (which keys off each row's own status).
export function computedEuropeanMarketStatus(now: Date): MarketSession {
  const { day, minutes } = europeanClock(now)
  if (day === 0 || day === 6) return 'WEEKEND'
  if (minutes >= 9 * 60 && minutes < 17 * 60 + 30) return 'OPEN'
  return 'CLOSED'
}

function marketStatusLabel(status: MarketSession) {
  const labels: Record<MarketSession, string> = {
    OPEN: 'Open',
    PRE_MARKET: 'Pre-market',
    AFTER_HOURS: 'After-hours',
    CLOSED: 'Closed',
    WEEKEND: 'Weekend',
    CRYPTO_24_7: '24/7',
  }
  return labels[status]
}

function normalizeYahooMarketStatus(marketState: string | undefined, now: Date): MarketSession {
  const computed = computedStockMarketStatus(now)
  const state = marketState?.toUpperCase()
  if (state === 'REGULAR') return 'OPEN'
  if (state === 'PRE' || state === 'PREPRE') return 'PRE_MARKET'
  if (state === 'POST' || state === 'POSTPOST') return 'AFTER_HOURS'
  if (state === 'CLOSED') return computed === 'WEEKEND' ? 'WEEKEND' : 'CLOSED'
  return computed
}

function normalizeCnbcMarketStatus(quote: CnbcQuickQuote | null, now: Date): MarketSession {
  const computed = computedStockMarketStatus(now)
  if (computed === 'WEEKEND') return 'WEEKEND'
  const tradingDayType = quote?.trading_day_type?.toUpperCase()
  if (tradingDayType === 'WEEKEND') return 'WEEKEND'
  const status = `${quote?.curmktstatus ?? ''} ${quote?.mainmktstatus ?? ''}`.toUpperCase()
  if (status.includes('OPEN') || status.includes('REG_MKT')) return 'OPEN'
  if (status.includes('PRE')) return 'PRE_MARKET'
  if (status.includes('POST')) return 'AFTER_HOURS'
  if (status.includes('CLOSE')) return 'CLOSED'
  return computed
}

function priceDiffPct(primaryPrice: number, secondaryPrice: number | null) {
  if (!primaryPrice || !secondaryPrice) return null
  return round((Math.abs(primaryPrice - secondaryPrice) / secondaryPrice) * 100, 2)
}

function isLiveStockSession(status: MarketSession) {
  return status === 'OPEN' || status === 'PRE_MARKET' || status === 'AFTER_HOURS'
}

function validateStockQuote({
  price,
  quoteTimestamp,
  marketStatus,
  secondary,
  fallbackSecondary,
  now,
}: {
  price: number
  quoteTimestamp: string | null
  marketStatus: MarketSession
  secondary: SecondaryStockQuote | null
  fallbackSecondary?: SecondaryStockQuote | null
  now: Date
}): StockValidation {
  const notes: string[] = []
  // Prefer the primary independent check (CNBC); fall back to a second
  // independent source (Yahoo) so one flaky endpoint can't silently drop an
  // otherwise-clean mover to UNVERIFIED. The fallback is always a different
  // source than the candidate's primary price, so the cross-check stays honest.
  const effectiveSecondary = secondary ?? fallbackSecondary ?? null
  const quoteAgeMinutes = minutesSince(quoteTimestamp, now)
  const secondaryPrice = effectiveSecondary?.price ?? null
  const diffPct = priceDiffPct(price, secondaryPrice)
  let dataError: string | null = null

  // A missing independent cross-check is no longer a hard error: the stock
  // still surfaces on the dashboard as UNVERIFIED (and the paper bot, which
  // requires VERIFIED, will simply never auto-enter it). DATA ERROR is reserved
  // for clearly broken data, a large source mismatch, a sub-$5 conflict, or a
  // stale/absent live quote during market hours.
  if (diffPct !== null && diffPct > STOCK_PRICE_TOLERANCE_PCT) {
    dataError = `price mismatch ${diffPct.toFixed(1)}% vs ${effectiveSecondary?.source ?? 'secondary source'}`
  } else if (price < 5 && (effectiveSecondary?.previousClose ?? 0) >= price * 20) {
    dataError = 'sub-$5 stock price conflicts with secondary previous close'
  } else if (isLiveStockSession(marketStatus) && quoteAgeMinutes === null) {
    dataError = 'missing stock quote timestamp during market hours'
  } else if (isLiveStockSession(marketStatus) && quoteAgeMinutes !== null && quoteAgeMinutes > STOCK_FRESH_QUOTE_MINUTES) {
    dataError = `stock quote stale by ${quoteAgeMinutes}m during market hours`
  }

  if (effectiveSecondary?.source && secondaryPrice)
    notes.push(`${effectiveSecondary.source} price ${roundPrice(secondaryPrice, price)}`)
  else notes.push('no independent price check')
  if (diffPct !== null) notes.push(`cross-source diff ${diffPct.toFixed(2)}%`)
  if (quoteAgeMinutes !== null) notes.push(`quote age ${quoteAgeMinutes}m`)
  if (effectiveSecondary?.rawSource) notes.push(effectiveSecondary.rawSource)

  return {
    dataQuality: dataError ? 'DATA ERROR' : secondaryPrice ? 'VERIFIED' : 'UNVERIFIED',
    dataError,
    secondarySource: effectiveSecondary?.source ?? null,
    secondaryPrice: secondaryPrice ? roundPrice(secondaryPrice, price) : null,
    priceDiffPct: diffPct,
    quoteAgeMinutes,
    validationNotes: notes.slice(0, 4),
  }
}

function buildSignalPlan(raw: RawCandidate, status: MomentumStatus): SignalPlan {
  const referencePrice = raw.price
  if (status === 'DATA ERROR' || raw.dataQuality === 'DATA ERROR') {
    return {
      action: 'AVOID',
      label: 'DATA ERROR',
      thesis: 'No trade signal until the stock price validates against a second source.',
      entryTrigger: null,
      entryZoneLow: null,
      entryZoneHigh: null,
      stopLoss: null,
      targetOne: null,
      targetTwo: null,
      invalidation: raw.dataError ?? 'Data quality gate failed.',
      sellPlan: 'Do not enter. Remove from paper-trading list until the next clean scan.',
      riskReward: null,
    }
  }

  if (status === 'IGNORE') {
    return {
      action: 'AVOID',
      label: 'NO TRADE',
      thesis: 'Momentum, liquidity, VWAP, spread, or high-of-day alignment is not clean enough.',
      entryTrigger: null,
      entryZoneLow: null,
      entryZoneHigh: null,
      stopLoss: null,
      targetOne: null,
      targetTwo: null,
      invalidation: 'Wait for the gates to clear on a later scan.',
      sellPlan: 'No active entry plan.',
      riskReward: null,
    }
  }

  const isCrypto = raw.assetClass === 'crypto'
  const microPullback = !isCrypto ? raw.microPullback : undefined
  const microEntry =
    microPullback &&
    (microPullback.state === 'READY' || microPullback.state === 'FORMING') &&
    microPullback.trigger !== null &&
    microPullback.stop !== null &&
    microPullback.stop < microPullback.trigger
      ? microPullback
      : null
  const triggerBuffer = isCrypto ? 1.001 : 1.0015
  const zoneLowBuffer = isCrypto ? 0.997 : 0.995
  const zoneHighBuffer = isCrypto ? 1.002 : 1.003
  const stopVwapBuffer = isCrypto ? 0.99 : 0.985
  const stopMaxLossBuffer = isCrypto ? 0.975 : 0.965
  const breakoutAnchor = Math.max(raw.price, raw.highOfDay)
  const entryTrigger = roundPrice(microEntry ? microEntry.trigger : breakoutAnchor * triggerBuffer, referencePrice)
  const entryZoneLow = roundPrice((entryTrigger ?? breakoutAnchor) * zoneLowBuffer, referencePrice)
  const entryZoneHigh = roundPrice((entryTrigger ?? breakoutAnchor) * zoneHighBuffer, referencePrice)
  const structuralStop =
    microEntry?.stop ??
    (raw.vwap > 0 ? raw.vwap * stopVwapBuffer : raw.price * stopMaxLossBuffer)
  const maxLossStop = (entryTrigger ?? raw.price) * stopMaxLossBuffer
  const stopLoss = roundPrice(Math.max(structuralStop, maxLossStop), referencePrice)
  const risk = entryTrigger !== null && stopLoss !== null ? Math.max(entryTrigger - stopLoss, 0) : 0
  const targetOne = risk > 0 && entryTrigger !== null ? roundPrice(entryTrigger + risk * 1.2, referencePrice) : null
  const targetTwo = risk > 0 && entryTrigger !== null ? roundPrice(entryTrigger + risk * 2, referencePrice) : null
  const riskReward = risk > 0 && targetTwo !== null && entryTrigger !== null ? round((targetTwo - entryTrigger) / risk, 2) : null
  const vwapLabel = isCrypto ? '4h VWAP' : 'VWAP'
  const setupLabel = microEntry ? 'micro-pullback' : 'breakout'
  const setupInvalidation =
    microEntry?.pullbackLow !== null && microEntry?.pullbackLow !== undefined
      ? `below the pullback low near ${formatSignalPrice(microEntry.pullbackLow)}`
      : `loses ${vwapLabel}`

  if (status === 'CHECK NOW') {
    return {
      action: 'BUY',
      label: 'BUY TRIGGER',
      thesis: `Model opinion: ${setupLabel} paper-buy only if price trades through ${formatSignalPrice(entryTrigger)} and stays above ${vwapLabel}.`,
      entryTrigger,
      entryZoneLow,
      entryZoneHigh,
      stopLoss,
      targetOne,
      targetTwo,
      invalidation: `No paper entry if it ${setupInvalidation}; exit below ${formatSignalPrice(stopLoss)} after entry.`,
      sellPlan: `First target ${formatSignalPrice(targetOne)}, final target ${formatSignalPrice(targetTwo)}, hard stop ${formatSignalPrice(stopLoss)}.`,
      riskReward,
    }
  }

  return {
    action: 'WAIT',
    label: 'WAIT FOR TRIGGER',
    thesis: `Model opinion: watch only. ${setupLabel} paper-buy requires a break through ${formatSignalPrice(entryTrigger)} without losing ${vwapLabel}.`,
    entryTrigger,
    entryZoneLow,
    entryZoneHigh,
    stopLoss,
    targetOne,
    targetTwo,
    invalidation: `Drop from watch if it ${setupInvalidation} or the next full scan removes the setup.`,
    sellPlan: `If triggered later, first target ${formatSignalPrice(targetOne)} and hard stop ${formatSignalPrice(stopLoss)}.`,
    riskReward,
  }
}

function carryForwardLiveSignal(refreshed: MomentumCandidate, previous: MomentumCandidate): MomentumCandidate {
  if (refreshed.status === 'DATA ERROR' || refreshed.status === 'IGNORE') return refreshed

  const action: SignalAction = refreshed.status === 'CHECK NOW' ? 'BUY' : 'WAIT'
  const vwapLabel = refreshed.assetClass === 'crypto' ? '4h VWAP' : 'VWAP'

  // By default the plan is carried forward from the last full scan so the breakout
  // trigger stays stable between 5s refreshes. A stock micro-pullback is the
  // exception: its trigger is the *pause high*, which rises live as the pause forms,
  // so a carried-forward trigger lags the live "break $X" level and the card shows
  // two different numbers. Re-derive trigger/stop/targets from the live micro
  // structure (same math as buildSignalPlan's stock micro path: 3.5% max-loss stop
  // floor, 1.2R / 2R targets) so the displayed plan stays coherent with it.
  const liveMicro =
    refreshed.assetClass === 'stock' &&
    refreshed.microPullback &&
    (refreshed.microPullback.state === 'READY' || refreshed.microPullback.state === 'FORMING') &&
    refreshed.microPullback.trigger !== null &&
    refreshed.microPullback.stop !== null &&
    refreshed.microPullback.stop < refreshed.microPullback.trigger
      ? refreshed.microPullback
      : null

  let entryTrigger = previous.signal.entryTrigger
  let stopLoss = previous.signal.stopLoss
  let targetOneValue = previous.signal.targetOne
  let targetTwoValue = previous.signal.targetTwo
  let riskReward = previous.signal.riskReward
  if (liveMicro && liveMicro.trigger !== null && liveMicro.stop !== null) {
    const ref = refreshed.price > 0 ? refreshed.price : liveMicro.trigger
    entryTrigger = roundPrice(liveMicro.trigger, ref)
    stopLoss = roundPrice(Math.max(liveMicro.stop, liveMicro.trigger * 0.965), ref)
    const risk = entryTrigger !== null && stopLoss !== null ? Math.max(entryTrigger - stopLoss, 0) : 0
    if (risk > 0 && entryTrigger !== null) {
      targetOneValue = roundPrice(entryTrigger + risk * 1.2, ref)
      targetTwoValue = roundPrice(entryTrigger + risk * 2, ref)
      if (targetTwoValue !== null) riskReward = round((targetTwoValue - entryTrigger) / risk, 2)
    }
  }

  const entry = formatSignalPrice(entryTrigger)
  const stop = formatSignalPrice(stopLoss)
  const targetOne = formatSignalPrice(targetOneValue)
  const targetTwo = formatSignalPrice(targetTwoValue)

  return {
    ...refreshed,
    signal: {
      ...previous.signal,
      action,
      entryTrigger,
      stopLoss,
      targetOne: targetOneValue,
      targetTwo: targetTwoValue,
      riskReward,
      label: action === 'BUY' ? 'BUY TRIGGER' : 'WAIT FOR TRIGGER',
      thesis:
        action === 'BUY'
          ? `Model opinion: paper-buy only if price trades through ${entry} and stays above ${vwapLabel}.`
          : `Model opinion: watch only. Paper-buy requires a break through ${entry} without losing ${vwapLabel}.`,
      invalidation:
        action === 'BUY'
          ? `No paper entry if it loses ${vwapLabel}; exit below ${stop} after entry.`
          : `Drop from watch if it loses ${vwapLabel} or the next full scan removes the setup.`,
      sellPlan:
        action === 'BUY'
          ? `First target ${targetOne}, final target ${targetTwo}, hard stop ${stop}.`
          : `If triggered later, first target ${targetOne} and hard stop ${stop}.`,
    },
  }
}

function canCarryReversionRefresh(refreshed: MomentumCandidate) {
  if (refreshed.status !== 'IGNORE') return true
  return refreshed.blockers.every(
    (blocker) =>
      blocker === 'price is no longer below VWAP' ||
      /^VWAP stretch .* below the .* setup minimum$/.test(blocker),
  )
}

export function carryForwardReversionSignal(refreshed: MomentumCandidate, previous: MomentumCandidate): MomentumCandidate {
  if (refreshed.status === 'DATA ERROR') return refreshed
  if (!canCarryReversionRefresh(refreshed)) return refreshed

  const trigger = previous.signal.entryTrigger
  const stop = previous.signal.stopLoss
  const targetOne = previous.signal.targetOne
  const targetTwo = previous.signal.targetTwo
  if (trigger === null || stop === null || targetOne === null || targetTwo === null) return refreshed

  const crossed = refreshed.price >= trigger
  const action: SignalAction = crossed ? 'BUY' : 'WAIT'
  const entry = formatSignalPrice(trigger)
  const target = formatSignalPrice(targetOne)
  const stopText = formatSignalPrice(stop)
  const harmlessBlockers =
    refreshed.status === 'IGNORE'
      ? refreshed.blockers.filter(
          (blocker) =>
            blocker !== 'price is no longer below VWAP' &&
            !/^VWAP stretch .* below the .* setup minimum$/.test(blocker),
        )
      : refreshed.blockers

  return {
    ...refreshed,
    strategy: 'reversion',
    score: Math.max(refreshed.score, previous.score),
    confidence: Math.max(refreshed.confidence, previous.confidence),
    status: crossed ? 'CHECK NOW' : 'WATCH',
    blockers: harmlessBlockers,
    signal: {
      ...previous.signal,
      action,
      label: crossed ? 'RECLAIM BUY' : 'WAIT FOR RECLAIM',
      entryTrigger: trigger,
      stopLoss: stop,
      targetOne,
      targetTwo,
      thesis: crossed
        ? `Model opinion: locked VWAP-reclaim trigger ${entry} was reached; paper-buy only if execution gates still pass.`
        : `Model opinion: locked VWAP-reclaim watch remains active; buy only through ${entry} toward VWAP ${target}.`,
      invalidation: `Drop if it loses ${stopText} or execution gates reject the reclaim.`,
      sellPlan: `Trim into VWAP ${target}, final ${formatSignalPrice(targetTwo)}, hard stop ${stopText}.`,
    },
  }
}

function formatSignalPrice(value: number | null) {
  if (value === null) return 'n/a'
  return `$${value.toFixed(priceDigits(value))}`
}

async function fetchJson<T>(url: string, timeoutMs = 9_000): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Market data request failed (${response.status})`)
  return (await response.json()) as T
}

async function fetchAlpacaJson<T>(url: string, timeoutMs = 9_000): Promise<T> {
  const credentials = alpacaCredentials()
  if (!credentials) throw new Error('Alpaca credentials are not configured.')

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'APCA-API-KEY-ID': credentials.key,
        'APCA-API-SECRET-KEY': credentials.secret,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      alpacaMarketDataError =
        response.status === 401 || response.status === 403
          ? `Alpaca market-data authentication failed (${response.status})`
          : `Alpaca market-data request failed (${response.status})`
      throw new Error(alpacaMarketDataError)
    }
    alpacaMarketDataError = null
    return (await response.json()) as T
  } catch (error) {
    if (!alpacaMarketDataError) {
      alpacaMarketDataError = error instanceof Error ? error.message : 'Alpaca market-data request failed'
    }
    throw error
  }
}

function tradingViewExchange(exchange: string, exchangeDisplay: string) {
  const value = `${exchange} ${exchangeDisplay}`.toUpperCase()
  if (value.includes('NASDAQ') || ['NMS', 'NGM', 'NCM'].some((code) => value.includes(code))) return 'NASDAQ'
  if (value.includes('NYSE') || value.includes('NYQ')) return 'NYSE'
  if (value.includes('AMEX') || value.includes('ASE')) return 'AMEX'
  return ''
}

function stockTradingViewUrl(symbol: string, exchange: string, exchangeDisplay: string) {
  const prefix = tradingViewExchange(exchange, exchangeDisplay)
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(prefix ? `${prefix}:${symbol}` : symbol)}`
}

function cryptoTradingViewUrl(symbol: string) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BINANCE:${symbol}`)}`
}

type IntradayBar = {
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp?: number
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function emaValue(values: number[], period: number) {
  if (values.length < period) return null
  const multiplier = 2 / (period + 1)
  let ema = average(values.slice(0, period))
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * multiplier + ema * (1 - multiplier)
  }
  return ema
}

function atrValue(bars: IntradayBar[], period = 14) {
  if (bars.length < period + 1) return null
  const ranges: number[] = []
  for (let i = 1; i < bars.length; i += 1) {
    const previousClose = bars[i - 1].close
    const bar = bars[i]
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)))
  }
  return average(ranges.slice(-period))
}

// Wilder's RSI over closes. Used by the mean-reversion path as an oversold gate
// (a stretched-below-VWAP name is only a controlled buy if it is also oversold).
// Returns null when there aren't enough bars to be meaningful.
function rsiValue(bars: IntradayBar[], period = 14) {
  if (bars.length < period + 1) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const delta = bars[i].close - bars[i - 1].close
    if (delta >= 0) gain += delta
    else loss -= delta
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < bars.length; i += 1) {
    const delta = bars[i].close - bars[i - 1].close
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return round(100 - 100 / (1 + rs), 1)
}

function levelKey(price: number) {
  return Math.round(price * 10000) / 10000
}

function addLevel(levels: Set<number>, value: number | null | undefined, price: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return
  if (Math.abs(value - price) / price > 0.12) return
  levels.add(levelKey(value))
}

function roundLevelStep(price: number) {
  if (price < 1) return 0.05
  if (price < 5) return 0.1
  if (price < 20) return 0.25
  if (price < 100) return 0.5
  return 1
}

function nearestSupportResistance({
  bars,
  price,
  vwap,
  ema9,
  ema20,
  highOfDay,
  premarketHigh,
  openingRangeHigh,
  openingRangeLow,
}: {
  bars: IntradayBar[]
  price: number
  vwap: number
  ema9: number | null
  ema20: number | null
  highOfDay: number
  premarketHigh: number | null
  openingRangeHigh: number | null
  openingRangeLow: number | null
}) {
  const levels = new Set<number>()
  addLevel(levels, vwap, price)
  addLevel(levels, ema9, price)
  addLevel(levels, ema20, price)
  addLevel(levels, highOfDay, price)
  addLevel(levels, premarketHigh, price)
  addLevel(levels, openingRangeHigh, price)
  addLevel(levels, openingRangeLow, price)

  const lookback = bars.slice(-48)
  for (let i = 1; i < lookback.length - 1; i += 1) {
    const previous = lookback[i - 1]
    const current = lookback[i]
    const next = lookback[i + 1]
    if (current.low <= previous.low && current.low <= next.low) addLevel(levels, current.low, price)
    if (current.high >= previous.high && current.high >= next.high) addLevel(levels, current.high, price)
  }

  const step = roundLevelStep(price)
  const base = Math.floor(price / step) * step
  for (let offset = -4; offset <= 6; offset += 1) {
    addLevel(levels, base + step * offset, price)
  }
  if (price < 10) {
    addLevel(levels, Math.floor(price) + 0.5, price)
    addLevel(levels, Math.ceil(price), price)
  }

  const sorted = [...levels].sort((a, b) => a - b)
  const nearestSupport = [...sorted].reverse().find((level) => level < price) ?? null
  const nearestResistance = sorted.find((level) => level > price) ?? null
  return {
    nearestSupport,
    nearestResistance,
    supportDistancePct: nearestSupport !== null ? round(((price - nearestSupport) / price) * 100, 2) : null,
    resistanceDistancePct: nearestResistance !== null ? round(((nearestResistance - price) / price) * 100, 2) : null,
  }
}

function pullbackRunCount(bars: IntradayBar[], endIndex: number) {
  let count = 0
  for (let index = endIndex; index > 0 && count < 5; index -= 1) {
    const bar = bars[index]
    const previous = bars[index - 1]
    const isPullbackBar = bar.close <= bar.open || bar.close < previous.close || bar.high <= previous.high
    if (!isPullbackBar) break
    count += 1
  }
  return count
}

function analyzeMicroPullback({
  bars,
  vwap,
  vwapExtensionPct,
  highOfDay,
  premarketHigh,
  openingRangeHigh,
  openingRangeLow,
}: {
  bars: IntradayBar[]
  vwap: number
  vwapExtensionPct: number | null
  highOfDay: number
  premarketHigh: number | null
  openingRangeHigh: number | null
  openingRangeLow: number | null
}): MicroPullbackAnalysis | undefined {
  if (bars.length < 8) return undefined
  const closes = bars.map((bar) => bar.close)
  const ema9 = emaValue(closes, 9)
  const ema20 = emaValue(closes, 20)
  const atr = atrValue(bars)
  const lastIndex = bars.length - 1
  const last = bars[lastIndex]
  const previous = bars[lastIndex - 1]
  const price = last.close
  const levels = nearestSupportResistance({
    bars,
    price,
    vwap,
    ema9,
    ema20,
    highOfDay,
    premarketHigh,
    openingRangeHigh,
    openingRangeLow,
  })

  const readyBreak = last.close >= last.open && last.high > previous.high && last.close > previous.close
  // Anchor the pause to the most recent down bar, skipping the breakout bar and any
  // green/flat follow-through bars sitting above it (bounded to a few bars). This
  // keeps the reclaim level (= pause high) stable across the whole up-leg. Without
  // it, a quiet follow-through bar re-reads as a fresh one-bar pullback and the
  // reclaim flickers READY -> FORMING the instant after it breaks out. readyBreak's
  // old `lastIndex - 1` anchor is just the single-bar special case of this skip-back.
  let pullbackEnd = lastIndex
  for (let skipped = 0; pullbackEnd > 1 && skipped < 5 && bars[pullbackEnd].close >= bars[pullbackEnd].open; skipped += 1) {
    pullbackEnd -= 1
  }
  // No recent down bar above the current leg -> not a follow-through reclaim; keep the
  // original semantics so a pure uptrend still reads as no-pullback / extended.
  if (bars[pullbackEnd].close >= bars[pullbackEnd].open) pullbackEnd = lastIndex
  const pullbackCount = pullbackRunCount(bars, pullbackEnd)
  const extended =
    pullbackCount === 0 &&
    price > vwap &&
    (vwapExtensionPct ?? 0) >= 8 &&
    highOfDay > 0 &&
    ((highOfDay - price) / highOfDay) * 100 <= 1.5

  if (pullbackCount === 0 && !extended) {
    return {
      state: 'NONE',
      label: 'No micro pullback',
      score: 0,
      trigger: null,
      stop: null,
      pullbackLow: null,
      pullbackHigh: null,
      pullbackCandles: 0,
      pullbackDepthPct: null,
      ema9: ema9 === null ? null : round(ema9, 4),
      ema20: ema20 === null ? null : round(ema20, 4),
      atr: atr === null ? null : round(atr, 4),
      ...levels,
      notes: ['no clean 1-3 candle pause yet'],
    }
  }

  if (extended) {
    return {
      state: 'EXTENDED',
      label: 'Extended - wait for pullback',
      score: -6,
      trigger: null,
      stop: null,
      pullbackLow: null,
      pullbackHigh: null,
      pullbackCandles: 0,
      pullbackDepthPct: null,
      ema9: ema9 === null ? null : round(ema9, 4),
      ema20: ema20 === null ? null : round(ema20, 4),
      atr: atr === null ? null : round(atr, 4),
      ...levels,
      notes: ['near high but stretched from VWAP'],
    }
  }

  const pullbackStart = Math.max(0, pullbackEnd - pullbackCount + 1)
  const pullbackBars = bars.slice(pullbackStart, pullbackEnd + 1)
  const impulseBars = bars.slice(Math.max(0, pullbackStart - 8), pullbackStart)
  const impulseHigh = impulseBars.length > 0 ? Math.max(...impulseBars.map((bar) => bar.high)) : highOfDay
  const impulseLow = impulseBars.length > 0 ? Math.min(...impulseBars.map((bar) => bar.low)) : Math.min(...bars.slice(-12).map((bar) => bar.low))
  const impulseRange = impulseHigh > impulseLow ? impulseHigh - impulseLow : 0
  const impulseMovePct = impulseLow > 0 ? ((impulseHigh - impulseLow) / impulseLow) * 100 : 0
  const pullbackLow = Math.min(...pullbackBars.map((bar) => bar.low))
  const pullbackHigh = Math.max(...pullbackBars.map((bar) => bar.high))
  const pullbackDepthPct = impulseRange > 0 ? clamp(((impulseHigh - pullbackLow) / impulseRange) * 100, 0, 100) : null
  const impulseVolume = average(impulseBars.map((bar) => bar.volume).filter((volume) => volume > 0))
  const pullbackVolume = average(pullbackBars.map((bar) => bar.volume).filter((volume) => volume > 0))
  const volumeContracted = impulseVolume <= 0 || pullbackVolume <= impulseVolume * 0.9
  const minSupport = Math.min(...[vwap, ema9 ?? Number.POSITIVE_INFINITY, ema20 ?? Number.POSITIVE_INFINITY].filter(Number.isFinite))
  const heldSupport = minSupport > 0 ? pullbackLow >= minSupport * 0.992 : price >= vwap
  const shallowEnough = pullbackDepthPct === null || pullbackDepthPct <= 50
  const trigger = pullbackHigh * 1.001
  const stop = pullbackLow * 0.995
  const notes: string[] = []
  let score = 0

  if (pullbackCount >= 1 && pullbackCount <= 3) {
    score += 8
    notes.push(`${pullbackCount} pullback candle${pullbackCount === 1 ? '' : 's'}`)
  } else {
    score -= 4
    notes.push(`${pullbackCount} candle pullback is aging`)
  }
  if (impulseMovePct >= 5) {
    score += 6
    notes.push('strong impulse before pullback')
  }
  if (shallowEnough) {
    score += pullbackDepthPct !== null && pullbackDepthPct <= 30 ? 5 : 2
    notes.push(`depth ${pullbackDepthPct === null ? 'n/a' : `${round(pullbackDepthPct, 1)}%`}`)
  } else {
    score -= 8
    notes.push('retraced more than half the move')
  }
  if (volumeContracted) {
    score += 4
    notes.push('pullback volume contracted')
  } else {
    score -= 4
    notes.push('pullback selling volume elevated')
  }
  if (heldSupport) {
    score += 5
    notes.push('held VWAP/EMA support')
  } else {
    score -= 8
    notes.push('lost VWAP/EMA support')
  }
  if (readyBreak) {
    score += 8
    notes.push('green candle broke pullback high')
  }

  // A reclaim is still live (not only on the single break bar) while the current bar
  // is green/flat and price is holding at/above the pause-high trigger. This is the
  // precision-neutral persistence: it never lights a pullback that has not reclaimed
  // (price < trigger stays FORMING) nor a red/reversing bar, it only stops a held
  // breakout from flickering off through its follow-through.
  const reclaimHolding = pullbackEnd < lastIndex && last.close >= last.open && price >= trigger
  let state: MicroPullbackState = 'FORMING'
  if (!heldSupport || !shallowEnough || pullbackCount > 4) state = 'FAILED'
  else if (readyBreak || reclaimHolding) state = 'READY'

  const label =
    state === 'READY'
      ? 'Micro pullback ready'
      : state === 'FAILED'
        ? 'Micro pullback failed'
        : 'Micro pullback forming'

  return {
    state,
    label,
    score,
    trigger: round(trigger, price < 10 ? 4 : 2),
    stop: round(stop, price < 10 ? 4 : 2),
    pullbackLow: round(pullbackLow, price < 10 ? 4 : 2),
    pullbackHigh: round(pullbackHigh, price < 10 ? 4 : 2),
    pullbackCandles: pullbackCount,
    pullbackDepthPct: pullbackDepthPct === null ? null : round(pullbackDepthPct, 1),
    ema9: ema9 === null ? null : round(ema9, 4),
    ema20: ema20 === null ? null : round(ema20, 4),
    atr: atr === null ? null : round(atr, 4),
    ...levels,
    notes: notes.slice(0, 5),
  }
}

function newYorkMinuteOfDay(timestampSeconds: number): number | null {
  try {
    const date = new Date(timestampSeconds * 1000)
    const estStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const [hour, minute] = estStr.split(':').map(Number)
    return hour * 60 + minute
  } catch {
    return null
  }
}

function expectedRegularSessionVolumeProgress(minutesAfterOpen: number) {
  const minute = clamp(minutesAfterOpen, 0, 390)
  if (minute <= 30) return 0.22 * (minute / 30)
  if (minute <= 120) return 0.22 + 0.22 * ((minute - 30) / 90)
  if (minute <= 300) return 0.44 + 0.26 * ((minute - 120) / 180)
  return 0.7 + 0.3 * ((minute - 300) / 90)
}

function expectedStockVolumeProgress(minuteOfDay: number | null) {
  if (minuteOfDay === null) return null
  // 04:00-09:30 ET: premarket usually contributes only a small fraction of a
  // normal full-day volume baseline, so heavy premarket activity should stand out.
  if (minuteOfDay >= 240 && minuteOfDay < 570) {
    return round(clamp(0.002 + 0.028 * ((minuteOfDay - 240) / 330), 0.002, 0.03), 4)
  }
  // 09:30-16:00 ET: approximate the normal U-shaped equity volume curve.
  if (minuteOfDay >= 570 && minuteOfDay < 960) {
    const regularProgress = expectedRegularSessionVolumeProgress(minuteOfDay - 570)
    return round(clamp(0.03 + 0.97 * regularProgress, 0.03, 1), 4)
  }
  if (minuteOfDay >= 960 && minuteOfDay < 1200) return 1
  return null
}

function buildStockSessionVolumeProfile({
  volume,
  averageVolume,
  latestMinuteOfDay,
  latestBarVolume,
  averageRecentBarVolume,
}: {
  volume: number
  averageVolume: number | null
  latestMinuteOfDay: number | null
  latestBarVolume: number | null
  averageRecentBarVolume: number | null
}): StockSessionVolumeProfile | null {
  const expectedProgress = expectedStockVolumeProgress(latestMinuteOfDay)
  const expectedVolumeSoFar =
    averageVolume !== null && averageVolume > 0 && expectedProgress !== null ? averageVolume * expectedProgress : null
  const timeAdjustedRelativeVolume =
    expectedVolumeSoFar !== null && expectedVolumeSoFar > 0 ? round(volume / expectedVolumeSoFar, 2) : null
  const latestBarVolumeRatio =
    latestBarVolume !== null && averageRecentBarVolume !== null && averageRecentBarVolume > 0
      ? round(latestBarVolume / averageRecentBarVolume, 2)
      : null
  const notes: string[] = []
  if (expectedProgress !== null) notes.push(`expected ${round(expectedProgress * 100, 1)}% of normal day by now`)
  if (expectedVolumeSoFar !== null) notes.push(`expected ${Math.round(expectedVolumeSoFar).toLocaleString()} shares by now`)
  if (latestBarVolumeRatio !== null) notes.push(`latest bar ${latestBarVolumeRatio.toFixed(2)}x recent average`)

  let label = 'volume pace unavailable'
  if (timeAdjustedRelativeVolume !== null) {
    if (timeAdjustedRelativeVolume >= 4) label = 'time-of-day volume explosion'
    else if (timeAdjustedRelativeVolume >= 2.5) label = 'abnormal volume for this time'
    else if (timeAdjustedRelativeVolume >= 1.5) label = 'healthy volume for this time'
    else if (timeAdjustedRelativeVolume >= 0.8) label = 'normal volume pace'
    else label = 'weak volume for this time'
  }

  return {
    minuteOfDay: latestMinuteOfDay,
    expectedVolumeProgressPct: expectedProgress !== null ? round(expectedProgress * 100, 2) : null,
    expectedVolumeSoFar: expectedVolumeSoFar !== null ? Math.round(expectedVolumeSoFar) : null,
    timeAdjustedRelativeVolume,
    latestBarVolumeRatio,
    label,
    notes,
  }
}

function chartStats(chart: ChartResult | null) {
  const quote = chart?.indicators?.quote?.[0]
  const opens = quote?.open ?? []
  const highs = quote?.high ?? []
  const lows = quote?.low ?? []
  const closes = quote?.close ?? []
  const volumes = quote?.volume ?? []
  const timestamps = chart?.timestamp ?? []

  let highOfDay = 0
  let lowOfDay = Number.POSITIVE_INFINITY
  let volumeSum = 0
  let vwapNumerator = 0
  let vwapDenominator = 0
  let latestMinuteOfDay: number | null = null
  const closeSeries: number[] = []
  const volumeSeries: number[] = []
  const bars: IntradayBar[] = []

  const premarketHighs: number[] = []
  const premarketVolumes: number[] = []
  const premarketDollarVolumes: number[] = []

  const openingRangeHighs: number[] = []
  const openingRangeLows: number[] = []

  for (let i = 0; i < closes.length; i += 1) {
    const ts = timestamps[i]
    const open = safeNumber(opens[i])
    const high = safeNumber(highs[i])
    const low = safeNumber(lows[i])
    const close = safeNumber(closes[i])
    const volume = safeNumber(volumes[i]) ?? 0

    if (high !== null) highOfDay = Math.max(highOfDay, high)
    if (low !== null && low > 0) lowOfDay = Math.min(lowOfDay, low)
    if (close !== null && close > 0) closeSeries.push(close)
    if (volume > 0) volumeSeries.push(volume)
    if (open !== null && high !== null && low !== null && close !== null && open > 0 && high > 0 && low > 0 && close > 0) {
      bars.push({ open, high, low, close, volume, timestamp: ts })
    }
    if (close !== null && high !== null && low !== null && volume > 0) {
      const typical = (high + low + close) / 3
      vwapNumerator += typical * volume
      vwapDenominator += volume
      volumeSum += volume
    }

    if (ts !== undefined) {
      const timeVal = newYorkMinuteOfDay(ts)
      if (timeVal !== null) {
        latestMinuteOfDay = timeVal
        // Premarket window: 04:00 <= time < 09:30 New York
        if (timeVal >= 240 && timeVal < 570) {
          if (high !== null) premarketHighs.push(high)
          if (volume > 0) {
            premarketVolumes.push(volume)
            if (close !== null) {
              premarketDollarVolumes.push(volume * close)
            }
          }
        }
        // Opening range window: 09:30 <= time < 09:45 New York
        if (timeVal >= 570 && timeVal < 585) {
          if (high !== null) openingRangeHighs.push(high)
          if (low !== null && low > 0) openingRangeLows.push(low)
        }
      }
    }
  }

  let lastClose: number | null = null
  let lastTimestamp: string | null = null
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const close = safeNumber(closes[i])
    if (close !== null) {
      lastClose = close
      lastTimestamp = isoFromSeconds(chart?.timestamp?.[i])
      break
    }
  }
  const vwap = round(vwapDenominator > 0 ? vwapNumerator / vwapDenominator : lastClose || 0, 3)
  const moveOverBars = (bars: number) => {
    if (lastClose === null || closeSeries.length < 2) return null
    const fromIndex = Math.max(0, closeSeries.length - 1 - bars)
    const from = closeSeries[fromIndex]
    return from > 0 ? round(((lastClose - from) / from) * 100, 2) : null
  }
  const recentVolumes = volumeSeries.slice(-2)
  const baselineVolumes = volumeSeries.slice(Math.max(0, volumeSeries.length - 14), Math.max(0, volumeSeries.length - 2))
  const baselineAverage =
    baselineVolumes.length > 0 ? baselineVolumes.reduce((total, value) => total + value, 0) / baselineVolumes.length : 0
  const recentVolume = recentVolumes.length > 0 ? Math.max(...recentVolumes) : null
  const volumePulse = baselineAverage > 0 && recentVolume !== null ? round(recentVolume / baselineAverage, 2) : null
  const rangeLow =
    Number.isFinite(lowOfDay) && lowOfDay > 0
      ? lowOfDay
      : closeSeries.length > 0
        ? Math.min(...closeSeries)
        : 0
  const range = highOfDay > rangeLow ? highOfDay - rangeLow : 0
  const rangePositionPct = range > 0 && lastClose !== null ? round(((lastClose - rangeLow) / range) * 100, 1) : null

  let premarketHigh: number | null = null
  let premarketVolume: number | null = null
  let premarketDollarVolume: number | null = null
  let openingRangeHigh: number | null = null
  let openingRangeLow: number | null = null

  if (premarketHighs.length > 0) premarketHigh = Math.max(...premarketHighs)
  if (premarketVolumes.length > 0) premarketVolume = premarketVolumes.reduce((a, b) => a + b, 0)
  if (premarketDollarVolumes.length > 0) premarketDollarVolume = premarketDollarVolumes.reduce((a, b) => a + b, 0)
  if (openingRangeHighs.length > 0) openingRangeHigh = Math.max(...openingRangeHighs)
  if (openingRangeLows.length > 0) openingRangeLow = Math.min(...openingRangeLows)

  const latestBarVolume = volumeSeries.length > 0 ? volumeSeries[volumeSeries.length - 1] : null
  const recentBarVolumes = volumeSeries.slice(-5)
  const averageRecentBarVolume = recentBarVolumes.length > 0
    ? Math.round(recentBarVolumes.reduce((a, b) => a + b, 0) / recentBarVolumes.length)
    : null
  const vwapExtensionPct = vwap > 0 && lastClose !== null ? round(((lastClose - vwap) / vwap) * 100, 2) : null
  const microPullback = analyzeMicroPullback({
    bars,
    vwap,
    vwapExtensionPct,
    highOfDay: highOfDay || lastClose || 0,
    premarketHigh,
    openingRangeHigh,
    openingRangeLow,
  })

  return {
    highOfDay: round(highOfDay || lastClose || 0, 3),
    vwap,
    chartVolume: Math.round(volumeSum),
    lastClose,
    lastTimestamp,
    oneHourMovePct: moveOverBars(12),
    fifteenMinuteMovePct: moveOverBars(3),
    volumePulse,
    rangePositionPct,
    vwapExtensionPct,
    premarketHigh,
    premarketVolume,
    premarketDollarVolume,
    openingRangeHigh,
    openingRangeLow,
    latestBarVolume,
    averageRecentBarVolume,
    latestMinuteOfDay,
    microPullback,
    // Mean-reversion inputs: intraday oversold reading + the session low used as
    // the structural stop reference for a VWAP-reclaim long.
    rsi14: rsiValue(bars),
    intradayLow: round((Number.isFinite(rangeLow) && rangeLow > 0 ? rangeLow : lastClose) || 0, 3),
  }
}

async function fetchScreener(id: string): Promise<ScreenerQuote[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${encodeURIComponent(
    id,
  )}&count=50`
  const data = await fetchJson<{
    finance?: { result?: Array<{ quotes?: ScreenerQuote[] }>; error?: { description?: string } }
  }>(url)
  if (data.finance?.error) throw new Error(data.finance.error.description || 'Yahoo screener error')
  return data.finance?.result?.[0]?.quotes ?? []
}

async function fetchStockChart(symbol: string): Promise<ChartResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1d&interval=5m&includePrePost=true`
  const data = await fetchJson<{ chart?: { result?: ChartResult[] } }>(url)
  return data.chart?.result?.[0] ?? null
}

// Maps an already-fetched Yahoo chart into the secondary-quote shape so it can
// serve as an independent cross-check for Alpaca-primary stock candidates when
// CNBC is unavailable. Reuses the existing chart fetch, no new endpoint.
function yahooSecondaryFromChart(chart: ChartResult | null, now: Date): SecondaryStockQuote | null {
  const meta = chart?.meta
  const price = safeNumber(meta?.regularMarketPrice)
  if (!meta || price === null) return null
  return {
    source: 'Yahoo',
    price,
    previousClose: safeNumber(meta.previousClose) ?? safeNumber(meta.chartPreviousClose),
    high: safeNumber(meta.regularMarketDayHigh),
    volume: safeNumber(meta.regularMarketVolume),
    marketCap: null,
    sharesOutstanding: null,
    shortInterestPct: null,
    timestamp: isoFromSeconds(meta.regularMarketTime),
    marketStatus: computedStockMarketStatus(now),
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    company: meta.shortName || meta.longName || null,
    rawSource: 'Yahoo chart meta',
  }
}

async function fetchCnbcQuote(symbol: string, now: Date): Promise<SecondaryStockQuote | null> {
  const url = `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=${encodeURIComponent(
    symbol,
  )}&output=json`
  const data = await fetchJson<{
    QuickQuoteResult?: { QuickQuote?: CnbcQuickQuote[] }
  }>(url)
  const quote = data.QuickQuoteResult?.QuickQuote?.[0]
  if (!quote) return null
  const price = safeNumber(quote.last)
  const previousClose = safeNumber(quote.previous_day_closing) ?? safeNumber(quote.FundamentalData?.MPreviousClose)
  const timestamp = firstIso(isoFromMilliseconds(quote.last_time_msec), quote.reg_last_time ?? null)
  
  // Safely check CNBC fundamental data payload for short interest fields
  const shortInterestPct = quote.FundamentalData 
    ? (safeNumber(quote.FundamentalData.shortinterest) ?? safeNumber(quote.FundamentalData.shortInterest) ?? null)
    : null;

  return {
    source: 'CNBC',
    price,
    previousClose,
    high: safeNumber(quote.high),
    volume: safeNumber(quote.fullVolume) ?? safeNumber(quote.volume),
    marketCap: safeNumber(quote.FundamentalData?.mktcap),
    sharesOutstanding: safeNumber(quote.FundamentalData?.sharesout),
    shortInterestPct,
    timestamp,
    marketStatus: normalizeCnbcMarketStatus(quote, now),
    exchange: quote.exchange ?? '',
    company: quote.name ?? null,
    rawSource: quote.source ?? quote.provider ?? null,
  }
}

async function fetchStockNews(symbol: string, now: Date) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    symbol,
  )}&quotesCount=1&newsCount=3&enableFuzzyQuery=false`
  const data = await fetchJson<{ news?: NewsItem[] }>(url)
  const upper = symbol.toUpperCase()
  const matchedItem = (data.news ?? []).find((entry) =>
    (entry.relatedTickers ?? []).some((ticker) => ticker.toUpperCase() === upper),
  )
  const item = matchedItem ?? data.news?.[0]
  const matchedTicker = matchedItem !== undefined

  if (!item?.title || !item.providerPublishTime) {
    return {
      catalyst: 'No linked source headline found',
      catalystPublisher: null,
      catalystAgeMinutes: null,
      newsUrl: null,
      matchedTicker: false,
    }
  }

  return {
    catalyst: item.title,
    catalystPublisher: item.publisher ?? null,
    catalystAgeMinutes: Math.max(0, Math.round((now.getTime() - item.providerPublishTime * 1000) / 60_000)),
    newsUrl: item.link ?? null,
    matchedTicker,
  }
}

async function buildStockCandidate(quote: ScreenerQuote, now: Date): Promise<RawCandidate | null> {
  const ticker = quote.symbol?.trim().toUpperCase()
  if (!ticker || quote.quoteType !== 'EQUITY' || !/^[A-Z][A-Z0-9.-]{0,12}$/.test(ticker)) return null

  const [chart, news, secondary] = await Promise.all([
    fetchStockChart(ticker).catch(() => null),
    fetchStockNews(ticker, now).catch(() => ({
      catalyst: 'News lookup failed',
      catalystPublisher: null,
      catalystAgeMinutes: null,
      newsUrl: null,
      matchedTicker: false,
    })),
    fetchCnbcQuote(ticker, now).catch(() => null),
  ])
  const stats = chartStats(chart)
  const price = safeNumber(quote.regularMarketPrice) ?? safeNumber(chart?.meta?.regularMarketPrice) ?? stats.vwap
  const previousClose =
    safeNumber(quote.regularMarketPreviousClose) ??
    safeNumber(chart?.meta?.previousClose) ??
    safeNumber(chart?.meta?.chartPreviousClose)
  const changePct =
    safeNumber(quote.regularMarketChangePercent) ??
    (previousClose && price ? ((price - previousClose) / previousClose) * 100 : 0)
  const volume = Math.max(
    safeNumber(quote.regularMarketVolume) ?? 0,
    safeNumber(chart?.meta?.regularMarketVolume) ?? 0,
    stats.chartVolume,
  )
  const averageVolume = safeNumber(quote.averageDailyVolume3Month) ?? safeNumber(quote.averageDailyVolume10Day)
  const bid = safeNumber(quote.bid)
  const ask = safeNumber(quote.ask)
  const spreadAvailable = bid !== null && ask !== null && bid > 0 && ask > bid
  const sessionVolume = buildStockSessionVolumeProfile({
    volume,
    averageVolume,
    latestMinuteOfDay: stats.latestMinuteOfDay,
    latestBarVolume: stats.latestBarVolume,
    averageRecentBarVolume: stats.averageRecentBarVolume,
  })

  if (!price || price <= 0 || !Number.isFinite(changePct)) return null
  const marketStatus = normalizeYahooMarketStatus(quote.marketState, now)
  const quoteTimestamp = firstIso(
    isoFromSeconds(quote.regularMarketTime),
    isoFromSeconds(chart?.meta?.regularMarketTime),
    stats.lastTimestamp,
  )
  const validation = validateStockQuote({
    price,
    quoteTimestamp,
    marketStatus,
    secondary,
    now,
  })
  const microBars = recordStockMicroBarSample({
    symbol: ticker,
    price,
    cumulativeVolume: Math.round(volume),
    timestamp: dateFromIso(quoteTimestamp, now),
    source: 'Yahoo',
  })

  const sharesOutstanding = safeNumber(quote.sharesOutstanding) ?? (secondary ? secondary.sharesOutstanding : null)
  const estimatedFreeFloat = sharesOutstanding ? sharesOutstanding * 0.8 : null
  const floatTurnover = estimatedFreeFloat ? volume / estimatedFreeFloat : null
  const shortInterestPct = secondary ? secondary.shortInterestPct : null

  let catScore = 0
  let catTags: string[] = []
  let catQuality: 'none' | 'positive' | 'negative' | 'mixed' | 'unmatched' = 'none'

  if (news.matchedTicker) {
    const classification = classifyCatalyst(news.catalyst)
    catScore = classification.score
    catTags = classification.tags
    catQuality = classification.quality
  } else if (news.catalyst && news.catalyst !== 'No linked source headline found' && news.catalyst !== 'News lookup failed') {
    catQuality = 'unmatched'
  }

  return {
    assetClass: 'stock',
    ticker,
    displaySymbol: ticker,
    company: quote.shortName || quote.longName || quote.displayName || chart?.meta?.shortName || chart?.meta?.longName || ticker,
    exchange: quote.exchange || chart?.meta?.exchangeName || '',
    exchangeDisplay: quote.fullExchangeName || chart?.meta?.fullExchangeName || quote.exchange || '',
    sector: quote.sector || 'Stock',
    price: round(price, price < 10 ? 3 : 2),
    changePct: round(changePct, 2),
    secondaryMovePct: null,
    secondaryMoveLabel: 'session',
    oneHourMovePct: stats.oneHourMovePct,
    fifteenMinuteMovePct: stats.fifteenMinuteMovePct,
    vwapExtensionPct: stats.vwapExtensionPct,
    rangePositionPct: stats.rangePositionPct,
    volume: Math.round(volume),
    quoteVolume: null,
    averageVolume: averageVolume ? Math.round(averageVolume) : null,
    relativeVolume: averageVolume && averageVolume > 0 ? round(volume / averageVolume, 2) : 0,
    volumePulse: stats.volumePulse,
    sessionVolume,
    microBars,
    recentQuoteVolume: null,
    trades: null,
    marketCap: safeNumber(quote.marketCap),
    sharesOutstanding,
    catalyst: news.catalyst,
    catalystPublisher: news.catalystPublisher,
    catalystAgeMinutes: news.catalystAgeMinutes,
    newsUrl: news.newsUrl,
    highOfDay: Math.max(safeNumber(quote.regularMarketDayHigh) ?? 0, safeNumber(chart?.meta?.regularMarketDayHigh) ?? 0, stats.highOfDay, price),
    vwap: stats.vwap || price,
    spreadPct: spreadAvailable ? round(((ask - bid) / price) * 100, 2) : 0,
    spreadAvailable,
    marketDataCoverage: 'PUBLIC_FALLBACK',
    tradingHalted: false,
    tradingHaltReason: null,
    quoteTimestamp,
    quoteAgeMinutes: validation.quoteAgeMinutes,
    marketStatus,
    marketStatusLabel: marketStatusLabel(marketStatus),
    dataQuality: validation.dataQuality,
    dataError: validation.dataError,
    primarySource: quote.quoteSourceName ? `Yahoo ${quote.quoteSourceName}` : 'Yahoo Finance screener',
    secondarySource: validation.secondarySource,
    secondaryPrice: validation.secondaryPrice,
    priceDiffPct: validation.priceDiffPct,
    validationNotes: validation.validationNotes,
    sourceLabel: 'Yahoo',

    // New Stock enhancements
    catalystScore: catScore,
    catalystTags: catTags,
    catalystQuality: catQuality,
    premarketHigh: stats.premarketHigh,
    premarketVolume: stats.premarketVolume,
    premarketDollarVolume: stats.premarketDollarVolume,
    openingRangeHigh: stats.openingRangeHigh,
    openingRangeLow: stats.openingRangeLow,
    orbBreakoutConfirmed: false,
    estimatedFreeFloat,
    floatTurnover,
    shortInterestPct,
    latestBarVolume: stats.latestBarVolume,
    averageRecentBarVolume: stats.averageRecentBarVolume,
    microPullback: stats.microPullback,
    intradayRsi: stats.rsi14,
    intradayLow: stats.intradayLow,
  }
}

async function fetchCryptoKlines(symbol: string) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=5m&limit=48`
  return fetchJson<Array<[number, string, string, string, string, string, number, string, number]>>(url)
}

function cryptoKlineStats(klines: Array<[number, string, string, string, string, string, number, string, number]>) {
  if (klines.length === 0) {
    return {
      fourHourMovePct: 0,
      oneHourMovePct: null,
      fifteenMinuteMovePct: null,
      vwap: 0,
      vwapExtensionPct: null,
      rangePositionPct: null,
      volumePulse: null,
      recentQuoteVolume: null,
    }
  }
  const firstOpen = safeNumber(klines[0][1]) ?? 0
  const lastClose = safeNumber(klines[klines.length - 1][4]) ?? firstOpen
  let vwapNumerator = 0
  let vwapDenominator = 0
  let rangeHigh = 0
  let rangeLow = Number.POSITIVE_INFINITY
  const quoteVolumes: number[] = []
  for (const kline of klines) {
    const high = safeNumber(kline[2]) ?? 0
    const low = safeNumber(kline[3]) ?? 0
    const close = safeNumber(kline[4]) ?? 0
    const volume = safeNumber(kline[5]) ?? 0
    const quoteVolume = safeNumber(kline[7]) ?? 0
    if (high > 0) rangeHigh = Math.max(rangeHigh, high)
    if (low > 0) rangeLow = Math.min(rangeLow, low)
    const typical = (high + low + close) / 3
    vwapNumerator += typical * volume
    vwapDenominator += volume
    quoteVolumes.push(quoteVolume)
  }
  const recent = quoteVolumes.slice(-2)
  const baseline = quoteVolumes.slice(Math.max(0, quoteVolumes.length - 14), Math.max(0, quoteVolumes.length - 2))
  const baselineAverage =
    baseline.length > 0 ? baseline.reduce((total, value) => total + value, 0) / baseline.length : 0
  const recentQuoteVolume = recent.length > 0 ? Math.max(...recent) : null
  const volumePulse =
    baselineAverage > 0 && recentQuoteVolume !== null ? round(recentQuoteVolume / baselineAverage, 2) : null
  const vwap = round(vwapDenominator ? vwapNumerator / vwapDenominator : lastClose, 6)
  const moveOverBars = (bars: number) => {
    const index = Math.max(0, klines.length - bars)
    const from = safeNumber(klines[index]?.[1])
    return from && from > 0 ? round(((lastClose - from) / from) * 100, 2) : null
  }
  const range = rangeHigh > rangeLow ? rangeHigh - rangeLow : 0
  return {
    fourHourMovePct: firstOpen ? round(((lastClose - firstOpen) / firstOpen) * 100, 2) : 0,
    oneHourMovePct: moveOverBars(12),
    fifteenMinuteMovePct: moveOverBars(3),
    vwap,
    vwapExtensionPct: vwap > 0 ? round(((lastClose - vwap) / vwap) * 100, 2) : null,
    rangePositionPct: range > 0 ? round(((lastClose - rangeLow) / range) * 100, 1) : null,
    volumePulse,
    recentQuoteVolume: recentQuoteVolume === null ? null : Math.round(recentQuoteVolume),
  }
}

export type CryptoScanOptions = {
  // When set, only Binance pairs whose base symbol (ticker minus the USDT
  // suffix, e.g. "BTC") is in this set survive. The paper bot passes the
  // Alpaca-tradable universe here so it never shortlists a coin it cannot buy.
  baseAllowlist?: Set<string>
  minQuoteVolume?: number
  minChangePct?: number
  limit?: number
}

function cryptoTickerBase(symbol: string) {
  return symbol.replace(/USDT$/, '')
}

function cryptoDiscoveryRank(ticker: BinanceTicker) {
  const changePct = safeNumber(ticker.priceChangePercent) ?? 0
  const quoteVolume = safeNumber(ticker.quoteVolume) ?? 0
  const trades = ticker.count ?? 0
  const last = safeNumber(ticker.lastPrice) ?? 0
  const bid = safeNumber(ticker.bidPrice) ?? 0
  const ask = safeNumber(ticker.askPrice) ?? 0
  const spreadPct = bid > 0 && ask > bid && last > 0 ? ((ask - bid) / last) * 100 : 0
  const liquidityScore = Math.log10(Math.max(quoteVolume, 1)) * 4
  const tradeScore = Math.log10(Math.max(trades, 1)) * 2
  return changePct * 5 + liquidityScore + tradeScore - spreadPct * 10
}

function uniqueCryptoTickers(groups: BinanceTicker[][], max: number) {
  const bySymbol = new Map<string, BinanceTicker>()
  for (const group of groups) {
    for (const ticker of group) {
      if (!bySymbol.has(ticker.symbol)) bySymbol.set(ticker.symbol, ticker)
      if (bySymbol.size >= max) return [...bySymbol.values()]
    }
  }
  return [...bySymbol.values()]
}

async function buildCryptoCandidates(now: Date, options: CryptoScanOptions = {}): Promise<RawCandidate[]> {
  const minQuoteVolume = options.minQuoteVolume ?? 5_000_000
  const minChangePct = options.minChangePct ?? 0
  const limit = options.limit ?? 30
  const allowlist = options.baseAllowlist
  const tickers = await fetchJson<BinanceTicker[]>('https://data-api.binance.vision/api/v3/ticker/24hr', 12_000)
  const eligibleTickers = tickers
    .filter((ticker) => {
      const quoteVolume = safeNumber(ticker.quoteVolume) ?? 0
      const changePct = safeNumber(ticker.priceChangePercent) ?? 0
      const base = cryptoTickerBase(ticker.symbol)
      return (
        CRYPTO_QUOTE_ASSETS.some((asset) => ticker.symbol.endsWith(asset)) &&
        STANDARD_CRYPTO_SYMBOL.test(ticker.symbol) &&
        !EXCLUDED_CRYPTO_BASES.has(base) &&
        !EXCLUDED_LEVERAGED_TOKENS.test(ticker.symbol) &&
        quoteVolume >= minQuoteVolume &&
        changePct > minChangePct &&
        (!allowlist || allowlist.has(base))
      )
    })
  const emergingFloor = Math.max(minChangePct, allowlist ? -0.5 : 0.75)
  const discoveryLimit = Math.min(70, Math.max(limit, Math.ceil(limit * 1.35)))
  const byMove = [...eligibleTickers]
    .sort((a, b) => (safeNumber(b.priceChangePercent) ?? 0) - (safeNumber(a.priceChangePercent) ?? 0))
    .slice(0, limit)
  const byBalanced = [...eligibleTickers]
    .sort((a, b) => cryptoDiscoveryRank(b) - cryptoDiscoveryRank(a))
    .slice(0, limit)
  const byLiquidity = eligibleTickers
    .filter((ticker) => (safeNumber(ticker.priceChangePercent) ?? 0) >= emergingFloor)
    .sort((a, b) => (safeNumber(b.quoteVolume) ?? 0) - (safeNumber(a.quoteVolume) ?? 0))
    .slice(0, Math.ceil(limit * 0.6))
  const byActivity = eligibleTickers
    .filter((ticker) => (safeNumber(ticker.priceChangePercent) ?? 0) >= emergingFloor)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, Math.ceil(limit * 0.6))
  const liquidMovers = uniqueCryptoTickers(
    [byMove.slice(0, Math.ceil(limit * 0.55)), byLiquidity, byActivity, byBalanced, byMove],
    discoveryLimit,
  )

  const withKlines = await Promise.all(
    liquidMovers.map(async (ticker) => ({
      ticker,
      klineStats: cryptoKlineStats(await fetchCryptoKlines(ticker.symbol).catch(() => [])),
    })),
  )

  return withKlines.map(({ ticker, klineStats }) => {
    const price = safeNumber(ticker.lastPrice) ?? 0
    const bid = safeNumber(ticker.bidPrice)
    const ask = safeNumber(ticker.askPrice)
    const spreadAvailable = bid !== null && ask !== null && bid > 0 && ask > bid && price > 0
    const base = ticker.symbol.replace(/USDT$/, '')
    const quoteTimestamp = isoFromMilliseconds(ticker.closeTime)
    return {
      assetClass: 'crypto',
      ticker: ticker.symbol,
      displaySymbol: `${base}/USDT`,
      company: `${base} spot pair`,
      exchange: 'BINANCE',
      exchangeDisplay: 'Binance Spot',
      sector: 'Crypto',
      price: round(price, price < 1 ? 6 : price < 10 ? 4 : 2),
      changePct: round(safeNumber(ticker.priceChangePercent) ?? 0, 2),
      secondaryMovePct: klineStats.fourHourMovePct,
      secondaryMoveLabel: '4h',
      oneHourMovePct: klineStats.oneHourMovePct,
      fifteenMinuteMovePct: klineStats.fifteenMinuteMovePct,
      vwapExtensionPct: klineStats.vwapExtensionPct,
      rangePositionPct: klineStats.rangePositionPct,
      volume: Math.round(safeNumber(ticker.volume) ?? 0),
      quoteVolume: Math.round(safeNumber(ticker.quoteVolume) ?? 0),
      averageVolume: null,
      relativeVolume: 0,
      volumePulse: klineStats.volumePulse,
      sessionVolume: null,
      microBars: null,
      recentQuoteVolume: klineStats.recentQuoteVolume,
      trades: ticker.count,
      marketCap: null,
      sharesOutstanding: null,
      catalyst: '24h Binance spot momentum',
      catalystPublisher: 'Binance public market data',
      catalystAgeMinutes: null,
      newsUrl: null,
      highOfDay: safeNumber(ticker.highPrice) ?? price,
      vwap: klineStats.vwap || safeNumber(ticker.weightedAvgPrice) || price,
      spreadPct: spreadAvailable ? round(((ask - bid) / price) * 100, 3) : 0,
      spreadAvailable,
      marketDataCoverage: 'CRYPTO_EXCHANGE',
      tradingHalted: false,
      tradingHaltReason: null,
      quoteTimestamp,
      quoteAgeMinutes: minutesSince(quoteTimestamp, now),
      marketStatus: 'CRYPTO_24_7' as const,
      marketStatusLabel: marketStatusLabel('CRYPTO_24_7'),
      dataQuality: 'VERIFIED' as const,
      dataError: null,
      primarySource: 'Binance spot 24h ticker',
      secondarySource: null,
      secondaryPrice: null,
      priceDiffPct: null,
      validationNotes: [
        quoteTimestamp ? 'Binance closeTime received' : 'Binance ticker timestamp unavailable',
        klineStats.volumePulse !== null ? `5m volume pulse ${klineStats.volumePulse.toFixed(2)}x` : '5m volume pulse unavailable',
      ],
      sourceLabel: 'Binance',

      // Stock-specific fields default mappings
      catalystScore: 0,
      catalystTags: [],
      catalystQuality: 'none',
      premarketHigh: null,
      premarketVolume: null,
      premarketDollarVolume: null,
      openingRangeHigh: null,
      openingRangeLow: null,
      orbBreakoutConfirmed: false,
      estimatedFreeFloat: null,
      floatTurnover: null,
      shortInterestPct: null,
      latestBarVolume: null,
      averageRecentBarVolume: null,
    }
  })
}

async function fetchAlpacaMovers(): Promise<AlpacaMover[]> {
  const data = await fetchAlpacaJson<{
    gainers?: AlpacaMover[]
    last_updated?: string
    market_type?: string
  }>('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=50', 12_000)
  return data.gainers ?? []
}

async function fetchAlpacaSnapshots(symbols: string[]) {
  const credentials = alpacaCredentials()
  const params = new URLSearchParams({
    symbols: symbols.join(','),
    feed: credentials?.feed || 'iex',
  })
  return fetchAlpacaJson<Record<string, AlpacaSnapshot>>(
    `https://data.alpaca.markets/v2/stocks/snapshots?${params.toString()}`,
    12_000,
  )
}

async function buildAlpacaStockCandidates(now: Date): Promise<RawCandidate[]> {
  const credentials = alpacaCredentials()
  if (!credentials) return []

  const movers: NormalizedAlpacaMover[] = (await fetchAlpacaMovers())
    .flatMap((mover) => {
      const symbol = mover.symbol?.trim().toUpperCase()
      const price = safeNumber(mover.price)
      const percentChange = safeNumber(mover.percent_change)
      if (
        !symbol ||
        price === null ||
        percentChange === null ||
        !STANDARD_STOCK_SYMBOL.test(symbol) ||
        EXCLUDED_STOCK_SUFFIXES.test(symbol) ||
        price <= 0.75 ||
        percentChange <= 0
      ) {
        return []
      }
      return [{ symbol, price, percentChange }]
    })
    .slice(0, 45)

  if (movers.length === 0) return []

  const snapshots = await fetchAlpacaSnapshots(movers.map((mover) => mover.symbol))

  const candidates = await Promise.all(
    movers.map(async (mover): Promise<RawCandidate | null> => {
      const snapshot = snapshots[mover.symbol]
      const dailyBar = snapshot?.dailyBar
      const minuteBar = snapshot?.minuteBar
      const previousBar = snapshot?.prevDailyBar
      const tradePrice = safeNumber(snapshot?.latestTrade?.p)
      const [secondary, news, chart] = await Promise.all([
        fetchCnbcQuote(mover.symbol, now).catch(() => null),
        fetchStockNews(mover.symbol, now).catch(() => ({
          catalyst: 'Alpaca top mover',
          catalystPublisher: `Alpaca ${credentials.feed.toUpperCase()} stock feed`,
          catalystAgeMinutes: null,
          newsUrl: null,
          matchedTicker: false,
        })),
        fetchStockChart(mover.symbol).catch(() => null),
      ])
      // Independent fallback cross-check (Yahoo) for when CNBC is unavailable, 
      // Alpaca is the primary price here, so Yahoo stays a genuine second source.
      const yahooSecondary = yahooSecondaryFromChart(chart, now)
      const chartMetrics = chartStats(chart)
      const price = tradePrice || safeNumber(minuteBar?.c) || safeNumber(dailyBar?.c) || mover.price || 0
      const previousClose = secondary?.previousClose ?? yahooSecondary?.previousClose ?? safeNumber(previousBar?.c)
      const changePct = previousClose && price ? ((price - previousClose) / previousClose) * 100 : mover.percentChange
      const highOfDay = Math.max(safeNumber(dailyBar?.h) ?? 0, safeNumber(minuteBar?.h) ?? 0, chartMetrics.highOfDay, price)
      const volume = Math.max(safeNumber(dailyBar?.v) ?? 0, safeNumber(minuteBar?.v) ?? 0, chartMetrics.chartVolume, secondary?.volume ?? 0)
      const previousVolume = safeNumber(previousBar?.v)
      const bid = safeNumber(snapshot?.latestQuote?.bp)
      const ask = safeNumber(snapshot?.latestQuote?.ap)
      const spreadAvailable = bid !== null && ask !== null && bid > 0 && ask > bid && price > 0
      const spreadPct = spreadAvailable ? round(((ask - bid) / price) * 100, 2) : 0
      const sessionVolume = buildStockSessionVolumeProfile({
        volume,
        averageVolume: previousVolume,
        latestMinuteOfDay: chartMetrics.latestMinuteOfDay,
        latestBarVolume: chartMetrics.latestBarVolume,
        averageRecentBarVolume: chartMetrics.averageRecentBarVolume,
      })

      if (!price || !Number.isFinite(changePct)) return null
      const marketStatus = secondary?.marketStatus ?? yahooSecondary?.marketStatus ?? computedStockMarketStatus(now)
      const quoteTimestamp = firstIso(
        snapshot?.latestTrade?.t ?? null,
        snapshot?.latestQuote?.t ?? null,
        minuteBar?.t ?? null,
        dailyBar?.t ?? null,
        secondary?.timestamp ?? null,
      )
      const validation = validateStockQuote({
        price,
        quoteTimestamp,
        marketStatus,
        secondary,
        fallbackSecondary: yahooSecondary,
        now,
      })
      const microBars = recordStockMicroBarSample({
        symbol: mover.symbol,
        price,
        cumulativeVolume: Math.round(volume),
        timestamp: dateFromIso(quoteTimestamp, now),
        source: `Alpaca ${credentials.feed.toUpperCase()}`,
      })

      const sharesOutstanding = secondary?.sharesOutstanding ?? yahooSecondary?.sharesOutstanding ?? null
      const estimatedFreeFloat = sharesOutstanding ? sharesOutstanding * 0.8 : null
      const floatTurnover = estimatedFreeFloat ? volume / estimatedFreeFloat : null
      const shortInterestPct = secondary ? secondary.shortInterestPct : null

      let catScore = 0
      let catTags: string[] = []
      let catQuality: 'none' | 'positive' | 'negative' | 'mixed' | 'unmatched' = 'none'

      if (news.matchedTicker) {
        const classification = classifyCatalyst(news.catalyst)
        catScore = classification.score
        catTags = classification.tags
        catQuality = classification.quality
      } else if (news.catalyst && news.catalyst !== 'Alpaca top mover' && news.catalyst !== 'News lookup failed') {
        catQuality = 'unmatched'
      }

      return {
        assetClass: 'stock',
        ticker: mover.symbol,
        displaySymbol: mover.symbol,
        company: secondary?.company || `${mover.symbol} common stock`,
        exchange: secondary?.exchange || '',
        exchangeDisplay: secondary?.exchange ? `${secondary.exchange} / Alpaca ${credentials.feed.toUpperCase()}` : `Alpaca ${credentials.feed.toUpperCase()}`,
        sector: 'Stock',
        price: round(price, price < 10 ? 3 : 2),
        changePct: round(changePct, 2),
        secondaryMovePct: null,
        secondaryMoveLabel: 'session',
        oneHourMovePct: chartMetrics.oneHourMovePct,
        fifteenMinuteMovePct: chartMetrics.fifteenMinuteMovePct,
        vwapExtensionPct: chartMetrics.vwapExtensionPct,
        rangePositionPct: chartMetrics.rangePositionPct,
        volume: Math.round(volume),
        quoteVolume: null,
        averageVolume: previousVolume ? Math.round(previousVolume) : null,
        relativeVolume: previousVolume && previousVolume > 0 ? round(volume / previousVolume, 2) : 0,
        volumePulse: chartMetrics.volumePulse,
        sessionVolume,
        microBars,
        recentQuoteVolume: null,
        trades: safeNumber(dailyBar?.n) ?? safeNumber(minuteBar?.n),
        marketCap: secondary?.marketCap ?? null,
        sharesOutstanding,
        catalyst: news.catalyst,
        catalystPublisher: news.catalystPublisher,
        catalystAgeMinutes: news.catalystAgeMinutes,
        newsUrl: news.newsUrl,
        highOfDay,
        vwap: safeNumber(dailyBar?.vw) ?? safeNumber(minuteBar?.vw) ?? (chartMetrics.vwap || price),
        spreadPct,
        spreadAvailable,
        marketDataCoverage: credentials.feed.toLowerCase() === 'sip' ? 'CONSOLIDATED' : 'SINGLE_EXCHANGE',
        tradingHalted: false,
        tradingHaltReason: null,
        quoteTimestamp,
        quoteAgeMinutes: validation.quoteAgeMinutes,
        marketStatus,
        marketStatusLabel: marketStatusLabel(marketStatus),
        dataQuality: validation.dataQuality,
        dataError: validation.dataError,
        primarySource: `Alpaca ${credentials.feed.toUpperCase()} snapshots`,
        secondarySource: validation.secondarySource,
        secondaryPrice: validation.secondaryPrice,
        priceDiffPct: validation.priceDiffPct,
        validationNotes: validation.validationNotes,
        sourceLabel: 'Alpaca',

        // New Stock enhancements
        catalystScore: catScore,
        catalystTags: catTags,
        catalystQuality: catQuality,
        premarketHigh: chartMetrics.premarketHigh,
        premarketVolume: chartMetrics.premarketVolume,
        premarketDollarVolume: chartMetrics.premarketDollarVolume,
        openingRangeHigh: chartMetrics.openingRangeHigh,
        openingRangeLow: chartMetrics.openingRangeLow,
        orbBreakoutConfirmed: false,
        estimatedFreeFloat,
        floatTurnover,
        shortInterestPct,
        latestBarVolume: chartMetrics.latestBarVolume,
        averageRecentBarVolume: chartMetrics.averageRecentBarVolume,
        microPullback: chartMetrics.microPullback,
      }
    }),
  )

  return candidates.filter((candidate): candidate is RawCandidate => candidate !== null)
}

async function buildYahooStockCandidates(now: Date): Promise<RawCandidate[]> {
  const screenerResults = await Promise.all(STOCK_SCREENERS.map((id) => fetchScreener(id)))
  const seen = new Set<string>()
  const quotes = screenerResults
    .flat()
    .filter((quote) => {
      const symbol = quote.symbol?.toUpperCase()
      if (!symbol || seen.has(symbol)) return false
      seen.add(symbol)
      return true
    })
    .slice(0, 45)

  const candidates = await Promise.all(quotes.map((quote) => buildStockCandidate(quote, now)))
  return candidates.filter((candidate): candidate is RawCandidate => Boolean(candidate))
}

async function buildStockCandidates(now: Date): Promise<RawCandidate[]> {
  const [alpaca, yahoo] = await Promise.all([
    buildAlpacaStockCandidates(now).catch(() => []),
    buildYahooStockCandidates(now).catch(() => []),
  ])
  const qualityRank: Record<DataQualityStatus, number> = {
    VERIFIED: 3,
    UNVERIFIED: 2,
    'DATA ERROR': 1,
  }
  const sourceRank = (candidate: RawCandidate) => (candidate.sourceLabel === 'Alpaca' ? 2 : 1)
  const byTicker = new Map<string, RawCandidate>()

  for (const candidate of [...alpaca, ...yahoo]) {
    const existing = byTicker.get(candidate.ticker)
    if (
      !existing ||
      qualityRank[candidate.dataQuality] > qualityRank[existing.dataQuality] ||
      (qualityRank[candidate.dataQuality] === qualityRank[existing.dataQuality] &&
        sourceRank(candidate) > sourceRank(existing))
    ) {
      byTicker.set(candidate.ticker, candidate)
    }
  }

  return [...byTicker.values()].slice(0, 70)
}

// A curated set of liquid, well-known European blue-chips (Yahoo symbols). They
// surface on the radar as a *discovery* feed during European hours, sourced from
// Yahoo Finance (free, no key, the same endpoint the US fallback already uses).
// They come through UNVERIFIED (there is no independent second price source for
// non-US names), so the paper bot never auto-enters them; Alpaca can only execute
// the US ADR (e.g. ASML, SAP) and only during US hours. This is for finding good
// European trends, not for the bot to trade on the European exchange directly.
const EUROPEAN_STOCKS: Array<{ symbol: string; name: string; exchange: string }> = [
  { symbol: 'ASML.AS', name: 'ASML Holding', exchange: 'Euronext Amsterdam' },
  { symbol: 'ADYEN.AS', name: 'Adyen', exchange: 'Euronext Amsterdam' },
  { symbol: 'PRX.AS', name: 'Prosus', exchange: 'Euronext Amsterdam' },
  { symbol: 'SAP.DE', name: 'SAP', exchange: 'Xetra' },
  { symbol: 'SIE.DE', name: 'Siemens', exchange: 'Xetra' },
  { symbol: 'MBG.DE', name: 'Mercedes-Benz', exchange: 'Xetra' },
  { symbol: 'MC.PA', name: 'LVMH', exchange: 'Euronext Paris' },
  { symbol: 'OR.PA', name: "L'Oreal", exchange: 'Euronext Paris' },
  { symbol: 'AIR.PA', name: 'Airbus', exchange: 'Euronext Paris' },
  { symbol: 'TTE.PA', name: 'TotalEnergies', exchange: 'Euronext Paris' },
  { symbol: 'NOVO-B.CO', name: 'Novo Nordisk', exchange: 'Nasdaq Copenhagen' },
  { symbol: 'NESN.SW', name: 'Nestle', exchange: 'SIX Swiss' },
  { symbol: 'NOVN.SW', name: 'Novartis', exchange: 'SIX Swiss' },
  { symbol: 'ROG.SW', name: 'Roche', exchange: 'SIX Swiss' },
  { symbol: 'SHEL.L', name: 'Shell', exchange: 'London' },
  { symbol: 'AZN.L', name: 'AstraZeneca', exchange: 'London' },
  { symbol: 'ULVR.L', name: 'Unilever', exchange: 'London' },
]

async function buildEuropeanStockCandidates(now: Date): Promise<RawCandidate[]> {
  // Only spend the API calls while European markets are actually in session
  // (weekends + off-hours skipped); off-hours the rows would just be closed noise.
  if (computedEuropeanMarketStatus(now) !== 'OPEN') return []
  const results = await Promise.allSettled(
    EUROPEAN_STOCKS.map((entry) =>
      buildStockCandidate(
        {
          symbol: entry.symbol,
          quoteType: 'EQUITY',
          marketState: 'REGULAR', // OPEN -> Yahoo "REGULAR" so the row reads as live during EU hours
          shortName: entry.name,
          fullExchangeName: entry.exchange,
        },
        now,
      ),
    ),
  )
  const out: RawCandidate[] = []
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue
    const candidate = result.value
    // Free European feeds are ~15 min delayed, which trips the US real-time
    // staleness check and wrongly flags an otherwise-clean (CNBC-cross-checked)
    // quote as DATA ERROR. These are discovery rows the bot never trades, so a
    // stale-ONLY error is downgraded to UNVERIFIED, the row stays visible and
    // can read as a live trend, while staying out of the bot's VERIFIED-only path.
    const staleOnly = candidate.dataError != null && /stale by .* during market hours/.test(candidate.dataError)
    const normalized = staleOnly
      ? {
          ...candidate,
          dataError: null,
          dataQuality: 'UNVERIFIED' as const,
          validationNotes: ['European feed ~15m delayed', ...candidate.validationNotes].slice(0, 4),
        }
      : candidate
    out.push({ ...normalized, sourceLabel: 'Yahoo (Europe)' })
  }
  return out
}

// European blue-chips that also trade as US-listed ADRs Alpaca can execute. The
// EU home line in EUROPEAN_STOCKS is discovery-only; these ADRs are scanned as
// normal US stocks (real US data, VERIFIED via the CNBC cross-check, US-hours
// gated) so the bot can ACTUALLY trade the name during US hours. OTC-only ADRs
// (Siemens/SIEGY, LVMH/LVMUY, Nestle/NSRGY, ...) are deliberately excluded since
// Alpaca execution on them is unreliable. The ADR trades on its OWN US-session
// momentum, not the EU line's signal (different session, FX, and ADR ratio).
const US_LISTED_ADRS: Array<{ adr: string; home: string; name: string; exchange: string }> = [
  { adr: 'ASML', home: 'ASML.AS', name: 'ASML Holding', exchange: 'NASDAQ' },
  { adr: 'SAP', home: 'SAP.DE', name: 'SAP SE', exchange: 'NYSE' },
  { adr: 'TTE', home: 'TTE.PA', name: 'TotalEnergies', exchange: 'NYSE' },
  { adr: 'NVO', home: 'NOVO-B.CO', name: 'Novo Nordisk', exchange: 'NYSE' },
  { adr: 'NVS', home: 'NOVN.SW', name: 'Novartis', exchange: 'NYSE' },
  { adr: 'SHEL', home: 'SHEL.L', name: 'Shell', exchange: 'NYSE' },
  { adr: 'AZN', home: 'AZN.L', name: 'AstraZeneca', exchange: 'NASDAQ' },
  { adr: 'UL', home: 'ULVR.L', name: 'Unilever', exchange: 'NYSE' },
]

async function buildAdrStockCandidates(now: Date): Promise<RawCandidate[]> {
  // Only worth the API calls during the US weekday session window, the bot can
  // only execute the ADR during US OPEN; pre/after-hours let the rows warm up.
  // Omitting marketState lets buildStockCandidate compute the REAL US session, so
  // these gate (and force to IGNORE when closed) exactly like any other US stock.
  const usStatus = computedStockMarketStatus(now)
  if (usStatus === 'WEEKEND' || usStatus === 'CLOSED') return []
  const results = await Promise.allSettled(
    US_LISTED_ADRS.map((entry) =>
      buildStockCandidate(
        {
          symbol: entry.adr,
          quoteType: 'EQUITY',
          shortName: `${entry.name} (US ADR)`,
          fullExchangeName: entry.exchange,
        },
        now,
      ),
    ),
  )
  const out: RawCandidate[] = []
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue
    const candidate = result.value
    const home = US_LISTED_ADRS.find((entry) => entry.adr === candidate.ticker)?.home
    out.push({
      ...candidate,
      validationNotes: [home ? `US ADR of ${home}` : 'US ADR', ...candidate.validationNotes].slice(0, 4),
    })
  }
  return out
}

// ---- mean-reversion signal + scoring --------------------------------------
// A reversion candidate is BELOW VWAP and far from the high, the inverse of a
// momentum setup, so it gets its own signal plan + scorer and is never routed
// through scoreCandidate. The plan is a controlled long back to the mean: enter
// on a small reclaim above the stretched price, stop below the intraday swing low
// (risk-capped), first target = VWAP, second target a touch beyond.
function buildReversionSignalPlan(raw: RawCandidate, status: MomentumStatus): SignalPlan {
  const ref = raw.price
  const noTrade = (thesis: string, invalidation: string): SignalPlan => ({
    action: 'AVOID',
    label: status === 'DATA ERROR' ? 'DATA ERROR' : 'NO TRADE',
    thesis,
    entryTrigger: null,
    entryZoneLow: null,
    entryZoneHigh: null,
    stopLoss: null,
    targetOne: null,
    targetTwo: null,
    invalidation,
    sellPlan: 'No active entry plan.',
    riskReward: null,
  })
  if (status === 'DATA ERROR' || raw.dataQuality === 'DATA ERROR') {
    return noTrade('No reversion signal until the price validates against a second source.', raw.dataError ?? 'Data quality gate failed.')
  }
  if (status === 'IGNORE') {
    return noTrade('Not stretched/oversold enough below VWAP for a controlled reclaim buy.', 'Wait for a real VWAP stretch with a turn back up.')
  }

  const vwap = raw.vwap
  const trigger = roundPrice(ref * 1.0015, ref) ?? ref
  const swingLow =
    raw.intradayLow !== null && raw.intradayLow !== undefined && raw.intradayLow > 0 && raw.intradayLow < ref
      ? raw.intradayLow
      : ref * 0.985
  // Structural stop just under the swing low, but never risk more than ~2%, the
  // tighter (higher) of the two so a deep low can't blow the risk budget.
  const stopLoss = roundPrice(Math.max(swingLow * 0.999, trigger * 0.98), ref)
  const risk = stopLoss !== null ? Math.max(trigger - stopLoss, 0) : 0
  // First target is the mean (VWAP); ensure it clears the trigger by at least 1R.
  const targetOne = roundPrice(Math.max(vwap, trigger + risk), ref)
  const targetTwo = roundPrice(Math.max((vwap > trigger ? vwap : trigger) * 1.004, trigger + risk * 1.8), ref)
  const riskReward = risk > 0 && targetTwo !== null ? round((targetTwo - trigger) / risk, 2) : null

  if (status === 'CHECK NOW') {
    return {
      action: 'BUY',
      label: 'RECLAIM BUY',
      thesis: `Model opinion: ${raw.displaySymbol} is stretched below VWAP and turning up, controlled paper-buy on a reclaim through ${formatSignalPrice(trigger)} toward VWAP ${formatSignalPrice(vwap)}.`,
      entryTrigger: trigger,
      entryZoneLow: roundPrice(ref * 0.999, ref),
      entryZoneHigh: roundPrice(trigger * 1.002, ref),
      stopLoss,
      targetOne,
      targetTwo,
      invalidation: `Exit below ${formatSignalPrice(stopLoss)} (lost the swing low); the thesis is reversion to VWAP, not a new downtrend.`,
      sellPlan: `Trim into VWAP ${formatSignalPrice(targetOne)}, final ${formatSignalPrice(targetTwo)}, hard stop ${formatSignalPrice(stopLoss)}.`,
      riskReward,
    }
  }

  return {
    action: 'WAIT',
    label: 'WAIT FOR RECLAIM',
    thesis: `Model opinion: ${raw.displaySymbol} is stretched below VWAP but not turning yet, buy only a confirmed reclaim through ${formatSignalPrice(trigger)}.`,
    entryTrigger: trigger,
    entryZoneLow: roundPrice(ref * 0.999, ref),
    entryZoneHigh: roundPrice(trigger * 1.002, ref),
    stopLoss,
    targetOne,
    targetTwo,
    invalidation: `Drop if it keeps falling through ${formatSignalPrice(stopLoss)} or reclaims VWAP without you.`,
    sellPlan: `If it reclaims, trim into VWAP ${formatSignalPrice(targetOne)} and hold hard stop ${formatSignalPrice(stopLoss)}.`,
    riskReward,
  }
}

function scoreReversionCandidate(raw: RawCandidate, now: Date): MomentumCandidate {
  const distance = distanceFromHigh(raw.price, raw.highOfDay)
  const aboveVwap = raw.price >= raw.vwap
  const reasons: string[] = []
  const blockers: string[] = []
  const sourceUrl =
    raw.sourceLabel === 'Alpaca'
      ? `https://app.alpaca.markets/stocks/${encodeURIComponent(raw.ticker)}`
      : `https://finance.yahoo.com/quote/${encodeURIComponent(raw.ticker)}`
  const finalize = (status: MomentumStatus, rawScore: number): MomentumCandidate => ({
    ...raw,
    strategy: 'reversion',
    distanceFromHighPct: distance,
    aboveVwap,
    score: Math.round(clamp(rawScore, 0, 100)),
    confidence: round(clamp(rawScore, 0, 100) / 100, 2),
    status,
    signal: buildReversionSignalPlan(raw, status),
    reasons: reasons.slice(0, 6),
    blockers,
    tradingViewUrl: stockTradingViewUrl(raw.ticker, raw.exchange, raw.exchangeDisplay),
    sourceUrl,
    updatedAt: now.toISOString(),
  })

  if (raw.dataQuality === 'DATA ERROR') {
    blockers.push(raw.dataError ?? 'data quality gate failed')
    return finalize('DATA ERROR', 0)
  }

  const vwap = raw.vwap
  const belowVwapPct = vwap > 0 && raw.price > 0 ? round(((vwap - raw.price) / vwap) * 100, 2) : 0
  const rsi = raw.intradayRsi ?? null
  const marketCap = raw.marketCap ?? 0
  const liquidEnough = marketCap >= REVERSION_MIN_MARKET_CAP || raw.volume >= 3_000_000
  const inBand = belowVwapPct >= REVERSION.minBelowVwapPct && belowVwapPct <= REVERSION.maxBelowVwapPct

  // Not a reversion setup at all -> IGNORE (kept off the tradable lists). Keep
  // the precise live invalidation reason so the bot UI never falls back to the
  // vague "missing plan" message after a shortlist row changes between scans.
  if (aboveVwap || !inBand || !liquidEnough) {
    if (aboveVwap) blockers.push('price is no longer below VWAP')
    if (!inBand) {
      blockers.push(
        belowVwapPct < REVERSION.minBelowVwapPct
          ? `VWAP stretch ${belowVwapPct.toFixed(2)}% is below the ${REVERSION.minBelowVwapPct}% setup minimum`
          : `VWAP stretch ${belowVwapPct.toFixed(2)}% exceeds the ${REVERSION.maxBelowVwapPct}% risk cap`,
      )
    }
    if (!liquidEnough) blockers.push('large-cap/liquidity floor not met')
    return finalize('IGNORE', 0)
  }

  // Knife guards: a clearly-bad catalyst or a name collapsing on the day is not a
  // controlled buy. Stay out entirely.
  if (raw.catalystQuality === 'negative') {
    blockers.push(`negative catalyst: ${raw.catalystTags.join(', ')}`)
    return finalize('IGNORE', 0)
  }
  if (raw.changePct <= REVERSION.maxAdverseDayChangePct) {
    blockers.push(`down ${raw.changePct.toFixed(1)}% on the day, too weak to fade`)
    return finalize('IGNORE', 0)
  }
  if (raw.dataQuality !== 'VERIFIED') blockers.push('stock price not verified')
  if (raw.marketStatus === 'CLOSED' || raw.marketStatus === 'WEEKEND') blockers.push('stock market closed')
  if (raw.quoteAgeMinutes === null) blockers.push('fresh stock quote unavailable')
  else if (raw.quoteAgeMinutes > 1) blockers.push(`stock quote stale by ${raw.quoteAgeMinutes}m`)
  if (raw.spreadPct > 0.4) blockers.push(`spread ${raw.spreadPct.toFixed(2)}% too wide for reclaim buy`)

  let score = 40
  reasons.push(`stretched ${belowVwapPct.toFixed(2)}% below VWAP`)
  score += Math.min(20, (belowVwapPct - REVERSION.minBelowVwapPct + 0.5) * 9)
  if (rsi !== null) {
    if (rsi <= 30) {
      score += 22
      reasons.push(`RSI ${rsi} deeply oversold`)
    } else if (rsi <= 36) {
      score += 14
      reasons.push(`RSI ${rsi} oversold`)
    } else if (rsi <= REVERSION.maxRsi) {
      score += 7
      reasons.push(`RSI ${rsi} soft`)
    }
  }
  if (marketCap >= 100_000_000_000) {
    score += 8
    reasons.push('mega-cap liquidity')
  } else if (marketCap >= 50_000_000_000) {
    score += 5
  } else if (marketCap >= REVERSION_MIN_MARKET_CAP) {
    score += 3
  }
  if (raw.spreadPct <= 0.1) {
    score += 6
    reasons.push('tight spread')
  } else if (raw.spreadPct <= 0.3) {
    score += 3
  }

  // A "reclaim" is the short-term tape turning back up; BUY only when it is
  // actually reclaiming AND oversold-confirmed, otherwise WATCH.
  const reclaiming = (raw.fifteenMinuteMovePct ?? -1) >= REVERSION.reclaimMinFifteenMinMovePct
  const oversoldEnough = rsi !== null && rsi <= REVERSION.maxRsi
  if (reclaiming) {
    score += 12
    reasons.push('15m tape turning up')
  } else {
    reasons.push('waiting for a turn back up')
  }

  if (blockers.length > 0) return finalize('IGNORE', score)

  const status: MomentumStatus = reclaiming && oversoldEnough ? 'CHECK NOW' : 'WATCH'
  return finalize(status, score)
}

// Curated large caps (always) + dynamically-discovered large-cap decliners,
// scored as VWAP-reclaim setups. Mirrors the ADR/European builders: each name is
// scanned by symbol via buildStockCandidate (real US data, CNBC cross-check), so
// reversion rows are VERIFIED and US-hours gated exactly like any other US stock.
async function buildReversionCandidates(now: Date): Promise<MomentumCandidate[]> {
  // Intraday VWAP exists across the tradable US window (pre-market through
  // after-hours, includePrePost bars), so run reversion whenever stocks are
  // tradable. Skip the API spend only when fully closed (overnight/weekend).
  const session = computedStockMarketStatus(now)
  if (session !== 'OPEN' && session !== 'PRE_MARKET' && session !== 'AFTER_HOURS') return []

  const curated: ScreenerQuote[] = MEGACAP_REVERSION_SYMBOLS.map((symbol) => ({ symbol, quoteType: 'EQUITY' }))
  const losers = await fetchScreener('day_losers').catch(() => [])
  const discovered = losers
    .filter(
      (quote) =>
        quote.quoteType === 'EQUITY' &&
        typeof quote.symbol === 'string' &&
        STANDARD_STOCK_SYMBOL.test(quote.symbol) &&
        (safeNumber(quote.marketCap) ?? 0) >= REVERSION_MIN_MARKET_CAP,
    )
    .slice(0, REVERSION_DISCOVERY_LIMIT)

  const seen = new Set<string>()
  const quotes: ScreenerQuote[] = []
  for (const quote of [...curated, ...discovered]) {
    const symbol = quote.symbol?.trim().toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    quotes.push(quote)
  }

  const results = await Promise.allSettled(quotes.map((quote) => buildStockCandidate(quote, now)))
  const out: MomentumCandidate[] = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) out.push(scoreReversionCandidate(result.value, now))
  }
  return out
}

function isAfterOpeningRangeNewYork(now: Date): boolean {
  try {
    const estStr = now.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const [hour, minute] = estStr.split(':').map(Number)
    return hour * 60 + minute >= 585 // 09:45 New York is 585 minutes
  } catch {
    return false
  }
}

function checkNowConfirmationBlockers(raw: RawCandidate, distance: number, aboveVwap: boolean, now: Date) {
  const blockers: string[] = []
  if (!aboveVwap) blockers.push('not holding VWAP')

  if (raw.assetClass === 'stock') {
    const timeAdjustedRvol = raw.sessionVolume?.timeAdjustedRelativeVolume ?? null
    if (raw.dataQuality !== 'VERIFIED') blockers.push('stock price not verified')
    if (raw.spreadAvailable === false) blockers.push('live bid/ask unavailable')
    if (raw.tradingHalted) blockers.push(raw.tradingHaltReason ? `trading halted: ${raw.tradingHaltReason}` : 'trading halted')
    if (raw.marketStatus === 'CLOSED' || raw.marketStatus === 'WEEKEND') blockers.push('stock market closed')
    if (raw.volume < 1_000_000) blockers.push('confirmation volume below 1M')
    if (raw.relativeVolume < 2 && (timeAdjustedRvol === null || timeAdjustedRvol < 2)) {
      blockers.push('confirmation relVol below 2x/time-adjusted pace')
    }
    if (
      timeAdjustedRvol !== null &&
      timeAdjustedRvol < 1.1 &&
      raw.relativeVolume < 3
    ) {
      blockers.push('time-adjusted relVol below 1.1x')
    }
    if (raw.microBars && raw.microBars.bars >= 6 && (raw.microBars.oneMinuteMovePct ?? 0) < -0.7) {
      blockers.push('10s tape fading')
    }
    if ((raw.oneHourMovePct ?? 0) < 0 && (raw.fifteenMinuteMovePct ?? 0) < 0) blockers.push('stock short-term tape fading')
    if (distance > 6) blockers.push('not close enough to high')
    if (raw.spreadPct > 1.5) blockers.push('confirmation spread too wide')
    if (raw.microPullback?.state === 'FAILED') blockers.push('micro pullback failed')
    if (raw.microPullback?.state === 'FORMING') blockers.push('micro pullback still forming')
    if (raw.microPullback?.state === 'EXTENDED') blockers.push('extended - wait for micro pullback')
    if (
      raw.microPullback?.state === 'READY' &&
      raw.microPullback.trigger !== null &&
      raw.price < raw.microPullback.trigger
    ) {
      blockers.push('micro pullback trigger not active')
    }
    if (
      raw.microPullback?.trigger !== null &&
      raw.microPullback?.trigger !== undefined &&
      raw.microPullback.stop !== null &&
      raw.microPullback.nearestResistance !== null
    ) {
      const risk = raw.microPullback.trigger - raw.microPullback.stop
      const room = raw.microPullback.nearestResistance - raw.microPullback.trigger
      if (risk > 0 && room > 0 && room < risk * 1.1) blockers.push('resistance too close for 1R')
    }

    if (raw.marketStatus === 'OPEN') {
      if (raw.premarketHigh !== null && raw.price < raw.premarketHigh) {
        blockers.push('below premarket high')
      }
      if (raw.premarketVolume !== null && raw.premarketVolume < 100000) {
        blockers.push('premarket volume below 100k')
      }
      if (isAfterOpeningRangeNewYork(now)) {
        if (raw.openingRangeHigh !== null && raw.price <= raw.openingRangeHigh) {
          blockers.push('below 15m opening range high')
        }
      }
    }
  } else {
    if (raw.spreadAvailable === false) blockers.push('live bid/ask unavailable')
    if ((raw.secondaryMovePct ?? 0) < 3) blockers.push('4h momentum not strong enough')
    if ((raw.quoteVolume ?? 0) < MOMENTUM_RULES.crypto.minConfirmationQuoteVolume) {
      blockers.push(`confirmation quote volume below $${Math.round(MOMENTUM_RULES.crypto.minConfirmationQuoteVolume / 1_000_000)}M`)
    }
    if (raw.volumePulse === null) blockers.push('confirmation 5m volume pulse unavailable')
    else if (raw.volumePulse < 1.2) blockers.push('confirmation 5m volume pulse below 1.2x')
    if ((raw.oneHourMovePct ?? 0) < 0.5 && (raw.fifteenMinuteMovePct ?? 0) <= 0) {
      blockers.push('fresh short-term trend not confirmed')
    }
    if ((raw.vwapExtensionPct ?? 0) > MOMENTUM_RULES.crypto.maxVwapExtensionPct && (raw.volumePulse ?? 0) < 2) {
      blockers.push('extended above 4h VWAP without strong pulse')
    }
    if (distance > 3.5) blockers.push('not close enough to 24h high')
    if (raw.spreadPct > 0.2) blockers.push('confirmation spread too wide')
  }

  return blockers
}

function candidateToRaw(candidate: MomentumCandidate): RawCandidate {
  const raw = { ...candidate } as Partial<MomentumCandidate>
  delete raw.distanceFromHighPct
  delete raw.aboveVwap
  delete raw.score
  delete raw.confidence
  delete raw.status
  delete raw.signal
  delete raw.reasons
  delete raw.blockers
  delete raw.tradingViewUrl
  delete raw.sourceUrl
  delete raw.updatedAt
  return raw as RawCandidate
}

function sortMomentumCandidates(candidates: MomentumCandidate[]) {
  return [...candidates].sort((a, b) => {
    const statusWeight: Record<MomentumStatus, number> = { 'CHECK NOW': 4, WATCH: 3, IGNORE: 2, 'DATA ERROR': 1 }
    return (
      statusWeight[b.status] - statusWeight[a.status] ||
      b.score - a.score ||
      b.changePct - a.changePct ||
      (b.quoteVolume ?? b.volume) - (a.quoteVolume ?? a.volume)
    )
  })
}

function scoreCandidate(raw: RawCandidate, now: Date): MomentumCandidate {
  const distance = distanceFromHigh(raw.price, raw.highOfDay)
  const aboveVwap = raw.price >= raw.vwap
  const reasons: string[] = []
  const blockers: string[] = []
  if (raw.dataQuality === 'DATA ERROR') {
    return {
      ...raw,
      distanceFromHighPct: distance,
      aboveVwap,
      score: 0,
      confidence: 0,
      status: 'DATA ERROR',
      signal: buildSignalPlan(raw, 'DATA ERROR'),
      reasons: raw.validationNotes.slice(0, 4),
      blockers: raw.dataError ? [raw.dataError] : ['data quality gate failed'],
      tradingViewUrl:
        raw.assetClass === 'crypto'
          ? cryptoTradingViewUrl(raw.ticker)
          : stockTradingViewUrl(raw.ticker, raw.exchange, raw.exchangeDisplay),
      sourceUrl:
        raw.assetClass === 'crypto'
          ? `https://www.binance.com/en/trade/${raw.ticker.replace('USDT', '_USDT')}`
          : raw.sourceLabel === 'Alpaca'
            ? `https://app.alpaca.markets/stocks/${encodeURIComponent(raw.ticker)}`
            : `https://finance.yahoo.com/quote/${encodeURIComponent(raw.ticker)}`,
      sourceLabel: raw.sourceLabel,
      updatedAt: now.toISOString(),
    }
  }

  let score = 0
  const add = (points: number, label: string) => {
    score += points
    reasons.push(reason(label, points))
  }
  const subtract = (points: number, label: string) => {
    score -= points
    reasons.push(`${label} -${points}`)
  }
  const oneHourMove = raw.oneHourMovePct ?? 0
  const fifteenMinuteMove = raw.fifteenMinuteMovePct ?? 0
  const volumePulse = raw.volumePulse ?? 0
  const vwapExtensionPct =
    raw.vwapExtensionPct ?? (raw.vwap > 0 && raw.price > 0 ? round(((raw.price - raw.vwap) / raw.vwap) * 100, 2) : null)
  const rangePositionPct = raw.rangePositionPct
  let orbBreakoutConfirmed = false

  if (raw.assetClass === 'stock') {
    if (raw.changePct >= 20) add(18, '20%+ session move')
    else if (raw.changePct >= 12) add(14, '12%+ session move')
    else if (raw.changePct >= 8) add(10, '8%+ session move')
    if (raw.volume >= 10_000_000) add(16, '10M+ volume')
    else if (raw.volume >= 3_000_000) add(13, '3M+ volume')
    else if (raw.volume >= 1_000_000) add(10, '1M+ volume')
    if (raw.relativeVolume >= 5) add(17, '5x+ relative volume')
    else if (raw.relativeVolume >= 3) add(14, '3x+ relative volume')
    else if (raw.relativeVolume >= 1.8) add(9, '1.8x+ relative volume')
    const timeAdjustedRvol = raw.sessionVolume?.timeAdjustedRelativeVolume ?? null
    if (timeAdjustedRvol !== null) {
      if (timeAdjustedRvol >= 4) add(14, '4x+ time-adjusted volume')
      else if (timeAdjustedRvol >= 2.5) add(10, '2.5x+ time-adjusted volume')
      else if (timeAdjustedRvol >= 1.5) add(6, '1.5x+ time-adjusted volume')
      else if (timeAdjustedRvol < 0.8 && raw.relativeVolume < 3) {
        subtract(5, 'weak volume for time of day')
      }
    }
    if (oneHourMove >= 5) add(9, '5%+ 1h acceleration')
    else if (oneHourMove >= 2) add(6, '2%+ 1h acceleration')
    else if (oneHourMove >= 0.8) add(3, 'positive 1h tape')
    if (fifteenMinuteMove >= 2) add(5, '15m push')
    else if (fifteenMinuteMove >= 0.75) add(3, '15m firming')
    if (raw.volumePulse !== null) {
      if (volumePulse >= 2.5) add(8, '2.5x recent volume pulse')
      else if (volumePulse >= 1.5) add(5, '1.5x recent volume pulse')
      else if (volumePulse >= 1.1) add(2, 'recent volume building')
    }
    if (raw.microBars) {
      const microPulse = raw.microBars.microVolumePulse ?? 0
      const oneMinuteMicroMove = raw.microBars.oneMinuteMovePct ?? 0
      if (raw.microBars.bars >= 6) {
        if (microPulse >= 3) add(6, '3x 10s tape pulse')
        else if (microPulse >= 1.5) add(3, '10s tape volume building')
        if (oneMinuteMicroMove >= 1) add(4, '1m micro tape rising')
        else if (oneMinuteMicroMove <= -1) subtract(4, '1m micro tape fading')
      }
    }

    // Catalyst news quality scoring
    if (raw.catalystQuality === 'positive') {
      add(raw.catalystScore, `catalyst: ${raw.catalystTags.join(', ')}`)
    } else if (raw.catalystQuality === 'negative') {
      subtract(Math.abs(raw.catalystScore), `negative catalyst: ${raw.catalystTags.join(', ')}`)
      blockers.push(`negative catalyst: ${raw.catalystTags.join(', ')}`)
    }

    if (raw.marketCap !== null && raw.marketCap <= 2_000_000_000) add(7, 'small cap')
    if (aboveVwap) add(10, 'above VWAP')
    if (distance <= 4) add(13, 'within 4% of high')
    else if (distance <= 10) add(9, 'within 10% of high')
    if (aboveVwap && distance > 4 && distance <= 10 && oneHourMove >= 0.5 && fifteenMinuteMove >= -0.2) {
      add(6, 'VWAP pullback reclaim')
    }
    if (rangePositionPct !== null) {
      if (rangePositionPct >= 80) add(4, 'top of intraday range')
      else if (rangePositionPct >= 60) add(2, 'upper intraday range')
    }
    if (raw.spreadAvailable !== false && raw.spreadPct <= 1) add(5, 'tight spread')
    else if (raw.spreadAvailable !== false && raw.spreadPct <= 2.5) add(3, 'manageable spread')

    // Premarket breakout scoring (points only, no hard blocker in watchlist)
    if (raw.marketStatus === 'OPEN' && raw.premarketHigh !== null && raw.premarketVolume !== null) {
      if (raw.price >= raw.premarketHigh && raw.premarketVolume >= 100000) {
        add(8, 'cleared premarket high')
      }
    }

    // ORB breakout scoring
    if (raw.marketStatus === 'OPEN' && raw.openingRangeHigh !== null) {
      if (raw.latestBarVolume !== null && raw.averageRecentBarVolume !== null) {
        if (raw.price > raw.openingRangeHigh && raw.latestBarVolume > 1.5 * raw.averageRecentBarVolume) {
          orbBreakoutConfirmed = true
          add(8, '15m ORB breakout with volume')
        }
      }
    }

    if (raw.microPullback) {
      const micro = raw.microPullback
      if (micro.state === 'READY') {
        add(12, 'micro pullback ready')
      } else if (micro.state === 'FORMING') {
        add(7, 'micro pullback forming')
      } else if (micro.state === 'FAILED') {
        subtract(10, 'micro pullback failed')
        blockers.push('micro pullback failed')
      } else if (micro.state === 'EXTENDED') {
        subtract(6, 'extended - needs micro pullback')
        blockers.push('extended - wait for micro pullback')
      }
      if (micro.score > 0) add(Math.min(8, Math.round(micro.score / 3)), 'pullback structure quality')
      if (micro.pullbackDepthPct !== null && micro.pullbackDepthPct > 50) {
        blockers.push('pullback retraced more than 50%')
      }
      if (micro.supportDistancePct !== null && micro.supportDistancePct <= 1.2 && micro.state !== 'FAILED') {
        add(4, 'near support')
      }
      if (micro.resistanceDistancePct !== null && micro.resistanceDistancePct <= 0.7 && micro.state !== 'READY') {
        subtract(3, 'near resistance')
      }
    }

    // Float turnover and short interest
    if (raw.estimatedFreeFloat !== null && raw.floatTurnover !== null) {
      if (raw.estimatedFreeFloat < 15000000 && raw.floatTurnover >= 0.5) {
        add(6, 'low float with high turnover')
      }
      if (raw.floatTurnover >= 1.0) {
        add(2, 'extremely high float turnover')
      }
    }
    if (raw.shortInterestPct !== null && raw.shortInterestPct > 15) {
      add(6, 'high short interest bonus')
    }

    if (vwapExtensionPct !== null && vwapExtensionPct > 18 && volumePulse < 1.5) {
      subtract(8, 'extended above VWAP without fresh volume')
      blockers.push('extended above VWAP without fresh volume')
    }
    if (oneHourMove <= -2 && fifteenMinuteMove < 0 && distance > 2) {
      blockers.push('short-term stock trend fading')
    }

    if (raw.dataQuality !== 'VERIFIED') blockers.push('stock price not independently verified')
    if (raw.spreadAvailable === false) blockers.push('live bid/ask unavailable')
    if (raw.tradingHalted) blockers.push(raw.tradingHaltReason ? `trading halted: ${raw.tradingHaltReason}` : 'trading halted')
    if (raw.changePct < MOMENTUM_RULES.stock.minMovePct) blockers.push(`move below ${MOMENTUM_RULES.stock.minMovePct}%`)
    if (raw.volume < MOMENTUM_RULES.stock.minVolume) blockers.push('volume below 1M')
    if (raw.relativeVolume < MOMENTUM_RULES.stock.minRelativeVolume) blockers.push('relative volume below 1.8x')
    if (!aboveVwap) blockers.push('below VWAP')
    if (distance > MOMENTUM_RULES.stock.maxDistanceFromHighPct) blockers.push('too far from high')
    if (raw.spreadPct > MOMENTUM_RULES.stock.maxSpreadPct) blockers.push('spread too wide')
  } else {
    const fourHourMove = raw.secondaryMovePct ?? 0
    const healthyCryptoPullback =
      aboveVwap &&
      distance > MOMENTUM_RULES.crypto.maxDistanceFromHighPct &&
      distance <= MOMENTUM_RULES.crypto.maxPullbackDistanceFromHighPct &&
      fourHourMove >= MOMENTUM_RULES.crypto.minFourHourMovePct &&
      oneHourMove >= 0 &&
      fifteenMinuteMove >= -0.2 &&
      raw.volumePulse !== null &&
      volumePulse >= MOMENTUM_RULES.crypto.minVolumePulse
    if (raw.changePct >= 15) add(18, '15%+ 24h move')
    else if (raw.changePct >= 10) add(15, '10%+ 24h move')
    else if (raw.changePct >= 5) add(11, '5%+ 24h move')
    else if (raw.changePct >= 3) add(7, '3%+ 24h move')
    if (fourHourMove >= 5) add(16, '5%+ 4h move')
    else if (fourHourMove >= 2.5) add(12, '2.5%+ 4h move')
    else if (fourHourMove >= 1.2) add(8, '1.2%+ 4h move')
    if (oneHourMove >= 3) add(8, '3%+ 1h acceleration')
    else if (oneHourMove >= 1.5) add(5, '1.5%+ 1h acceleration')
    else if (oneHourMove >= 0.5) add(2, 'positive 1h tape')
    if (fifteenMinuteMove >= 1.2) add(5, '15m burst')
    else if (fifteenMinuteMove >= 0.4) add(2, '15m firming')
    if ((raw.quoteVolume ?? 0) >= 200_000_000) add(18, '$200M+ quote volume')
    else if ((raw.quoteVolume ?? 0) >= 50_000_000) add(14, '$50M+ quote volume')
    else if ((raw.quoteVolume ?? 0) >= 20_000_000) add(10, '$20M+ quote volume')
    if ((raw.trades ?? 0) >= 250_000) add(10, '250k+ trades')
    else if ((raw.trades ?? 0) >= 75_000) add(7, '75k+ trades')
    if ((raw.volumePulse ?? 0) >= 3) add(10, '3x+ 5m volume pulse')
    else if ((raw.volumePulse ?? 0) >= 2) add(7, '2x+ 5m volume pulse')
    else if ((raw.volumePulse ?? 0) >= 1.25) add(4, '5m volume pulse')
    if (aboveVwap) add(10, 'above 4h VWAP')
    if (distance <= 3) add(13, 'within 3% of 24h high')
    else if (distance <= 7) add(9, 'within 7% of 24h high')
    else if (healthyCryptoPullback) add(7, 'VWAP pullback reclaim')
    if (rangePositionPct !== null) {
      if (rangePositionPct >= 82) add(4, 'top of 4h range')
      else if (rangePositionPct >= 62) add(2, 'upper 4h range')
    }
    if (raw.spreadAvailable !== false && raw.spreadPct <= 0.1) add(7, 'very tight spread')
    else if (raw.spreadAvailable !== false && raw.spreadPct <= 0.35) add(4, 'tight spread')
    if (vwapExtensionPct !== null && vwapExtensionPct > MOMENTUM_RULES.crypto.maxVwapExtensionPct && volumePulse < 1.5) {
      subtract(8, 'extended above 4h VWAP without fresh pulse')
      blockers.push('extended above 4h VWAP without fresh pulse')
    } else if (vwapExtensionPct !== null && vwapExtensionPct > MOMENTUM_RULES.crypto.maxVwapExtensionPct * 1.6) {
      subtract(5, 'very extended from 4h VWAP')
    }
    if (oneHourMove <= -1.2 && fifteenMinuteMove < 0 && distance > 2) {
      blockers.push('short-term crypto trend fading')
    }

    if (raw.changePct < MOMENTUM_RULES.crypto.minMovePct) blockers.push(`24h move below ${MOMENTUM_RULES.crypto.minMovePct}%`)
    if ((raw.secondaryMovePct ?? 0) < MOMENTUM_RULES.crypto.minFourHourMovePct) {
      blockers.push(`4h move below ${MOMENTUM_RULES.crypto.minFourHourMovePct}%`)
    }
    if ((raw.quoteVolume ?? 0) < MOMENTUM_RULES.crypto.minQuoteVolume) blockers.push('quote volume below $20M')
    if (raw.spreadAvailable === false) blockers.push('live bid/ask unavailable')
    if (raw.volumePulse === null) {
      blockers.push('5m volume pulse unavailable')
    } else if (raw.volumePulse < MOMENTUM_RULES.crypto.minVolumePulse) {
      blockers.push('5m volume pulse below 1.15x')
    }
    if (!aboveVwap) blockers.push('below 4h VWAP')
    if (distance > MOMENTUM_RULES.crypto.maxDistanceFromHighPct && !healthyCryptoPullback) {
      blockers.push('too far from 24h high')
    }
    if (raw.spreadPct > MOMENTUM_RULES.crypto.maxSpreadPct) blockers.push('spread too wide')
  }

  const confidenceScore = clamp(score, 0, 100)
  const confirmationBlockers = checkNowConfirmationBlockers(raw, distance, aboveVwap, now)
  let status: MomentumStatus = 'IGNORE'
  if (confidenceScore >= MOMENTUM_RULES.checkNowScore && blockers.length === 0 && confirmationBlockers.length === 0) {
    status = 'CHECK NOW'
  } else if (confidenceScore >= MOMENTUM_RULES.watchScore && blockers.length === 0 && confirmationBlockers.length <= 3) {
    status = 'WATCH'
  }

  // Stocks have no live tape when the US market is closed for the weekend or
  // overnight. Their last-session move/volume keeps scoring, which previously
  // leaked stale names (e.g. a Friday gainer) into WATCH on Saturday/Sunday.
  // Force those to IGNORE so the radar hides them; crypto (CRYPTO_24_7) is
  // unaffected, and pre-market / after-hours stocks still show.
  if (raw.assetClass === 'stock' && (raw.marketStatus === 'WEEKEND' || raw.marketStatus === 'CLOSED')) {
    status = 'IGNORE'
    if (!blockers.includes('stock market closed, no live tape')) {
      blockers.push('stock market closed, no live tape')
    }
  }

  const signal = buildSignalPlan(raw, status)

  return {
    ...raw,
    distanceFromHighPct: distance,
    aboveVwap,
    score: confidenceScore,
    confidence: confidenceScore / 100,
    status,
    signal,
    reasons: reasons.slice(0, 7),
    blockers: status === 'CHECK NOW' ? [] : [...blockers, ...confirmationBlockers].slice(0, 5),
    tradingViewUrl:
      raw.assetClass === 'crypto'
        ? cryptoTradingViewUrl(raw.ticker)
        : stockTradingViewUrl(raw.ticker, raw.exchange, raw.exchangeDisplay),
    sourceUrl:
      raw.assetClass === 'crypto'
        ? `https://www.binance.com/en/trade/${raw.ticker.replace('USDT', '_USDT')}`
        : raw.sourceLabel === 'Alpaca'
          ? `https://app.alpaca.markets/stocks/${encodeURIComponent(raw.ticker)}`
        : `https://finance.yahoo.com/quote/${encodeURIComponent(raw.ticker)}`,
    sourceLabel: raw.sourceLabel,
    updatedAt: now.toISOString(),
    orbBreakoutConfirmed: raw.assetClass === 'stock' ? orbBreakoutConfirmed : false,
  }
}

async function refreshCryptoCandidate(candidate: MomentumCandidate, now: Date): Promise<MomentumCandidate> {
  const ticker = await fetchJson<BinanceTicker>(
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(candidate.ticker)}`,
    8_000,
  )
  const klineStats = cryptoKlineStats(await fetchCryptoKlines(candidate.ticker).catch(() => []))
  const raw = candidateToRaw(candidate)
  const price = safeNumber(ticker.lastPrice) ?? raw.price
  const bid = safeNumber(ticker.bidPrice)
  const ask = safeNumber(ticker.askPrice)
  const spreadAvailable = bid !== null && ask !== null && bid > 0 && ask > bid && price > 0
  const quoteTimestamp = isoFromMilliseconds(ticker.closeTime)

  return scoreCandidate(
    {
      ...raw,
      price: round(price, price < 1 ? 6 : price < 10 ? 4 : 2),
      changePct: round(safeNumber(ticker.priceChangePercent) ?? raw.changePct, 2),
      secondaryMovePct: klineStats.fourHourMovePct || raw.secondaryMovePct,
      oneHourMovePct: klineStats.oneHourMovePct ?? raw.oneHourMovePct,
      fifteenMinuteMovePct: klineStats.fifteenMinuteMovePct ?? raw.fifteenMinuteMovePct,
      vwapExtensionPct: klineStats.vwapExtensionPct ?? raw.vwapExtensionPct,
      rangePositionPct: klineStats.rangePositionPct ?? raw.rangePositionPct,
      volume: Math.round(safeNumber(ticker.volume) ?? raw.volume),
      quoteVolume: Math.round(safeNumber(ticker.quoteVolume) ?? raw.quoteVolume ?? 0),
      volumePulse: klineStats.volumePulse ?? raw.volumePulse,
      recentQuoteVolume: klineStats.recentQuoteVolume ?? raw.recentQuoteVolume,
      trades: ticker.count ?? raw.trades,
      highOfDay: safeNumber(ticker.highPrice) ?? Math.max(raw.highOfDay, price),
      vwap: klineStats.vwap || safeNumber(ticker.weightedAvgPrice) || raw.vwap || price,
      spreadPct: spreadAvailable ? round(((ask - bid) / price) * 100, 3) : raw.spreadPct,
      spreadAvailable,
      quoteTimestamp,
      quoteAgeMinutes: minutesSince(quoteTimestamp, now),
      marketStatus: 'CRYPTO_24_7',
      marketStatusLabel: marketStatusLabel('CRYPTO_24_7'),
      dataQuality: 'VERIFIED',
      dataError: null,
      primarySource: 'Binance spot 24h ticker',
      validationNotes: [
        quoteTimestamp ? 'Binance live shortlist refresh' : 'Binance ticker timestamp unavailable',
        klineStats.volumePulse !== null ? `5m volume pulse ${klineStats.volumePulse.toFixed(2)}x` : '5m volume pulse unavailable',
      ],
      sourceLabel: 'Binance',
    },
    now,
  )
}

function previousCloseFromCandidate(raw: RawCandidate) {
  if (!Number.isFinite(raw.price) || raw.price <= 0 || !Number.isFinite(raw.changePct)) return null
  const denominator = 1 + raw.changePct / 100
  return denominator > 0 ? raw.price / denominator : null
}

function liveAlpacaValidation(raw: RawCandidate, quoteTimestamp: string | null, now: Date): StockValidation {
  const quoteAgeMinutes = minutesSince(quoteTimestamp, now)
  let dataError: string | null = null
  if (isLiveStockSession(raw.marketStatus) && quoteAgeMinutes === null) {
    dataError = 'missing Alpaca live quote timestamp during market hours'
  } else if (isLiveStockSession(raw.marketStatus) && quoteAgeMinutes !== null && quoteAgeMinutes > STOCK_FRESH_QUOTE_MINUTES) {
    dataError = `Alpaca live quote stale by ${quoteAgeMinutes}m during market hours`
  }

  const notes = [
    'Alpaca live stream/snapshot refresh',
    raw.secondarySource && raw.secondaryPrice !== null
      ? `prior ${raw.secondarySource} check ${roundPrice(raw.secondaryPrice, raw.price)}`
      : 'prior independent check unavailable',
  ]
  if (quoteAgeMinutes !== null) notes.push(`quote age ${quoteAgeMinutes}m`)

  return {
    dataQuality: dataError ? 'DATA ERROR' : raw.dataQuality === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
    dataError,
    secondarySource: raw.secondarySource,
    secondaryPrice: raw.secondaryPrice,
    priceDiffPct: raw.priceDiffPct,
    quoteAgeMinutes,
    validationNotes: notes.slice(0, 4),
  }
}

function liveMicroPullback(raw: RawCandidate, price: number): MicroPullbackAnalysis | undefined {
  const micro = raw.microPullback
  if (!micro) return undefined
  if (micro.stop !== null && price <= micro.stop) {
    return {
      ...micro,
      state: 'FAILED',
      label: 'Micro pullback failed',
      score: Math.min(micro.score, -4),
      notes: ['live price lost pullback stop', ...micro.notes].slice(0, 5),
    }
  }
  if (micro.state === 'FORMING' && micro.trigger !== null && price >= micro.trigger) {
    return {
      ...micro,
      state: 'READY',
      label: 'Micro pullback ready',
      score: Math.max(micro.score + 8, 12),
      notes: ['live price broke pullback trigger', ...micro.notes].slice(0, 5),
    }
  }
  return micro
}

function snapshotBarTime(...bars: Array<AlpacaBar | null | undefined>) {
  return firstIso(...bars.map((bar) => bar?.t ?? null))
}

async function refreshAlpacaStockCandidate(
  candidate: MomentumCandidate,
  now: Date,
  snapshot: AlpacaSnapshot | null,
): Promise<MomentumCandidate> {
  const raw = candidateToRaw(candidate)
  const stream = freshAlpacaRealtimeSample(candidate.ticker, now)
  const latestBar = stream?.latestBar ?? snapshot?.minuteBar ?? null
  const latestQuote = snapshot?.latestQuote
  const latestTrade = snapshot?.latestTrade
  const dailyBar = snapshot?.dailyBar
  const previousBar = snapshot?.prevDailyBar
  const streamPrice = safeNumber(stream?.price)
  const tradePrice = safeNumber(latestTrade?.p)
  const barPrice = safeNumber(latestBar?.c)
  const dailyPrice = safeNumber(dailyBar?.c)
  const price = streamPrice ?? tradePrice ?? barPrice ?? dailyPrice ?? raw.price
  const bid = safeNumber(stream?.bid) ?? safeNumber(latestQuote?.bp)
  const ask = safeNumber(stream?.ask) ?? safeNumber(latestQuote?.ap)
  const spreadAvailable = bid !== null && ask !== null && bid > 0 && ask > bid && price > 0
  const previousClose = safeNumber(previousBar?.c) ?? previousCloseFromCandidate(raw)
  const volume = Math.max(safeNumber(dailyBar?.v) ?? 0, raw.volume)
  const averageVolume = raw.averageVolume
  const quoteTimestamp = firstIso(
    stream?.timestamp ?? null,
    latestTrade?.t ?? null,
    latestQuote?.t ?? null,
    snapshotBarTime(latestBar, dailyBar),
    raw.quoteTimestamp,
  )
  const marketStatus = computedStockMarketStatus(now)
  const validation = liveAlpacaValidation({ ...raw, marketStatus }, quoteTimestamp, now)
  const microBars = recordStockMicroBarSample({
    symbol: candidate.ticker,
    price,
    cumulativeVolume: Math.round(volume),
    timestamp: dateFromIso(quoteTimestamp, now),
    source: stream ? stream.source : `Alpaca ${(alpacaCredentials()?.feed ?? 'iex').toUpperCase()} snapshot`,
  })
  const liveBarVolume = safeNumber(latestBar?.v)
  const latestBarVolume = liveBarVolume !== null && liveBarVolume > 0 ? Math.round(liveBarVolume) : raw.latestBarVolume
  const sessionVolume = buildStockSessionVolumeProfile({
    volume,
    averageVolume,
    latestMinuteOfDay: raw.sessionVolume?.minuteOfDay ?? null,
    latestBarVolume,
    averageRecentBarVolume: raw.averageRecentBarVolume,
  })

  const rescore = candidate.strategy === 'reversion' ? scoreReversionCandidate : scoreCandidate
  return rescore(
    {
      ...raw,
      price: round(price, price < 10 ? 3 : 2),
      changePct: round(previousClose && price ? ((price - previousClose) / previousClose) * 100 : raw.changePct, 2),
      volume: Math.round(volume),
      relativeVolume: averageVolume && averageVolume > 0 ? round(volume / averageVolume, 2) : raw.relativeVolume,
      sessionVolume: sessionVolume ?? raw.sessionVolume,
      microBars: microBars ?? raw.microBars,
      trades: safeNumber(dailyBar?.n) ?? safeNumber(latestBar?.n) ?? raw.trades,
      highOfDay: Math.max(safeNumber(dailyBar?.h) ?? 0, safeNumber(latestBar?.h) ?? 0, raw.highOfDay, price),
      vwap: (safeNumber(dailyBar?.vw) ?? safeNumber(latestBar?.vw) ?? raw.vwap) || price,
      spreadPct: spreadAvailable ? round(((ask - bid) / price) * 100, 3) : raw.spreadPct,
      spreadAvailable,
      quoteTimestamp,
      quoteAgeMinutes: validation.quoteAgeMinutes,
      marketStatus,
      marketStatusLabel: marketStatusLabel(marketStatus),
      dataQuality: validation.dataQuality,
      dataError: validation.dataError,
      primarySource: stream ? stream.source : `Alpaca ${(alpacaCredentials()?.feed ?? 'iex').toUpperCase()} live snapshots`,
      secondarySource: validation.secondarySource,
      secondaryPrice: validation.secondaryPrice,
      priceDiffPct: validation.priceDiffPct,
      validationNotes: validation.validationNotes,
      sourceLabel: 'Alpaca',
      tradingHalted: stream?.tradingHalted ?? raw.tradingHalted ?? false,
      tradingHaltReason: stream?.tradingHaltReason ?? raw.tradingHaltReason ?? null,
      latestBarVolume,
      microPullback: liveMicroPullback(raw, price),
    },
    now,
  )
}

async function refreshStockCandidate(candidate: MomentumCandidate, now: Date): Promise<MomentumCandidate> {
  const [chart, secondary] = await Promise.all([
    fetchStockChart(candidate.ticker).catch(() => null),
    fetchCnbcQuote(candidate.ticker, now).catch(() => null),
  ])
  const raw = candidateToRaw(candidate)
  const stats = chartStats(chart)
  const chartPrice = stats.lastClose ?? safeNumber(chart?.meta?.regularMarketPrice)
  const price = chartPrice ?? raw.price
  const previousClose =
    secondary?.previousClose ??
    safeNumber(chart?.meta?.previousClose) ??
    safeNumber(chart?.meta?.chartPreviousClose)
  const marketStatus = secondary?.marketStatus ?? computedStockMarketStatus(now)
  const quoteTimestamp = firstIso(
    stats.lastTimestamp,
    isoFromSeconds(chart?.meta?.regularMarketTime),
    raw.quoteTimestamp,
  )
  const validation = validateStockQuote({
    price,
    quoteTimestamp,
    marketStatus,
    secondary,
    now,
  })
  // The 5s live refresh prices off the Yahoo chart, so Yahoo can't double as its
  // own independent check here. If the only independent source (CNBC) is briefly
  // unavailable, keep the verification the full 60s scan already established
  // rather than flickering a good row out of the strict list mid-session.
  const resilientValidation: StockValidation =
    validation.dataQuality === 'UNVERIFIED' && candidate.dataQuality === 'VERIFIED' && !validation.dataError
      ? {
          ...validation,
          dataQuality: 'VERIFIED',
          secondarySource: candidate.secondarySource,
          secondaryPrice: candidate.secondaryPrice,
          validationNotes: ['carried prior cross-check (CNBC unavailable on refresh)', ...validation.validationNotes].slice(0, 4),
        }
      : validation
  const volume = Math.max(
    secondary?.volume ?? 0,
    safeNumber(chart?.meta?.regularMarketVolume) ?? 0,
    stats.chartVolume,
    raw.volume,
  )
  const averageVolume = raw.averageVolume
  const sessionVolume = buildStockSessionVolumeProfile({
    volume,
    averageVolume,
    latestMinuteOfDay: stats.latestMinuteOfDay,
    latestBarVolume: stats.latestBarVolume ?? raw.latestBarVolume,
    averageRecentBarVolume: stats.averageRecentBarVolume ?? raw.averageRecentBarVolume,
  })
  const microBars = recordStockMicroBarSample({
    symbol: candidate.ticker,
    price,
    cumulativeVolume: Math.round(volume),
    timestamp: dateFromIso(quoteTimestamp, now),
    source: raw.sourceLabel === 'Alpaca' ? 'Alpaca refresh' : 'Yahoo refresh',
  })

  // A reversion candidate must be re-scored by its own scorer on every live
  // refresh; scoreCandidate (momentum) would strip its strategy tag and reclaim
  // signal and the bot would then reject it as a below-VWAP momentum row.
  const rescore = candidate.strategy === 'reversion' ? scoreReversionCandidate : scoreCandidate
  return rescore(
    {
      ...raw,
      price: round(price, price < 10 ? 3 : 2),
      changePct: round(previousClose && price ? ((price - previousClose) / previousClose) * 100 : raw.changePct, 2),
      oneHourMovePct: stats.oneHourMovePct ?? raw.oneHourMovePct,
      fifteenMinuteMovePct: stats.fifteenMinuteMovePct ?? raw.fifteenMinuteMovePct,
      intradayRsi: stats.rsi14 ?? raw.intradayRsi,
      intradayLow: stats.intradayLow ?? raw.intradayLow,
      vwapExtensionPct: stats.vwapExtensionPct ?? raw.vwapExtensionPct,
      rangePositionPct: stats.rangePositionPct ?? raw.rangePositionPct,
      volume: Math.round(volume),
      relativeVolume: averageVolume && averageVolume > 0 ? round(volume / averageVolume, 2) : raw.relativeVolume,
      volumePulse: stats.volumePulse ?? raw.volumePulse,
      sessionVolume: sessionVolume ?? raw.sessionVolume,
      microBars: microBars ?? raw.microBars,
      marketCap: secondary?.marketCap ?? raw.marketCap,
      sharesOutstanding: secondary?.sharesOutstanding ?? raw.sharesOutstanding,
      highOfDay: Math.max(secondary?.high ?? 0, stats.highOfDay, raw.highOfDay, price),
      vwap: stats.vwap || raw.vwap || price,
      quoteTimestamp,
      quoteAgeMinutes: resilientValidation.quoteAgeMinutes,
      marketStatus,
      marketStatusLabel: marketStatusLabel(marketStatus),
      dataQuality: resilientValidation.dataQuality,
      dataError: resilientValidation.dataError,
      primarySource: 'Yahoo chart live refresh',
      secondarySource: resilientValidation.secondarySource,
      secondaryPrice: resilientValidation.secondaryPrice,
      priceDiffPct: resilientValidation.priceDiffPct,
      validationNotes: resilientValidation.validationNotes,
      sourceLabel: raw.sourceLabel,
      // Yahoo chart refreshes do not include an executable BBO. Do not carry a
      // minute-old screener spread forward as if it were live.
      spreadAvailable: false,

      // Keep premarket/ORB values updated on refresh
      premarketHigh: stats.premarketHigh ?? raw.premarketHigh,
      premarketVolume: stats.premarketVolume ?? raw.premarketVolume,
      premarketDollarVolume: stats.premarketDollarVolume ?? raw.premarketDollarVolume,
      openingRangeHigh: stats.openingRangeHigh ?? raw.openingRangeHigh,
      openingRangeLow: stats.openingRangeLow ?? raw.openingRangeLow,
      latestBarVolume: stats.latestBarVolume ?? raw.latestBarVolume,
      averageRecentBarVolume: stats.averageRecentBarVolume ?? raw.averageRecentBarVolume,
      microPullback: stats.microPullback ?? raw.microPullback,
    },
    now,
  )
}

export async function refreshMomentumCandidates(
  candidates: MomentumCandidate[],
  now = new Date(),
): Promise<MomentumCandidate[]> {
  const unique = [...new Map(candidates.map((candidate) => [candidate.ticker, candidate])).values()].slice(0, 12)
  const alpacaStockSymbols = unique
    .filter((candidate) => candidate.assetClass === 'stock' && candidate.sourceLabel === 'Alpaca')
    .map((candidate) => candidate.ticker)
  primeAlpacaRealtime(alpacaStockSymbols)
  const alpacaSnapshots: Record<string, AlpacaSnapshot> =
    alpacaStockSymbols.length > 0 ? await fetchAlpacaSnapshots(alpacaStockSymbols).catch(() => ({})) : {}
  const refreshed = await Promise.all(
    unique.map(async (candidate) => {
      try {
        const refreshed =
          candidate.assetClass === 'crypto'
            ? await refreshCryptoCandidate(candidate, now)
            : candidate.sourceLabel === 'Alpaca'
              ? await refreshAlpacaStockCandidate(candidate, now, alpacaSnapshots[candidate.ticker] ?? null)
              : await refreshStockCandidate(candidate, now)
        // Reversion has its own carry-forward: keep the original reclaim trigger
        // stable so a live refresh cannot move the goalpost or make a just-hit
        // reclaim vanish as "no longer below VWAP".
        return candidate.strategy === 'reversion'
          ? carryForwardReversionSignal(refreshed, candidate)
          : carryForwardLiveSignal(refreshed, candidate)
      } catch {
        return {
          ...candidate,
          quoteAgeMinutes: minutesSince(candidate.quoteTimestamp, now),
          updatedAt: now.toISOString(),
          validationNotes: ['Live shortlist refresh failed; keeping last clean quote', ...candidate.validationNotes].slice(0, 4),
        }
      }
    }),
  )
  return sortMomentumCandidates(refreshed)
}

// Bot-facing crypto scan: same engine as the radar, but constrained to a
// caller-supplied universe (the Alpaca-tradable pairs) and scored/sorted so the
// paper bot can arm and trigger on coins it can actually execute.
export async function buildScoredCryptoCandidates(
  options: CryptoScanOptions = {},
  now = new Date(),
): Promise<MomentumCandidate[]> {
  const raw = await buildCryptoCandidates(now, options)
  return sortMomentumCandidates(raw.map((candidate) => scoreCandidate(candidate, now)))
}

let cachedMarketContext: {
  indices: Record<IndexSymbol, IndexMarketTape>
  spyTrendPct: number | null
  qqqTrendPct: number | null
  iwmTrendPct: number | null
  fetchedAt: number | null
} = {
  indices: {
    SPY: emptyIndexTape(),
    QQQ: emptyIndexTape(),
    IWM: emptyIndexTape(),
  },
  spyTrendPct: null,
  qqqTrendPct: null,
  iwmTrendPct: null,
  fetchedAt: null,
}

function emptyIndexTape(): IndexMarketTape {
  return {
    dailyTrendPct: null,
    sessionMovePct: null,
    recentTrendPct: null,
    drawdownFromHighPct: null,
    recoveryFromLowPct: null,
  }
}

function validChartValues(values: Array<number | null> | undefined) {
  return (values ?? []).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

async function fetchIndexChart(symbol: string, range: string, interval: string): Promise<ChartResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${range}&interval=${interval}&includePrePost=false`
  const data = await fetchJson<{ chart?: { result?: ChartResult[] } }>(url).catch(() => ({ chart: undefined }))
  return data?.chart?.result?.[0] ?? null
}

function computeIndexTrendPct(chart: ChartResult): number | null {
  const validCloses = validChartValues(chart?.indicators?.quote?.[0]?.close)
  if (validCloses.length < 4) return null
  const latest = validCloses[validCloses.length - 1]
  const prev = validCloses[validCloses.length - 4] // 3 bars ago
  return ((latest - prev) / prev) * 100
}

function computeIndexTape(dailyChart: ChartResult | null, intradayChart: ChartResult | null): IndexMarketTape {
  const tape = emptyIndexTape()
  if (dailyChart) tape.dailyTrendPct = computeIndexTrendPct(dailyChart)
  if (!intradayChart) return tape

  const quote = intradayChart.indicators?.quote?.[0]
  const closes = validChartValues(quote?.close)
  if (closes.length < 2) return tape

  const latestMeta = intradayChart.meta?.regularMarketPrice
  const latest = typeof latestMeta === 'number' && Number.isFinite(latestMeta) ? latestMeta : closes[closes.length - 1]
  const first = closes[0]
  const recentLookbackIndex = Math.max(0, closes.length - 4)
  const recentBase = closes[recentLookbackIndex]
  const highs = validChartValues(quote?.high)
  const lows = validChartValues(quote?.low)
  const sessionHigh = Math.max(
    latest,
    intradayChart.meta?.regularMarketDayHigh ?? Number.NEGATIVE_INFINITY,
    highs.length ? Math.max(...highs) : Number.NEGATIVE_INFINITY,
  )
  const sessionLow = Math.min(
    latest,
    intradayChart.meta?.regularMarketDayLow ?? Number.POSITIVE_INFINITY,
    lows.length ? Math.min(...lows) : Number.POSITIVE_INFINITY,
  )

  tape.sessionMovePct = first > 0 ? ((latest - first) / first) * 100 : null
  tape.recentTrendPct = recentBase > 0 ? ((latest - recentBase) / recentBase) * 100 : null
  tape.drawdownFromHighPct = sessionHigh > 0 ? ((latest - sessionHigh) / sessionHigh) * 100 : null
  tape.recoveryFromLowPct = sessionLow > 0 ? ((latest - sessionLow) / sessionLow) * 100 : null
  return tape
}

export function indexDumpInProgress(tape: IndexMarketTape | null | undefined) {
  if (!tape) return false
  const sessionDump = tape.sessionMovePct !== null && tape.sessionMovePct <= -0.45
  const highDump = tape.drawdownFromHighPct !== null && tape.drawdownFromHighPct <= -0.6
  const activeSelling = tape.recentTrendPct !== null && tape.recentTrendPct <= -0.25
  const pinnedNearLow = tape.recoveryFromLowPct !== null && tape.recoveryFromLowPct < 0.25
  return (sessionDump || highDump) && (activeSelling || pinnedNearLow)
}

async function getMarketContext(now: Date) {
  const cacheAge = cachedMarketContext.fetchedAt ? now.getTime() - cachedMarketContext.fetchedAt : Number.POSITIVE_INFINITY
  if (cacheAge < 60_000 && cachedMarketContext.fetchedAt !== null) {
    return {
      indices: cachedMarketContext.indices,
      spyTrendPct: cachedMarketContext.spyTrendPct,
      qqqTrendPct: cachedMarketContext.qqqTrendPct,
      iwmTrendPct: cachedMarketContext.iwmTrendPct,
      fetchedAt: new Date(cachedMarketContext.fetchedAt).toISOString(),
    }
  }

  try {
    const [spyDaily, qqqDaily, iwmDaily, spyIntraday, qqqIntraday, iwmIntraday] = await Promise.all([
      fetchIndexChart('SPY', '5d', '1d'),
      fetchIndexChart('QQQ', '5d', '1d'),
      fetchIndexChart('IWM', '5d', '1d'),
      fetchIndexChart('SPY', '1d', '5m'),
      fetchIndexChart('QQQ', '1d', '5m'),
      fetchIndexChart('IWM', '1d', '5m'),
    ])

    const indices: Record<IndexSymbol, IndexMarketTape> = {
      SPY: computeIndexTape(spyDaily, spyIntraday),
      QQQ: computeIndexTape(qqqDaily, qqqIntraday),
      IWM: computeIndexTape(iwmDaily, iwmIntraday),
    }
    const spyTrendPct = indices.SPY.dailyTrendPct
    const qqqTrendPct = indices.QQQ.dailyTrendPct
    const iwmTrendPct = indices.IWM.dailyTrendPct

    cachedMarketContext = {
      indices,
      spyTrendPct,
      qqqTrendPct,
      iwmTrendPct,
      fetchedAt: now.getTime(),
    }

    return {
      indices,
      spyTrendPct,
      qqqTrendPct,
      iwmTrendPct,
      fetchedAt: now.toISOString(),
    }
  } catch {
    return {
      indices: cachedMarketContext.indices,
      spyTrendPct: cachedMarketContext.spyTrendPct,
      qqqTrendPct: cachedMarketContext.qqqTrendPct,
      iwmTrendPct: cachedMarketContext.iwmTrendPct,
      fetchedAt: cachedMarketContext.fetchedAt ? new Date(cachedMarketContext.fetchedAt).toISOString() : null,
    }
  }
}

export async function buildMomentumSnapshot(
  now = new Date(),
  options: { includeCrypto?: boolean } = {},
): Promise<MomentumSnapshot> {
  const marketContext = await getMarketContext(now)
  const includeCrypto = options.includeCrypto ?? cryptoRadarEnabled()
  const isSpyWeak = indexDumpInProgress(marketContext.indices.SPY)
  const isQqqWeak = indexDumpInProgress(marketContext.indices.QQQ)
  const isIwmWeak = indexDumpInProgress(marketContext.indices.IWM)

  // Stocks are fetched every day, including weekends. When the US market is
  // closed (weekend / overnight) scoreCandidate force-sets every stock to
  // IGNORE with a "market closed" blocker, so they can never appear as a live
  // signal, but they still flow through as NO-TRADE preview rows so the trade
  // list can be reviewed before the next open. At the open the same pipeline
  // yields real WATCH/CHECK NOW signals with no further change.
  const [stocks, adrStocks, europeanStocks, crypto, reversion] = await Promise.all([
    buildStockCandidates(now).catch(() => []),
    // US-listed ADRs of the European blue-chips, scanned as normal US stocks so
    // the bot can actually trade the name during US hours (see US_LISTED_ADRS).
    buildAdrStockCandidates(now).catch(() => []),
    // Curated European blue-chips for discovery during European hours (display
    // only; UNVERIFIED so the bot never auto-enters them, see EUROPEAN_STOCKS).
    buildEuropeanStockCandidates(now).catch(() => []),
    // Keep the entire application Alpaca/stocks-only unless crypto is explicitly
    // enabled. This prevents the radar from making hidden Binance requests while
    // the paper bot correctly reports "crypto off".
    includeCrypto ? buildCryptoCandidates(now, { limit: 50 }).catch(() => []) : Promise.resolve([]),
    // Large-cap VWAP-reclaim (mean reversion). Already-scored MomentumCandidates
    // (own scorer/plan), so they bypass scoreCandidate and merge in below rather
    // than joining rawCandidates.
    buildReversionCandidates(now).catch(() => []),
  ])
  // Drop any ADR the main US scan already surfaced so it isn't double-counted.
  const stockTickers = new Set(stocks.map((candidate) => candidate.ticker))
  const adrUnique = adrStocks.filter((candidate) => !stockTickers.has(candidate.ticker))
  const rawCandidates = [...stocks, ...adrUnique, ...europeanStocks, ...crypto]
  if (rawCandidates.length === 0) {
    throw new Error('All market data sources failed.')
  }

  const scoredMomentum = rawCandidates.map((candidate) => {
    const scored = scoreCandidate(candidate, now)
    if (scored.assetClass === 'stock') {
      const isSmallCap = scored.estimatedFreeFloat !== null && scored.estimatedFreeFloat < 15000000
      const isWeak = isSpyWeak || isQqqWeak || (isSmallCap && isIwmWeak)
      if (isWeak) {
        scored.blockers.push('index weak - bot blocked')
      }
    }
    return scored
  })

  // Merge in the mean-reversion candidates. Drop any whose ticker is already an
  // actionable momentum row (a name can't be both a confirmed up-mover and a
  // below-VWAP reclaim), and apply the SAME index-weak veto so neither the bot nor
  // the radar fades a dip into a broad-market dump.
  const momentumActionableTickers = new Set(
    scoredMomentum
      .filter((candidate) => candidate.status !== 'IGNORE' && candidate.status !== 'DATA ERROR')
      .map((candidate) => candidate.ticker),
  )
  const reversionMerged = reversion
    .filter((candidate) => !momentumActionableTickers.has(candidate.ticker))
    .map((candidate) => {
      if ((isSpyWeak || isQqqWeak) && !candidate.blockers.includes('index weak - bot blocked')) {
        candidate.blockers.push('index weak - bot blocked')
      }
      return candidate
    })

  const candidates = sortMomentumCandidates([...scoredMomentum, ...reversionMerged])

  const actionable = candidates.filter((candidate) => candidate.status !== 'IGNORE' && candidate.status !== 'DATA ERROR')
  // Guarantee actionable reversion rows reach the bot/radar even when many gainers
  // would otherwise fill the top-N shortlist (reversion sorts lower on momentum
  // metrics like change% and distance-from-high).
  const reversionActionable = actionable.filter((candidate) => candidate.strategy === 'reversion')
  const shortlist = [
    ...new Map(
      [...actionable.slice(0, MOMENTUM_RULES.shortlistLimit), ...reversionActionable].map((candidate) => [
        candidate.ticker,
        candidate,
      ]),
    ).values(),
  ]
  const statusCounts: Record<MomentumStatus, number> = {
    IGNORE: candidates.filter((candidate) => candidate.status === 'IGNORE').length,
    WATCH: candidates.filter((candidate) => candidate.status === 'WATCH').length,
    'CHECK NOW': candidates.filter((candidate) => candidate.status === 'CHECK NOW').length,
    'DATA ERROR': candidates.filter((candidate) => candidate.status === 'DATA ERROR').length,
  }
  const assetCounts: Record<AssetClass, number> = {
    stock: candidates.filter((candidate) => candidate.assetClass === 'stock').length,
    crypto: candidates.filter((candidate) => candidate.assetClass === 'crypto').length,
  }
  // European exchange rows are discovery-only and cannot be executed by Alpaca.
  // Keep this coverage block focused on the US/ADR universe the paper bot can
  // actually consider, including rows that correctly failed the strict gate.
  const coveredStocks = candidates.filter(
    (candidate) => candidate.assetClass === 'stock' && candidate.sourceLabel !== 'Yahoo (Europe)',
  )
  const coveredActionable = coveredStocks.filter(
    (candidate) => candidate.status === 'WATCH' || candidate.status === 'CHECK NOW',
  )
  const countBand = (rows: MomentumCandidate[], band: StockCapBand) =>
    rows.filter((candidate) => stockCapBand(candidate) === band).length
  const stockCoverage: MomentumSnapshot['stockCoverage'] = {
    scanned: coveredStocks.length,
    microSmallCap: countBand(coveredStocks, 'micro-small'),
    midCap: countBand(coveredStocks, 'mid'),
    largeCap: countBand(coveredStocks, 'large'),
    unknownCap: countBand(coveredStocks, 'unknown'),
    actionableMicroSmallCap: countBand(coveredActionable, 'micro-small'),
    actionableLargeCap: countBand(coveredActionable, 'large'),
  }
  // Reflect whether Alpaca keys are configured, not just whether a stock
  // candidate happened to use Alpaca this scan (there are none on weekends).
  const hasAlpaca = alpacaCredentials() !== null
  const alpacaFeed = alpacaCredentials()?.feed.toLowerCase() ?? null
  const alpacaDataReady = hasAlpaca && alpacaMarketDataError === null
  const stockSource = alpacaDataReady
    ? `Alpaca ${alpacaCredentials()?.feed.toUpperCase() ?? 'IEX'} stock market data`
    : 'Yahoo Finance public stock screeners'
  const dataProviders = configuredStockProviders(typeof process !== 'undefined' ? process?.env ?? {} : {})
  const providerNote = dataProviders
    .map((provider) => `${provider.label} ${provider.configured ? 'ready' : provider.role}`)
    .join(', ')

  return {
    ok: true,
    provider: includeCrypto ? `${stockSource} + Binance public crypto market data` : stockSource,
    generatedAt: now.toISOString(),
    nextScanSeconds: MOMENTUM_RULES.nextScanSeconds,
    liveRefreshSeconds: alpacaDataReady ? MOMENTUM_RULES.alpacaLiveRefreshSeconds : MOMENTUM_RULES.liveRefreshSeconds,
    shortlistLimit: MOMENTUM_RULES.shortlistLimit,
    candidates,
    shortlist,
    ignoredCount: statusCounts.IGNORE,
    dataErrorCount: statusCounts['DATA ERROR'],
    hiddenSignalCount: Math.max(0, actionable.length - shortlist.length),
    statusCounts,
    assetCounts,
    stockCoverage,
    rules: {
      checkNowScore: MOMENTUM_RULES.checkNowScore,
      watchScore: MOMENTUM_RULES.watchScore,
      shortlistLimit: MOMENTUM_RULES.shortlistLimit,
      checkNowRequires: [
        `score ${MOMENTUM_RULES.checkNowScore}+`,
        'strong recent move',
        'fresh 1h / 15m tape',
        'high liquidity',
        'above VWAP',
        'near session/24h high',
        'tight spread',
        'confirmation volume / time-adjusted pace',
        'time-of-day volume pace',
        'micro pullback ready or clean breakout',
        'support/resistance room',
        'crypto 5m volume pulse',
        'not overextended from VWAP',
        'stock price verified within 5%',
      ],
    },
    sourceNote: `${
      alpacaDataReady
        ? `Stocks use Alpaca ${alpacaCredentials()?.feed.toUpperCase() ?? 'IEX'} stream/snapshots or Yahoo as primary data and CNBC as the independent price check.`
        : `Stocks use Yahoo public screeners as primary data and CNBC as the independent price check.${alpacaMarketDataError ? ` ${alpacaMarketDataError}.` : ''}`
    } ${includeCrypto ? 'Crypto uses Binance public market data.' : 'Crypto/Binance scanning is disabled.'} Provider registry: ${providerNote}.`,
    keyAdvice: alpacaMarketDataError
      ? `${alpacaMarketDataError}. Replace or regenerate the Alpaca paper keys before starting the bot; stock scans are currently public-data fallback only.`
      : !hasAlpaca
        ? 'Add Alpaca keys for cleaner stock market-data coverage.'
        : alpacaFeed === 'sip'
          ? 'Consolidated SIP coverage is active. Signals still require live bid/ask, held confirmation, and paper validation.'
          : 'LIMITED FEED: Alpaca IEX is a single-exchange testing feed. Use these signals for paper validation only; consolidated SIP coverage is required before treating small-cap quotes/spreads as live-grade.',
    disclaimer: 'Paper-trading research only. BUY/WAIT/AVOID levels are model opinions, not financial advice.',
    marketContext,
    dataProviders,
  }
}
