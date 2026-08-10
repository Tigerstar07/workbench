export type RegimePreset = 'balanced' | 'trend' | 'stress' | 'noisy'

export type FeatureKey =
  | 'momentum5'
  | 'momentum20'
  | 'volatility20'
  | 'volumeZ'
  | 'sentiment'
  | 'marketTrend'
  | 'fracDiff'

export type FeatureVector = Record<FeatureKey, number>

export type PipelineParams = {
  ticker: string
  days: number
  regime: RegimePreset
  cusumThreshold: number
  horizon: number
  profitTake: number
  stopLoss: number
  riskPerTradePct: number
  folds: number
  embargoPct: number
  metaThreshold: number
  seed: number
}

export type PriceBar = {
  day: number
  date: string
  close: number
  volume: number
  sentiment: number
  market: number
  returnPct: number
  rollingVol: number
}

export type HistoricalBarInput = {
  date: string
  close: number
  volume: number
}

export type DatasetMeta = {
  kind: 'synthetic' | 'historical'
  provider: string
  benchmark: string
  startDate: string
  endDate: string
  observations: number
}

export type LabeledEvent = {
  id: string
  dayIndex: number
  endIndex: number
  date: string
  label: -1 | 0 | 1
  side: -1 | 1
  futureReturn: number
  volatility: number
  features: FeatureVector
}

export type FoldWindow = {
  fold: number
  testStart: number
  testEnd: number
  embargoUntil: number
  trainCount: number
  testCount: number
}

export type FoldResult = FoldWindow & {
  trades: number
  wins: number
  trainSharpe: number
  testSharpe: number
  pnlR: number
  pnlPct: number
  hitRate: number
  equity: ChartPoint[]
}

export type ChartPoint = {
  x: number
  y: number
}

export type LeakageAudit = {
  name: string
  passed: boolean
  detail: string
}

export type PredictionMetrics = {
  psr: number
  dsr: number
  sharpe: number
  maxDrawdownR: number
  maxDrawdownPct: number
  calmar: number
  hitRate: number
  turnover: number
  pbo: number
  hacT: number
  trades: number
  events: number
  timeInMarketPct: number
  cashTimePct: number
  averageHoldingDays: number
  maxSimultaneousTrades: number
  longExposurePct: number
  shortExposurePct: number
  skippedOverlapEvents: number
  portfolioSharpe: number
  dailyVolatility: number
}

export type SourceStatus = 'free' | 'needs-key' | 'proxy' | 'paid' | 'blocked'

export type DataSourceBlueprint = {
  id: string
  name: string
  provider: string
  category: 'macro' | 'fiscal' | 'filings' | 'earnings' | 'market' | 'options' | 'positioning' | 'reference'
  cadence: string
  lagGuard: string
  feature: string
  storage: string
  status: SourceStatus
  cost: 'free' | 'paid' | 'commercial'
  priority: 1 | 2 | 3
  records: string
  lastWindow: string
  leakageRisk: string
}

export type DailyResearchQuestion = {
  question: string
  driver: string
  answer: string
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  evidence: string
}

export type SignalHypothesis = {
  name: string
  type: 'macro' | 'event' | 'microstructure' | 'positioning'
  universe: string
  expectedHorizon: string
  edgeCase: string
  status: 'research' | 'ready' | 'needs-data' | 'reject'
  rank: number
}

