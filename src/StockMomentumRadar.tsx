import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Counter, Reveal } from './motion'
import {
  Activity,
  Bell,
  BellRing,
  AlertTriangle,
  Bot,
  CalendarDays,
  Check,
  Coins,
  Database,
  Eye,
  ExternalLink,
  Filter,
  Flame,
  Gauge,
  Layers,
  LineChart,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Square,
  Sun,
  Target,
  TrendingUp,
  Volume2,
  VolumeX,
  Wallet,
  X,
  Zap,
  Clock,
  Sparkles,
} from 'lucide-react'
import { StockAssistantPanel } from './StockAssistantPanel'
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LastPriceAnimationMode,
  LineStyle,
  createChart,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  stockCapBand,
  type MomentumCandidate,
  type MomentumSnapshot,
  type MomentumStatus,
  type SignalPhase,
  type SignalStability,
  type StockCapBand,
} from './momentumCore'

export type RadarAlert = {
  id: string
  ticker: string
  message: string
  status: MomentumStatus
  price: number
  entry: number | null
  stop: number | null
  target1: number | null
  target2: number | null
  risk: number | null
  movePct: number | null
  validUntil: number
}

type RadarView = 'signals' | 'bot' | 'assistant'
type RadarTheme = 'dark' | 'light'

type AssetFilter = 'all' | 'stock' | 'crypto'
type CapFilter = 'all' | StockCapBand
const BOT_CONTROL_HEADERS = { accept: 'application/json', 'x-dawn-control': 'local' }

type MomentumLiveResponse =
  | {
      ok: true
      generatedAt: string
      nextLiveSeconds: number
      candidates: MomentumCandidate[]
    }
  | { ok: false; error?: string }

type BotPosition = {
  symbol: string
  displaySymbol: string
  assetClass: 'stock' | 'crypto'
  venue: 'alpaca' | 'binance'
  side: string
  qty: number
  avgEntry: number
  currentPrice: number
  marketValue: number
  unrealizedPl: number
  unrealizedPlPct: number
  stop: number | null
  target1: number | null
  target2: number | null
}

type BotOrder = {
  id: string
  symbol: string
  venue: 'alpaca' | 'binance'
  side: string
  qty: number | null
  notional: number | null
  type: string
  status: string
  filledAvgPrice: number | null
  submittedAt: string | null
}

type EquityPoint = {
  t: string
  equity: number
  cash: number
}

type BotMacroEvent = {
  label: string
  at: string
  minutesUntil: number
  active: boolean
}

type BotAccount = {
  cash: number
  equity: number
  buyingPower: number
  currency: string
}

type BotLogEntry = {
  id: string
  time: string
  level: 'buy' | 'sell' | 'skip' | 'info' | 'error'
  symbol: string
  message: string
}

type BotHistoryEntry = {
  id: string
  time: string
  orderId?: string | null
  symbol: string
  side: 'buy' | 'sell'
  reason: string
  qty: number | null
  notional: number | null
  price: number | null
  pnl: number | null
  pnlPct: number | null
  outcome: 'open' | 'win' | 'loss' | 'flat'
  mode: BotMode
  holdSeconds?: number | null
  setup?: BotTradeSetup | null
  // How far the trade ran in our favor (MFE) / against us (MAE) before close, in R.
  maxFavorableR?: number | null
  maxAdverseR?: number | null
}

type BotStats = {
  wins: number
  losses: number
  flats: number
  closedTrades: number
  realizedPl: number
}

type BotTradeSetup = {
  assetClass: 'stock' | 'crypto'
  venue: 'alpaca' | 'binance'
  entryMode: string
  score: number
  status: MomentumStatus
  aboveVwap: boolean
  volumePulse: number | null
  quoteVolume: number | null
  relativeVolume: number
  timeAdjustedRelativeVolume: number | null
  distanceFromHighPct: number
  changePct: number
  vwapExtensionPct: number | null
  spreadPct: number
  floatTurnover: number | null
  microPullbackState: 'NONE' | 'FORMING' | 'READY' | 'FAILED' | 'EXTENDED' | null
  microPullbackScore: number | null
  supportDistancePct: number | null
  resistanceDistancePct: number | null
  microTapeOneMinuteMovePct: number | null
  microTapePulse: number | null
  trigger: number
  stop: number
  target1: number
  target2: number
  riskPct: number
  technical: BotTechnicalContext | null
}

type BotSetupMemoryEntry = {
  key: string
  label: string
  assetClass: 'stock' | 'crypto'
  trades: number
  wins: number
  losses: number
  flats: number
  winRate: number | null
  realizedPl: number
  netRealizedPl: number
  avgPnl: number
  netAvgPnl: number
  estimatedCost: number
  lastUpdated: string | null
  lastOutcome: 'win' | 'loss' | 'flat' | null
}

type BotDiagnosticBucket = {
  key: string
  label: string
  trades: number
  wins: number
  losses: number
  flats: number
  realizedPl: number
  avgPnl: number
}

type BotDiagnostics = {
  mode: BotMode
  closedTrades: number
  winRate: number | null
  realizedPl: number
  avgPnl: number | null
  avgWin: number | null
  avgLoss: number | null
  profitFactor: number | null
  expectancy: number | null
  costModeled: boolean
  estimatedCost: number
  netRealizedPl: number
  netExpectancy: number | null
  netProfitFactor: number | null
  byExitReason: BotDiagnosticBucket[]
  bySetup: BotDiagnosticBucket[]
  notes: string[]
}

type BotTechnicalContext = {
  trendScore: number
  trendLabel: 'strong-uptrend' | 'uptrend' | 'mixed' | 'weak'
  fibZone: string
  fibRetracementPct: number | null
  fibNearestLevel: number | null
  edgeScore: number
  notes: string[]
}

type BotModeComparison = {
  mode: BotMode
  label: string
  riskLabel: string
  minScore: number
  reversionMinScore?: number
  maxPositions: number
  sizeMultiplier: number
  ready: number
  armed: number
  blocked: number
  top: {
    symbol: string
    assetClass: 'stock' | 'crypto'
    score: number
    price: number
    state: 'ready' | 'armed' | 'blocked' | 'holding'
    reason: string
    technical: BotTechnicalContext
  } | null
  diagnostics: BotDiagnostics
}

export type BotState = {
  ok: true
  configured: boolean
  running: boolean
  draining: boolean
  startedAt: string | null
  lastTickAt: string | null
  lastError: string | null
  account: BotAccount | null
  positions: BotPosition[]
  orders: BotOrder[]
  log: BotLogEntry[]
  history: BotHistoryEntry[]
  stats: BotStats
  diagnostics: BotDiagnostics
  armed: number
  triggered: number
  tradingBase: string
  cryptoVenue: 'alpaca' | 'binance'
  cryptoVenueLabel: string
  mode: BotMode
  modeLabel: string
  minScore: number
  reversionMinScore?: number
  riskLabel: string
  maxPositions: number
  sizeMultiplier: number
  riskPause: string | null
  watch: BotWatchEntry[]
  comparisons: BotModeComparison[]
  equitySeries: EquityPoint[]
  setupMemory: BotSetupMemoryEntry[]
  macroEvents?: BotMacroEvent[]
}

type BotMode = 'safe' | 'active' | 'turbo'
type BotStopMode = 'immediate' | 'drain'

type BotWatchEntry = {
  symbol: string
  assetClass: 'stock' | 'crypto'
  strategy?: 'momentum' | 'reversion'
  score: number
  scoreFloor?: number
  status: MomentumStatus
  price: number
  trigger: number | null
  state: 'holding' | 'triggered' | 'cooldown' | 'armed' | 'blocked'
  note: string
  waitingFor?: string
  nextCheck?: string
  tradePlan?: {
    buy: number
    stop: number
    target1: number
    target2: number
  } | null
  technical?: BotTechnicalContext
  holding?: {
    qty: number
    marketValue: number
    unrealizedPl: number
    unrealizedPlPct: number
  } | null
}

const PAPER_BOT_POLL_MS = 10_000
// Keep the trade-journal calendar compact instead of letting hundreds of rows pile up.
const JOURNAL_MAX_DAYS = 4
const JOURNAL_MAX_PER_DAY = 6
const PAPER_BOT_MIN_SCORE = 72
const ALLOWED_PAPER_BOT_RISK_BLOCKERS = new Set([
  'confirmation volume below 3M',
  'confirmation relVol below 3x',
  'not close enough to high',
  '4h momentum not strong enough',
  'not close enough to 24h high',
])

const statusLabels: Record<MomentumStatus, string> = {
  IGNORE: 'Ignore',
  WATCH: 'Watch',
  'CHECK NOW': 'Confirmed',
  'DATA ERROR': 'Data error',
}

const stockCapLabels: Record<StockCapBand, string> = {
  'micro-small': 'Small cap',
  mid: 'Mid cap',
  large: 'Big cap',
  unknown: 'Cap pending',
}

const capFilterLabels: Record<CapFilter, string> = {
  all: 'Any cap',
  'micro-small': 'Small',
  mid: 'Mid',
  large: 'Big',
  unknown: 'Unknown',
}

const capFilterNouns: Record<CapFilter, string> = {
  all: 'stock',
  'micro-small': 'small-cap stock',
  mid: 'mid-cap stock',
  large: 'big-cap stock',
  unknown: 'cap-pending stock',
}

const LIVE_BOT_ORDER_STATUSES = new Set([
  'accepted',
  'accepted_for_bidding',
  'held',
  'new',
  'partially_filled',
  'pending_cancel',
  'pending_new',
  'pending_replace',
])

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 6 : value >= 10 ? 2 : 3,
  }).format(value)
}

function matchesCapFilter(candidate: MomentumCandidate, capFilter: CapFilter) {
  if (capFilter === 'all') return true
  return candidate.assetClass === 'stock' && stockCapBand(candidate) === capFilter
}

// Resolve a CSS color string (hex or rgb/rgba) to an rgba() string at the given
// alpha so the canvas gradient can reuse the theme tokens that are normally hex.
function colorWithAlpha(color: string, alpha: number) {
  const c = color.trim()
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((x) => x + x).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((x) => x.trim())
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return c
}

// Selectable look-back windows for the equity chart. `seconds: null` means
// "fit everything we have".
const EQUITY_RANGES = [
  { key: '15m', label: '15M', seconds: 15 * 60 },
  { key: '1h', label: '1H', seconds: 60 * 60 },
  { key: '4h', label: '4H', seconds: 4 * 60 * 60 },
  { key: '1d', label: '1D', seconds: 24 * 60 * 60 },
  { key: '1w', label: '1W', seconds: 7 * 24 * 60 * 60 },
  { key: 'all', label: 'ALL', seconds: null },
] as const

type EquityRangeKey = (typeof EQUITY_RANGES)[number]['key']

type PerfMetric = 'equity' | 'pnl'