export type ValidationGate = {
  gate: string
  check: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export type ResearchIntakeSnapshot = {
  sources: DataSourceBlueprint[]
  questions: DailyResearchQuestion[]
  signals: SignalHypothesis[]
  gates: ValidationGate[]
  registry: {
    pointInTimeCoverage: number
    delistedIncluded: number
    cusipAccuracy: number
    dataGaps: number
    freeConnectors: number
    paidConnectors: number
    needsKey: number
  }
  alerts: Array<{ level: 'info' | 'warn' | 'bad'; title: string; detail: string }>
}

export type MarketComparison = {
  strategyNetPct: number
  strategyGrossPct: number
  benchmarkPct: number
  alphaPct: number
  costDragPct: number
  beatMarket: boolean
  foldBeatRate: number
  statisticallyCredible: boolean
  verdict: 'credible-outperformance' | 'outperformed-not-proven' | 'underperformed'
}

export type TradeLedgerEntry = {
  id: string
  fold: number
  entryIndex: number
  exitIndex: number
  entryDate: string
  exitDate: string
  side: 'long' | 'short'
  entryPrice: number
  exitPrice: number
  signalProbability: number
  exitReason: 'profit target' | 'stop loss' | 'timeout'
  pnlR: number
  accountPnlPct: number
  benchmarkPct: number
  alphaContributionPct: number
  features: FeatureVector
  marketRegime: 'uptrend' | 'downtrend' | 'choppy'
}

export type AlphaAttribution = {
  topAlphaTrades: TradeLedgerEntry[]
  worstTrades: TradeLedgerEntry[]
  top1AlphaShare: number
  top3AlphaShare: number
  longAlphaPct: number
  shortAlphaPct: number
  alphaByRegime: Array<{ label: TradeLedgerEntry['marketRegime']; alphaPct: number; trades: number }>
  concentrationWarning: string | null
  alphaWhileInvestedPct: number
  alphaWhileInCashPct: number
  cashDragPct: number
}

export type PublicRepoInfluence = {
  id: 'qlib' | 'darts' | 'finrl' | 'mlfinlab'
  name: string
  url: string
  license: string
  role: string
  adopted: string
  caveat: string
}

export type ForecastDirection = 'bullish' | 'bearish' | 'neutral'

export type ForecastAction = 'watch-long' | 'watch-short' | 'wait-for-confirmation' | 'stand-aside'

export type ForecastVote = {
  id: string
  model: string
  family: 'meta-label' | 'trend' | 'reversion' | 'risk-regime'
  sourceId: PublicRepoInfluence['id']
  stance: ForecastDirection
  probability: number
  confidence: number
  forecastPct: number
  weight: number
  evidence: string
}

export type PredictionForecast = {
  asOfDate: string
  horizonDays: number
  currentPrice: number
  direction: ForecastDirection
  action: ForecastAction
  confidence: number
  bullProbability: number
  bearProbability: number
  expectedMovePct: number
  expectedPrice: number
  targetPrice: number | null
  stopPrice: number | null
  rangeLowPrice: number
  rangeHighPrice: number
  rangeLowPct: number
  rangeHighPct: number
  votes: ForecastVote[]
  rationale: string
}

export type PredictionDashboard = {
  forecast: PredictionForecast
  qualityScore: number
  qualityLabel: 'research-only' | 'candidate-watch' | 'blocked'
  blockers: string[]
  repoInfluences: PublicRepoInfluence[]
}

export type RobustnessSummary = {
  runs: number
  beatMarketRate: number
  credibleRate: number
  medianAlphaPct: number
  p05AlphaPct: number
  p95AlphaPct: number
  medianStrategyPct: number
  medianBenchmarkPct: number
  alphas: number[]
}

export type PipelineResult = {
  params: PipelineParams
  bars: PriceBar[]
  events: LabeledEvent[]
  folds: FoldResult[]
  tradeLedger: TradeLedgerEntry[]
  attribution: AlphaAttribution
  metrics: PredictionMetrics
  audits: LeakageAudit[]
  equity: ChartPoint[]
  benchmark: ChartPoint[]
  labelCounts: Record<'profit' | 'loss' | 'timeout', number>
  featureImportance: Array<{ key: FeatureKey; value: number }>
  sourceChecklist: Array<{ label: string; status: 'mvp' | 'needed' | 'later'; detail: string }>
  modelNotes: string[]
  intake: ResearchIntakeSnapshot
  comparison: MarketComparison
  dataset: DatasetMeta
  dashboard: PredictionDashboard
}

export const DEFAULT_PIPELINE_PARAMS: PipelineParams = {
  ticker: 'SPY',
  days: 900,
  regime: 'balanced',
  cusumThreshold: 1.2,
  horizon: 18,
  profitTake: 1.8,
  stopLoss: 1.2,
  riskPerTradePct: 1,
  folds: 6,
  embargoPct: 3,
  metaThreshold: 0.52,
  seed: 13,
}

const FEATURE_KEYS: FeatureKey[] = [
  'momentum5',
  'momentum20',
  'volatility20',
  'volumeZ',
  'sentiment',
  'marketTrend',
  'fracDiff',
]

const PUBLIC_REPO_INFLUENCES: PublicRepoInfluence[] = [
  {
    id: 'qlib',
    name: 'Microsoft Qlib',
    url: 'https://github.com/microsoft/qlib',
    license: 'MIT',
    role: 'Research workflow',
    adopted: 'Dataset -> candidate search -> validation -> backtest -> decision dashboard.',
    caveat: 'This app does not embed Qlib; it mirrors the pipeline shape in TypeScript.',
  },
  {
    id: 'darts',
    name: 'Unit8 Darts',
    url: 'https://github.com/unit8co/darts',
    license: 'Apache-2.0',
    role: 'Forecasting pattern',
    adopted: 'Ensemble votes, backtest-first forecasting, and probabilistic ranges.',
    caveat: 'No Python Darts runtime is bundled; the dashboard uses local lightweight votes.',
  },
  {
    id: 'finrl',
    name: 'AI4Finance FinRL',
    url: 'https://github.com/AI4Finance-Foundation/FinRL',
    license: 'MIT',
    role: 'Decision policy',
    adopted: 'Action labels separate prediction, risk, and whether a model is tradeable.',
    caveat: 'No reinforcement-learning agent is shipped in this browser app.',
  },
  {
    id: 'mlfinlab',
    name: 'Hudson & Thames MlFinLab',
    url: 'https://github.com/hudson-and-thames/mlfinlab',
    license: 'All rights reserved',
    role: 'Financial ML method reference',
    adopted: 'CUSUM events, triple-barrier labels, meta-labeling, purging, and embargo checks.',
    caveat: 'Methodology only; no MlFinLab code was copied because the current repository is not permissively licensed.',
  },
]

const SOURCE_BLUEPRINTS: DataSourceBlueprint[] = [
  {
    id: 'fred-alfred-liquidity',
    name: 'FRED / ALFRED Liquidity',
    provider: 'FRED, ALFRED',
    category: 'macro',
    cadence: 'Weekly / daily',
    lagGuard: 'Use realtime_start; H.4.1 T+1 after Thu 16:30 ET',
    feature: 'Net liquidity, liquidity impulse',
    storage: 'TimescaleDB bi-temporal',
    status: 'free',
    cost: 'free',
    priority: 1,
    records: 'WALCL, WTREGEN, RRPONTSYD',
    lastWindow: 'connector spec ready',
    leakageRisk: 'Latest-revised FRED values leak old vintages unless ALFRED realtime_start is used.',
  },
  {
    id: 'treasury-dts',
    name: 'Treasury Daily Statement',
    provider: 'US Treasury Fiscal Data API',
    category: 'fiscal',
    cadence: 'Daily 16:00 ET',
    lagGuard: 'Trade only after publication timestamp',
    feature: 'Fiscal impulse, tax surprise',
    storage: 'TimescaleDB cash-flow table',
    status: 'free',
    cost: 'free',
    priority: 1,
    records: 'Daily cash flows',
    lastWindow: 'public API',
    leakageRisk: 'Prior business day operations are only known after the daily statement posts.',
  },
  {
    id: 'sec-form4',
    name: 'SEC EDGAR Form 4',
    provider: 'SEC Atom / EDGAR REST',
    category: 'filings',
    cadence: 'Event-driven, T+2 business days',
    lagGuard: 'Use accepted_at / filed_at only',
    feature: 'Discretionary insider buying intensity',
    storage: 'PostgreSQL filings + parsed transactions',
    status: 'free',
    cost: 'free',
    priority: 1,
    records: 'New ownership filings',
    lastWindow: 'public feed',
    leakageRisk: 'Transaction date is not tradable knowledge until the filing is accepted.',
  },
  {
    id: 'sec-13f',
    name: 'SEC 13F Holdings',
    provider: 'SEC EDGAR, SEC-API.io',
    category: 'positioning',
    cadence: 'Quarterly, up to T+45',
    lagGuard: 'Hard 45-day availability lag',
    feature: 'Institutional congruence, crowding',
    storage: 'ClickHouse holdings by CUSIP',
    status: 'blocked',
    cost: 'free',
    priority: 2,
    records: 'Holdings filings',
    lastWindow: 'needs PIT CUSIP map',
    leakageRisk: 'Period-end holdings are hidden until filing date; current tickers create survivorship bias.',
  },
  {
    id: 'earnings-estimates',
    name: 'Earnings Estimates',
    provider: 'SEC Companyfacts + release-price reaction',
    category: 'earnings',
    cadence: 'Intraday',
    lagGuard: 'Use API inserted_at and fiscal period keys',
    feature: 'Reported surprise proxy, SUE, delayed disclosure',
    storage: 'PostgreSQL filing facts + accepted_at',
    status: 'proxy',
    cost: 'free',
    priority: 1,
    records: 'Companyfacts and earnings filings',
    lastWindow: 'free proxy; no consensus history',
    leakageRisk: 'This does not replace analyst-consensus revisions; fiscal-year joins can still fake surprise strength.',
  },
  {
    id: 'market-bars',
    name: 'Market Data OHLCV',
    provider: 'Alpaca IEX via existing paper bot',
    category: 'market',
    cadence: 'Intraday to sub-second',
    lagGuard: 'Use exchange timestamp and vendor receipt time',
    feature: 'Returns, volatility, trade/quote bars',
    storage: 'ClickHouse bars and quotes',
    status: 'free',
    cost: 'free',
    priority: 1,
    records: 'Bars, trades, quotes',
    lastWindow: 'existing Alpaca credentials',
    leakageRisk: 'Yahoo-style current universes omit delisted names and inflate backtests.',
  },
  {
    id: 'options-ofi',
    name: 'Options / OFI',
    provider: 'Alpaca trades/quotes + delayed chain proxy',
    category: 'options',
    cadence: 'Real-time',
    lagGuard: 'Live only; never revise open interest into same-day tests',
    feature: 'Signed trade imbalance, spread pressure, put/call and IV proxies',
    storage: 'ClickHouse trades, quotes, delayed options snapshots',
    status: 'proxy',
    cost: 'free',
    priority: 2,
    records: 'IEX trades/quotes and delayed option snapshots',
    lastWindow: 'free proxy; consolidated history unavailable',
    leakageRisk: 'Open interest and ETF flow data often become usable only next day.',
  },
]

function buildResearchIntakeSnapshot(metrics: PredictionMetrics, audits: LeakageAudit[]): ResearchIntakeSnapshot {
  const freeConnectors = SOURCE_BLUEPRINTS.filter((source) => source.cost === 'free').length
  const paidConnectors = SOURCE_BLUEPRINTS.filter((source) => source.cost !== 'free').length
  const needsKey = SOURCE_BLUEPRINTS.filter((source) => source.status === 'needs-key').length
  const validationPasses = audits.filter((audit) => audit.passed).length
  const pboPass = metrics.pbo <= 0.05
  const hacPass = metrics.hacT > 3

  return {
    sources: SOURCE_BLUEPRINTS,
    registry: {
      pointInTimeCoverage: 38,
      delistedIncluded: 0,
      cusipAccuracy: 0,
      dataGaps: SOURCE_BLUEPRINTS.filter((source) => source.status === 'blocked' || source.status === 'paid').length + 1,
      freeConnectors,
      paidConnectors,
      needsKey,
    },
    questions: [
      {
        question: 'Is systemic net liquidity expanding or contracting today?',
        driver: 'WALCL - WTREGEN - RRPONTSYD',
        answer: 'The live connector now loads WALCL, WTREGEN, and RRPONTSYD with realtime_start; the UI shows the latest released liquidity impulse.',
        tone: 'good',
        evidence: 'NotebookLM flagged revised FRED values as a direct lookahead leak without vintage timestamps.',
      },
      {
        question: 'Did fiscal cash flows create a sector-level liquidity impulse?',
        driver: 'Treasury DTS',
        answer: 'This is the cleanest free connector to wire first because it has a public API and daily publication window.',
        tone: 'neutral',
        evidence: 'Use daily cash-flow rows only after the statement publication timestamp, then map to funding-dependent sectors.',
      },
      {
        question: 'Which companies show non-routine insider accumulation?',
        driver: 'SEC Form 4 code P',
        answer: 'High-priority public signal. Score discretionary purchases after accepted_at, not the transaction date.',
        tone: 'good',
        evidence: 'Form 4 filings are free, event-driven, and useful for delayed market assimilation tests.',
      },
      {
        question: 'Where are earnings revisions and PEAD strongest after publication lag?',
        driver: 'SUE + revisions + transcripts',
        answer: 'The free path uses SEC filing facts and release-price drift as a PEAD proxy. It cannot claim analyst-revision coverage.',
        tone: 'warn',
        evidence: 'FMP/Benzinga-style feeds need inserted_at, fiscal period keys, and analyst dropout handling.',
      },
      {
        question: 'Is order-flow imbalance confirming or rejecting the thesis?',
        driver: 'Trades, quotes, options surface',
        answer: 'Alpaca IEX trades and quotes can produce a useful signed-imbalance proxy. Full consolidated TAQ, OPRA, and dealer gamma remain unavailable.',
        tone: 'warn',
        evidence: 'The proxy is explicitly labeled so IEX-only coverage is never presented as full-market OFI.',
      },
    ],
    signals: [
      {
        name: 'Order Flow Imbalance',
        type: 'microstructure',
        universe: 'Liquid equities and ETFs',
        expectedHorizon: 'Minutes to 2 days',
        edgeCase: 'Works only with real trade/quote timing, spreads, and cost modeling.',
        status: 'needs-data',
        rank: 1,
      },
      {
        name: 'PEAD / SUE with delayed disclosure',
        type: 'event',
        universe: 'Earnings reporters with estimates history',
        expectedHorizon: '2 to 45 trading days',
        edgeCase: 'Must model announcement timestamp, revisions, fiscal calendar, and analyst coverage drift.',
        status: 'needs-data',
        rank: 2,
      },
      {
        name: 'Discretionary insider buying',
        type: 'event',
        universe: 'US common stocks with Form 4 code P',
        expectedHorizon: '5 to 60 trading days',
        edgeCase: 'Filter 10b5-1 plans, tiny dollar buys, and cluster by officer quality.',
        status: 'research',
        rank: 3,
      },
      {
        name: 'Net liquidity x funding dependence',
        type: 'macro',
        universe: 'Sector ETFs and balance-sheet-sensitive equities',
        expectedHorizon: '1 to 12 weeks',
        edgeCase: 'Needs vintage macro data and a stable mapping from firms to sector funding sensitivity.',
        status: 'research',
        rank: 4,
      },
      {
        name: '13F institutional congruence',
        type: 'positioning',
        universe: '13F-reportable US equities',
        expectedHorizon: 'Quarterly rebalance',
        edgeCase: 'T+45 filing lag and CUSIP mapping decide whether the backtest is honest.',
        status: 'needs-data',
        rank: 5,
      },
    ],
    gates: [
      {
        gate: 'Point-in-time timestamps',
        check: 'effective_date + realtime_start + inserted_at exist per row',
        status: 'warn',
        detail: 'Blueprint is explicit, but only prototype bars are wired in this MVP.',
      },
      {
        gate: 'Publication-lag guards',
        check: 'No source becomes tradable before filing/API/transcript acceptance time',
        status: 'warn',
        detail: 'Rules are documented for FRED, DTS, Form 4, 13F, estimates, and options.',
      },
      {
        gate: 'Survivor-bias-free universe',
        check: 'Delisted names and historical ticker/CUSIP mapping are included',
        status: 'fail',
        detail: 'Needs CRSP-quality reference data before any historical edge claim is credible.',
      },
      {
        gate: 'Purged and embargoed validation',
        check: `${validationPasses}/${audits.length} label-overlap assertions pass`,
        status: validationPasses === audits.length ? 'pass' : 'fail',
        detail: 'Existing prototype removes overlapping label horizons and adjacent post-test events.',
      },
      {
        gate: 'Transaction cost frontier',
        check: 'Reject signals that vanish under spread, fee, slippage, and capacity stress',
        status: 'warn',
        detail: 'Current backtest subtracts a small synthetic cost only; real cost curves are not wired.',
      },
      {
        gate: 'Outperformance hurdle',
        check: 'PBO <= 5%, HAC t-stat > 3, DSR/PSR visible',
        status: pboPass && hacPass ? 'pass' : 'warn',
        detail: `Current synthetic run: PBO ${(metrics.pbo * 100).toFixed(0)}%, HAC t-stat ${metrics.hacT.toFixed(2)}.`,
      },
    ],
    alerts: [
      {
        level: 'warn',
        title: 'Do not claim live prediction yet',
        detail: 'This screen now separates source readiness from model output so missing feeds are visible instead of hidden.',
      },
      {
        level: 'bad',
        title: 'CRSP / point-in-time universe missing',
        detail: 'Without delisted securities and historical identifiers, equity backtests are structurally inflated.',
      },
      {
        level: 'info',
        title: 'Best first implementation path',
        detail: 'Wire Treasury DTS and SEC Form 4 first: both are public, event-rich, and force the timestamp discipline this product needs.',
      },
    ],
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return function nextRandom() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand: () => number) {
  const u = Math.max(rand(), 1e-9)
  const v = Math.max(rand(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values: number[]) {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = mean(values.map((value) => (value - avg) ** 2))
  return Math.sqrt(variance)
}

function skew(values: number[]) {
  const sd = std(values)
  if (values.length < 3 || sd === 0) return 0
  const avg = mean(values)
  return mean(values.map((value) => ((value - avg) / sd) ** 3))
}

function kurtosis(values: number[]) {
  const sd = std(values)
  if (values.length < 4 || sd === 0) return 3
  const avg = mean(values)
  return mean(values.map((value) => ((value - avg) / sd) ** 4))
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * absX)
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absX * absX))
  return sign * y
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)))
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-clamp(value, -12, 12)))
}