// One Lightweight Charts canvas that toggles between two related-but-distinct
// performance curves (auto-scaling price/time axes, crosshair, animated
// last-price marker, draggable/zoomable look-back windows):
//   • ACCOUNT VALUE, equity (cash + open positions) sampled every tick; moves
//     on unrealized swings too.
//   • REALIZED P/L, cumulative profit from CLOSED trades only; steps only when
//     a trade books an exit.
function PaperBotPerformanceChart({
  series,
  history,
  account,
  netRealizedPl,
  theme,
}: {
  series: EquityPoint[]
  history: BotHistoryEntry[]
  account: BotAccount | null
  netRealizedPl?: number | null
  theme: RadarTheme
}) {
  const [metric, setMetric] = useState<PerfMetric>('equity')
  const [range, setRange] = useState<EquityRangeKey>('all')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  // --- Account value (equity) ------------------------------------------------
  const hasEquity = series.length >= 2
  const equityValues = hasEquity ? series.map((point) => point.equity) : []
  const eqMin = hasEquity ? Math.min(...equityValues) : 0
  const eqMax = hasEquity ? Math.max(...equityValues) : 0
  const eqFirst = hasEquity ? equityValues[0] : 0
  const eqLast = hasEquity ? equityValues[equityValues.length - 1] : 0
  const liveEquity = account?.equity ?? (hasEquity ? eqLast : null)
  const liveCash = account?.cash ?? (hasEquity ? series[series.length - 1].cash : null)
  const equityNow = liveEquity ?? (hasEquity ? eqLast : null)
  // True performance is the net realized P&L after modeled costs, NOT the
  // rolling chart window.
  const hasPnlNum = typeof netRealizedPl === 'number' && Number.isFinite(netRealizedPl)
  const realizedPnl = hasPnlNum ? (netRealizedPl as number) : eqLast - eqFirst
  const startingCapital = hasPnlNum ? (equityNow ?? 0) - realizedPnl : eqFirst
  const equityUp = realizedPnl >= 0
  const changePct = startingCapital > 0 ? (realizedPnl / startingCapital) * 100 : 0

  const equityData = useMemo<AreaData<UTCTimestamp>[]>(() => {
    if (series.length < 2) return []
    const byTime = new Map<number, number>()
    for (const point of series) {
      const ms = Date.parse(point.t)
      if (!Number.isFinite(ms)) continue
      byTime.set(Math.floor(ms / 1000), point.equity)
    }
    return Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
  }, [series])

  // --- Realized P/L (cumulative over closed trades) --------------------------
  const pnlInfo = useMemo(() => {
    const closed = history
      .filter((entry) => entry.side === 'sell' && entry.pnl !== null)
      .map((entry) => ({ t: Date.parse(entry.time), pnl: entry.pnl as number }))
      .filter((point) => Number.isFinite(point.t))
      .sort((a, b) => a.t - b.t)
    const byTime = new Map<number, number>()
    let cum = 0
    for (const point of closed) {
      cum += point.pnl
      byTime.set(Math.floor(point.t / 1000), cum)
    }
    const data: AreaData<UTCTimestamp>[] = Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
    const pnls = closed.map((point) => point.pnl)
    return {
      data,
      net: pnls.reduce((sum, value) => sum + value, 0),
      count: closed.length,
      wins: pnls.filter((value) => value > 0).length,
      losses: pnls.filter((value) => value < 0).length,
      best: pnls.length ? Math.max(...pnls) : 0,
      worst: pnls.length ? Math.min(...pnls) : 0,
    }
  }, [history])

  const activeData = metric === 'equity' ? equityData : pnlInfo.data
  const hasActive = activeData.length > 0
  const trendUp = metric === 'equity' ? equityUp : pnlInfo.net >= 0

  // Create the chart once and keep it mounted; data/theme are pushed via the
  // effects below so updates never tear the chart down.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Size explicitly from the laid-out container (reliable even before the
    // ResizeObserver fires), then keep it in sync on later resizes.
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        attributionLogo: false,
        fontFamily: getComputedStyle(el).fontFamily,
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.2, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { width: 1, style: LineStyle.Dashed, labelVisible: true },
        horzLine: { width: 1, style: LineStyle.Dashed, labelVisible: true },
      },
      // Pan with drag/wheel, zoom with wheel/pinch, keep the price axis locked
      // so the curve can't be dragged off vertically.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      localization: { priceFormatter: (price: number) => `$${price.toFixed(2)}` },
    })
    const areaSeries = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      lastPriceAnimation: LastPriceAnimationMode.Continuous,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    chartRef.current = chart
    seriesRef.current = areaSeries

    // Only re-apply when the box actually changed size, guards against a
    // resize→relayout→resize feedback loop.
    let lastW = el.clientWidth
    let lastH = el.clientHeight
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (width <= 0 || height <= 0) return
      if (width === lastW && height === lastH) return
      lastW = width
      lastH = height
      chart.applyOptions({ width, height })
    })
    resizeObserver.observe(el)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Re-read the radar theme tokens and recolor the chart (also re-runs when the
  // curve flips between profit/loss).
  useEffect(() => {
    const el = containerRef.current
    const chart = chartRef.current
    const areaSeries = seriesRef.current
    if (!el || !chart || !areaSeries) return
    const styles = getComputedStyle(el)
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    const text = token('--radar-text', '#14242a')
    const grid = token('--radar-grid', 'rgba(124, 77, 255, 0.08)')
    const accent = token('--radar-accent', '#7657ff')
    const trend = trendUp ? token('--radar-green', '#07966b') : token('--radar-red', '#ff5d73')
    chart.applyOptions({
      layout: { textColor: colorWithAlpha(text, 0.55) },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: {
        vertLine: { color: colorWithAlpha(accent, 0.45), labelBackgroundColor: accent },
        horzLine: { color: colorWithAlpha(accent, 0.45), labelBackgroundColor: accent },
      },
    })
    areaSeries.applyOptions({
      lineColor: trend,
      topColor: colorWithAlpha(trend, 0.3),
      bottomColor: colorWithAlpha(trend, 0),
    })
  }, [theme, trendUp])

  // Constrain the visible time axis to the selected look-back window (or fit
  // everything for "ALL").
  const applyRange = useCallback(
    (key: EquityRangeKey) => {
      const chart = chartRef.current
      if (!chart || activeData.length === 0) return
      const timeScale = chart.timeScale()
      const preset = EQUITY_RANGES.find((item) => item.key === key)
      if (!preset || preset.seconds === null) {
        timeScale.fitContent()
        return
      }
      const to = activeData[activeData.length - 1].time as number
      const earliest = activeData[0].time as number
      const from = Math.max(earliest, to - preset.seconds)
      if (from >= to) {
        timeScale.fitContent()
        return
      }
      timeScale.setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp })
    },
    [activeData],
  )

  // Push data, then (re)apply the active look-back window.
  useEffect(() => {
    seriesRef.current?.setData(activeData)
  }, [activeData])

  useEffect(() => {
    applyRange(range)
  }, [range, applyRange])

  return (
    <div className="paper-bot-equity">
      <div className="paper-bot-equity-head">
        <div className="paper-bot-perf-toggle" role="group" aria-label="Performance metric">
          <button
            type="button"
            className={metric === 'equity' ? 'active' : ''}
            aria-pressed={metric === 'equity'}
            onClick={() => setMetric('equity')}
          >
            <LineChart size={14} /> Account value
          </button>
          <button
            type="button"
            className={metric === 'pnl' ? 'active' : ''}
            aria-pressed={metric === 'pnl'}
            onClick={() => setMetric('pnl')}
          >
            P/L curve
          </button>
        </div>
        {metric === 'equity' ? (
          <span>
            Equity <b>{equityNow === null ? 'n/a' : formatMoney(equityNow)}</b>{' '}
            · {hasPnlNum ? 'Net P&L' : 'Window'}{' '}
            <b className={equityUp ? 'momentum-green' : 'momentum-red'}>
              {hasPnlNum ? `${realizedPnl >= 0 ? '+' : ''}${formatMoney(realizedPnl)} ` : ''}({changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}%)
            </b>{' '}
            · Cash <b>{liveCash === null ? 'n/a' : formatMoney(liveCash)}</b>
          </span>
        ) : (
          <span>
            Net realized{' '}
            <b className={pnlInfo.net >= 0 ? 'momentum-green' : 'momentum-red'}>
              {pnlInfo.net >= 0 ? '+' : ''}
              {formatMoney(pnlInfo.net)}
            </b>{' '}
            · {pnlInfo.count} {pnlInfo.count === 1 ? 'trade' : 'trades'}
          </span>
        )}
      </div>
      {hasActive && (
        <div className="paper-bot-equity-ranges" role="group" aria-label="Chart look-back window">
          {EQUITY_RANGES.map((preset) => (
            <button
              type="button"
              key={preset.key}
              className={range === preset.key ? 'active' : ''}
              aria-pressed={range === preset.key}
              onClick={() => setRange(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="paper-bot-equity-chart"
        ref={containerRef}
        role="img"
        aria-label={metric === 'equity' ? 'Account equity over time' : 'Cumulative realized profit and loss'}
      >
        {!hasActive && (
          <p className="paper-bot-empty paper-bot-equity-empty">
            {metric === 'equity'
              ? 'Collecting account-value samples, the curve fills in as the bot runs and trades.'
              : 'No closed trades yet, the realized P/L curve appears once the bot books its first exit.'}
          </p>
        )}
      </div>
      {hasActive && metric === 'equity' && (
        <div className="paper-bot-equity-foot">
          <span>window {formatMoney(eqFirst)}</span>
          <span>low {formatMoney(eqMin)}</span>
          <span>high {formatMoney(eqMax)}</span>
          <span>{series.length} samples</span>
        </div>
      )}
      {hasActive && metric === 'pnl' && (
        <div className="paper-bot-equity-foot">
          <span>wins {pnlInfo.wins}</span>
          <span>losses {pnlInfo.losses}</span>
          <span>best {formatMoney(pnlInfo.best)}</span>
          <span>worst {formatMoney(pnlInfo.worst)}</span>
        </div>
      )}
    </div>
  )
}

function formatCompact(value: number | null) {
  if (value === null) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPercent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatRate(value: number | null) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`
}

function formatRatio(value: number | null) {
  if (value === null) return 'n/a'
  if (!Number.isFinite(value)) return '∞'
  return value.toFixed(2)
}

function formatMacroWhen(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatMacroEta(event: { minutesUntil: number; active: boolean }) {
  if (event.active) return 'now'
  const minutes = event.minutesUntil
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `in ${minutes}m`
  if (minutes < 60 * 24) return `in ${Math.round(minutes / 60)}h`
  return `in ${Math.round(minutes / (60 * 24))}d`
}

function formatHold(value: number | null | undefined) {
  if (!value) return ''
  if (value < 90) return ` · held ${value}s`
  return ` · held ${Math.round(value / 60)}m`
}

function formatTrendLabel(value: BotTechnicalContext['trendLabel']) {
  return value.replace('-', ' ')
}

function technicalClass(value?: BotTechnicalContext | null) {
  if (!value) return ''
  if (value.edgeScore >= 75) return 'strong'
  if (value.edgeScore >= 60) return 'ok'
  return 'weak'
}

function formatPulse(value: number | null) {
  return value === null ? 'pulse n/a' : `${value.toFixed(2)}x pulse`
}

function formatTimestamp(value: string | null) {
  if (!value) return 'no timestamp'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatBotLogTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatAge(value: number | null) {
  if (value === null) return 'age n/a'
  if (value < 60) return `${value}m old`
  return `${Math.round(value / 60)}h old`
}

function formatPlanValue(value: number | null) {
  return value === null ? 'n/a' : formatMoney(value)
}

function formatTradeDistance(value: number | null) {
  if (value === null) return 'n/a'
  if (Math.abs(value) < 0.05) return 'at level'
  return `${Math.abs(value).toFixed(1)}% ${value > 0 ? 'away' : 'through'}`
}

type TradeMetrics = {
  triggerGapPct: number | null
  riskPerShare: number | null
  riskPct: number | null
  targetOneR: number | null
  targetTwoR: number | null
}

function tradeMetrics(candidate: MomentumCandidate): TradeMetrics {
  const entry = candidate.signal.entryTrigger
  const stop = candidate.signal.stopLoss
  const targetOne = candidate.signal.targetOne
  const targetTwo = candidate.signal.targetTwo
  const triggerGapPct = entry !== null && candidate.price > 0 ? ((entry - candidate.price) / candidate.price) * 100 : null
  const riskPerShare = entry !== null && stop !== null && entry > stop ? entry - stop : null
  const riskPct = riskPerShare !== null && entry !== null && entry > 0 ? (riskPerShare / entry) * 100 : null
  const targetOneR =
    riskPerShare !== null && riskPerShare > 0 && entry !== null && targetOne !== null
      ? (targetOne - entry) / riskPerShare
      : null
  const targetTwoR =
    riskPerShare !== null && riskPerShare > 0 && entry !== null && targetTwo !== null
      ? (targetTwo - entry) / riskPerShare
      : null
  return { triggerGapPct, riskPerShare, riskPct, targetOneR, targetTwoR }
}

function classifySetup(candidate: MomentumCandidate) {
  const extension = candidate.vwapExtensionPct ?? (candidate.vwap > 0 ? ((candidate.price - candidate.vwap) / candidate.vwap) * 100 : null)
  const micro = candidate.assetClass === 'stock' ? candidate.microPullback : undefined
  // Mean-reversion: the opposite of momentum. Stretched BELOW VWAP, the controlled
  // buy is the reclaim back toward the mean, never a breakout chase.
  if (candidate.strategy === 'reversion') {
    if (candidate.signal.action === 'BUY') {
      return {
        tone: 'reclaim',
        label: 'VWAP reclaim, controlled buy',
        detail: `Stretched below VWAP and turning up. Buy the reclaim through ${formatPlanValue(
          candidate.signal.entryTrigger,
        )} toward VWAP ${formatPlanValue(candidate.vwap)}; hard stop ${formatPlanValue(candidate.signal.stopLoss)}.`,
      }
    }
    return {
      tone: 'reclaim',
      label: 'VWAP reclaim watch (mean reversion)',
      detail: `Stretched below VWAP ${formatPlanValue(
        candidate.vwap,
      )}. Wait for a confirmed turn back up, buy the reclaim, don't catch the knife.`,
    }
  }
  if (candidate.signal.action === 'BUY') {
    return {
      tone: micro?.state === 'READY' ? 'dip' : 'breakout',
      label: micro?.state === 'READY' ? 'Micro pullback ready' : 'Confirmed breakout',
      detail:
        micro?.state === 'READY'
          ? `Break above ${formatPlanValue(micro.trigger)} after ${micro.pullbackCandles} pullback candle${
              micro.pullbackCandles === 1 ? '' : 's'
            }; stop near ${formatPlanValue(micro.stop)}.`
          : 'Price cleared the trigger and held the VWAP/volume gate.',
    }
  }
  if (micro?.state === 'READY') {
    return {
      tone: 'dip',
      label: 'Micro pullback ready',
      detail: `Buy only if it breaks ${formatPlanValue(micro.trigger)}; invalid below ${formatPlanValue(micro.stop)}.`,
    }
  }
  if (micro?.state === 'FORMING') {
    return {
      tone: 'dip',
      label: 'Micro pullback forming',
      detail: `${micro.pullbackCandles} candle pause. Wait for a green candle to break ${formatPlanValue(micro.trigger)}.`,
    }
  }
  if (micro?.state === 'FAILED') {
    return {
      tone: 'risk',
      label: 'Pullback failed',
      detail: 'The pullback lost support, got too deep, or selling volume expanded. No chase.',
    }
  }
  if (micro?.state === 'EXTENDED') {
    return {
      tone: 'risk',
      label: 'Extended chase risk',
      detail: 'It is near the high without a clean pause. Wait for a controlled micro pullback.',
    }
  }
  if (!candidate.aboveVwap) {
    return {
      tone: 'reclaim',
      label: 'VWAP reclaim watch',
      detail: `No dip buy yet. First prove it can reclaim VWAP ${formatPlanValue(candidate.vwap)}.`,
    }
  }
  if (extension !== null && extension <= 1.8 && candidate.changePct >= 5 && candidate.distanceFromHighPct > 1) {
    return {
      tone: 'dip',
      label: 'VWAP dip watch',
      detail: 'Potential dip only if it turns up from VWAP and then breaks the trigger.',
    }
  }
  if (extension !== null && extension >= 10) {
    return {
      tone: 'risk',
      label: 'Extended chase risk',
      detail: 'Strong move, but far above VWAP. Wait for a reset or a clean base.',
    }
  }
  if (candidate.distanceFromHighPct <= 1.2) {
    return {
      tone: 'breakout',
      label: 'Breakout watch',
      detail: 'Near the high. The next decision is trigger break plus confirmation.',
    }
  }
  return {
    tone: 'watch',
    label: 'Momentum watch',
    detail: 'Good activity, but the trigger, VWAP, and confirmation gates still decide.',
  }
}

function tradeState(candidate: MomentumCandidate, isContext: boolean, contextReason: string, metrics: TradeMetrics) {
  if (isContext) {
    return {
      tone: 'avoid',
      label: 'NO TRADE',
      sublabel: 'context only',
      detail: contextReason,
    }
  }
  if (candidate.signal.action === 'BUY') {
    const reversion = candidate.strategy === 'reversion'
    return {
      tone: 'buy',
      label: 'BUYABLE NOW',
      sublabel: 'confirmed',
      detail: reversion
        ? `Reclaim entry is active at ${formatPlanValue(candidate.signal.entryTrigger)} while the stop holds.`
        : `Entry is active at ${formatPlanValue(candidate.signal.entryTrigger)} while VWAP holds.`,
    }
  }
  if (candidate.signal.action === 'WAIT') {
    const distance = formatTradeDistance(metrics.triggerGapPct)
    return {
      tone: 'wait',
      label: 'WAIT - NOT BUYABLE',
      sublabel: distance,
      detail: `Score ${candidate.score} is setup quality, not permission. It must break ${formatPlanValue(
        candidate.signal.entryTrigger,
      )} and confirm first.`,
    }
  }
  return {
    tone: 'avoid',
    label: 'NO TRADE',
    sublabel: 'blocked',
    detail: candidate.blockers[0] ?? 'Trade gate failed.',
  }
}

function buyGateSummary(candidate: MomentumCandidate, isContext: boolean, contextReason: string) {
  if (isContext) return `Buy gate: no trade - ${contextReason}.`
  if (candidate.signal.action === 'BUY') {
    const phase = candidate.signalPhase
    const holdText = phase ? `confirmation ${Math.min(phase.holds, phase.holdsNeeded)}/${phase.holdsNeeded}` : 'confirmed'
    return `Buy gate passed: ${holdText}, trigger active, verified quote, stop and targets valid.`
  }
  if (candidate.signalPhase) return `Buy gate: ${candidate.signalPhase.detail}`
  if (candidate.signal.action === 'WAIT') {
    return `Buy gate: waiting for ${formatPlanValue(candidate.signal.entryTrigger)} and confirmation before this becomes actionable.`
  }
  return `Buy gate blocked: ${candidate.blockers[0] ?? 'setup or data gate failed'}.`
}

function manualTrackerStop(candidate: MomentumCandidate) {
  const planned = candidate.signal.stopLoss
  if (planned !== null && planned > 0 && planned < candidate.price) return planned
  const fallbackPct = candidate.assetClass === 'stock' ? 0.965 : 0.985
  const fallbackStop = candidate.price * fallbackPct
  const vwapStop = candidate.vwap > 0 && candidate.vwap < candidate.price ? candidate.vwap * 0.992 : null
  if (vwapStop !== null && vwapStop > 0 && vwapStop < candidate.price) return Math.max(vwapStop, fallbackStop)
  return fallbackStop
}

function alertIsValidCandidate(candidate: MomentumCandidate) {
  const entry = candidate.signal.entryTrigger
  const stop = candidate.signal.stopLoss
  if (candidate.status !== 'CHECK NOW' || entry === null || candidate.price < entry) return false
  if (stop !== null && candidate.price <= stop) return false
  return candidate.dataQuality === 'VERIFIED'
}

function alertFromCandidate(candidate: MomentumCandidate, id = `${candidate.ticker}-${Date.now()}`): RadarAlert {
  const entry = candidate.signal.entryTrigger
  const stop = candidate.signal.stopLoss
  const risk = entry !== null && stop !== null && entry > stop ? entry - stop : null
  const movePct = entry !== null && entry > 0 ? ((candidate.price - entry) / entry) * 100 : null
  const trigger = entry === null ? '' : ` at ${formatPlanValue(entry)}`
  return {
    id,
    ticker: candidate.ticker,
    status: candidate.status,
    price: candidate.price,
    entry,
    stop,
    target1: candidate.signal.targetOne,
    target2: candidate.signal.targetTwo,
    risk,
    movePct,
    validUntil: Date.now() + 90_000,
    message: `${candidate.ticker} reached BUY trigger opinion${trigger}. Live ${formatMoney(candidate.price)}; stop ${
      stop === null ? 'n/a' : formatMoney(stop)
    }.`,
  }
}

function syncAlertsWithCandidates(alerts: RadarAlert[], candidates: MomentumCandidate[]) {
  const byTicker = new Map(candidates.map((candidate) => [candidate.ticker, candidate]))
  const now = Date.now()
  return alerts
    .flatMap((alert) => {
      const candidate = byTicker.get(alert.ticker)
      if (candidate) return alertIsValidCandidate(candidate) ? [alertFromCandidate(candidate, alert.id)] : []
      return alert.validUntil > now ? [alert] : []
    })
    .slice(0, 5)
}

function formatDiff(value: number | null) {
  return value === null ? 'no diff' : `${value.toFixed(2)}% diff`
}

function signalRowId(ticker: string) {
  return `signal-row-${ticker.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function statusClass(status: MomentumStatus) {
  return status.toLowerCase().replace(/\s+/g, '-')
}

function sortRadarCandidates(candidates: MomentumCandidate[]) {
  const statusWeight: Record<MomentumStatus, number> = { 'CHECK NOW': 4, WATCH: 3, IGNORE: 2, 'DATA ERROR': 1 }
  return [...candidates].sort(
    (a, b) =>
      statusWeight[b.status] - statusWeight[a.status] ||
      b.score - a.score ||
      b.changePct - a.changePct ||
      (b.quoteVolume ?? b.volume) - (a.quoteVolume ?? a.volume),
  )
}

function StatusPill({ status }: { status: MomentumStatus }) {
  return <span className={`momentum-status ${statusClass(status)}`}>{statusLabels[status]}</span>
}

function botLogClass(level: BotLogEntry['level']) {
  return level === 'error' ? 'momentum-red' : level === 'sell' || level === 'skip' ? 'momentum-red' : 'momentum-green'
}

function botHistoryClass(entry: BotHistoryEntry) {
  if (entry.outcome === 'win') return 'momentum-green'
  if (entry.outcome === 'loss') return 'momentum-red'
  return entry.side === 'buy' ? 'momentum-green' : ''
}

function hasPaperBotRiskPlan(candidate: MomentumCandidate) {
  return (
    candidate.signal.stopLoss !== null &&
    candidate.signal.targetOne !== null &&
    candidate.signal.targetTwo !== null
  )
}

function isPaperBotProbe(candidate: MomentumCandidate) {
  // Reversion candidates are below VWAP by design, so they satisfy the VWAP gate.
  const vwapOk = candidate.aboveVwap || candidate.strategy === 'reversion'
  if (candidate.dataQuality !== 'VERIFIED' || !vwapOk || !hasPaperBotRiskPlan(candidate)) return false
  if (candidate.score < PAPER_BOT_MIN_SCORE) return false
  if (candidate.status === 'CHECK NOW') return true
  return candidate.status === 'WATCH' && candidate.blockers.every((blocker) => ALLOWED_PAPER_BOT_RISK_BLOCKERS.has(blocker))
}

function isStrictTraderCandidate(candidate: MomentumCandidate) {
  const hasActionableStatus = candidate.status === 'CHECK NOW' || candidate.status === 'WATCH'
  const hasActionableSignal = candidate.signal.action === 'BUY' || candidate.signal.action === 'WAIT'
  return (
    hasActionableStatus &&
    hasActionableSignal &&
    candidate.dataQuality === 'VERIFIED' &&
    // Reversion setups are below VWAP by design, that IS the setup, so they are
    // tradable signals rather than "context only" rows.
    (candidate.aboveVwap || candidate.strategy === 'reversion') &&
    candidate.price > 0 &&
    hasPaperBotRiskPlan(candidate)
  )
}

// A genuinely interesting mover, used only to pick the "closest to a signal"
// NO-TRADE context rows, so flat majors (e.g. a stablecoin sitting at 0%) never
// crowd out the real action. This does NOT relax the strict trade gate above;
// these rows are shown as context only and are never tradable signals.
function isRealMover(candidate: MomentumCandidate) {
  if (candidate.assetClass === 'crypto') {
    return candidate.changePct >= 5 || (candidate.secondaryMovePct ?? 0) >= 3
  }
  return candidate.changePct >= 5
}

// The confirmation ladder shown as a stepper. `failed` shares the last slot with
// `confirmed` but renders red, the break got that far, then broke down.
const PHASE_STEPS: { key: SignalPhase; label: string }[] = [
  { key: 'armed', label: 'Armed' },
  { key: 'triggered', label: 'Triggered' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'confirmed', label: 'Confirmed' },
]

const PHASE_INDEX: Record<SignalPhase, number> = {
  armed: 0,
  triggered: 1,
  confirming: 2,
  confirmed: 3,
  failed: 3,
}

// Full-width banner under a candidate row: the armed -> triggered -> confirming
// -> confirmed/failed ladder plus the current one-line explanation. This is what
// keeps a single price tick from ever reading as an instant buy.
function SignalPhaseBanner({ phase }: { phase: SignalStability }) {
  const failed = phase.phase === 'failed'
  const currentIndex = PHASE_INDEX[phase.phase]
  return (
    <div className={`momentum-phase phase-${phase.phase}`} aria-label="Signal confirmation state">
      <ol className="momentum-phase-steps">
        {PHASE_STEPS.map((step, index) => {
          const state = failed
            ? index < 3
              ? 'done'
              : 'failed'
            : index < currentIndex
              ? 'done'
              : index === currentIndex
                ? 'active'
                : 'todo'
          return (
            <li key={step.key} className={`phase-step ${state}`}>
              <i />
              <span>{failed && index === 3 ? 'Failed' : step.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="momentum-phase-copy">
        <strong>{phase.label}</strong>
        <small>{phase.detail}</small>
      </p>
    </div>
  )
}

// ---- manual position tracking ("I'm in") --------------------------------
// A trade the user tells the radar they actually entered. Stored in
// localStorage and used to turn a confirmed signal into live "what do I do
// now" guidance. This is a personal journal/coach, it places no real orders
// (that is the separate paper bot) and is independent of the signal engine.
const POSITIONS_STORAGE_KEY = 'radar.trackedPositions.v1'
const RADAR_THEME_STORAGE_KEY = 'radar.theme.v1'

export type TrackedPosition = {
  ticker: string
  displaySymbol: string
  assetClass: 'stock' | 'crypto'
  entryPrice: number
  entryAt: string
  trigger?: number | null
  stop: number | null
  plannedStop?: number | null
  target1: number | null
  target2: number | null
  score?: number
  setupLabel?: string
}

type PositionGuidance = {
  tone: 'exit' | 'trim' | 'profit' | 'hold'
  headline: string
  detail: string
  plPct: number
}

// Turn the live price into one unambiguous instruction against the plan the
// user locked in at entry. This is the "it notices the price and tells me what
// to do next" behaviour.
function positionGuidance(position: TrackedPosition, price: number): PositionGuidance {
  const plPct = position.entryPrice > 0 ? ((price - position.entryPrice) / position.entryPrice) * 100 : 0
  const { stop, target1, target2, entryPrice } = position
  if (stop !== null && price <= stop) {
    return {
      tone: 'exit',
      headline: 'Exit now, stop hit',
      detail: `Price ${formatMoney(price)} is at/under your stop ${formatMoney(stop)}. Close it; the setup is invalidated.`,
      plPct,
    }
  }
  if (target2 !== null && price >= target2) {
    return {
      tone: 'profit',
      headline: 'Take profit, final target hit',
      detail: `Hit your final target ${formatMoney(target2)}. Bank it, or trail a tight stop if you let a runner go.`,
      plPct,
    }
  }
  if (target1 !== null && price >= target1) {
    return {
      tone: 'trim',
      headline: 'Trim & raise your stop',
      detail: `First target ${formatMoney(target1)} is in. Take some off and move your stop up to break-even (${formatMoney(entryPrice)}).`,
      plPct,
    }
  }
  if (price >= entryPrice) {
    return {
      tone: 'profit',
      headline: 'Hold, in profit',
      detail: `Green from ${formatMoney(entryPrice)}. Let it work toward ${target1 !== null ? formatMoney(target1) : 'target 1'}; stop stays at ${stop !== null ? formatMoney(stop) : 'your stop'}.`,
      plPct,
    }
  }
  return {
    tone: 'hold',
    headline: 'Hold, give it room',
    detail: `Under your ${formatMoney(entryPrice)} entry but still above the stop${stop !== null ? ` ${formatMoney(stop)}` : ''}. Thesis holds until the stop, don't panic-sell the noise.`,
    plPct,
  }
}

// A position the user is holding, rendered as a full row PINNED to the top of
// the trade list. It is driven by the tracked position (not the shortlist), so
// it never disappears when the ticker drops out of the strict gate, the bug
// where "it should have stayed at the top because I bought it". Live price comes
// from the latest scan when available, otherwise it falls back to the entry and
// flags "off radar" so guidance is still shown.
function HeldPositionRow({
  position,
  candidate,
  onExit,
}: {
  position: TrackedPosition
  candidate?: MomentumCandidate
  onExit: (ticker: string) => void
}) {
  const offRadar = !candidate
  const price = candidate?.price ?? position.entryPrice
  const guidance = positionGuidance(position, price)
  const riskPerShare = position.stop !== null && position.entryPrice > position.stop ? position.entryPrice - position.stop : null
  const riskPct = riskPerShare !== null ? (riskPerShare / position.entryPrice) * 100 : null
  const targetOneR =
    riskPerShare !== null && riskPerShare > 0 && position.target1 !== null
      ? (position.target1 - position.entryPrice) / riskPerShare
      : null
  const targetTwoR =
    riskPerShare !== null && riskPerShare > 0 && position.target2 !== null
      ? (position.target2 - position.entryPrice) / riskPerShare
      : null
  const stopWasAdjusted =
    position.plannedStop !== undefined &&
    position.plannedStop !== null &&
    position.plannedStop >= position.entryPrice &&
    position.stop !== null &&
    position.stop < position.entryPrice
  return (
    <article className={`held-row tone-${guidance.tone}`} aria-label={`${position.displaySymbol} open position`}>
      <div className="held-symbol">
        <span className="held-tag">You're in</span>
        <strong>{position.displaySymbol}</strong>
        <small>
          {position.assetClass === 'crypto' ? 'Crypto' : 'Stock'}
          {offRadar ? ' · off radar' : ''}
        </small>
        {position.setupLabel && <small>{position.setupLabel}</small>}
      </div>
      <div className="held-plan">
        <div className="held-plan-main">
          <span>
            <small>Now</small>
            <b>{formatMoney(price)}</b>
          </span>
          <span>
            <small>P/L</small>
            <b className={guidance.plPct >= 0 ? 'momentum-green' : 'momentum-red'}>{formatPercent(guidance.plPct)}</b>
          </span>
          <span>
            <small>Entry</small>
            <b>{formatMoney(position.entryPrice)}</b>
          </span>
        </div>
        <div className="held-targets">
          <span className="held-stop">
            <small>Stop loss</small>
            <b>{position.stop !== null ? formatMoney(position.stop) : 'n/a'}</b>
            <em>{riskPct === null ? 'risk n/a' : `${riskPct.toFixed(1)}% risk`}</em>
          </span>
          <span>
            <small>Target 1</small>
            <b>{position.target1 !== null ? formatMoney(position.target1) : 'n/a'}</b>
            <em>{targetOneR === null ? 'trim zone' : `${targetOneR.toFixed(1)}R trim`}</em>
          </span>
          <span>
            <small>Target 2</small>
            <b>{position.target2 !== null ? formatMoney(position.target2) : 'n/a'}</b>
            <em>{targetTwoR === null ? 'final zone' : `${targetTwoR.toFixed(1)}R final`}</em>
          </span>
        </div>
        <div className="held-context-line">
          {position.trigger !== undefined && position.trigger !== null && <span>Original trigger {formatMoney(position.trigger)}</span>}
          {stopWasAdjusted && <span>Manual stop adjusted below your actual entry</span>}
          {position.score !== undefined && <span>Setup score {position.score}</span>}
        </div>
      </div>
      <div className="held-numbers held-numbers-legacy">
        <span>
          <small>Entry</small>
          <b>{formatMoney(position.entryPrice)}</b>
        </span>
        <span>
          <small>Now</small>
          <b>{formatMoney(price)}</b>
        </span>
        <span>
          <small>P/L</small>
          <b className={guidance.plPct >= 0 ? 'momentum-green' : 'momentum-red'}>{formatPercent(guidance.plPct)}</b>
        </span>
        <span>
          <small>Stop</small>
          <b>{position.stop !== null ? formatMoney(position.stop) : '-'}</b>
        </span>
        <span>
          <small>Targets</small>
          <b>
            {position.target1 !== null ? formatMoney(position.target1) : '-'}
            {' / '}
            {position.target2 !== null ? formatMoney(position.target2) : '-'}
          </b>
        </span>
      </div>
      <div className="held-guidance">
        <strong>{guidance.headline}</strong>
        <small>{guidance.detail}</small>
      </div>
      <button type="button" className="held-close" onClick={() => onExit(position.ticker)}>
        <X size={14} />
        Sold / close
      </button>
    </article>
  )
}

function CandidateRow({
  candidate,
  variant = 'strict',
  onEnter,
}: {
  candidate: MomentumCandidate
  variant?: 'strict' | 'context'
  onEnter?: (candidate: MomentumCandidate) => void
}) {
  const isContext = variant === 'context'
  // The one-line reason this row is NOT tradable, surfaced in the signal cell so
  // a context row can never be mistaken for a buy signal.
  const contextReason =
    candidate.blockers[0] ?? (candidate.aboveVwap ? 'not strong enough yet' : 'below VWAP')
  const distanceLabel =
    candidate.distanceFromHighPct <= 0.2 ? 'at high' : `${candidate.distanceFromHighPct.toFixed(1)}% off high`
  const catalystAge =
    candidate.catalystAgeMinutes === null
      ? 'no source time'
      : candidate.catalystAgeMinutes < 60
        ? `${candidate.catalystAgeMinutes}m ago`
        : `${Math.round(candidate.catalystAgeMinutes / 60)}h ago`
  const sourceDetail = candidate.newsUrl ? `${candidate.catalyst} - ${catalystAge}` : candidate.catalystPublisher || candidate.catalyst
  const signalClass = candidate.signal.action.toLowerCase()
  const qualityLine =
    candidate.secondarySource && candidate.secondaryPrice
      ? `${candidate.primarySource} / ${candidate.secondarySource} ${formatMoney(candidate.secondaryPrice)}`
      : candidate.primarySource
  const metrics = tradeMetrics(candidate)
  const setup = classifySetup(candidate)
  const state = tradeState(candidate, isContext, contextReason, metrics)
  const capBand = candidate.assetClass === 'stock' ? stockCapBand(candidate) : null
  const riskLabel =
    metrics.riskPerShare === null
      ? 'risk n/a'
      : `${formatMoney(metrics.riskPerShare)} / sh · ${metrics.riskPct?.toFixed(1) ?? 'n/a'}%`
  const targetRLabel =
    metrics.targetOneR === null || metrics.targetTwoR === null
      ? candidate.signal.riskReward === null
        ? 'R plan n/a'
        : `${candidate.signal.riskReward.toFixed(1)}R plan`
      : `${metrics.targetOneR.toFixed(1)}R / ${metrics.targetTwoR.toFixed(1)}R`
  // Action-led signal: lead with the verb, then where to buy. This is the
  // "clearly state where to buy" the dense old label buried.
  const signalNote =
    candidate.signal.action === 'BUY'
      ? 'confirmed setup'
      : candidate.signal.action === 'WAIT'
        ? 'wait for clean break'
        : 'blocked'
  const actionHeadline = isContext
    ? state.label
    : candidate.signal.action === 'BUY'
      ? state.label
      : candidate.signal.action === 'WAIT'
        ? state.label
        : state.label
  const entryLine =
    isContext || candidate.signal.entryTrigger === null
      ? isContext
        ? contextReason
        : signalNote
      : candidate.signal.action === 'BUY'
        ? `entry ≥ ${formatPlanValue(candidate.signal.entryTrigger)}`
        : `buy break > ${formatPlanValue(candidate.signal.entryTrigger)}`
  const targetLabel =
    candidate.signal.targetOne === null
      ? 'n/a'
      : `${formatPlanValue(candidate.signal.targetOne)} / ${formatPlanValue(candidate.signal.targetTwo)}`
  const planDo =
    candidate.signal.action === 'BUY'
      ? candidate.strategy === 'reversion'
        ? `DO: buy only through the reclaim ${formatPlanValue(candidate.signal.entryTrigger)} toward VWAP, stop ${formatPlanValue(candidate.signal.stopLoss)}.`
        : `DO: buy only above ${formatPlanValue(candidate.signal.entryTrigger)} while it holds VWAP, stop ${formatPlanValue(candidate.signal.stopLoss)}.`
      : candidate.signal.action === 'WAIT'
        ? candidate.strategy === 'reversion'
          ? `DO: wait, act only if it reclaims ${formatPlanValue(candidate.signal.entryTrigger)} with turning tape.`
          : `DO: wait, act only if it breaks ${formatPlanValue(candidate.signal.entryTrigger)} with VWAP support.`
        : 'DO: stay out, no trade here.'
  const planDont =
    candidate.signal.action === 'AVOID'
      ? `DON'T: enter, ${candidate.blockers[0] ?? 'setup or data gate failed'}.`
      : candidate.blockers.length > 0
        ? `DON'T: enter while ${candidate.blockers[0]}.`
        : "DON'T: chase below VWAP or once it has run past the targets."
  const gateSummary = buyGateSummary(candidate, isContext, contextReason)

  return (
    <article
      id={signalRowId(candidate.ticker)}
      className={`momentum-row ${statusClass(candidate.status)} signal-${isContext ? 'avoid' : signalClass}${
        isContext ? ' near-miss' : ''
      }`}
    >
      <div className="momentum-symbol">
        <strong>{candidate.displaySymbol}</strong>
        <span>{candidate.assetClass === 'crypto' ? 'Crypto' : candidate.exchangeDisplay || candidate.exchange || 'Stock'}</span>
        <small>{candidate.company}</small>
        {capBand && <span className={`momentum-strategy-tag cap-${capBand}`}>{stockCapLabels[capBand]}</span>}
        {candidate.strategy === 'reversion' && <span className="momentum-strategy-tag reversion">Mean reversion</span>}
      </div>
      <div className={`momentum-signal signal-${isContext ? 'avoid' : signalClass} state-${state.tone}`}>
        <span className="momentum-cell-label">Action now</span>
        <strong>{actionHeadline}</strong>
        <small>{state.detail}</small>
        <em>{state.sublabel}</em>
        {!isContext && candidate.signalPhase && (
          <span className={`signal-phase-chip phase-${candidate.signalPhase.phase}`}>
            {candidate.signalPhase.label}
          </span>
        )}
      </div>
      <div className="momentum-price-cell">
        <span className="momentum-cell-label">Now price</span>
        <strong>{formatMoney(candidate.price)}</strong>
        <small className={candidate.changePct >= 0 ? 'momentum-green' : 'momentum-red'}>
          {formatPercent(candidate.changePct)}
          {candidate.secondaryMovePct !== null ? ` / ${formatPercent(candidate.secondaryMovePct)}` : ''}
        </small>
      </div>
      <div className="momentum-trigger-cell">
        <span className="momentum-cell-label">{candidate.signal.action === 'BUY' ? 'Entry active' : 'Buy above'}</span>
        <strong>{formatPlanValue(candidate.signal.entryTrigger)}</strong>
        <small>{metrics.triggerGapPct === null ? entryLine : formatTradeDistance(metrics.triggerGapPct)}</small>
      </div>
      <div className="momentum-stop-cell">
        <span className="momentum-cell-label">Planned stop</span>
        <strong>{formatPlanValue(candidate.signal.stopLoss)}</strong>
        <small>{riskLabel}</small>
      </div>
      <div className="momentum-target-cell">
        <span className="momentum-cell-label">Gains / targets</span>
        <strong>{targetLabel}</strong>
        <small>{targetRLabel}</small>
      </div>
      <div className="momentum-volume-cell">
        <span className="momentum-cell-label">
          {candidate.assetClass === 'crypto' ? 'Quote vol / trades' : 'Vol / relVol'}
        </span>
        <strong>
          {candidate.assetClass === 'crypto'
            ? `${formatCompact(candidate.quoteVolume)} / ${formatCompact(candidate.trades)}`
            : `${formatCompact(candidate.volume)} / ${candidate.relativeVolume.toFixed(1)}x`}
        </strong>
        <small>{candidate.spreadPct.toFixed(candidate.assetClass === 'crypto' ? 3 : 2)}% spread</small>
        {candidate.assetClass === 'stock' && candidate.sessionVolume && (
          <small>
            {candidate.sessionVolume.timeAdjustedRelativeVolume !== null
              ? `${candidate.sessionVolume.timeAdjustedRelativeVolume.toFixed(1)}x time rVol`
              : candidate.sessionVolume.label}
          </small>
        )}
        {candidate.assetClass === 'stock' && candidate.microBars && (
          <small>
            10s tape {candidate.microBars.bars} bars
            {candidate.microBars.microVolumePulse !== null ? ` / ${candidate.microBars.microVolumePulse.toFixed(1)}x` : ''}
          </small>
        )}
        {candidate.assetClass === 'crypto' && <small>{formatPulse(candidate.volumePulse ?? null)}</small>}
      </div>
      <div className="momentum-quality">
        <span className="momentum-cell-label">Quality</span>
        <strong>{candidate.dataQuality === 'VERIFIED' ? 'Verified' : candidate.dataQuality}</strong>
        <small>{candidate.marketStatusLabel} - {formatAge(candidate.quoteAgeMinutes)}</small>
      </div>
      <div className="momentum-score">
        <span className="momentum-cell-label">Score</span>
        <strong>{candidate.score}</strong>
        {isContext &&
          (candidate.score >= PAPER_BOT_MIN_SCORE ? (
            <small className="score-ok">score ok · see reason</small>
          ) : (
            <small>needs {PAPER_BOT_MIN_SCORE}</small>
          ))}
      </div>
      <StatusPill status={candidate.status} />
      <div className="momentum-trade-map" aria-label={`${candidate.displaySymbol} trading plan`}>
        <span>
          <small>1 · Now</small>
          <b>{formatMoney(candidate.price)}</b>
        </span>
        <i />
        <span>
          <small>2 · Wait for</small>
          <b>{formatPlanValue(candidate.signal.entryTrigger)}</b>
        </span>
        <i />
        <span className="danger">
          <small>3 · Stop</small>
          <b>{formatPlanValue(candidate.signal.stopLoss)}</b>
        </span>
        <i />
        <span className="target">
          <small>4 · Targets</small>
          <b>{targetLabel}</b>
        </span>
      </div>
      <div className={`momentum-setup-coach tone-${setup.tone}`}>
        <strong>{setup.label}</strong>
        <span>{setup.detail}</span>
        <small>{gateSummary}</small>
      </div>
      {!isContext && candidate.signalPhase && <SignalPhaseBanner phase={candidate.signalPhase} />}
      {!isContext && (
        <div className="momentum-action">
          <div className="momentum-action-copy">
            <small className={candidate.signal.action === 'AVOID' ? '' : 'momentum-green'}>{planDo}</small>
            <small className="momentum-red">{planDont}</small>
          </div>
          {(candidate.signal.action === 'BUY' || candidate.signal.action === 'WAIT') && onEnter && (
            <button
              type="button"
              className={`momentum-buy-btn ${candidate.signal.action === 'BUY' ? 'is-buy' : ''}`}
              onClick={() => onEnter(candidate)}
            >
              {candidate.signal.action === 'BUY' ? <Check size={15} /> : <Target size={15} />}
              {candidate.signal.action === 'BUY' ? 'I bought this' : 'Track manual buy'}
            </button>
          )}
        </div>
      )}

      <details className="momentum-why">
        <summary>Why this setup{candidate.blockers.length > 0 ? ' · caution' : ''}</summary>
        <div className="momentum-why-grid">
          <div className="momentum-reasons">
            <strong>Setup</strong>
            <div>
              {candidate.reasons.slice(0, 4).map((reason) => (
                <em key={reason}>{reason}</em>
              ))}
              <em>{candidate.aboveVwap ? 'above VWAP' : 'below VWAP'}</em>
              <em>{distanceLabel}</em>
              {candidate.assetClass === 'stock' && candidate.sessionVolume && (
                <>
                  <em>{candidate.sessionVolume.label}</em>
                  {candidate.sessionVolume.expectedVolumeProgressPct !== null && (
                    <em>expected volume progress {candidate.sessionVolume.expectedVolumeProgressPct.toFixed(1)}%</em>
                  )}
                </>
              )}
              {candidate.assetClass === 'stock' && candidate.microBars && (
                <>
                  <em>10s cache {candidate.microBars.bars} bars from {candidate.microBars.source}</em>
                  {candidate.microBars.oneMinuteMovePct !== null && (
                    <em>1m micro tape {formatPercent(candidate.microBars.oneMinuteMovePct)}</em>
                  )}
                </>
              )}
              {candidate.assetClass === 'stock' && candidate.microPullback && (
                <>
                  <em>{candidate.microPullback.label}</em>
                  {candidate.microPullback.pullbackDepthPct !== null && (
                    <em>pullback depth {candidate.microPullback.pullbackDepthPct.toFixed(1)}%</em>
                  )}
                  {candidate.microPullback.nearestSupport !== null && (
                    <em>support {formatPlanValue(candidate.microPullback.nearestSupport)}</em>
                  )}
                  {candidate.microPullback.nearestResistance !== null && (
                    <em>resistance {formatPlanValue(candidate.microPullback.nearestResistance)}</em>
                  )}
                </>
              )}
              {candidate.blockers.length > 0 && <em className="risk-chip">caution: {candidate.blockers[0]}</em>}
            </div>
          </div>
          <div className="momentum-catalyst">
            <strong>Source &amp; data</strong>
            <span>{sourceDetail}</span>
            <small>{qualityLine}</small>
            <small>
              {formatTimestamp(candidate.quoteTimestamp)} - {formatDiff(candidate.priceDiffPct)}
            </small>
          </div>
          <div className="momentum-links">
            <a href={candidate.tradingViewUrl} target="_blank" rel="noreferrer">
              TradingView
              <ExternalLink size={13} />
            </a>
            <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              {candidate.sourceLabel}
              <ExternalLink size={13} />
            </a>
            {candidate.newsUrl && (
              <a href={candidate.newsUrl} target="_blank" rel="noreferrer">
                News
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      </details>
    </article>
  )
}

function riskBadge(mode: BotMode): { label: string; cls: string } {
  if (mode === 'safe') return { label: 'Low', cls: 'low' }
  if (mode === 'active') return { label: 'Med', cls: 'med' }
  return { label: 'High', cls: 'high' }
}

type JournalDay = {
  key: string
  label: string
  realized: number
  wins: number
  losses: number
  trades: BotHistoryEntry[]
}

// Group the bot's trade history into day buckets (newest first) with realized
// P/L and win/loss tallies, the data behind the trade-journal calendar.
function groupTradesByDay(history: BotHistoryEntry[]): JournalDay[] {
  const order: string[] = []
  const byDay = new Map<string, JournalDay>()
  for (const entry of history) {
    const date = new Date(entry.time)
    const key = date.toLocaleDateString('en-CA')
    let day = byDay.get(key)
    if (!day) {
      day = {
        key,
        label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }),
        realized: 0,
        wins: 0,
        losses: 0,
        trades: [],
      }
      byDay.set(key, day)
      order.push(key)
    }
    day.trades.push(entry)
    if (entry.side === 'sell' && entry.pnl !== null) {
      day.realized += entry.pnl
      if (entry.pnl > 0) day.wins += 1
      else if (entry.pnl < 0) day.losses += 1
    }
  }
  return order.map((key) => byDay.get(key) as JournalDay)
}

function PaperBotPanel({
  bot,
  candidates,
  onStart,
  onStop,
  onReset,
  onSetMode,
  theme,
}: {
  bot: BotState | null
  candidates: MomentumCandidate[]
  onStart: () => void
  onStop: (mode: BotStopMode) => void
  onReset: () => void
  onSetMode: (mode: BotMode) => void
  theme: RadarTheme
}) {
  const [stopChoiceOpen, setStopChoiceOpen] = useState(false)
  const [showVitals, setShowVitals] = useState(false)
  const running = bot?.running ?? false
  const draining = bot?.draining ?? false
  const mode: BotMode = bot?.mode ?? 'active'
  const maxPositions = bot?.maxPositions ?? 0
  const sizeMultiplier = bot?.sizeMultiplier ?? 1
  const configured = bot?.configured ?? false
  const account = bot?.account ?? null
  const accountReady = configured && account !== null
  const positions = bot?.positions ?? []
  const orders = bot?.orders ?? []
  const openOrders = orders.filter((order) => LIVE_BOT_ORDER_STATUSES.has(order.status.trim().toLowerCase()))
  const botLog = bot?.log ?? []
  const history = bot?.history ?? []
  const stats = bot?.stats ?? { wins: 0, losses: 0, flats: 0, closedTrades: 0, realizedPl: 0 }
  const equitySeries = bot?.equitySeries ?? []
  const diagnostics = bot?.diagnostics ?? null
  const setupMemory = bot?.setupMemory ?? []
  const weakSetupMemory = setupMemory.filter((entry) => entry.trades >= 3 && entry.netAvgPnl < 0).slice(0, 3)
  const strongSetupMemory = [...setupMemory]
    .filter((entry) => entry.trades >= 3 && entry.netAvgPnl > 0)
    .sort((a, b) => b.netAvgPnl - a.netAvgPnl)
    .slice(0, 3)
  const macroEvents = bot?.macroEvents ?? []
  const macroBlackoutActive = macroEvents.some((event) => event.active)
  const riskPause = bot?.riskPause ?? null
  const paperTrading = (bot?.tradingBase ?? '').includes('paper-api.alpaca.markets')
  const cryptoVenue = bot?.cryptoVenue ?? 'alpaca'
  const cryptoVenueLabel = bot?.cryptoVenueLabel ?? 'Alpaca paper crypto'
  const lastTick = bot?.lastTickAt
    ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(bot.lastTickAt),
      )
    : 'idle'
  const armedCount = bot?.armed ?? candidates.filter(isPaperBotProbe).length
  const triggeredCount = bot?.triggered ?? 0
  const minScore = bot?.minScore ?? PAPER_BOT_MIN_SCORE
  const reversionMinScore = bot?.reversionMinScore ?? 70
  const watch = bot?.watch ?? []
  const journal = groupTradesByDay(history)
  const modeTune =
    mode === 'safe'
      ? { filter: 'strict', exit: 'wide trail', liquidity: 'curated majors' }
      : mode === 'active'
        ? { filter: 'strict+', exit: 'runner trail', liquidity: '$50M+ crypto' }
        : { filter: 'turbo+', exit: 'fast trail', liquidity: '$40M+ crypto' }
  const liveStripState = running ? 'tracking' : 'idle'
  const hasOpenExposure = positions.length > 0 || openOrders.length > 0
  const requestStop = () => {
    if (!running) {
      onStart()
      return
    }
    if (hasOpenExposure) {
      setStopChoiceOpen(true)
      return
    }
    onStop('immediate')
  }
  const confirmStop = (mode: BotStopMode) => {
    setStopChoiceOpen(false)
    onStop(mode)
  }

  return (
    <section className={`paper-bot ${running ? 'running' : ''} mode-${mode}`}>
      <div className="paper-bot-head">
        <div>
          <p className="eyebrow">
            Live paper lab{' '}
            <span className={`connection-badge ${configured ? 'connected' : 'disconnected'}`}>
              <span className="dot" />
              {configured ? `Alpaca stocks + ${cryptoVenueLabel}` : 'not connected'}
            </span>
          </p>
          <h4>
            <Bot size={20} />
            Paper Bot
          </h4>
        </div>
        <div className="paper-bot-actions">
          <button
            type="button"
            onClick={requestStop}
            className={running ? 'danger' : 'primary'}
            disabled={!running && !accountReady}
          >
            {running ? <Square size={15} /> : <Play size={15} />}
            {running ? (draining ? 'Stop now' : 'Stop') : 'Start'}
          </button>
          <button type="button" onClick={onReset}>
            <RotateCcw size={15} />
            Reset
          </button>
        </div>
      </div>

      <Reveal delayStep={0.05} index={0}>
        <div className="paper-bot-controls-strip">
          <div className="paper-bot-modes" role="group" aria-label="Bot trading mode">
            <button
              type="button"
              className={mode === 'safe' && !showVitals ? 'active' : ''}
              aria-pressed={mode === 'safe' && !showVitals}
              onClick={() => {
                onSetMode('safe')
                setShowVitals(false)
              }}
            >
              <ShieldCheck size={14} />
              Safe
            </button>
            <button
              type="button"
              className={mode === 'active' && !showVitals ? 'active' : ''}
              aria-pressed={mode === 'active' && !showVitals}
              onClick={() => {
                onSetMode('active')
                setShowVitals(false)
              }}
            >
              <Flame size={14} />
              Active
            </button>
            <button
              type="button"
              className={mode === 'turbo' && !showVitals ? 'active' : ''}
              aria-pressed={mode === 'turbo' && !showVitals}
              onClick={() => {
                onSetMode('turbo')
                setShowVitals(false)
              }}
            >
              <Rocket size={14} />
              Turbo
            </button>
          </div>

          <button
            type="button"
            className={`paper-bot-vitals-toggle ${showVitals ? 'active' : ''}`}
            onClick={() => setShowVitals(!showVitals)}
            aria-pressed={showVitals}
          >
            <Activity className={`vitals-icon ${showVitals ? 'heartbeat' : ''}`} size={14} />
            <span>Vitals</span>
            {showVitals && <span className="vitals-live-indicator" />}
          </button>
        </div>
      </Reveal>

      {showVitals ? (
        <Reveal delayStep={0.05} index={1}>
          <div className="paper-bot-vitals-container">
            {diagnostics && (
              <div className="paper-bot-diagnostics">
                <div className="paper-bot-diagnostics-head">
                  <strong>
                    <Gauge size={15} /> {diagnostics.mode} feedback
                  </strong>
                  <span>
                    {diagnostics.closedTrades} closed in {diagnostics.mode} · win rate {formatRate(diagnostics.winRate)} · expectancy{' '}
                    <b className={(diagnostics.expectancy ?? 0) >= 0 ? 'momentum-green' : 'momentum-red'}>
                      {diagnostics.expectancy === null ? 'n/a' : formatMoney(diagnostics.expectancy)}
                    </b>
                  </span>
                </div>
                <div className="paper-bot-diagnostic-metrics">
                  <span>
                    Profit factor <b>{formatRatio(diagnostics.profitFactor)}</b>
                  </span>
                  <span>
                    Avg win <b className="momentum-green">{diagnostics.avgWin === null ? 'n/a' : formatMoney(diagnostics.avgWin)}</b>
                  </span>
                  <span>
                    Avg loss <b className="momentum-red">{diagnostics.avgLoss === null ? 'n/a' : formatMoney(diagnostics.avgLoss)}</b>
                  </span>
                  <span>
                    Realized{' '}
                    <b className={diagnostics.realizedPl >= 0 ? 'momentum-green' : 'momentum-red'}>
                      {formatMoney(diagnostics.realizedPl)}
                    </b>
                  </span>
                </div>
                {diagnostics.costModeled && (
                  <div className="paper-bot-diagnostic-metrics paper-bot-net-metrics">
                    <span>
                      Net expectancy{' '}
                      <b className={(diagnostics.netExpectancy ?? 0) >= 0 ? 'momentum-green' : 'momentum-red'}>
                        {diagnostics.netExpectancy === null ? 'n/a' : formatMoney(diagnostics.netExpectancy)}
                      </b>
                    </span>
                    <span>
                      Net realized{' '}
                      <b className={diagnostics.netRealizedPl >= 0 ? 'momentum-green' : 'momentum-red'}>
                        {formatMoney(diagnostics.netRealizedPl)}
                      </b>
                    </span>
                    <span>
                      Net profit factor <b>{formatRatio(diagnostics.netProfitFactor)}</b>
                    </span>
                    <span>
                      Est. cost <b className="momentum-red">{formatMoney(diagnostics.estimatedCost)}</b>
                    </span>
                    <span className="paper-bot-net-caption">after modeled spread + slippage + fees · the live-realistic read</span>
                  </div>
                )}
                <div className="paper-bot-diagnostic-grid">
                  <div>
                    <strong>Weak exit buckets</strong>
                    {diagnostics.byExitReason.length === 0 ? (
                      <span className="paper-bot-empty">No closed exits yet.</span>
                    ) : (
                      diagnostics.byExitReason.slice(0, 4).map((bucket) => (
                        <article key={bucket.key}>
                          <b>{bucket.label}</b>
                          <span className={bucket.avgPnl >= 0 ? 'momentum-green' : 'momentum-red'}>{formatMoney(bucket.avgPnl)} avg</span>
                          <small>
                            {bucket.trades} trades · {bucket.wins}W / {bucket.losses}L · {formatMoney(bucket.realizedPl)}
                          </small>
                        </article>
                      ))
                    )}
                  </div>
                  <div>
                    <strong>Weak setup buckets</strong>
                    {diagnostics.bySetup.length === 0 ? (
                      <span className="paper-bot-empty">New trades will add setup context.</span>
                    ) : (
                      diagnostics.bySetup.slice(0, 4).map((bucket) => (
                        <article key={bucket.key}>
                          <b>{bucket.label}</b>
                          <span className={bucket.avgPnl >= 0 ? 'momentum-green' : 'momentum-red'}>{formatMoney(bucket.avgPnl)} avg</span>
                          <small>
                            {bucket.trades} trades · {bucket.wins}W / {bucket.losses}L · {formatMoney(bucket.realizedPl)}
                          </small>
                        </article>
                      ))
                    )}
                  </div>
                  <div>
                    <strong>What to fix</strong>
                    {diagnostics.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="paper-bot-diagnostics">
              <div className="paper-bot-diagnostics-head">
                <strong>
                  <Database size={15} /> Setup memory
                </strong>
                <span>Pattern fingerprints from closed bot trades, net of modeled execution costs.</span>
              </div>
              <div className="paper-bot-diagnostic-grid">
                <div>
                  <strong>Weak learned patterns</strong>
                  {weakSetupMemory.length === 0 ? (
                    <span className="paper-bot-empty">Closed trades with setup context will populate this.</span>
                  ) : (
                    weakSetupMemory.map((entry) => (
                      <article key={entry.key}>
                        <b>{entry.label}</b>
                        <span className="momentum-red">{formatMoney(entry.netAvgPnl)} net avg</span>
                        <small>
                          {entry.trades} trades · {entry.wins}W / {entry.losses}L · win {formatRate(entry.winRate)}
                        </small>
                      </article>
                    ))
                  )}
                </div>
                <div>
                  <strong>Strong learned patterns</strong>
                  {strongSetupMemory.length === 0 ? (
                    <span className="paper-bot-empty">No positive repeated pattern yet.</span>
                  ) : (
                    strongSetupMemory.map((entry) => (
                    <article key={entry.key}>
                      <b>{entry.label}</b>
                      <span className="momentum-green">{formatMoney(entry.netAvgPnl)} net avg</span>
                      <small>
                        {entry.trades} trades · {entry.wins}W / {entry.losses}L · win {formatRate(entry.winRate)}
                      </small>
                    </article>
                    ))
                  )}
                </div>
                <div>
                  <strong>How it is used</strong>
                  <p>Bad patterns with enough trades can block auto-entry.</p>
                  <p>Marginal negative patterns scale position size down.</p>
                  <p>Elite current setups can override old weak memory.</p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      ) : (
        <>
          <Reveal delayStep={0.05} index={1}>
            <div className={`paper-bot-live-strip ${liveStripState}`} role="status">
              <span>
                Status
                <b>
                  {running ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span className="live-dot" />
                      {draining ? 'Wind down' : 'Running'}
                    </span>
                  ) : (
                    'Idle'
                  )}
                </b>
              </span>
              <span>
                Tick
                <b>{running ? lastTick : '-'}</b>
              </span>
              <span>
                Floor
                <b>{minScore}+</b>
              </span>
              <span>
                Soft Target
                <b>{maxPositions > 0 ? `${positions.length}/${maxPositions}` : positions.length}</b>
              </span>
              <span>
                Risk Level
                <b>{bot?.riskLabel ?? '-'}</b>
              </span>
              <span>
                Crypto Venue
                <b>{cryptoVenue === 'binance' ? 'Binance' : 'Alpaca'}</b>
              </span>
            </div>
          </Reveal>

          <Reveal delayStep={0.05} index={2}>
            <div className={`paper-bot-mode-meter ${mode}`} aria-label="Current bot tuning">
              <div>
                <span>
                  Filter <b>{modeTune.filter}</b>
                </span>
                <span>
                  Exit <b>{modeTune.exit}</b>
                </span>
                <span>
                  Liquidity <b>{modeTune.liquidity}</b>
                </span>
              </div>
              <i aria-hidden="true" />
            </div>
          </Reveal>

          <Reveal delayStep={0.05} index={3}>
            <p className="paper-bot-note">
              {mode === 'safe'
                ? 'Safe: auto-trades only a curated list of liquid majors on the strictest gate (score 90+, fresh quote, tight spread), fewer, cleaner entries.'
                : mode === 'active'
                  ? `Active: auto-trades the ${cryptoVenue === 'binance' ? 'Binance spot crypto universe' : 'Alpaca-tradable universe'} on a confirmed, risk-sized gate (momentum score 90+, reversion ${reversionMinScore}+, $50M+ crypto, fresh quote, volume pulse).`
                  : 'Turbo: an optimized paper-scalp mode with verified data, $40M+ crypto liquidity, green-trend pulse, two-tick confirmation, adaptive trailing, cash-aware sizing, and 35m time exits. More wins AND losses; not a serious strategy.'}{' '}
              Stocks trade only during US market hours; crypto executes on {cryptoVenueLabel}.
            </p>

            <details className="paper-bot-rules">
              <summary>
                Strategy details
                <span>
                  {mode === 'safe'
                    ? 'Strict · curated majors'
                    : mode === 'active'
                      ? 'Strict+ · risk-sized'
                      : 'Turbo · scalp'}
                </span>
              </summary>
              <div className="paper-bot-rules-tags" aria-label="Paper bot entry rules">
                <span>{mode === 'turbo' ? `floor ${minScore}+ turbo` : `momentum floor ${minScore}+`}</span>
                <span>reversion floor {reversionMinScore}+</span>
                <span>{mode === 'turbo' ? 'VWAP/reclaim' : 'VWAP held'}</span>
                <span>{mode === 'safe' ? 'curated majors' : cryptoVenue === 'binance' ? 'Binance spot scan' : 'all Alpaca pairs'}</span>
                <span>{mode === 'turbo' ? 'pulse + liquidity' : 'fresh quote + tight spread'}</span>
                <span>{mode === 'turbo' ? 'adaptive trail' : 'risk trail'}</span>
                <span>{sizeMultiplier}x paper sizing</span>
                <span>{maxPositions > 0 ? `${maxPositions} soft target` : 'cash-driven'}</span>
                <span>{paperTrading ? 'cash-aware sizing' : 'hard live cap'}</span>
                <span>{paperTrading ? 'no paper daily caps' : 'live risk guard'}</span>
                <span>{cryptoVenue === 'binance' ? 'Binance testnet crypto' : 'Alpaca tradable'}</span>
                <span>risk: {bot?.riskLabel ?? '-'}</span>
              </div>
            </details>
          </Reveal>

          {!configured && (
            <p className="paper-bot-note">
              <span className="momentum-red">
                Broker keys not detected. Add the required Alpaca/Binance values to .env.local and restart the dev server.
              </span>
            </p>
          )}
          {configured && !accountReady && (
            <p className="paper-bot-note">
              <span className="momentum-red">
                Broker account is not readable yet. Check the key/secret pairs, then restart npm run dev.
              </span>
            </p>
          )}
          {configured && bot?.lastError && (
            <p className="paper-bot-note">
              <span className="momentum-red">Last issue: {bot.lastError}</span>
            </p>
          )}
          {configured && riskPause && (
            <p className="paper-bot-note">
              <span className="momentum-red">Risk warning: {riskPause}</span>
            </p>
          )}
          {draining && (
            <p className="paper-bot-note">
              <span className="momentum-green">
                Wind-down is active: the bot will not open new buys and will keep managing existing exits.
              </span>
            </p>
          )}

          <Reveal delayStep={0.05} index={4}>
            <div className="paper-bot-hero">
              <div className="paper-bot-hero-card primary">
                <span>Equity</span>
                <strong>{account ? <Counter to={account.equity} prefix="$" decimals={2} /> : 'n/a'}</strong>
                <small>
                  {account
                    ? (
                      <>
                        Cash <Counter to={account.cash} prefix="$" decimals={2} /> · Buying power <Counter to={account.buyingPower} prefix="$" decimals={2} />
                      </>
                    )
                    : 'Broker not connected'}
                </small>
              </div>
              <div className="paper-bot-hero-card pnl">
                <span>Realized P/L</span>
                <strong className={stats.realizedPl >= 0 ? 'momentum-green' : 'momentum-red'}>
                  <Counter to={stats.realizedPl} prefix="$" decimals={2} />
                </strong>
                <small>
                  <Counter to={stats.wins} />W · <Counter to={stats.losses} />L
                  {stats.closedTrades > 0 ? (
                    <>
                      {' · '}<Counter to={Math.round((stats.wins / stats.closedTrades) * 100)} suffix="%" /> win rate
                    </>
                  ) : ''}
                </small>
              </div>
            </div>
          </Reveal>

          <Reveal delayStep={0.05} index={5}>
            <div className="paper-bot-stats">
              <div>
                <TrendingUp size={16} />
                <span>Positions</span>
                <strong>
                  {maxPositions > 0 ? (
                    <>
                      <Counter to={positions.length} />/{maxPositions} soft
                    </>
                  ) : (
                    <Counter to={positions.length} />
                  )}
                </strong>
              </div>
              <div>
                <Database size={16} />
                <span>Open orders</span>
                <strong><Counter to={openOrders.length} /></strong>
              </div>
              <div>
                <Target size={16} />
                <span>Armed Setups</span>
                <strong><Counter to={armedCount} /></strong>
              </div>
              <div>
                <Zap size={16} />
                <span>Triggered</span>
                <strong><Counter to={triggeredCount} /></strong>
              </div>
              <div>
                <Clock size={16} />
                <span>Last Tick</span>
                <strong>{running ? lastTick : 'idle'}</strong>
              </div>
            </div>
          </Reveal>

          <Reveal delayStep={0.05} index={6}>
            <div className={`paper-bot-overview${configured && macroEvents.length > 0 ? '' : ' is-solo'}`}>
              <PaperBotPerformanceChart
                series={equitySeries}
                history={history}
                account={account}
                netRealizedPl={diagnostics?.netRealizedPl ?? null}
                theme={theme}
              />

              {configured && macroEvents.length > 0 && (
                <div className={`paper-bot-calendar${macroBlackoutActive ? ' is-active' : ''}`}>
                  <div className="paper-bot-calendar-head">
                    <strong>
                      <CalendarDays size={15} /> Macro calendar
                    </strong>
                    <span>
                      {macroBlackoutActive
                        ? 'Blackout active, new entries paused through the print'
                        : 'New entries pause briefly around these prints; exits keep running'}
                    </span>
                  </div>
                  <ul>
                    {macroEvents.map((event) => (
                      <li key={`${event.label}-${event.at}`} className={event.active ? 'active' : ''}>
                        <span className="paper-bot-calendar-when">{formatMacroWhen(event.at)}</span>
                        <span className="paper-bot-calendar-label">{event.label}</span>
                        <span className="paper-bot-calendar-eta">{formatMacroEta(event)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Reveal>

          <div className="paper-bot-watch">
            <strong>
              What the bot sees{running ? '' : ' · paused'}
            </strong>
            {watch.length === 0 ? (
              <span className="paper-bot-empty">
                {running ? 'Bot loop running; waiting for the next watchlist tick.' : 'Start the bot to populate its watchlist.'}
              </span>
            ) : (
              <ul>
                {watch.map((entry) => (
                  <li className={`bot-watch-row ${entry.state}`} key={`${entry.assetClass}-${entry.symbol}`}>
                    <div className="bot-watch-main">
                      <span className={`bot-watch-state ${entry.state}`}>{entry.state}</span>
                      <b>{entry.symbol}</b>
                      <strong>{formatMoney(entry.price)}</strong>
                    </div>
                    <div className="bot-watch-wait">
                      <span>Waiting for</span>
                      <b>{entry.waitingFor ?? entry.note}</b>
                      <small>{entry.nextCheck ?? entry.note}</small>
                    </div>
                    <div className="bot-watch-facts">
                      <span>
                        Score <b>{entry.score}</b>{' '}
                        {typeof entry.scoreFloor === 'number' && <small>/ floor {entry.scoreFloor}</small>}
                      </span>
                      {entry.strategy === 'reversion' && <span className="bot-watch-strategy reversion">Mean reversion</span>}
                      <span>{entry.assetClass}</span>
                      <span>{statusLabels[entry.status]}</span>
                      {entry.technical && (
                        <span className={`bot-watch-tech ${technicalClass(entry.technical)}`}>
                          Edge <b>{entry.technical.edgeScore}</b>
                        </span>
                      )}
                      {entry.technical && <span>{formatTrendLabel(entry.technical.trendLabel)}</span>}
                      {entry.technical && <span>{entry.technical.fibZone}</span>}
                      {entry.trigger !== null && (
                        <span>
                          Trigger <b>{formatMoney(entry.trigger)}</b>
                        </span>
                      )}
                      {entry.holding && (
                        <span className={entry.holding.unrealizedPl >= 0 ? 'momentum-green' : 'momentum-red'}>
                          Live P/L{' '}
                          <b>
                            {formatMoney(entry.holding.unrealizedPl)} ({formatPercent(entry.holding.unrealizedPlPct)})
                          </b>
                        </span>
                      )}
                    </div>
                    {(entry.state === 'triggered' || entry.state === 'holding') && entry.tradePlan && (
                      <div className="bot-watch-plan" aria-label={`${entry.symbol} trade plan`}>
                        {entry.holding && (
                          <span className={entry.holding.unrealizedPl >= 0 ? 'profit' : 'loss'}>
                            <small>Live P/L</small>
                            <b>
                              {formatMoney(entry.holding.unrealizedPl)} ({formatPercent(entry.holding.unrealizedPlPct)})
                            </b>
                          </span>
                        )}
                        <span>
                          <small>{entry.state === 'holding' ? 'Avg entry' : 'Buy at/near'}</small>
                          <b>{formatMoney(entry.tradePlan.buy)}</b>
                        </span>
                        <span className="risk">
                          <small>Stop</small>
                          <b>{formatMoney(entry.tradePlan.stop)}</b>
                        </span>
                        <span className="target">
                          <small>Sell 1</small>
                          <b>{formatMoney(entry.tradePlan.target1)}</b>
                        </span>
                        <span className="target">
                          <small>Sell 2</small>
                          <b>{formatMoney(entry.tradePlan.target2)}</b>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="paper-bot-grid">
            <div>
              <strong>Open positions</strong>
              {positions.length === 0 ? (
                <span className="paper-bot-empty">No open bot positions.</span>
              ) : (
                positions.map((position) => (
                  <article key={position.symbol}>
                    <b>{position.displaySymbol}</b>
                    <span>{formatMoney(position.currentPrice)}</span>
                    <small className={position.unrealizedPlPct >= 0 ? 'momentum-green' : 'momentum-red'}>
                      {position.venue === 'binance' ? 'Binance testnet' : 'Alpaca paper'} · {formatMoney(position.unrealizedPl)} ({formatPercent(position.unrealizedPlPct)}) live P/L
                      {position.stop !== null ? ` · stop ${formatMoney(position.stop)}` : ''}
                    </small>
                  </article>
                ))
              )}
            </div>
            <div>
              <strong>Live activity</strong>
              {botLog.length === 0 && orders.length === 0 ? (
                <span className="paper-bot-empty">No bot activity yet.</span>
              ) : botLog.length > 0 ? (
                botLog.slice(0, 6).map((entry) => (
                  <article key={entry.id}>
                    <b>{entry.symbol}</b>
                    <span>{formatBotLogTime(entry.time)}</span>
                    <small className={botLogClass(entry.level)}>{entry.message}</small>
                  </article>
                ))
              ) : (
                orders.slice(0, 6).map((order) => (
                  <article key={order.id}>
                    <b>
                      {order.side.toUpperCase()} {order.symbol}
                    </b>
                    <span>{order.filledAvgPrice !== null ? formatMoney(order.filledAvgPrice) : ''}</span>
                    <small>{order.status}</small>
                  </article>
                ))
              )}
            </div>
            <div>
              <strong>Win/loss history</strong>
              {history.length === 0 ? (
                <span className="paper-bot-empty">No closed bot trades yet.</span>
              ) : (
                history.slice(0, 8).map((entry) => (
                  <article key={entry.id}>
                    <b>
                      {entry.side.toUpperCase()} {entry.symbol}
                    </b>
                    <span>{formatBotLogTime(entry.time)}</span>
                    <small className={botHistoryClass(entry)}>
                      {entry.outcome.toUpperCase()} {entry.price !== null ? `@ ${formatMoney(entry.price)}` : ''}
                      {entry.pnl !== null ? ` / ${formatMoney(entry.pnl)}` : ''}
                      {entry.pnlPct !== null ? ` / ${formatPercent(entry.pnlPct)}` : ''}
                      {' - '}
                      {entry.reason}
                    </small>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="paper-bot-journal">
            <div className="paper-bot-journal-head">
              <strong>
                <CalendarDays size={15} /> Trade journal
              </strong>
              <span>
                {stats.closedTrades} closed · {stats.wins}W / {stats.losses}L · realized{' '}
                <b className={stats.realizedPl >= 0 ? 'momentum-green' : 'momentum-red'}>{formatMoney(stats.realizedPl)}</b>
              </span>
            </div>
            {journal.length === 0 ? (
              <span className="paper-bot-empty">No trades yet, start the bot (try Turbo to see lots quickly).</span>
            ) : (
              <>
              {journal.slice(0, JOURNAL_MAX_DAYS).map((day) => (
                <div className="paper-bot-day" key={day.key}>
                  <div className="paper-bot-day-head">
                    <b>{day.label}</b>
                    <span className={day.realized >= 0 ? 'momentum-green' : 'momentum-red'}>
                      {formatMoney(day.realized)}
                    </span>
                    <small>
                      {day.trades.length} trades · {day.wins}W / {day.losses}L
                    </small>
                  </div>
                  <ul>
                    {day.trades.slice(0, JOURNAL_MAX_PER_DAY).map((entry) => {
                      const risk = riskBadge(entry.mode)
                      return (
                        <li key={entry.id}>
                          <span className={`trade-side ${entry.side}`}>{entry.side}</span>
                          <b>{entry.symbol}</b>
                          <span className={`risk-badge ${risk.cls}`}>{risk.label}</span>
                          <span className="trade-meta">
                            {formatBotLogTime(entry.time)}
                            {entry.price !== null ? ` · ${formatMoney(entry.price)}` : ''}
                            {entry.notional !== null ? ` · ${formatMoney(entry.notional)}` : ''}
                            {formatHold(entry.holdSeconds)}
                            {entry.side === 'sell' && entry.maxFavorableR != null
                              ? ` · ran +${entry.maxFavorableR}R / -${entry.maxAdverseR ?? 0}R before exit`
                              : ''}
                            {entry.setup?.technical ? ` / edge ${entry.setup.technical.edgeScore} / ${entry.setup.technical.fibZone}` : ''}
                            {entry.setup ? ` · ${entry.setup.entryMode} · score ${entry.setup.score}` : ''}
                          </span>
                          <span className="trade-pnl">
                            {entry.side === 'sell' && entry.pnl !== null ? (
                              <b className={entry.pnl >= 0 ? 'momentum-green' : 'momentum-red'}>
                                {formatMoney(entry.pnl)}
                                {entry.pnlPct !== null ? ` (${formatPercent(entry.pnlPct)})` : ''}
                              </b>
                            ) : (
                              <span className="trade-open">{entry.outcome === 'open' ? 'entry' : entry.outcome}</span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  {day.trades.length > JOURNAL_MAX_PER_DAY && (
                    <small className="paper-bot-day-more">+{day.trades.length - JOURNAL_MAX_PER_DAY} more this day</small>
                  )}
                </div>
              ))}
              {journal.length > JOURNAL_MAX_DAYS && (
                <small className="paper-bot-day-more">
                  Showing last {JOURNAL_MAX_DAYS} days · {journal.length - JOURNAL_MAX_DAYS} earlier day(s) hidden
                </small>
              )}
              </>
            )}
          </div>
        </>
      )}

      {stopChoiceOpen && (
        <div className="paper-bot-stop-dialog" role="dialog" aria-modal="true" aria-label="Stop paper bot">
          <div>
            <strong>Stop while positions are open?</strong>
            <span>
              Stop now cancels open bot buys and sends sell orders for every open bot position. Wind down pauses new
              buys and lets the bot manage existing exits.
            </span>
          </div>
          <div>
            <button type="button" className="danger" onClick={() => confirmStop('immediate')}>
              <Square size={14} />
              Stop now + sell
            </button>
            <button type="button" className="primary" onClick={() => confirmStop('drain')}>
              <ShieldCheck size={14} />
              Wind down
            </button>
            <button type="button" onClick={() => setStopChoiceOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export function StockMomentumRadar() {
  const [snapshot, setSnapshot] = useState<MomentumSnapshot | null>(null)
  const [activeView, setActiveView] = useState<RadarView>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.toLowerCase()
      if (hash.includes('assistant')) return 'assistant'
      if (hash.includes('bot')) return 'bot'
    }
    return 'signals'
  })
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('stock')
  const [capFilter, setCapFilter] = useState<CapFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [theme, setTheme] = useState<RadarTheme>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      const stored = window.localStorage.getItem(RADAR_THEME_STORAGE_KEY)
      return stored === 'light' || stored === 'dark' ? stored : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => 'Notification' in window && Notification.permission === 'granted',
  )
  const [alerts, setAlerts] = useState<RadarAlert[]>([])
  const [lastLiveAt, setLastLiveAt] = useState<string | null>(null)
  const [botState, setBotState] = useState<BotState | null>(null)
  const [positions, setPositions] = useState<Record<string, TrackedPosition>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      return JSON.parse(window.localStorage.getItem(POSITIONS_STORAGE_KEY) || '{}') as Record<string, TrackedPosition>
    } catch {
      return {}
    }
  })
  const firstLoad = useRef(true)
  const previousStatuses = useRef<Record<string, MomentumStatus>>({})

  useEffect(() => {
    try {
      window.localStorage.setItem(RADAR_THEME_STORAGE_KEY, theme)
    } catch {
      // storage can be unavailable (private mode), the selected theme still works for the session
    }
  }, [theme])

  useEffect(() => {
    try {
      window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions))
    } catch {
      // storage can be unavailable (private mode), guidance still works for the session
    }
  }, [positions])

  const enterPosition = useCallback((candidate: MomentumCandidate) => {
    const setup = classifySetup(candidate)
    const trackedStop = manualTrackerStop(candidate)
    setPositions((current) => ({
      ...current,
      [candidate.ticker]: {
        ticker: candidate.ticker,
        displaySymbol: candidate.displaySymbol,
        assetClass: candidate.assetClass,
        entryPrice: candidate.price,
        entryAt: new Date().toISOString(),
        trigger: candidate.signal.entryTrigger,
        stop: trackedStop,
        plannedStop: candidate.signal.stopLoss,
        target1: candidate.signal.targetOne,
        target2: candidate.signal.targetTwo,
        score: candidate.score,
        setupLabel: setup.label,
      },
    }))
  }, [])

  const exitPosition = useCallback((ticker: string) => {
    setPositions((current) => {
      const next = { ...current }
      delete next[ticker]
      return next
    })
  }, [])

  const playTone = useCallback(() => {
    if (muted) return
    try {
      const context = new AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.2)
      window.setTimeout(() => void context.close(), 260)
    } catch {
      // Audio can be blocked until the user interacts with the page.
    }
  }, [muted])

  const triggerAlert = useCallback(
    (candidate: MomentumCandidate) => {
      if (!alertIsValidCandidate(candidate)) return
      playTone()
      setAlerts((current) => {
        const existing = current.find((alert) => alert.ticker === candidate.ticker)
        const next = alertFromCandidate(candidate, existing?.id)
        return [next, ...current.filter((alert) => alert.ticker !== candidate.ticker)].slice(0, 5)
      })
      if ('Notification' in window && notificationsEnabled && Notification.permission === 'granted') {
        const message = alertFromCandidate(candidate).message
        new Notification(`Momentum radar: ${candidate.ticker}`, {
          body: message,
          tag: `momentum-${candidate.ticker}`,
        })
      }
    },
    [notificationsEnabled, playTone],
  )

  const dismissAlert = useCallback((id: string) => {
    setAlerts((current) => current.filter((alert) => alert.id !== id))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setAlerts((current) => current.filter((alert) => alert.validUntil > now))
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const focusAlert = useCallback((ticker: string) => {
    setActiveView('signals')
    setAssetFilter('all')
    window.setTimeout(() => {
      document.getElementById(signalRowId(ticker))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 40)
  }, [])

  const loadScan = useCallback(
    async (mode: 'initial' | 'manual' | 'auto' = 'manual') => {
      if (mode !== 'auto') setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/momentum', { headers: { accept: 'application/json' } })
        const contentType = response.headers.get('content-type') || ''
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error('Momentum endpoint is not available.')
        }
        const data = (await response.json()) as MomentumSnapshot | { ok: false; error?: string }
        if (!data.ok) {
          throw new Error(data.error || 'Market data source failed.')
        }
        const nextStatuses = Object.fromEntries(
          data.candidates.map((candidate) => [candidate.ticker, candidate.status]),
        ) as Record<string, MomentumStatus>

        if (!firstLoad.current) {
          data.shortlist
            .filter(
              (candidate) =>
                candidate.status === 'CHECK NOW' && previousStatuses.current[candidate.ticker] !== 'CHECK NOW',
            )
            .forEach(triggerAlert)
        }
        setAlerts((current) => syncAlertsWithCandidates(current, data.candidates))

        previousStatuses.current = nextStatuses
        firstLoad.current = false
        setLastLiveAt(null)
        setSnapshot(data)
      } catch (scanError) {
        const message = scanError instanceof Error ? scanError.message : 'Could not load the radar scan.'
        setError(message)
      } finally {
        if (mode !== 'auto') setLoading(false)
      }
    },
    [triggerAlert],
  )

  useEffect(() => {
    const startup = window.setTimeout(() => void loadScan('initial'), 0)
    return () => {
      window.clearTimeout(startup)
    }
  }, [loadScan])

  useEffect(() => {
    const intervalMs = Math.max(30_000, (snapshot?.nextScanSeconds ?? 60) * 1000)
    const timer = window.setInterval(() => void loadScan('auto'), intervalMs)
    return () => window.clearInterval(timer)
  }, [loadScan, snapshot?.nextScanSeconds])

  const refreshLiveShortlist = useCallback(async () => {
    if (!snapshot?.shortlist.length) return
    try {
      const response = await fetch('/api/momentum/live', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ candidates: snapshot.shortlist }),
      })
      const data = (await response.json()) as MomentumLiveResponse
      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? 'Live market refresh failed.' : data.error || 'Live market refresh failed.')
      }
      const replacements = new Map(data.candidates.map((candidate) => [candidate.ticker, candidate]))

      data.candidates
        .filter(
          (candidate) =>
            candidate.status === 'CHECK NOW' && previousStatuses.current[candidate.ticker] !== 'CHECK NOW',
        )
        .forEach(triggerAlert)
      setAlerts((current) => syncAlertsWithCandidates(current, data.candidates))

      setSnapshot((current) => {
        if (!current) return current
        const replaceCandidate = (candidate: MomentumCandidate) => replacements.get(candidate.ticker) ?? candidate
        const candidates = sortRadarCandidates(current.candidates.map(replaceCandidate))
        const shortlist = current.shortlist.map(replaceCandidate)
        previousStatuses.current = Object.fromEntries(
          candidates.map((candidate) => [candidate.ticker, candidate.status]),
        ) as Record<string, MomentumStatus>
        return { ...current, candidates, shortlist, liveRefreshSeconds: data.nextLiveSeconds }
      })
      setLastLiveAt(data.generatedAt)
    } catch {
      setLastLiveAt((current) => current)
    }
  }, [snapshot, triggerAlert])

  useEffect(() => {
    if (!snapshot?.shortlist.length) return
    const intervalMs = Math.max(1_000, (snapshot.liveRefreshSeconds ?? 5) * 1000)
    const timer = window.setInterval(() => void refreshLiveShortlist(), intervalMs)
    return () => window.clearInterval(timer)
  }, [refreshLiveShortlist, snapshot?.liveRefreshSeconds, snapshot?.shortlist.length])

  const fetchBotState = useCallback(async () => {
    try {
      const response = await fetch('/api/paper-bot/state', { headers: { accept: 'application/json' } })
      const data = (await response.json()) as BotState | { ok: false; error?: string }
      if (data.ok) setBotState(data)
    } catch {
      // keep the last known bot state on a transient error
    }
  }, [])

  const controlBot = useCallback(
    async (action: 'start' | 'stop' | 'reset', stopMode?: BotStopMode) => {
      try {
        const suffix = action === 'stop' && stopMode ? `?mode=${stopMode}` : ''
        await fetch(`/api/paper-bot/${action}${suffix}`, { method: 'POST', headers: BOT_CONTROL_HEADERS })
      } catch {
        // ignore; the next poll will reflect the real state
      }
      void fetchBotState()
    },
    [fetchBotState],
  )

  const setBotMode = useCallback(
    async (mode: BotMode) => {
      setBotState((current) => (current ? { ...current, mode, modeLabel: current.modeLabel } : current))
      try {
        await fetch(`/api/paper-bot/mode?mode=${mode}`, { method: 'POST', headers: BOT_CONTROL_HEADERS })
      } catch {
        // ignore; the next poll will reconcile the real mode
      }
      void fetchBotState()
    },
    [fetchBotState],
  )

  useEffect(() => {
    const startup = window.setTimeout(() => void fetchBotState(), 0)
    const timer = window.setInterval(() => void fetchBotState(), PAPER_BOT_POLL_MS)
    return () => {
      window.clearTimeout(startup)
      window.clearInterval(timer)
    }
  }, [fetchBotState])

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setAlerts((current) => [
        {
          id: `unsupported-${Date.now()}`,
          ticker: 'SYS',
          message: 'Browser notifications are not supported here.',
          status: 'DATA ERROR',
          price: 0,
          entry: null,
          stop: null,
          target1: null,
          target2: null,
          risk: null,
          movePct: null,
          validUntil: Date.now() + 12_000,
        },
        ...current,
      ])
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationsEnabled(permission === 'granted')
  }

  const updatedAt = useMemo(() => {
    if (!snapshot) return 'not scanned yet'
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(snapshot.generatedAt))
  }, [snapshot])

  const liveUpdatedAt = useMemo(() => {
    if (!lastLiveAt) return 'waiting'
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(lastLiveAt))
  }, [lastLiveAt])

  // Every candidate that clears the strict trade gate, both asset classes,
  // sorted. The asset filter (All / Stocks / Crypto) narrows this down for the
  // table; counts for the filter chips come from this full list.
  const strictCandidates = useMemo(() => {
    const list = snapshot?.candidates ?? []
    return sortRadarCandidates(list.filter(isStrictTraderCandidate))
  }, [snapshot])

  const assetCounts = useMemo(
    () => ({
      all: strictCandidates.length,
      stock: strictCandidates.filter((candidate) => candidate.assetClass === 'stock').length,
      crypto: strictCandidates.filter((candidate) => candidate.assetClass === 'crypto').length,
    }),
    [strictCandidates],
  )

  const capCounts = useMemo(() => {
    const stockRows = (snapshot?.candidates ?? []).filter(
      (candidate) => candidate.assetClass === 'stock' && candidate.status !== 'DATA ERROR' && isRealMover(candidate),
    )
    const counts: Record<CapFilter, number> = {
      all: stockRows.length,
      'micro-small': 0,
      mid: 0,
      large: 0,
      unknown: 0,
    }
    for (const candidate of stockRows) {
      counts[stockCapBand(candidate)] += 1
    }
    return counts
  }, [snapshot])

  const visibleCandidates = useMemo(() => {
    const byAsset =
      assetFilter === 'all' ? strictCandidates : strictCandidates.filter((candidate) => candidate.assetClass === assetFilter)
    const byCap = byAsset.filter((candidate) => matchesCapFilter(candidate, capFilter))
    // Held positions are pinned at the top in their own section, so drop them
    // from the regular list to avoid showing the same ticker twice.
    return byCap.filter((candidate) => !positions[candidate.ticker])
  }, [strictCandidates, assetFilter, capFilter, positions])

  // Latest candidate (carrying the live price) keyed by ticker, so an open
  // position's guidance tracks the same 5s live refresh the shortlist uses.
  const priceByTicker = useMemo(
    () => new Map((snapshot?.candidates ?? []).map((candidate) => [candidate.ticker, candidate] as const)),
    [snapshot],
  )
  const trackedPositions = useMemo(() => Object.values(positions), [positions])

  // The context rows under the strict list: movers that did NOT clear the strict
  // gate, shown as NO TRADE, never actionable. Honors the asset filter so a
  // Stocks-only or Crypto-only view never shows the other class as context.
  //
  // Two modes:
  //   • near-miss: genuine 5%+ movers in the selected band, ranked by how close
  //     they are to a signal (setup score).
  //   • movers: fallback when nothing tradable-grade is in the selected band.
  //     Rather than an empty screen, surface the biggest % movers ranked by the
  //     size of today's move so you always see what's running hardest and how
  //     close it is. The 5% bar is relaxed (small-caps often move less) and, if
  //     the selected band is itself empty, we broaden to every cap, cap data is
  //     frequently missing on exactly the low-float names a Small filter wants,
  //     so respecting the band literally would just show nothing.
  const nearMissCandidates = useMemo(() => {
    const list = snapshot?.candidates ?? []
    const strict = new Set(strictCandidates.map((candidate) => candidate.ticker))
    // "Closest to a signal" leads with setup quality (score), then move size.
    const byScore = (a: MomentumCandidate, b: MomentumCandidate) =>
      b.score - a.score || b.changePct - a.changePct
    // The big-movers fallback leads with the size of today's % move.
    const byMove = (a: MomentumCandidate, b: MomentumCandidate) =>
      b.changePct - a.changePct || b.score - a.score
    const eligible = (candidate: MomentumCandidate) =>
      !strict.has(candidate.ticker) && candidate.status !== 'DATA ERROR' && candidate.price > 0
    // Collapse duplicate tickers (the scan can carry the same name twice, e.g. a
    // US listing and its ADR) so they never share a React key or double up.
    const dedupe = (items: MomentumCandidate[]) => {
      const seen = new Set<string>()
      return items.filter((candidate) => !seen.has(candidate.ticker) && seen.add(candidate.ticker))
    }

    // Computed in one expression (no render-scope reassignment) so the flags
    // travel with the rows: fallback = relaxed the 5% bar to show movers;
    // broadened = had to look past the selected cap band to find any.
    const stockResult = (() => {
      if (assetFilter === 'crypto') return { stocks: [] as MomentumCandidate[], fallback: false, broadened: false }
      const stockPool = list.filter((candidate) => eligible(candidate) && candidate.assetClass === 'stock')
      const inBand = stockPool.filter((candidate) => matchesCapFilter(candidate, capFilter))
      const movers = inBand.filter(isRealMover)
      // Preferred: genuine 5%+ movers in the selected band, closest to a signal.
      if (movers.length > 0) return { stocks: dedupe(movers.sort(byScore)).slice(0, 3), fallback: false, broadened: false }
      // Fallback: relax the 5% bar to today's actual up-movers in the band, and
      // if the band itself is empty (no small-cap names with cap data, say),
      // broaden to every cap so the biggest movers still show. Each row carries
      // its own cap-band tag, and the heading says it's all-cap.
      const inBandUp = inBand.filter((candidate) => candidate.changePct > 0)
      const broadened = inBandUp.length === 0 && capFilter !== 'all'
      const base = broadened ? stockPool.filter((candidate) => candidate.changePct > 0) : inBandUp
      return { stocks: dedupe(base.sort(byMove)).slice(0, 6), fallback: true, broadened }
    })()
    const crypto =
      assetFilter === 'stock' || capFilter !== 'all'
        ? []
        : list
            .filter((candidate) => eligible(candidate) && candidate.assetClass === 'crypto' && isRealMover(candidate))
            .sort(byScore)
            .slice(0, 3)
    const rows = dedupe([...stockResult.stocks, ...crypto].sort(stockResult.fallback ? byMove : byScore))
    return { rows, fallback: stockResult.fallback, broadened: stockResult.broadened }
  }, [snapshot, strictCandidates, assetFilter, capFilter])

  const dataErrorCandidates = useMemo(() => {
    const list = snapshot?.candidates ?? []
    return list.filter((candidate) => candidate.status === 'DATA ERROR').slice(0, 4)
  }, [snapshot])

  const visibleCounts = useMemo(() => {
    const list = visibleCandidates
    const scanned = snapshot ? snapshot.assetCounts.stock + snapshot.assetCounts.crypto : 0
    return {
      checkNow: list.filter((candidate) => candidate.status === 'CHECK NOW').length,
      watch: list.filter((candidate) => candidate.status === 'WATCH').length,
      strict: list.length,
      scanned,
      stock: list.filter((candidate) => candidate.assetClass === 'stock').length,
      crypto: list.filter((candidate) => candidate.assetClass === 'crypto').length,
    }
  }, [snapshot, visibleCandidates])

  const assetNoun = assetFilter === 'stock' ? 'stock' : assetFilter === 'crypto' ? 'crypto' : 'crypto + stock'
  const filteredAssetNoun = assetFilter !== 'crypto' && capFilter !== 'all' ? capFilterNouns[capFilter] : assetNoun

  return (
    <div className={`stock-radar radar-theme-${theme}`}>
      <div className="momentum-hero">
        <div>
          <p className="eyebrow">{activeView === 'signals' ? 'Stock-first momentum signals' : 'Paper bot execution'}</p>
          <h3>{activeView === 'signals' ? 'Trade shortlist' : 'Bot command center'}</h3>
        </div>
        <div className="momentum-actions">
          <button
            type="button"
            className="radar-theme-toggle"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'dark' ? 'Dark' : 'Bright'}
          </button>
          <button type="button" onClick={() => void loadScan('manual')} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Rescan
          </button>
          <button type="button" onClick={requestNotifications} className={notificationsEnabled ? 'active' : ''}>
            {notificationsEnabled ? <BellRing size={16} /> : <Bell size={16} />}
            Alerts
          </button>
          <button type="button" onClick={() => setMuted((value) => !value)} aria-pressed={muted}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            {muted ? 'Muted' : 'Sound'}
          </button>
        </div>
      </div>

      <div className="radar-view-tabs" role="tablist" aria-label="Radar workspace">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'signals'}
          className={activeView === 'signals' ? 'active' : ''}
          onClick={() => setActiveView('signals')}
        >
          <TrendingUp size={20} />
          <span>
            <b>My trade list</b>
            <small>stock-first strict setups</small>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'bot'}
          className={activeView === 'bot' ? 'active' : ''}
          onClick={() => setActiveView('bot')}
        >
          <Bot size={20} />
          <span>
            <b>Paper bot</b>
            <small>{botState?.running ? 'running execution checks' : 'execution view'}</small>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'assistant'}
          className={activeView === 'assistant' ? 'active' : ''}
          onClick={() => setActiveView('assistant')}
        >
          <Sparkles size={20} />
          <span>
            <b>Local Assistant</b>
            <small>Ask portfolio, stocks & bot AI</small>
          </span>
        </button>
      </div>

      {activeView === 'signals' ? (
        <>
          {trackedPositions.length > 0 && (
            <Reveal delayStep={0.05} index={0}>
              <div className="held-section" aria-label="Your open trades">
                <div className="held-head">
                  <Wallet size={15} />
                  <strong>Holding · {trackedPositions.length}</strong>
                  <small>Pinned while you're in, live guidance follows the price. The radar places no real orders.</small>
                </div>
                {trackedPositions.map((position) => (
                  <HeldPositionRow
                    key={position.ticker}
                    position={position}
                    candidate={priceByTicker.get(position.ticker)}
                    onExit={exitPosition}
                  />
                ))}
              </div>
            </Reveal>
          )}

          {(loading || !snapshot) && (
            <Reveal delayStep={0.05} index={1}>
              <div className="momentum-scan-loader" role="status">
                <div>
                  <Loader2 size={17} className="spin" />
                  <strong>{snapshot ? 'Refreshing scan' : 'Scanning market'}</strong>
                  <span>Checking price, VWAP, volume, spread, and data quality.</span>
                </div>
                <div className="scan-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </Reveal>
          )}

          <Reveal delayStep={0.05} index={2}>
            <div className="momentum-stats">
              <div>
                <Zap size={18} />
                <span>Confirmed</span>
                <strong><Counter to={visibleCounts.checkNow} /></strong>
              </div>
              <div>
                <TrendingUp size={18} />
                <span>Watch</span>
                <strong><Counter to={visibleCounts.watch} /></strong>
              </div>
              <div>
                <Filter size={18} />
                <span>Strict rows</span>
                <strong><Counter to={visibleCounts.strict} /></strong>
              </div>
              <div>
                <Database size={18} />
                <span>Scanned</span>
                <strong><Counter to={visibleCounts.scanned} /></strong>
              </div>
              <div>
                <Gauge size={18} />
                <span>Updated</span>
                <strong>{updatedAt}</strong>
              </div>
            </div>
          </Reveal>

          <Reveal delayStep={0.05} index={3}>
            <div className="radar-asset-filter" role="group" aria-label="Filter shortlist by asset class">
              <button
                type="button"
                className={assetFilter === 'all' ? 'active' : ''}
                aria-pressed={assetFilter === 'all'}
                onClick={() => setAssetFilter('all')}
              >
                <Layers size={14} />
                All
                <span className="radar-filter-count"><Counter to={assetCounts.all} /></span>
              </button>
              <button
                type="button"
                className={assetFilter === 'stock' ? 'active' : ''}
                aria-pressed={assetFilter === 'stock'}
                onClick={() => setAssetFilter('stock')}
              >
                <LineChart size={14} />
                Stocks
                <span className="radar-filter-count"><Counter to={assetCounts.stock} /></span>
              </button>
              <button
                type="button"
                className={assetFilter === 'crypto' ? 'active' : ''}
                aria-pressed={assetFilter === 'crypto'}
                onClick={() => {
                  setAssetFilter('crypto')
                  setCapFilter('all')
                }}
              >
                <Coins size={14} />
                Crypto
                <span className="radar-filter-count"><Counter to={assetCounts.crypto} /></span>
              </button>
            </div>
          </Reveal>

          {assetFilter !== 'crypto' && (
            <Reveal delayStep={0.05} index={4}>
              <div className="radar-asset-filter radar-cap-filter" role="group" aria-label="Filter stock rows by market cap">
                <button
                  type="button"
                  className={capFilter === 'all' ? 'active' : ''}
                  aria-pressed={capFilter === 'all'}
                  onClick={() => setCapFilter('all')}
                >
                  <Layers size={14} />
                  {capFilterLabels.all}
                  <span className="radar-filter-count"><Counter to={capCounts.all} /></span>
                </button>
                <button
                  type="button"
                  className={capFilter === 'micro-small' ? 'active' : ''}
                  aria-pressed={capFilter === 'micro-small'}
                  onClick={() => setCapFilter('micro-small')}
                >
                  <Zap size={14} />
                  {capFilterLabels['micro-small']}
                  <span className="radar-filter-count"><Counter to={capCounts['micro-small']} /></span>
                </button>
                <button
                  type="button"
                  className={capFilter === 'mid' ? 'active' : ''}
                  aria-pressed={capFilter === 'mid'}
                  onClick={() => setCapFilter('mid')}
                >
                  <LineChart size={14} />
                  {capFilterLabels.mid}
                  <span className="radar-filter-count"><Counter to={capCounts.mid} /></span>
                </button>
                <button
                  type="button"
                  className={capFilter === 'large' ? 'active' : ''}
                  aria-pressed={capFilter === 'large'}
                  onClick={() => setCapFilter('large')}
                >
                  <ShieldCheck size={14} />
                  {capFilterLabels.large}
                  <span className="radar-filter-count"><Counter to={capCounts.large} /></span>
                </button>
                <button
                  type="button"
                  className={capFilter === 'unknown' ? 'active' : ''}
                  aria-pressed={capFilter === 'unknown'}
                  onClick={() => setCapFilter('unknown')}
                >
                  <Database size={14} />
                  {capFilterLabels.unknown}
                  <span className="radar-filter-count"><Counter to={capCounts.unknown} /></span>
                </button>
              </div>
            </Reveal>
          )}

          {snapshot?.stockCoverage && (
            <Reveal delayStep={0.05} index={5}>
              <div className="radar-stock-coverage" aria-label="US stock scanner coverage">
                <strong>US stock coverage</strong>
                <span>{snapshot.stockCoverage.microSmallCap} micro/small-cap</span>
                <span>{snapshot.stockCoverage.midCap} mid-cap</span>
                <span>{snapshot.stockCoverage.largeCap} large-cap</span>
                {snapshot.stockCoverage.unknownCap > 0 && <span>{snapshot.stockCoverage.unknownCap} cap pending</span>}
                <small>
                  Both ends are scanned. Only clean setups enter the trade list; small/low-float entries are automatically size-reduced.
                </small>
              </div>
            </Reveal>
          )}

          <Reveal delayStep={0.05} index={6}>
            <div className="momentum-rules">
              <strong>Verified signal gate</strong>
              <div>
                {(snapshot?.rules.checkNowRequires ?? []).map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>
            </div>
          </Reveal>

          {error && (
            <div className="momentum-error" role="alert">
              {error}
            </div>
          )}

          <Reveal delayStep={0.05} index={7}>
            <div className="momentum-phase-legend" aria-label="How signals confirm">
              <span className="legend-title">Signals confirm before buy</span>
              <span className="legend-step phase-armed">Armed</span>
              <span className="legend-arrow">→</span>
              <span className="legend-step phase-triggered">Triggered</span>
              <span className="legend-arrow">→</span>
              <span className="legend-step phase-confirming">Confirming</span>
              <span className="legend-arrow">→</span>
              <span className="legend-step phase-confirmed">Confirmed = buy</span>
              <span className="legend-note">
                A break that fails fast is flagged <b className="phase-failed">Failed</b>, never a buy, no acting on one tick.
              </span>
            </div>
          </Reveal>

          <Reveal delayStep={0.05} index={8}>
            <div className="momentum-table" aria-live="polite">
              <div className="momentum-table-head">
                <span>
                  Showing {visibleCandidates.length} strict {filteredAssetNoun} {visibleCandidates.length === 1 ? 'setup' : 'setups'}
                </span>
                <small>
                  Full scan {updatedAt} / live quotes {liveUpdatedAt}
                  {snapshot ? ` - ${assetCounts.stock} stocks / ${assetCounts.crypto} crypto passed strict gate` : ''}
                </small>
              </div>
              {snapshot && visibleCandidates.length > 0 ? (
                visibleCandidates.map((candidate) => (
                  <CandidateRow candidate={candidate} key={candidate.ticker} onEnter={enterPosition} />
                ))
              ) : (
                <div className="momentum-empty">
                  <strong>
                    No tradable {assetFilter === 'all' && capFilter === 'all' ? '' : `${filteredAssetNoun} `}setups right now.
                  </strong>
                  <span>
                    Nothing is holding VWAP near its high with verified data and a clean stop/target yet.
                    {nearMissCandidates.rows.length > 0
                      ? nearMissCandidates.fallback
                        ? " Today's biggest movers are shown below as NO-TRADE context, closest to tradable first."
                        : ' The closest movers are shown below as NO-TRADE context.'
                      : ''}
                  </span>
                </div>
              )}
            </div>
          </Reveal>

          {snapshot && nearMissCandidates.rows.length > 0 && (
            <Reveal delayStep={0.05} index={9}>
              <div className="momentum-near-miss" aria-live="polite">
                <div className="momentum-table-head">
                  <span>
                    {nearMissCandidates.fallback ? <Flame size={15} /> : <Eye size={15} />}
                    {nearMissCandidates.fallback ? 'Biggest movers · closest to tradable' : 'Closest to a signal'} ·{' '}
                    {nearMissCandidates.rows.length}
                  </span>
                  <small>
                    {nearMissCandidates.fallback
                      ? nearMissCandidates.broadened
                        ? `No ${filteredAssetNoun} movers near a signal right now, so these are today's biggest % movers across all caps, ranked by how hard they're running. Context only, NOT a trade signal; each row shows its cap and the gate it still has to clear.`
                        : "Today's strongest % movers that haven't cleared the strict gate yet, ranked by how hard they're running. Context only, NOT a trade signal; each row shows the gate it still has to clear."
                      : 'Context only, these fail the strict gate (below VWAP, off the high, unverified, or market closed). NOT a trade signal. Learn the setups; don’t act on them.'}
                  </small>
                </div>
                {nearMissCandidates.rows.map((candidate) => (
                  <CandidateRow candidate={candidate} variant="context" key={`near-${candidate.ticker}`} />
                ))}
              </div>
            </Reveal>
          )}

          {dataErrorCandidates.length > 0 && (
            <Reveal delayStep={0.05} index={10}>
              <div className="momentum-data-errors" role="status">
                <div>
                  <AlertTriangle size={16} />
                  <strong>Data quality blocks</strong>
                  <span>These rows stay out of the strict list until the next clean cross-check.</span>
                </div>
                {dataErrorCandidates.map((candidate) => (
                  <article key={`error-${candidate.ticker}`}>
                    <strong>{candidate.ticker}</strong>
                    <span>{candidate.dataError ?? 'Data validation failed'}</span>
                    <small>
                      {candidate.primarySource}: {formatMoney(candidate.price)}
                      {candidate.secondaryPrice !== null
                        ? ` / ${candidate.secondarySource}: ${formatMoney(candidate.secondaryPrice)}`
                        : ''}
                      {' - '}
                      {formatTimestamp(candidate.quoteTimestamp)}
                    </small>
                  </article>
                ))}
              </div>
            </Reveal>
          )}
        </>
      ) : activeView === 'bot' ? (
        <PaperBotPanel
          bot={botState}
          candidates={snapshot?.candidates ?? []}
          onStart={() => void controlBot('start')}
          onStop={(mode) => void controlBot('stop', mode)}
          onReset={() => void controlBot('reset')}
          onSetMode={(mode) => void setBotMode(mode)}
          theme={theme}
        />
      ) : (
        <StockAssistantPanel
          snapshot={snapshot}
          bot={botState}
          positions={positions}
          alerts={alerts}
          theme={theme}
        />
      )}

      {alerts.length > 0 && (
        <div className="momentum-toasts" aria-live="polite">
          {alerts.map((alert) => (
            <div key={alert.id} className={`momentum-toast status-${statusClass(alert.status)}`}>
              <button type="button" className="momentum-toast-main" onClick={() => focusAlert(alert.ticker)}>
                <span className="momentum-toast-title">
                  <strong>{alert.ticker}</strong>
                  <b>{alert.price > 0 ? formatMoney(alert.price) : alert.status}</b>
                </span>
                <span>{alert.message}</span>
                <span className="momentum-toast-metrics">
                  <i>Entry {alert.entry === null ? 'n/a' : formatMoney(alert.entry)}</i>
                  <i>Stop {alert.stop === null ? 'n/a' : formatMoney(alert.stop)}</i>
                  <i>Risk {alert.risk === null ? 'n/a' : formatMoney(alert.risk)}</i>
                  <i className={alert.movePct !== null && alert.movePct >= 0 ? 'momentum-green' : 'momentum-red'}>
                    {alert.movePct === null ? 'Move n/a' : `Move ${formatPercent(alert.movePct)}`}
                  </i>
                </span>
                <span className="momentum-toast-targets">
                  Targets {alert.target1 === null ? 'n/a' : formatMoney(alert.target1)} /{' '}
                  {alert.target2 === null ? 'n/a' : formatMoney(alert.target2)}
                </span>
                <small>Open signal</small>
              </button>
              <button
                type="button"
                className="momentum-toast-close"
                onClick={() => dismissAlert(alert.id)}
                aria-label={`Dismiss ${alert.ticker} alert`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