function businessDate(start: Date, offset: number) {
  const date = new Date(start)
  let added = 0
  while (added < offset) {
    date.setUTCDate(date.getUTCDate() + 1)
    const day = date.getUTCDay()
    if (day !== 0 && day !== 6) added++
  }
  return date.toISOString().slice(0, 10)
}

function rolling(values: number[], index: number, window: number) {
  const start = Math.max(0, index - window + 1)
  return values.slice(start, index + 1)
}

function regimeShape(regime: RegimePreset, day: number, days: number) {
  const phase = day / Math.max(1, days - 1)
  if (regime === 'trend') {
    return {
      drift: 0.00055 + Math.sin(phase * Math.PI * 2) * 0.0002,
      vol: 0.010,
      alphaStrength: 0.0038,
    }
  }
  if (regime === 'stress') {
    return {
      drift: phase > 0.35 && phase < 0.68 ? -0.00065 : 0.00018,
      vol: phase > 0.3 && phase < 0.72 ? 0.019 : 0.013,
      alphaStrength: 0.0024,
    }
  }
  if (regime === 'noisy') {
    return {
      drift: 0.00012,
      vol: 0.017,
      alphaStrength: 0.0012,
    }
  }
  return {
    drift: 0.00028,
    vol: 0.012,
    alphaStrength: 0.0028,
  }
}

export function generatePrototypeBars(params: PipelineParams): PriceBar[] {
  const rand = mulberry32(params.seed * 7919 + params.ticker.length * 97)
  const returns: number[] = []
  const bars: PriceBar[] = []
  const startDate = new Date(Date.UTC(2022, 0, 3))
  let close = params.ticker === 'NVDA' ? 155 : params.ticker === 'AAPL' ? 172 : 420
  let sentiment = 0
  let market = 0
  let latentAlpha = 0

  for (let day = 0; day < params.days; day++) {
    const shape = regimeShape(params.regime, day, params.days)
    sentiment = clamp(0.86 * sentiment + normal(rand) * 0.28, -1, 1)
    market = clamp(0.9 * market + normal(rand) * 0.18 + shape.drift * 85, -1, 1)
    const shock = normal(rand) * shape.vol
    const returnPct = shape.drift + latentAlpha + shock
    close = Math.max(8, close * (1 + returnPct))
    latentAlpha = shape.alphaStrength * (0.62 * sentiment + 0.38 * market) + 0.08 * returnPct

    returns.push(returnPct)
    const volWindow = rolling(returns, day, 20)
    const rollingVol = Math.max(0.004, std(volWindow))
    const volumeBase = params.ticker === 'SPY' ? 78_000_000 : params.ticker === 'NVDA' ? 48_000_000 : 55_000_000
    const volume =
      volumeBase *
      (1 + Math.abs(returnPct) * 34 + Math.max(0, sentiment) * 0.18 + Math.max(0, market) * 0.12) *
      (0.86 + rand() * 0.28)

    bars.push({
      day,
      date: businessDate(startDate, day),
      close,
      volume,
      sentiment,
      market,
      returnPct,
      rollingVol,
    })
  }

  return bars
}

export function normalizeHistoricalBars(
  targetRows: HistoricalBarInput[],
  benchmarkRows: HistoricalBarInput[] = targetRows,
): { bars: PriceBar[]; benchmarkBars: PriceBar[] } {
  const benchmarkByDate = new Map(benchmarkRows.map((row) => [row.date, row]))
  const aligned = targetRows
    .filter((row) => benchmarkByDate.has(row.date) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const targetReturns: number[] = []
  const benchmarkReturns: number[] = []
  const bars: PriceBar[] = []
  const benchmarkBars: PriceBar[] = []

  for (let index = 0; index < aligned.length; index++) {
    const target = aligned[index]
    const benchmark = benchmarkByDate.get(target.date) as HistoricalBarInput
    const previousTarget = aligned[index - 1]?.close ?? target.close
    const previousBenchmarkDate = aligned[index - 1]?.date
    const previousBenchmark = previousBenchmarkDate
      ? benchmarkByDate.get(previousBenchmarkDate)?.close ?? benchmark.close
      : benchmark.close
    const targetReturn = target.close / previousTarget - 1
    const benchmarkReturn = benchmark.close / previousBenchmark - 1
    targetReturns.push(targetReturn)
    benchmarkReturns.push(benchmarkReturn)
    const targetVol = Math.max(0.004, std(rolling(targetReturns, index, 20)))
    const benchmarkVol = Math.max(0.004, std(rolling(benchmarkReturns, index, 20)))
    const benchmarkLookbackDate = aligned[Math.max(0, index - 20)]?.date
    const benchmarkLookback = benchmarkLookbackDate
      ? benchmarkByDate.get(benchmarkLookbackDate)?.close ?? benchmark.close
      : benchmark.close
    const marketTrend = clamp((benchmark.close / benchmarkLookback - 1) / (benchmarkVol * Math.sqrt(20)), -1, 1)

    bars.push({
      day: index,
      date: target.date,
      close: target.close,
      volume: target.volume,
      sentiment: 0,
      market: marketTrend,
      returnPct: targetReturn,
      rollingVol: targetVol,
    })
    benchmarkBars.push({
      day: index,
      date: benchmark.date,
      close: benchmark.close,
      volume: benchmark.volume,
      sentiment: 0,
      market: marketTrend,
      returnPct: benchmarkReturn,
      rollingVol: benchmarkVol,
    })
  }

  return { bars, benchmarkBars }
}

export function generateCusumEvents(bars: PriceBar[], thresholdMultiplier: number) {
  const events: number[] = []
  let positive = 0
  let negative = 0
  for (let i = 22; i < bars.length - 2; i++) {
    const threshold = Math.max(0.0025, bars[i].rollingVol * thresholdMultiplier)
    positive = Math.max(0, positive + bars[i].returnPct)
    negative = Math.min(0, negative + bars[i].returnPct)
    if (positive > threshold || negative < -threshold) {
      events.push(i)
      positive = 0
      negative = 0
    }
  }
  return events
}

function fractionalDiff(bars: PriceBar[], index: number, d = 0.35) {
  const weights = [1]
  for (let k = 1; k < 8; k++) {
    weights.push(-weights[k - 1] * ((d - k + 1) / k))
  }
  let value = 0
  let norm = 0
  for (let k = 0; k < weights.length; k++) {
    const bar = bars[index - k]
    if (!bar) break
    value += weights[k] * Math.log(bar.close)
    norm += Math.abs(weights[k])
  }
  return norm ? value / norm : 0
}

function zScoreAt(values: number[], index: number, window: number) {
  const sample = rolling(values, index, window)
  const sd = std(sample)
  return sd === 0 ? 0 : (values[index] - mean(sample)) / sd
}

function eventFeatures(bars: PriceBar[], index: number): FeatureVector {
  const close = bars[index].close
  const close5 = bars[Math.max(0, index - 5)].close
  const close20 = bars[Math.max(0, index - 20)].close
  const volumes = bars.map((bar) => bar.volume)
  const market5 = bars[index].market - bars[Math.max(0, index - 5)].market
  return {
    momentum5: ((close / close5 - 1) * 100) / Math.max(0.35, bars[index].rollingVol * 100),
    momentum20: ((close / close20 - 1) * 100) / Math.max(0.35, bars[index].rollingVol * 100),
    volatility20: bars[index].rollingVol * 100,
    volumeZ: zScoreAt(volumes, index, 30),
    sentiment: bars[index].sentiment,
    marketTrend: market5,
    fracDiff: fractionalDiff(bars, index) * 10,
  }
}

function primarySide(features: FeatureVector): -1 | 1 {
  const score =
    0.46 * features.momentum5 +
    0.34 * features.momentum20 +
    0.58 * features.sentiment +
    0.24 * features.marketTrend +
    0.08 * features.volumeZ -
    0.08 * features.volatility20
  return score >= 0 ? 1 : -1
}

export function buildTripleBarrierLabels(params: PipelineParams, bars: PriceBar[], eventDays: number[]): LabeledEvent[] {
  return eventDays.map((dayIndex, eventIndex) => {
    const startClose = bars[dayIndex].close
    const maxEnd = Math.min(bars.length - 1, dayIndex + params.horizon)
    const volatility = Math.max(0.003, bars[dayIndex].rollingVol)
    const upper = volatility * params.profitTake
    const lower = -volatility * params.stopLoss
    let label: -1 | 0 | 1 = 0
    let endIndex = maxEnd
    let futureReturn = bars[maxEnd].close / startClose - 1

    for (let i = dayIndex + 1; i <= maxEnd; i++) {
      const pathReturn = bars[i].close / startClose - 1
      if (pathReturn >= upper) {
        label = 1
        endIndex = i
        futureReturn = pathReturn
        break
      }
      if (pathReturn <= lower) {
        label = -1
        endIndex = i
        futureReturn = pathReturn
        break
      }
    }

    const features = eventFeatures(bars, dayIndex)
    return {
      id: `E${String(eventIndex + 1).padStart(3, '0')}`,
      dayIndex,
      endIndex,
      date: bars[dayIndex].date,
      label,
      side: primarySide(features),
      futureReturn,
      volatility,
      features,
    }
  })
}

export function buildPurgedEmbargoedSplits(events: LabeledEvent[], params: PipelineParams): Array<FoldWindow & { train: number[]; test: number[] }> {
  const foldCount = clamp(Math.round(params.folds), 3, 10)
  const minDay = events[0]?.dayIndex ?? 0
  const maxDay = events[events.length - 1]?.dayIndex ?? minDay
  const span = Math.max(1, maxDay - minDay + 1)
  const block = Math.max(8, Math.floor(span / foldCount))
  const embargoDays = Math.ceil(params.days * (params.embargoPct / 100))
  const splits: Array<FoldWindow & { train: number[]; test: number[] }> = []

  for (let fold = 0; fold < foldCount; fold++) {
    const testStart = minDay + fold * block
    const testEnd = fold === foldCount - 1 ? maxDay : Math.min(maxDay, testStart + block - 1)
    const embargoUntil = Math.min(params.days - 1, testEnd + embargoDays)
    const test: number[] = []
    const train: number[] = []

    events.forEach((event, index) => {
      const inTest = event.dayIndex >= testStart && event.dayIndex <= testEnd
      const overlapsTest = event.dayIndex <= testEnd && event.endIndex >= testStart
      const inEmbargo = event.dayIndex > testEnd && event.dayIndex <= embargoUntil
      if (inTest) {
        test.push(index)
      } else if (!overlapsTest && !inEmbargo) {
        train.push(index)
      }
    })

    if (test.length > 0 && train.length > 8) {
      splits.push({
        fold: fold + 1,
        testStart,
        testEnd,
        embargoUntil,
        trainCount: train.length,
        testCount: test.length,
        train,
        test,
      })
    }
  }

  return splits
}

type MetaModel = {
  means: FeatureVector
  stds: FeatureVector
  weights: FeatureVector
  intercept: number
}

function emptyFeatureRecord(value: number): FeatureVector {
  return {
    momentum5: value,
    momentum20: value,
    volatility20: value,
    volumeZ: value,
    sentiment: value,
    marketTrend: value,
    fracDiff: value,
  }
}

function trainMetaModel(events: LabeledEvent[], train: number[]): MetaModel {
  const means = emptyFeatureRecord(0)
  const stds = emptyFeatureRecord(1)
  const weights = emptyFeatureRecord(0)
  const successes = train.filter((index) => events[index].label !== 0 && events[index].label === events[index].side)
  const failures = train.filter((index) => events[index].label === 0 || events[index].label !== events[index].side)
  const positiveRate = clamp(successes.length / Math.max(1, train.length), 0.05, 0.95)

  for (const key of FEATURE_KEYS) {
    const values = train.map((index) => events[index].features[key])
    means[key] = mean(values)
    stds[key] = Math.max(std(values), 0.0001)
    const successMean = mean(successes.map((index) => events[index].features[key]))
    const failMean = mean(failures.map((index) => events[index].features[key]))
    weights[key] = clamp((successMean - failMean) / stds[key], -1.8, 1.8)
  }

  return {
    means,
    stds,
    weights,
    intercept: Math.log(positiveRate / (1 - positiveRate)) * 0.7,
  }
}

function metaProbability(model: MetaModel, event: LabeledEvent) {
  const raw = FEATURE_KEYS.reduce((sum, key) => {
    const z = (event.features[key] - model.means[key]) / model.stds[key]
    return sum + model.weights[key] * clamp(z, -3, 3)
  }, model.intercept)
  return sigmoid(raw / Math.sqrt(FEATURE_KEYS.length))
}

function eventReturnR(event: LabeledEvent, params: PipelineParams) {
  if (event.label === event.side) return params.profitTake
  if (event.label === -event.side) return -params.stopLoss
  const timeoutR = (event.side * event.futureReturn) / Math.max(0.001, event.volatility * params.stopLoss)
  return clamp(timeoutR, -0.35, 0.35)
}

function accountReturnPct(pnlR: number, params: PipelineParams) {
  return pnlR * params.riskPerTradePct
}

function compoundedReturnPct(accountValue: number) {
  return (accountValue - 1) * 100
}

function benchmarkHoldingReturnPct(benchmarkBars: PriceBar[], startIndex: number, endIndex: number) {
  const start = benchmarkBars[startIndex]?.close ?? 1
  const end = benchmarkBars[endIndex]?.close ?? start
  return start > 0 ? (end / start - 1) * 100 : 0
}

function exitReason(event: LabeledEvent): TradeLedgerEntry['exitReason'] {
  if (event.label === event.side) return 'profit target'
  if (event.label === -event.side) return 'stop loss'
  return 'timeout'
}

function marketRegime(event: LabeledEvent): TradeLedgerEntry['marketRegime'] {
  if (event.features.marketTrend > 0.18) return 'uptrend'
  if (event.features.marketTrend < -0.18) return 'downtrend'
  return 'choppy'
}

function directionFromForecast(valuePct: number, neutralBand = 0.12): ForecastDirection {
  if (valuePct > neutralBand) return 'bullish'
  if (valuePct < -neutralBand) return 'bearish'
  return 'neutral'
}

function voteConfidence(probability: number) {
  return clamp(Math.abs(probability - 0.5) * 2, 0, 1)
}

function signedReturnPct(bars: PriceBar[], startIndex: number, endIndex: number) {
  const start = bars[Math.max(0, startIndex)]?.close ?? 1
  const end = bars[Math.max(0, endIndex)]?.close ?? start
  return start > 0 ? (end / start - 1) * 100 : 0
}

function closeZScore(bars: PriceBar[], index: number, window: number) {
  const closes = bars.map((bar) => bar.close)
  return zScoreAt(closes, index, window)
}

function latestPredictionEvent(params: PipelineParams, bars: PriceBar[]): LabeledEvent {
  const dayIndex = Math.max(0, bars.length - 1)
  const features = eventFeatures(bars, dayIndex)
  return {
    id: 'NEXT',
    dayIndex,
    endIndex: Math.min(dayIndex + params.horizon, bars.length - 1),
    date: bars[dayIndex]?.date ?? '',
    label: 0,
    side: primarySide(features),
    futureReturn: 0,
    volatility: Math.max(0.003, bars[dayIndex]?.rollingVol ?? 0.01),
    features,
  }
}

function buildForecastVotes(params: PipelineParams, bars: PriceBar[], events: LabeledEvent[]): ForecastVote[] {
  const current = latestPredictionEvent(params, bars)
  const latestIndex = current.dayIndex
  const volPct = current.volatility * 100
  const train = events.flatMap((event, index) => (event.endIndex < latestIndex ? [index] : []))
  const votes: ForecastVote[] = []

  if (train.length > 8) {
    const model = trainMetaModel(events, train)
    const probability = metaProbability(model, current)
    const signedEdge = current.side * (probability - 0.5) * 2 * params.profitTake * volPct
    const stance = probability >= params.metaThreshold ? directionFromForecast(signedEdge) : 'neutral'
    votes.push({
      id: 'meta-label',
      model: 'Purged meta-label classifier',
      family: 'meta-label',
      sourceId: 'mlfinlab',
      stance,
      probability,
      confidence: voteConfidence(probability),
      forecastPct: stance === 'neutral' ? signedEdge * 0.35 : signedEdge,
      weight: 0.36,
      evidence: `${train.length} completed labels; p=${probability.toFixed(2)} vs threshold ${params.metaThreshold.toFixed(2)}.`,
    })
  } else {
    votes.push({
      id: 'meta-label',
      model: 'Purged meta-label classifier',
      family: 'meta-label',
      sourceId: 'mlfinlab',
      stance: 'neutral',
      probability: 0.5,
      confidence: 0,
      forecastPct: 0,
      weight: 0.36,
      evidence: 'Not enough completed labels to train a meta-model.',
    })
  }

  const momentum5 = signedReturnPct(bars, Math.max(0, latestIndex - 5), latestIndex)
  const momentum20 = signedReturnPct(bars, Math.max(0, latestIndex - 20), latestIndex)
  const trendRaw = clamp((momentum5 * 0.55 + momentum20 * 0.45) / Math.max(1, volPct * Math.sqrt(20)), -2.2, 2.2)
  const trendProbability = sigmoid(Math.abs(trendRaw) * 1.18)
  const trendForecast = clamp(trendRaw * volPct * Math.sqrt(params.horizon) * 0.45, -12, 12)
  votes.push({
    id: 'trend-follow',
    model: 'Multi-horizon trend learner',
    family: 'trend',
    sourceId: 'qlib',
    stance: directionFromForecast(trendForecast, 0.18),
    probability: trendProbability,
    confidence: voteConfidence(trendProbability),
    forecastPct: trendForecast,
    weight: 0.24,
    evidence: `5d ${momentum5.toFixed(1)}%, 20d ${momentum20.toFixed(1)}%, volatility ${volPct.toFixed(1)}%.`,
  })

  const z20 = closeZScore(bars, latestIndex, 20)
  const reversionForecast = clamp(-z20 * volPct * Math.sqrt(Math.min(10, params.horizon)) * 0.28, -8, 8)
  const reversionProbability = sigmoid(Math.abs(z20) * 0.72)
  votes.push({
    id: 'mean-reversion',
    model: 'Residual mean-reversion forecaster',
    family: 'reversion',
    sourceId: 'darts',
    stance: directionFromForecast(reversionForecast, 0.18),
    probability: reversionProbability,
    confidence: voteConfidence(reversionProbability),
    forecastPct: reversionForecast,
    weight: 0.18,
    evidence: `20d close z-score ${z20.toFixed(2)}; forecast fades stretched moves.`,
  })

  const drawdown20 = Math.min(0, signedReturnPct(bars, Math.max(0, latestIndex - 20), latestIndex))
  const riskScore = clamp((-drawdown20 / Math.max(1, volPct * 4)) + Math.max(0, volPct - 2.4) * 0.22 - current.features.marketTrend, -2, 2)
  const riskForecast = clamp(-riskScore * volPct * Math.sqrt(params.horizon) * 0.32, -10, 6)
  const riskProbability = sigmoid(Math.abs(riskScore) * 0.95)
  votes.push({
    id: 'risk-policy',
    model: 'Risk-regime policy vote',
    family: 'risk-regime',
    sourceId: 'finrl',
    stance: directionFromForecast(riskForecast, 0.18),
    probability: riskProbability,
    confidence: voteConfidence(riskProbability),
    forecastPct: riskForecast,
    weight: 0.22,
    evidence: `20d drawdown ${drawdown20.toFixed(1)}%, market trend ${current.features.marketTrend.toFixed(2)}, vol ${volPct.toFixed(1)}%.`,
  })

  return votes
}

function buildPredictionDashboard(
  params: PipelineParams,
  bars: PriceBar[],
  events: LabeledEvent[],
  metrics: PredictionMetrics,
  comparison: MarketComparison,
  audits: LeakageAudit[],
  dataset: DatasetMeta,
): PredictionDashboard {
  const votes = buildForecastVotes(params, bars, events)
  const totalWeight = votes.reduce((sum, vote) => sum + vote.weight, 0) || 1
  const bullProbability = votes.reduce((sum, vote) => {
    if (vote.stance === 'bullish') return sum + vote.probability * vote.weight
    if (vote.stance === 'bearish') return sum + (1 - vote.probability) * vote.weight
    return sum + 0.5 * vote.weight
  }, 0) / totalWeight
  const bearProbability = votes.reduce((sum, vote) => {
    if (vote.stance === 'bearish') return sum + vote.probability * vote.weight
    if (vote.stance === 'bullish') return sum + (1 - vote.probability) * vote.weight
    return sum + 0.5 * vote.weight
  }, 0) / totalWeight
  const expectedMovePct = votes.reduce((sum, vote) => sum + vote.forecastPct * vote.weight, 0) / totalWeight
  const confidence = Math.max(bullProbability, bearProbability)
  const direction: ForecastDirection =
    Math.abs(bullProbability - bearProbability) < 0.07 || confidence < 0.54
      ? 'neutral'
      : bullProbability > bearProbability
        ? 'bullish'
        : 'bearish'
  const current = bars[bars.length - 1]
  const currentPrice = current?.close ?? 0
  const oneSigmaPct = (current?.rollingVol ?? 0.01) * Math.sqrt(params.horizon) * 100
  const rangePad = oneSigmaPct * (0.75 + Math.max(0, 0.66 - confidence))
  const rangeLowPct = expectedMovePct - rangePad
  const rangeHighPct = expectedMovePct + rangePad
  const signed = direction === 'bullish' ? 1 : direction === 'bearish' ? -1 : 0
  const targetPrice = signed === 0 ? null : currentPrice * (1 + signed * params.profitTake * (current?.rollingVol ?? 0.01))
  const stopPrice = signed === 0 ? null : currentPrice * (1 - signed * params.stopLoss * (current?.rollingVol ?? 0.01))
  const action: ForecastAction =
    direction === 'neutral'
      ? 'stand-aside'
      : confidence >= Math.max(0.56, params.metaThreshold)
        ? direction === 'bullish'
          ? 'watch-long'
          : 'watch-short'
        : 'wait-for-confirmation'
  const blockers = [
    dataset.kind !== 'historical' ? 'Synthetic-only run. Load historical Alpaca bars before treating output as a forecast.' : '',
    metrics.trades < 30 ? 'Fewer than 30 holdout trades.' : '',
    comparison.alphaPct <= 0 ? 'Selected spec did not beat the benchmark.' : '',
    metrics.pbo > 0.05 ? 'Backtest-overfitting risk is above the 5% gate.' : '',
    metrics.dsr < 0.7 ? 'Deflated Sharpe ratio is below the credibility gate.' : '',
    audits.some((audit) => !audit.passed) ? 'Temporal leakage audit failed.' : '',
  ].filter(Boolean)
  const qualityScore = clamp(
    100 -
      blockers.length * 12 -
      Math.max(0, 30 - metrics.trades) * 0.7 -
      Math.max(0, metrics.pbo - 0.05) * 100 -
      Math.max(0, 0.7 - metrics.dsr) * 22 -
      (dataset.kind === 'synthetic' ? 18 : 0),
    0,
    100,
  )
  const qualityLabel: PredictionDashboard['qualityLabel'] =
    blockers.length >= 3 || qualityScore < 45
      ? 'blocked'
      : comparison.statisticallyCredible && confidence >= Math.max(0.56, params.metaThreshold)
        ? 'candidate-watch'
        : 'research-only'

  return {
    forecast: {
      asOfDate: current?.date ?? '',
      horizonDays: params.horizon,
      currentPrice,
      direction,
      action,
      confidence,
      bullProbability,
      bearProbability,
      expectedMovePct,
      expectedPrice: currentPrice * (1 + expectedMovePct / 100),
      targetPrice,
      stopPrice,
      rangeLowPrice: currentPrice * (1 + rangeLowPct / 100),
      rangeHighPrice: currentPrice * (1 + rangeHighPct / 100),
      rangeLowPct,
      rangeHighPct,
      votes,
      rationale:
        direction === 'neutral'
          ? 'The ensemble is not separated enough to justify a directional call.'
          : `${direction === 'bullish' ? 'Upside' : 'Downside'} probability leads by ${Math.abs(bullProbability - bearProbability).toFixed(2)} with ${votes.length} model votes.`,
    },
    qualityScore,
    qualityLabel,
    blockers,
    repoInfluences: PUBLIC_REPO_INFLUENCES,
  }
}

function buildAlphaAttribution(trades: TradeLedgerEntry[]): AlphaAttribution {
  const byAlpha = [...trades].sort((left, right) => right.alphaContributionPct - left.alphaContributionPct)
  const topAlphaTrades = byAlpha.slice(0, 5)
  const worstTrades = [...trades].sort((left, right) => left.alphaContributionPct - right.alphaContributionPct).slice(0, 5)
  const positiveAlpha = trades.reduce((sum, trade) => sum + Math.max(0, trade.alphaContributionPct), 0)
  const top1AlphaShare = positiveAlpha > 0 ? Math.max(0, byAlpha[0]?.alphaContributionPct ?? 0) / positiveAlpha : 0
  const top3AlphaShare = positiveAlpha > 0
    ? byAlpha.slice(0, 3).reduce((sum, trade) => sum + Math.max(0, trade.alphaContributionPct), 0) / positiveAlpha
    : 0
  const longAlphaPct = trades
    .filter((trade) => trade.side === 'long')
    .reduce((sum, trade) => sum + trade.alphaContributionPct, 0)
  const shortAlphaPct = trades
    .filter((trade) => trade.side === 'short')
    .reduce((sum, trade) => sum + trade.alphaContributionPct, 0)
  const alphaByRegime = (['uptrend', 'downtrend', 'choppy'] as const).map((label) => {
    const regimeTrades = trades.filter((trade) => trade.marketRegime === label)
    return {
      label,
      alphaPct: regimeTrades.reduce((sum, trade) => sum + trade.alphaContributionPct, 0),
      trades: regimeTrades.length,
    }
  })
  const concentrationWarning =
    top1AlphaShare >= 0.5
      ? 'More than half of positive alpha came from one trade.'
      : top3AlphaShare >= 0.75
        ? 'More than 75% of positive alpha came from the top three trades.'
        : null

  return {
    topAlphaTrades,
    worstTrades,
    top1AlphaShare,
    top3AlphaShare,
    longAlphaPct,
    shortAlphaPct,
    alphaByRegime,
    concentrationWarning,
    alphaWhileInvestedPct: 0,
    alphaWhileInCashPct: 0,
    cashDragPct: 0,
  }
}

type DailyEquityContext = {
  bars: PriceBar[]
  tradeLedger: TradeLedgerEntry[]
  params: PipelineParams
  startIndex: number
}

function buildDailyEquity(ctx: DailyEquityContext): ChartPoint[] {
  const { bars, tradeLedger, params, startIndex } = ctx
  const safeStart = clamp(Math.round(startIndex), 0, Math.max(0, bars.length - 1))
  const points: ChartPoint[] = []
  let accountValue = 1
  let realizedSoFar = 1

  const tradeByDay = new Map<number, TradeLedgerEntry>()
  for (const trade of tradeLedger) {
    for (let d = trade.entryIndex; d <= Math.min(trade.exitIndex, bars.length - 1); d++) {
      tradeByDay.set(d, trade)
    }
  }

  for (let day = safeStart; day < bars.length; day++) {
    const trade = tradeByDay.get(day)
    if (trade) {
      const entryClose = trade.entryPrice
      if (entryClose <= 0) {
        points.push({ x: day, y: compoundedReturnPct(accountValue) })
        continue
      }
      if (day === trade.exitIndex) {
        const netPnlR = trade.pnlR
        accountValue = realizedSoFar * (1 + netPnlR * params.riskPerTradePct / 100)
        realizedSoFar = accountValue
      } else {
        const currentClose = bars[day].close
        const priceMove = (currentClose - entryClose) / entryClose
        const side = trade.side === 'long' ? 1 : -1
        const directedMove = side * priceMove
        const volatility = bars[trade.entryIndex]?.rollingVol ?? 0.01
        const stopDistance = Math.max(0.001, volatility * params.stopLoss)
        const unrealizedR = clamp(directedMove / stopDistance, -params.stopLoss, params.profitTake)
        const netUnrealizedR = unrealizedR - 0.04
        accountValue = realizedSoFar * (1 + netUnrealizedR * params.riskPerTradePct / 100)
      }
    } else {
      accountValue = realizedSoFar
    }
    points.push({ x: day, y: compoundedReturnPct(accountValue) })
  }
  return points
}

function dailyReturnsFromEquity(equity: ChartPoint[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < equity.length; i++) {
    returns.push(equity[i].y - equity[i - 1].y)
  }
  return returns
}

function computeCashAttribution(
  dailyEquity: ChartPoint[],
  benchmarkBars: PriceBar[],
  tradeLedger: TradeLedgerEntry[],
) {
  const investedDays = new Set<number>()
  for (const trade of tradeLedger) {
    for (let d = trade.entryIndex; d <= trade.exitIndex; d++) {
      investedDays.add(d)
    }
  }

  let strategyInvested = 0
  let benchmarkInvested = 0
  let benchmarkCash = 0

  for (let i = 1; i < dailyEquity.length; i++) {
    const day = dailyEquity[i].x
    const stratReturn = dailyEquity[i].y - dailyEquity[i - 1].y
    const benchClose = benchmarkBars[day]?.close ?? 0
    const prevDay = dailyEquity[i - 1].x
    const prevBenchClose = benchmarkBars[prevDay]?.close ?? benchClose
    const benchReturn = prevBenchClose > 0 ? ((benchClose / prevBenchClose) - 1) * 100 : 0

    if (investedDays.has(day)) {
      strategyInvested += stratReturn
      benchmarkInvested += benchReturn
    } else {
      benchmarkCash += benchReturn
    }
  }

  return {
    alphaWhileInvestedPct: strategyInvested - benchmarkInvested,
    cashDragPct: benchmarkCash,
    alphaWhileInCashPct: -benchmarkCash,
  }
}

function pushEquityPoint(points: ChartPoint[], x: number, y: number) {
  const last = points[points.length - 1]
  if (last?.x === x) {
    last.y = y
    return
  }
  points.push({ x, y })
}

function markExposure(exposure: number[], startIndex: number, endIndex: number, side: -1 | 1) {
  for (let index = Math.max(0, startIndex); index <= Math.min(exposure.length - 1, endIndex); index++) {
    exposure[index] += side
  }
}

function sharpeRatio(values: number[]) {
  const sd = std(values)
  if (values.length < 2 || sd === 0) return 0
  return (mean(values) / sd) * Math.sqrt(Math.min(252, Math.max(12, values.length)))
}

function maxDrawdown(equity: ChartPoint[]) {
  let peak = equity[0]?.y ?? 0
  let maxDd = 0
  for (const point of equity) {
    peak = Math.max(peak, point.y)
    maxDd = Math.max(maxDd, peak - point.y)
  }
  return maxDd
}

function probabilisticSharpeRatio(returns: number[], srReference: number) {
  if (returns.length < 8) return 0.5
  const sr = sharpeRatio(returns)
  const skewness = skew(returns)
  const kurt = Math.max(kurtosis(returns), 1.01)
  const denominator = Math.sqrt(Math.max(1e-6, 1 - skewness * sr + ((kurt - 1) / 4) * sr * sr))
  return normalCdf(((sr - srReference) * Math.sqrt(returns.length - 1)) / denominator)
}

function hacTStat(returns: number[]) {
  if (returns.length < 8) return 0
  const avg = mean(returns)
  const centered = returns.map((value) => value - avg)
  const maxLag = Math.min(5, Math.floor(returns.length / 3))
  let longRunVariance = mean(centered.map((value) => value * value))
  for (let lag = 1; lag <= maxLag; lag++) {
    let covariance = 0
    for (let i = lag; i < centered.length; i++) {
      covariance += centered[i] * centered[i - lag]
    }
    covariance /= centered.length
    longRunVariance += 2 * (1 - lag / (maxLag + 1)) * covariance
  }
  return longRunVariance <= 0 ? 0 : avg / Math.sqrt(longRunVariance / returns.length)
}

function benchmarkCurve(bars: PriceBar[], startIndex = 0) {
  const safeStart = clamp(Math.round(startIndex), 0, Math.max(0, bars.length - 1))
  const points: ChartPoint[] = [{ x: safeStart, y: 0 }]
  const start = bars[safeStart]?.close ?? 1
  const step = Math.max(1, Math.floor((bars.length - safeStart) / 140))
  for (let i = safeStart + 1; i < bars.length; i += step) {
    points.push({ x: i, y: (bars[i].close / start - 1) * 100 })
  }
  const lastIndex = bars.length - 1
  if (lastIndex > 0 && points[points.length - 1]?.x !== lastIndex) {
    points.push({ x: lastIndex, y: (bars[lastIndex].close / start - 1) * 100 })
  }
  return points
}

export function assertNoTemporalLeakage(events: LabeledEvent[], splits: Array<FoldWindow & { train: number[]; test: number[] }>, params: PipelineParams): LeakageAudit[] {
  let overlapCount = 0
  let embargoBreaks = 0
  let groupBreaks = 0

  for (const split of splits) {
    const testSet = new Set(split.test)
    for (const trainIndex of split.train) {
      const trainEvent = events[trainIndex]
      const overlaps = trainEvent.dayIndex <= split.testEnd && trainEvent.endIndex >= split.testStart
      if (overlaps) overlapCount++
      if (trainEvent.dayIndex > split.testEnd && trainEvent.dayIndex <= split.embargoUntil) embargoBreaks++
      if (testSet.has(trainIndex)) groupBreaks++
    }
  }

  return [
    {
      name: 'assert_no_temporal_leakage',
      passed: overlapCount === 0,
      detail: overlapCount === 0 ? 'No training label horizon overlaps a test window.' : `${overlapCount} overlapping labels found.`,
    },
    {
      name: 'assert_embargo_respected',
      passed: embargoBreaks === 0,
      detail:
        embargoBreaks === 0
          ? `${params.embargoPct}% post-test embargo removed adjacent training events.`
          : `${embargoBreaks} embargo violations found.`,
    },
    {
      name: 'assert_groups_disjoint',
      passed: groupBreaks === 0,
      detail: groupBreaks === 0 ? 'Train and test event groups are disjoint in every fold.' : `${groupBreaks} group collisions found.`,
    },
  ]
}

function runPipeline(
  params: PipelineParams,
  bars: PriceBar[],
  benchmarkBars: PriceBar[],
  dataset: DatasetMeta,
  evaluationStartIndex?: number,
): PipelineResult {
  const eventDays = generateCusumEvents(bars, params.cusumThreshold)
  const events = buildTripleBarrierLabels(params, bars, eventDays)
  const evaluationStart = evaluationStartIndex === undefined
    ? undefined
    : clamp(Math.round(evaluationStartIndex), 40, Math.max(40, bars.length - 20))
  const splits = evaluationStart === undefined
    ? buildPurgedEmbargoedSplits(events, params)
    : (() => {
        const train = events.flatMap((event, index) => event.endIndex < evaluationStart ? [index] : [])
        const test = events.flatMap((event, index) => event.dayIndex >= evaluationStart ? [index] : [])
        return train.length > 8 && test.length > 0
          ? [{
              fold: 1,
              testStart: evaluationStart,
              testEnd: bars.length - 1,
              embargoUntil: bars.length - 1,
              trainCount: train.length,
              testCount: test.length,
              train,
              test,
            }]
          : []
      })()
  const folds: FoldResult[] = []
  const returns: number[] = []
  const equity: ChartPoint[] = [{ x: evaluationStart ?? 0, y: 0 }]
  const tradeLedger: TradeLedgerEntry[] = []
  const exposureByDay = Array.from({ length: bars.length }, () => 0)
  const featureTotals = emptyFeatureRecord(0)
  let netAccountValue = 1
  let grossAccountValue = 1
  let trades = 0
  let wins = 0
  let testedEvents = 0
  let pboBadFolds = 0
  let skippedOverlapEvents = 0
  let openUntil = (evaluationStart ?? 0) - 1

  for (const split of splits) {
    const model = trainMetaModel(events, split.train)
    const foldReturns: number[] = []
    const foldEquity: ChartPoint[] = [{ x: split.testStart, y: 0 }]
    let foldCumulativeR = 0
    let foldAccountValue = 1
    let foldTrades = 0
    let foldWins = 0
    const trainReturns = split.train.map((index) => accountReturnPct(eventReturnR(events[index], params), params))

    for (const testIndex of split.test) {
      testedEvents++
      const event = events[testIndex]
      const probability = metaProbability(model, event)
      if (probability >= params.metaThreshold) {
        if (event.dayIndex <= openUntil) {
          skippedOverlapEvents++
          continue
        }
        const grossPnlR = eventReturnR(event, params)
        const netPnlR = grossPnlR - 0.04
        const netReturnPct = accountReturnPct(netPnlR, params)
        const grossReturnPct = accountReturnPct(grossPnlR, params)
        const benchmarkPct = benchmarkHoldingReturnPct(benchmarkBars, event.dayIndex, event.endIndex)
        pushEquityPoint(equity, event.dayIndex, compoundedReturnPct(netAccountValue))
        pushEquityPoint(foldEquity, event.dayIndex, compoundedReturnPct(foldAccountValue))
        returns.push(netReturnPct)
        foldReturns.push(netReturnPct)
        foldCumulativeR += netPnlR
        netAccountValue *= 1 + netReturnPct / 100
        grossAccountValue *= 1 + grossReturnPct / 100
        foldAccountValue *= 1 + netReturnPct / 100
        openUntil = event.endIndex
        markExposure(exposureByDay, event.dayIndex, event.endIndex, event.side)
        trades++
        foldTrades++
        if (netPnlR > 0) {
          wins++
          foldWins++
        }
        tradeLedger.push({
          id: event.id,
          fold: split.fold,
          entryIndex: event.dayIndex,
          exitIndex: event.endIndex,
          entryDate: event.date,
          exitDate: bars[event.endIndex]?.date ?? event.date,
          side: event.side === 1 ? 'long' : 'short',
          entryPrice: bars[event.dayIndex]?.close ?? 0,
          exitPrice: bars[event.endIndex]?.close ?? 0,
          signalProbability: probability,
          exitReason: exitReason(event),
          pnlR: netPnlR,
          accountPnlPct: netReturnPct,
          benchmarkPct,
          alphaContributionPct: netReturnPct - benchmarkPct,
          features: event.features,
          marketRegime: marketRegime(event),
        })
        for (const key of FEATURE_KEYS) {
          featureTotals[key] += Math.abs(model.weights[key])
        }
        pushEquityPoint(equity, event.endIndex, compoundedReturnPct(netAccountValue))
        pushEquityPoint(foldEquity, event.endIndex, compoundedReturnPct(foldAccountValue))
      }
    }

    const trainSharpe = sharpeRatio(trainReturns)
    const testSharpe = sharpeRatio(foldReturns)
    if (trainSharpe > 0 && testSharpe < 0) pboBadFolds++
    const foldTradeLedger = tradeLedger.filter((t) => t.fold === split.fold)
    const foldDailyEquity = buildDailyEquity({
      bars,
      tradeLedger: foldTradeLedger,
      params,
      startIndex: split.testStart,
    })
    folds.push({
      ...split,
      trades: foldTrades,
      wins: foldWins,
      trainSharpe,
      testSharpe,
      pnlR: foldCumulativeR,
      pnlPct: compoundedReturnPct(foldAccountValue),
      hitRate: foldTrades ? foldWins / foldTrades : 0,
      equity: foldDailyEquity,
    })
  }

  const sortedFeatureTotals = FEATURE_KEYS.map((key) => ({ key, value: featureTotals[key] })).sort((a, b) => b.value - a.value)
  const sr = sharpeRatio(returns)
  const psr = probabilisticSharpeRatio(returns, 0)
  const dsrReference = returns.length > 3 ? Math.sqrt(2 * Math.log(Math.max(2, params.folds * 3))) / Math.sqrt(returns.length) : 0
  const dsr = probabilisticSharpeRatio(returns, dsrReference)
  const dailyEquity = buildDailyEquity({ bars, tradeLedger, params, startIndex: evaluationStart ?? 0 })
  const dailyReturns = dailyReturnsFromEquity(dailyEquity)
  const dailySd = std(dailyReturns)
  const portfolioSharpe = dailyReturns.length >= 2 && dailySd > 0
    ? (mean(dailyReturns) / dailySd) * Math.sqrt(252)
    : 0
  const dailyVolatility = dailySd * Math.sqrt(252)
  const maxDrawdownPct = maxDrawdown(dailyEquity)
  const strategyNetPct = compoundedReturnPct(netAccountValue)
  const strategyGrossPct = compoundedReturnPct(grossAccountValue)
  const benchmarkStart = evaluationStart ?? 0
  const exposureStart = clamp(benchmarkStart, 0, Math.max(0, bars.length - 1))
  const exposureWindow = exposureByDay.slice(exposureStart)
  const exposureDays = Math.max(1, exposureWindow.length)
  const inMarketDays = exposureWindow.filter((value) => value !== 0).length
  const longExposureDays = exposureWindow.filter((value) => value > 0).length
  const shortExposureDays = exposureWindow.filter((value) => value < 0).length
  const averageHoldingDays = tradeLedger.length
    ? mean(tradeLedger.map((trade) => Math.max(0, trade.exitIndex - trade.entryIndex)))
    : 0
  const timeInMarketPct = (inMarketDays / exposureDays) * 100
  const longExposurePct = (longExposureDays / exposureDays) * 100
  const shortExposurePct = (shortExposureDays / exposureDays) * 100
  const labelCounts = events.reduce(
    (counts, event) => {
      if (event.label === 1) counts.profit += 1
      if (event.label === -1) counts.loss += 1
      if (event.label === 0) counts.timeout += 1
      return counts
    },
    { profit: 0, loss: 0, timeout: 0 },
  )
  const metrics: PredictionMetrics = {
    psr,
    dsr,
    sharpe: sr,
    maxDrawdownR: maxDrawdownPct,
    maxDrawdownPct,
    calmar: maxDrawdownPct > 0 ? strategyNetPct / maxDrawdownPct : strategyNetPct,
    hitRate: trades ? wins / trades : 0,
    turnover: testedEvents ? trades / testedEvents : 0,
    pbo: folds.length ? pboBadFolds / folds.length : 0,
    hacT: hacTStat(returns),
    trades,
    events: events.length,
    timeInMarketPct,
    cashTimePct: Math.max(0, 100 - timeInMarketPct),
    averageHoldingDays,
    maxSimultaneousTrades: exposureWindow.reduce((maxOpen, value) => Math.max(maxOpen, Math.abs(value)), 0),
    longExposurePct,
    shortExposurePct,
    skippedOverlapEvents,
    portfolioSharpe,
    dailyVolatility,
  }
  const audits = assertNoTemporalLeakage(events, splits, params)
  const benchmark = benchmarkCurve(benchmarkBars, benchmarkStart)
  const benchmarkPct = benchmark[benchmark.length - 1]?.y ?? 0
  const costDragPct = strategyGrossPct - strategyNetPct
  const foldBeatRate = folds.length
    ? folds.filter((fold) => {
        const start = benchmarkBars[fold.testStart]?.close ?? 1
        const end = benchmarkBars[fold.testEnd]?.close ?? start
        const foldBenchmarkPct = (end / start - 1) * 100
        return fold.pnlPct > foldBenchmarkPct
      }).length / folds.length
    : 0
  const statisticallyCredible =
    strategyNetPct > benchmarkPct &&
    trades >= 30 &&
    metrics.hacT > 2 &&
    metrics.pbo <= 0.05 &&
    metrics.dsr >= 0.7 &&
    foldBeatRate >= 0.6 &&
    audits.every((audit) => audit.passed)
  const comparison: MarketComparison = {
    strategyNetPct,
    strategyGrossPct,
    benchmarkPct,
    alphaPct: strategyNetPct - benchmarkPct,
    costDragPct,
    beatMarket: strategyNetPct > benchmarkPct,
    foldBeatRate,
    statisticallyCredible,
    verdict: strategyNetPct <= benchmarkPct ? 'underperformed' : statisticallyCredible ? 'credible-outperformance' : 'outperformed-not-proven',
  }
  const attribution = buildAlphaAttribution(tradeLedger)
  const cashAttr = computeCashAttribution(dailyEquity, benchmarkBars, tradeLedger)
  attribution.alphaWhileInvestedPct = cashAttr.alphaWhileInvestedPct
  attribution.alphaWhileInCashPct = cashAttr.alphaWhileInCashPct
  attribution.cashDragPct = cashAttr.cashDragPct
  const dashboard = buildPredictionDashboard(params, bars, events, metrics, comparison, audits, dataset)

  return {
    params,
    bars,
    events,
    folds,
    tradeLedger,
    attribution,
    metrics,
    audits,
    equity: dailyEquity,
    benchmark,
    labelCounts,
    featureImportance: sortedFeatureTotals,
    sourceChecklist: [
      {
        label: 'Daily EOD OHLCV',
        status: 'mvp',
        detail: dataset.kind === 'historical'
          ? `${dataset.observations} adjusted daily observations loaded from ${dataset.provider}.`
          : 'Prototype uses deterministic local bars. Replace with point-in-time historical ingestion for serious research.',
      },
      {
        label: 'Point-in-time universe',
        status: 'needed',
        detail: 'Add survivor-bias-free security master data before claiming historical edge.',
      },
      {
        label: 'News and fundamentals',
        status: 'later',
        detail: 'Add EDGAR topics, filings, fundamentals, and sentiment only with timestamps known at prediction time.',
      },
      {
        label: 'TAQ / order flow',
        status: 'later',
        detail: 'Add dollar bars, VPIN, and imbalance bars when a trade/quote feed is available.',
      },
    ],
    modelNotes: [
      'CUSUM samples events from volatility-scaled price movement instead of every fixed day.',
      'Triple-barrier labels use profit, stop, and timeout paths, so stop-loss breaches are not hidden.',
      'The meta-model is trained inside each fold using training-only normalization and feature weights.',
      'Purging removes overlapping label horizons; embargo removes the immediate post-test buffer.',
      'Account equity is marked to market daily. Open positions fluctuate with the underlying close-to-close move, clamped by the barrier distance.',
      'Overlapping same-symbol signals are skipped while a position is open.',
      'Trade Sharpe uses per-trade returns. Portfolio Sharpe uses daily account value changes including cash days.',
      'This is research software and not financial advice or a live trading signal.',
    ],
    intake: buildResearchIntakeSnapshot(metrics, audits),
    comparison,
    dataset,
    dashboard,
  }
}

export function runStockPredictionPipeline(input: Partial<PipelineParams> = {}): PipelineResult {
  const params = { ...DEFAULT_PIPELINE_PARAMS, ...input }
  const bars = generatePrototypeBars(params)
  return runPipeline(params, bars, bars, {
    kind: 'synthetic',
    provider: 'Deterministic local prototype',
    benchmark: params.ticker,
    startDate: bars[0]?.date ?? '',
    endDate: bars[bars.length - 1]?.date ?? '',
    observations: bars.length,
  })
}

export function runStockPredictionPipelineOnHistoricalBars(
  input: Partial<PipelineParams>,
  targetRows: HistoricalBarInput[],
  benchmarkRows: HistoricalBarInput[],
  datasetInput: Pick<DatasetMeta, 'provider' | 'benchmark'>,
  evaluationStartIndex?: number,
): PipelineResult {
  const normalized = normalizeHistoricalBars(targetRows, benchmarkRows)
  if (normalized.bars.length < 160) throw new Error('At least 160 aligned daily observations are required.')
  const params: PipelineParams = {
    ...DEFAULT_PIPELINE_PARAMS,
    ...input,
    days: normalized.bars.length,
    regime: 'balanced',
    seed: DEFAULT_PIPELINE_PARAMS.seed,
  }
  const dataset: DatasetMeta = {
    kind: 'historical',
    provider: datasetInput.provider,
    benchmark: datasetInput.benchmark,
    startDate: normalized.bars[0]?.date ?? '',
    endDate: normalized.bars[normalized.bars.length - 1]?.date ?? '',
    observations: normalized.bars.length,
  }
  return runPipeline(params, normalized.bars, normalized.benchmarkBars, dataset, evaluationStartIndex)
}

function percentile(sorted: number[], fraction: number) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return sorted[index]
}

export function runRobustnessSimulation(input: Partial<PipelineParams> = {}, runs = 50): RobustnessSummary {
  const baseSeed = input.seed ?? DEFAULT_PIPELINE_PARAMS.seed
  const results = Array.from({ length: runs }, (_, index) =>
    runStockPredictionPipeline({ ...input, seed: baseSeed + index * 17 }),
  )
  const alphas = results.map((result) => result.comparison.alphaPct).sort((a, b) => a - b)
  const strategyReturns = results.map((result) => result.comparison.strategyNetPct).sort((a, b) => a - b)
  const benchmarkReturns = results.map((result) => result.comparison.benchmarkPct).sort((a, b) => a - b)
  return {
    runs,
    beatMarketRate: results.filter((result) => result.comparison.beatMarket).length / runs,
    credibleRate: results.filter((result) => result.comparison.statisticallyCredible).length / runs,
    medianAlphaPct: percentile(alphas, 0.5),
    p05AlphaPct: percentile(alphas, 0.05),
    p95AlphaPct: percentile(alphas, 0.95),
    medianStrategyPct: percentile(strategyReturns, 0.5),
    medianBenchmarkPct: percentile(benchmarkReturns, 0.5),
    alphas,
  }
}
