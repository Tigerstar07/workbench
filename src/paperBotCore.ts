// Server-side paper-trading bot. Runs inside the Vite dev/preview server (see
// vite.config.ts) so it keeps watching for signals on a fixed cadence for as
// long as the server process is alive — independent of any open browser tab.
//
// It reuses the momentum engine for signals and routes real stock orders to the
// Alpaca *paper* trading API (paper-api.alpaca.markets). Crypto defaults to the
// Alpaca paper path but can be routed to Binance Spot Testnet with
// BOT_CRYPTO_VENUE=binance. Broker secrets stay server-side and are never
// exposed to the browser.
//
// Alpaca remains the source of truth for stock positions. Binance testnet crypto
// positions are tracked from the bot's own confirmed fills, so unrelated
// pre-funded testnet balances are ignored.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AssetClass, MicroPullbackState, MomentumCandidate, MomentumSnapshot } from './momentumCore'
import {
  buildMomentumSnapshot,
  buildScoredCryptoCandidates,
  refreshMomentumCandidates,
  computedStockMarketStatus,
  stockCapBand,
  indexDumpInProgress,
  MOMENTUM_RULES,
} from './momentumCore'
import {
  binanceConfigured as binanceClientConfigured,
  binanceTickerPrice,
  binanceUsdtBalance,
  mapBaseToBinanceSymbol,
  placeBinanceMarketBuy,
  placeBinanceMarketSell,
} from './binanceExec'
import {
  maybeNotifyDiscordSignal,
  maybeNotifyDiscordStatus,
  notifyDiscordTrade,
} from './discordTradingNotifications'

declare const process:
  | {
      env?: Record<string, string | undefined>
    }
  | undefined

// ---- tuning ---------------------------------------------------------------
const TICK_MS = 10_000 // how often the bot evaluates signals while running
const SNAPSHOT_TTL_MS = 60_000 // rebuild the full scan at most once a minute
const ALPACA_ACCOUNT_CACHE_MS = 15_000
const BINANCE_ACCOUNT_CACHE_MS = 15_000
const ALPACA_POSITION_CACHE_MS = 8_000
const ALPACA_ORDER_CACHE_MS = 12_000
const ALPACA_RATE_LIMIT_BACKOFF_MS = 90_000
const ORDER_SIZE_MULTIPLIER = 1 // keep paper sizing close to live-trading discipline
const MAX_NOTIONAL = 25_000 // hard cap per stock position before mode multiplier ($)
const CRYPTO_MAX_NOTIONAL = 7_500 // hard cap per crypto position before mode multiplier ($)
const MIN_NOTIONAL = 55 // skip dust, but allow more useful paper positions on small accounts
const LIVE_DEFAULT_MIN_NOTIONAL = 5 // live micro-probe floor; Alpaca's current buy minimum is lower, but dust is noisy
const LIVE_DEFAULT_STOCK_MAX_NOTIONAL = 25
const LIVE_DEFAULT_CRYPTO_MAX_NOTIONAL = 15
const LIVE_DEFAULT_MAX_POSITIONS = 1
const PENDING_TTL_MS = 45_000 // how long to treat a just-sent order as in-flight
const NO_FILL_COOLDOWN_MS = 10 * 60_000 // short pause after Alpaca accepts/cancels without a fill
const REJECTED_COOLDOWN_MS = 30 * 60_000
const ORPHAN_FILL_COOLDOWN_MS = 5 * 60_000
const LOSS_COOLDOWN_MS = 45 * 60_000
const WIN_REENTRY_COOLDOWN_MS = 10 * 60_000
const PAPER_REENTRY_LOSS_COOLDOWN_MS = 12 * 60_000 // paper anti-churn: pause re-buying a symbol after a losing exit
const PAPER_REENTRY_SCRATCH_COOLDOWN_MS = 6 * 60_000 // paper anti-churn: shorter pause after a win/scratch exit
const REVERSION_STICKY_WATCH_MS = 8 * 60_000
const DEFAULT_RISK_EQUITY = 25_000
const LIVE_TRADING_ACK = 'I_UNDERSTAND_THIS_CAN_LOSE_REAL_MONEY'
const BOT_CLIENT_ORDER_PREFIX = 'mbot-'
const LOG_LIMIT = 60
const HISTORY_LIMIT = 300 // keep more closed trades so the journal/calendar is rich
const MEMORY_VERSION = 1
const MEMORY_FILE = new URL('../paper-bot-memory.json', import.meta.url)
const SETUP_MEMORY_VERSION = 1
const SETUP_MEMORY_FILE = new URL('../paper-bot-setup-memory.json', import.meta.url)
// Append-only, never-truncated CSV of every closed trade with its full feature
// snapshot + modeled cost. Unlike paper-bot-memory.json (capped at HISTORY_LIMIT),
// this grows unbounded so you accumulate a real dataset across restarts/regimes
// to analyze offline (Excel/sheets/pandas). This file is the actual asset.
const TRADE_LOG_FILE = new URL('../paper-bot-trades.csv', import.meta.url)
// Append-only JSONL review journal. Each line is a full trade event with setup,
// plan, net cost, excursion, and review tags so later analysis can explain what
// went right/wrong without reconstructing context from the UI.
const TRADE_REVIEW_FILE = new URL('../paper-bot-review.jsonl', import.meta.url)
// Append-only decision journal. This is the bot's black-box recorder: every
// state/note change for rows in "What the bot sees" is written here so an
// armed/triggered/drop question can be audited after the fact.
const DECISION_AUDIT_FILE = new URL('../paper-bot-decisions.jsonl', import.meta.url)
const DECISION_AUDIT_HEARTBEAT_MS = 5 * 60_000
// Append-only shadow execution telemetry. This never changes routing; it records
// what an Alpaca crypto maker entry would have seen so maker routing can be
// enabled later only if observed fill/markout data justify it.
const MAKER_SHADOW_FILE = new URL('../paper-bot-maker-shadow.jsonl', import.meta.url)
// Account-value time series for the live equity/cash chart. Capped ring buffer,
// persisted so the curve survives a dev-server restart.
const EQUITY_FILE = new URL('../paper-bot-equity.json', import.meta.url)
const EQUITY_SERIES_LIMIT = 720 // ~12h of one-per-minute idle samples
const EQUITY_SAMPLE_MS = 60_000 // idle cadence; a trade that moves equity samples immediately
const MAKER_SHADOW_MARKOUT_MS = [1_000, 5_000, 10_000] as const
// ---- realistic cost model -------------------------------------------------
// Alpaca *paper* fills are idealized: they fill at the quote with no spread to
// cross, no slippage and no fees. Live retail momentum scalping pays all three
// on every round trip — which is exactly where a "green on paper, red live" gap
// comes from. We never touch the broker's reported P&L (that is the paper truth);
// we model what a live fill would have cost and surface a *net-of-cost* P&L next
// to it. If net expectancy is not positive over a large sample, no gate tuning
// will make the strategy profitable live. Tunable via PAPER_BOT_*_BPS env vars.
const COST_MODEL_DEFAULTS = {
  stockSlippageBps: 3, // adverse fill vs quote, per leg
  cryptoSlippageBps: 5,
  stockFeeBps: 0, // Alpaca stocks are commission-free; regulatory fees ~0
  // The bot routes crypto as MARKET orders, which always cross the book as a
  // *taker*. Alpaca's Tier-1 (<$100k 30d volume) crypto taker fee is 0.25% per
  // leg — NOT the 0.15% maker rate. Modeling the maker rate would understate the
  // round trip by ~0.20% and let the fee-aware entry gate wave through trades that
  // are actually net losers. So we charge the real 25 bps taker fee per leg.
  cryptoFeeBps: 25, // Alpaca crypto Tier-1 TAKER fee, per leg (0.25%)
  binanceCryptoFeeBps: 10, // Binance spot taker fee, per leg (testnet fills are modeled like live spot)
  stockSpreadFloorPct: 0.02, // even liquid names cost something to cross
  cryptoSpreadFloorPct: 0.05,
} as const
const ORDER_FETCH_LIMIT = 25
const CRYPTO_ASSET_TTL_MS = 6 * 60 * 60 * 1000
const ASSET_INFO_TTL_MS = 60 * 60 * 1000
const STATUS_LOG_MS = 15_000
const PAPER_TURBO_ANTI_CHURN_MS = 20 * 60_000
const TURBO_LEARNING_MIN_TRADES = 8
const TURBO_LEARNING_LOSS_RATE = 0.68
const TURBO_LEARNING_MAX_AVG_PNL = -8
const SETUP_MEMORY_MIN_TRADES = 5
const SETUP_MEMORY_BLOCK_LOSS_RATE = 0.68
const SETUP_MEMORY_BLOCK_NET_AVG_PNL = -6
const TURBO_BAD_FILL_RETUNE_PCT = 0.25
const STOCK_BAD_FILL_RETUNE_PCT = 0.25
const PAPER_MIN_CASH_RESERVE_PCT = 0.08
const PAPER_MAX_STRONG_POSITION_PCT = 0.36
const PAPER_MAX_CROWDED_POSITION_PCT = 0.24
const PROFIT_TRIM_MIN_PCT = 0.18
const PROFIT_TRIM_MIN_NOTIONAL = 25
const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786] as const
const BOT_OBSERVATION_LIMIT_PER_ASSET = 12
const BOT_OBSERVATION_SCORE_MARGIN = 22
const ALPACA_CRYPTO_MAX_PRICE_DIVERGENCE_PCT = 0.75
// Risk misses the wider "active" mode tolerates on a WATCH probe. The $50M
// crypto confirmation volume is deliberately NOT here: paper auto-entry always
// requires $50M+ quote volume, in every mode.
const ALLOWED_RISK_BLOCKERS = new Set([
  'confirmation volume below 3M',
  'confirmation relVol below 3x',
  'not close enough to high',
  '4h momentum not strong enough',
  'not close enough to 24h high',
])

// ---- bot modes ------------------------------------------------------------
// Three operator-selectable personalities:
//  - "safe"   auto-trades only a hand-curated list of liquid majors, on the
//             strictest gate (high score, fresh quote, tight spread).
//  - "active" auto-trades the whole selected crypto venue universe on a still-strict
//             auto gate but a wider net and bigger sizing.
//  - "turbo"  a deliberately loose "for fun" mode: it drops the WATCH-quality
//             gate and re-buys constantly, so you see lots of paper trades
//             (more wins AND more losses). Still stop/target
//             managed — just far more aggressive. Not a serious strategy.
export type BotMode = 'safe' | 'active' | 'turbo'

// Your "super good and safe" shortlist (Binance base symbols). In Alpaca crypto
// mode anything Alpaca does not list is filtered out automatically; in Binance
// mode the bases map directly to USDT spot symbols.
const SAFE_CRYPTO_BASES = ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX', 'DOT', 'LTC', 'BCH', 'UNI', 'AAVE', 'DOGE', 'XRP']
const BOT_EXCLUDED_CRYPTO_BASES = new Set(['USDC', 'USDT', 'DAI'])

type BotModeConfig = {
  label: string
  riskLabel: string // short tag shown per trade in the journal
  minScore: number // auto-entry score floor (watch/armed display can be lower)
  positionFraction: number // fraction of cash per new position
  maxPositions: number
  sizeMultiplier: number
  riskPerTradePct: number
  maxPortfolioRiskPct: number
  dailyLossCapPct: number
  dailyLossStreakLimit: number
  dailyNoWinLossLimit: number
  symbolDailyEntryLimit: number
  symbolDailyLossLimit: number
  lossCooldownMs: number
  allowedRiskBlockers: Set<string>
  curatedOnly: boolean // safe = curated majors; active/turbo = full universe
  cryptoMinQuoteVolume: number // universe/scan floor (lower = more discovery)
  cryptoLimit: number
  cryptoMinVolumePulse: number
  cryptoMaxQuoteAgeMs: number
  stockSpreadCapPct: number // bot-only stock spread cap for auto-entry
  stockMaxInitialRiskPct: number // maximum entry-to-stop distance for a stock trade
  stockMaxQuoteAgeMs: number // bot-only stock quote freshness for auto-entry
  entryConfirmHolds: number
  entryConfirmDwellMs: number
  maxChasePct: number
  protectTarget1Runner: boolean
  target1TrailLockR: number
  maxHoldMs: number
  breakevenAtR: number
  trailAfterR: number
  trailDistanceR: number
  atrTrailMultiple: number
  turboVwapBypassMaxDistancePct: number
  turboVwapBypassMinPulse: number
  relaxStatusGate: boolean // turbo: skip the WATCH-quality gate + re-buy freely
}

const BOT_MODES: Record<BotMode, BotModeConfig> = {
  safe: {
    label: 'Safe - curated, strict auto',
    riskLabel: 'Low',
    minScore: 92,
    positionFraction: 0.28,
    maxPositions: 4,
    sizeMultiplier: ORDER_SIZE_MULTIPLIER,
    riskPerTradePct: 0.008,
    maxPortfolioRiskPct: 0.04,
    dailyLossCapPct: 0.02,
    dailyLossStreakLimit: 3,
    dailyNoWinLossLimit: 4,
    symbolDailyEntryLimit: 1,
    symbolDailyLossLimit: 1,
    lossCooldownMs: 90 * 60_000,
    allowedRiskBlockers: new Set<string>(), // only spotless CHECK NOW
    curatedOnly: true,
    cryptoMinQuoteVolume: 50_000_000,
    cryptoLimit: SAFE_CRYPTO_BASES.length,
    // Diagnostics: the 1.05-2x volume-pulse band is the worst-performing setup
    // bucket (net-negative expectancy). Require a genuine 2x+ pulse so the bot
    // stops entering that losing band. See nightCryptoMinVolumePulse() below.
    cryptoMinVolumePulse: 2.0,
    cryptoMaxQuoteAgeMs: 45_000,
    stockSpreadCapPct: 0.3,
    stockMaxInitialRiskPct: 0.022,
    stockMaxQuoteAgeMs: 45_000,
    entryConfirmHolds: 4,
    entryConfirmDwellMs: 30_000,
    maxChasePct: 0.8,
    protectTarget1Runner: true,
    target1TrailLockR: 0.12,
    maxHoldMs: 6 * 60 * 60_000,
    breakevenAtR: 0.55,
    trailAfterR: 0.9,
    trailDistanceR: 0.55,
    atrTrailMultiple: 2.8,
    turboVwapBypassMaxDistancePct: 0,
    turboVwapBypassMinPulse: Number.POSITIVE_INFINITY,
    relaxStatusGate: false,
  },
  active: {
    label: 'Active - confirmed, risk-sized auto',
    riskLabel: 'Med',
    minScore: 90,
    positionFraction: 0.2,
    maxPositions: 6,
    sizeMultiplier: 1.15,
    riskPerTradePct: 0.01,
    maxPortfolioRiskPct: 0.055,
    dailyLossCapPct: 0.03,
    dailyLossStreakLimit: 4,
    dailyNoWinLossLimit: 5,
    symbolDailyEntryLimit: 1,
    symbolDailyLossLimit: 1,
    lossCooldownMs: 75 * 60_000,
    allowedRiskBlockers: ALLOWED_RISK_BLOCKERS,
    curatedOnly: false,
    cryptoMinQuoteVolume: 75_000_000,
    cryptoLimit: 40,
    // Cut the net-negative 1.05-2x pulse band: require a real 2x+ volume pulse.
    cryptoMinVolumePulse: 2.0,
    cryptoMaxQuoteAgeMs: 45_000,
    stockSpreadCapPct: 0.4,
    stockMaxInitialRiskPct: 0.025,
    stockMaxQuoteAgeMs: 60_000,
    entryConfirmHolds: 3,
    entryConfirmDwellMs: 20_000,
    maxChasePct: 1.2,
    protectTarget1Runner: true,
    target1TrailLockR: 0.18,
    maxHoldMs: 3 * 60 * 60_000,
    breakevenAtR: 0.75,
    trailAfterR: 1.15,
    trailDistanceR: 0.7,
    atrTrailMultiple: 2.5,
    turboVwapBypassMaxDistancePct: 0,
    turboVwapBypassMinPulse: Number.POSITIVE_INFINITY,
    relaxStatusGate: false,
  },
  turbo: {
    label: 'Turbo - optimized scalp lab',
    riskLabel: 'High',
    minScore: 72,
    positionFraction: 0.135,
    maxPositions: 9,
    sizeMultiplier: 1.05,
    riskPerTradePct: 0.01,
    maxPortfolioRiskPct: 0.07,
    dailyLossCapPct: 0.035,
    dailyLossStreakLimit: 6,
    dailyNoWinLossLimit: 8,
    symbolDailyEntryLimit: 2,
    symbolDailyLossLimit: 1,
    lossCooldownMs: LOSS_COOLDOWN_MS,
    allowedRiskBlockers: ALLOWED_RISK_BLOCKERS,
    curatedOnly: false,
    cryptoMinQuoteVolume: 40_000_000,
    cryptoLimit: 50,
    // Turbo is the scalp lab, but the 1.05-2x pulse band still bled it the most.
    // Require 2x+ pulse here too; loosen only if entries dry up for too long.
    cryptoMinVolumePulse: 2.0,
    cryptoMaxQuoteAgeMs: 2 * 60_000,
    stockSpreadCapPct: 0.55,
    stockMaxInitialRiskPct: 0.03,
    stockMaxQuoteAgeMs: 2 * 60_000,
    entryConfirmHolds: 2,
    entryConfirmDwellMs: 6_000,
    maxChasePct: 0.8,
    protectTarget1Runner: true,
    target1TrailLockR: 0.16,
    maxHoldMs: 35 * 60_000,
    breakevenAtR: 0.55,
    trailAfterR: 0.85,
    trailDistanceR: 0.55,
    atrTrailMultiple: 2.2,
    turboVwapBypassMaxDistancePct: 0.7,
    // Was 1.3 — but the trade log shows every sub-2x-pulse entry lost (0 wins in
    // 13). Hold the VWAP-bypass path to the same 2x+ pulse bar as the main gate so
    // nothing weak sneaks in through the bypass.
    turboVwapBypassMinPulse: 2.0,
    relaxStatusGate: true,
  },
}

function initialBotMode(): BotMode {
  const mode = envValue('PAPER_BOT_DEFAULT_MODE')?.toLowerCase()
  return mode === 'safe' || mode === 'active' || mode === 'turbo' ? mode : 'active'
}

let botMode: BotMode = initialBotMode()
function cfg() {
  return BOT_MODES[botMode]
}

export function botModePolicy(mode: BotMode) {
  const config = BOT_MODES[mode]
  return {
    stockSpreadCapPct: config.stockSpreadCapPct,
    stockMaxInitialRiskPct: config.stockMaxInitialRiskPct,
    riskPerTradePct: config.riskPerTradePct,
    maxPositions: config.maxPositions,
    entryConfirmHolds: config.entryConfirmHolds,
    entryConfirmDwellMs: config.entryConfirmDwellMs,
    protectTarget1Runner: config.protectTarget1Runner,
    target1TrailLockR: config.target1TrailLockR,
    breakevenAtR: config.breakevenAtR,
    trailAfterR: config.trailAfterR,
    trailDistanceR: config.trailDistanceR,
    atrTrailMultiple: config.atrTrailMultiple,
  }
}

// ---- night mode -----------------------------------------------------------
// When the US stock market is closed, turbo can only act on 24/7 crypto. After
// the close the tape cools and the composite score of even strong movers sinks
// below the daytime floor, so the bot would sit idle all night. "Night mode"
// drops ONLY the crypto score floor while keeping every structural quality gate
// (above-VWAP / strong-pulse reclaim, volume pulse, technical edge, wider stops,
// winner-protection). The volume-pulse gate then does the quality filtering the
// score floor normally would, so it scalps genuine overnight surges (e.g. a coin
// up double digits, above VWAP, pulse 3x) and still skips dead, quiet weakness.
const NIGHT_CRYPTO_MIN_SCORE = 55
let stockSessionOpenNow = true // refreshed each tick; cached so gate helpers stay cheap/sync

// Active only for turbo (the scalp lab) while stocks are closed.
function nightCryptoActive() {
  return cfg().relaxStatusGate && !stockSessionOpenNow
}

// Per-asset entry score floor: crypto gets the relaxed night floor when the
// stock session is closed; stocks (which can't trade then anyway) and daytime
// crypto keep the mode's normal floor.
// Reversion candidates carry their own 0-100 reversion-quality score (not the
// momentum composite), so they need an independent floor regardless of mode.
const REVERSION_MIN_SCORE = 70

export function entryScoreFloor(candidate: MomentumCandidate) {
  if (isReversionCandidate(candidate)) return REVERSION_MIN_SCORE
  if (candidate.assetClass === 'crypto' && nightCryptoActive()) {
    return Math.min(cfg().minScore, NIGHT_CRYPTO_MIN_SCORE)
  }
  // A raw CHECK NOW has already cleared every scanner blocker and the stricter
  // confirmation blockers. Active mode should not throw those fully confirmed
  // 84-89 point setups away merely because WATCH probes retain a 90-point bar.
  // Safe mode remains untouched; only Active aligns confirmed entries with the
  // scanner's own CHECK NOW threshold.
  if (botMode === 'active' && candidate.status === 'CHECK NOW') {
    return Math.min(cfg().minScore, MOMENTUM_RULES.checkNowScore)
  }
  return cfg().minScore
}

function entryFloorLabel() {
  return botMode === 'active'
    ? `momentum WATCH ${cfg().minScore}+ / confirmed ${MOMENTUM_RULES.checkNowScore}+, reversion ${REVERSION_MIN_SCORE}+`
    : `momentum ${cfg().minScore}+, reversion ${REVERSION_MIN_SCORE}+`
}

// Night mode used to slash the pulse floor to 0.8x and let entries run 2% from
// VWAP after the US close so the bot kept scalping overnight. The trade log showed
// that "stay busy" loosening *was* the bleed: weak-pulse, far-from-VWAP overnight
// probes are the net-negative buckets. So night mode no longer weakens the pulse
// requirement, and it chases VWAP far less. The bot may sit idle on quiet nights —
// that's the point: no genuine 2x+ surge, no trade. The `changePct > 0` (24h
// uptrend) gate in isTurboCryptoProbe still prevents buying anything red on the day.
function nightVwapBypassMaxDistancePct() {
  return nightCryptoActive() ? Math.max(cfg().turboVwapBypassMaxDistancePct, 1.0) : cfg().turboVwapBypassMaxDistancePct
}
function nightVwapBypassMinPulse() {
  // No overnight discount on the bypass-pulse bar — far-from-VWAP entries must show
  // the same genuine pulse strength they do during the day.
  return cfg().turboVwapBypassMinPulse
}
function nightCryptoMinVolumePulse() {
  // No overnight discount on the entry pulse floor (was min(cfg, 0.8)); keep the
  // 2x+ requirement around the clock so the losing weak-pulse band stays cut.
  return cfg().cryptoMinVolumePulse
}

// ---- public types ---------------------------------------------------------
export type BotLogLevel = 'buy' | 'sell' | 'skip' | 'info' | 'error'
type ExecutionVenue = 'alpaca' | 'binance'
type CryptoVenue = 'alpaca' | 'binance'

export type BotLogEntry = {
  id: string
  time: string
  level: BotLogLevel
  symbol: string
  message: string
}

export type BotPosition = {
  symbol: string
  displaySymbol: string
  assetClass: 'stock' | 'crypto'
  venue: ExecutionVenue
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

export type BotAccount = {
  cash: number
  equity: number
  buyingPower: number
  nonMarginableBuyingPower: number
  currency: string
}

// One sampled point of account value over time, so the UI can chart equity (and
// cash) moving up/down as the bot trades.
export type EquityPoint = {
  t: string
  equity: number
  cash: number
}

// One upcoming scheduled macro print for the bot UI's calendar. `active` is true
// while `now` sits inside its blackout window (new entries paused).
export type BotMacroEvent = {
  label: string
  at: string // ISO timestamp of the print
  minutesUntil: number // negative once the print has passed but the window is open
  active: boolean
}

export type BotOrder = {
  id: string
  clientOrderId: string | null
  symbol: string
  venue: ExecutionVenue
  side: string
  qty: number | null
  notional: number | null
  type: string
  status: string
  filledAvgPrice: number | null
  submittedAt: string | null
}

export type BotHistoryEntry = {
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
  // Excursion in R-multiples, filled on the closing (sell) leg only.
  // maxFavorableR: peak unrealized gain reached before exit (>= 0).
  // maxAdverseR: deepest unrealized drawdown reached before exit, as a positive
  // magnitude (>= 0). Both are measured against the trade's original initialRisk.
  maxFavorableR?: number | null
  maxAdverseR?: number | null
}

export type BotStats = {
  wins: number
  losses: number
  flats: number
  closedTrades: number
  realizedPl: number
}

export type BotTradeSetup = {
  assetClass: 'stock' | 'crypto'
  venue: ExecutionVenue
  entryMode: BotTradePlan['mode']
  score: number
  status: MomentumCandidate['status']
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
  microPullbackState: MicroPullbackState | null
  microPullbackScore: number | null
  atr: number | null
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

export type BotDiagnosticBucket = {
  key: string
  label: string
  trades: number
  wins: number
  losses: number
  flats: number
  realizedPl: number
  avgPnl: number
}

export type BotSetupMemoryEntry = {
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

export type BotDiagnostics = {
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

export type BotTechnicalContext = {
  trendScore: number
  trendLabel: 'strong-uptrend' | 'uptrend' | 'mixed' | 'weak'
  fibZone: string
  fibRetracementPct: number | null
  fibNearestLevel: number | null
  edgeScore: number
  notes: string[]
}

export type BotModeComparison = {
  mode: BotMode
  label: string
  riskLabel: string
  minScore: number
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

type BotModeComparisonTopState = NonNullable<BotModeComparison['top']>['state']

type SetupMemoryStoredEntry = {
  key: string
  label: string
  assetClass: 'stock' | 'crypto'
  trades: number
  wins: number
  losses: number
  flats: number
  realizedPl: number
  estimatedCost: number
  lastUpdated: string | null
  lastOutcome: 'win' | 'loss' | 'flat' | null
}

type SetupMemoryFile = {
  version: number
  updatedAt: string
  entries: SetupMemoryStoredEntry[]
}

// A single row of the bot's live "thinking": every candidate it is actively
// evaluating this tick, where it stands, and the one-line reason.
export type BotWatchEntry = {
  symbol: string
  assetClass: 'stock' | 'crypto'
  strategy: NonNullable<MomentumCandidate['strategy']>
  score: number
  scoreFloor: number
  status: MomentumCandidate['status']
  price: number
  trigger: number | null
  state: 'holding' | 'triggered' | 'cooldown' | 'armed' | 'blocked'
  note: string
  waitingFor: string
  nextCheck: string
  tradePlan: {
    buy: number
    stop: number
    target1: number
    target2: number
  } | null
  technical: BotTechnicalContext
  holding: {
    qty: number
    marketValue: number
    unrealizedPl: number
    unrealizedPlPct: number
  } | null
}

export type BotStateResponse =
  | {
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
      cryptoVenue: CryptoVenue
      cryptoVenueLabel: string
      mode: BotMode
      modeLabel: string
      minScore: number
      reversionMinScore: number
      nightMode: boolean
      cryptoFloor: number
      riskLabel: string
      maxPositions: number
      sizeMultiplier: number
      riskPause: string | null
      watch: BotWatchEntry[]
      comparisons: BotModeComparison[]
      equitySeries: EquityPoint[]
      setupMemory: BotSetupMemoryEntry[]
      macroEvents: BotMacroEvent[]
    }
  | { ok: false; error: string }

// ---- internal state -------------------------------------------------------
type TrackedEntry = {
  entry: number
  stop: number
  target1: number
  target2: number
  initialRisk: number
  openedAt: number
  peakPrice: number
  atr: number | null
  // Low-water mark since entry, the mirror of peakPrice. Together they let us
  // record how far each trade ran in our favor (MFE) and against us (MAE) before
  // it closed — the one diagnostic that separates "entries are wrong" from
  // "stops too tight / targets too far" when targets never get hit.
  troughPrice: number
  lastStopRaisedAt: number
  target1Hit: boolean
  assetClass: 'stock' | 'crypto'
  venue: ExecutionVenue
  qty: number | null
  displaySymbol: string
  botMode: BotMode
  mode: BotTradePlan['mode']
  setup: BotTradeSetup | null
}

type ResolvedSymbol = { symbol: string; assetClass: 'stock' | 'crypto'; venue: ExecutionVenue }
export type BotTradePlan = {
  trigger: number
  stop: number
  target1: number
  target2: number
  mode: 'breakout' | 'watch-probe' | 'turbo-probe' | 'quick-scalp' | 'momentum-scalp' | 'breakout-scalp' | 'reversion'
}

type PendingEntry = {
  submittedAt: number
  symbol: string
  displaySymbol: string
  assetClass: 'stock' | 'crypto'
  venue: ExecutionVenue
  clientOrderId: string
  orderId: string | null
  score: number
  budget: number
  expectedPrice: number
  expectedQty: number | null
  plan: BotTradePlan
  mode: BotMode
  setup: BotTradeSetup
  makerShadowId?: string | null
}

type PendingExit = {
  submittedAt: number
  symbol: string
  displaySymbol: string
  venue: ExecutionVenue
  orderId: string | null
  reason: string
  qty: number
  remainingQty: number | null
  notional: number
  price: number
  pnl: number
  pnlPct: number
  mode: BotMode
  holdSeconds: number | null
  setup: BotTradeSetup | null
  fullClose: boolean
}

type NoFillCooldown = {
  until: number
  reason: string
}

type TradeCooldown = {
  until: number
  reason: string
}

type EntryConfirmation = {
  firstSeen: number
  lastSeen: number
  trigger: number
  holds: number
}

type ReadCache<T> = {
  value: T | null
  at: number
  inFlight: Promise<T> | null
}

const botState = {
  running: false,
  draining: false,
  startedAt: null as string | null,
  lastTickAt: null as string | null,
  lastError: null as string | null,
}

const tracked = new Map<string, TrackedEntry>() // keyed by normalized symbol
const pendingEntries = new Map<string, PendingEntry>() // normalized symbol -> submitted order details
const pendingExits = new Map<string, PendingExit>() // normalized symbol -> submitted close details
const noFillCooldowns = new Map<string, NoFillCooldown>() // normalized symbol -> broker did not fill last entry
const tradeCooldowns = new Map<string, TradeCooldown>() // normalized symbol -> loss/diversity cooldown
const entryConfirmations = new Map<string, EntryConfirmation>() // normalized symbol -> anti-flicker entry confirmation
const stickyReversionWatches = new Map<string, { candidate: MomentumCandidate; seenAt: number }>()
const log: BotLogEntry[] = []
const history: BotHistoryEntry[] = []
const setupMemory = new Map<string, SetupMemoryStoredEntry>()
let botWatch: BotWatchEntry[] = []
let modeComparisons: BotModeComparison[] = []
const accountCache: ReadCache<BotAccount> = { value: null, at: 0, inFlight: null }
const binanceAccountCache: ReadCache<BotAccount> = { value: null, at: 0, inFlight: null }
const positionsCache: ReadCache<BotPosition[]> = { value: null, at: 0, inFlight: null }
const ordersCache: ReadCache<BotOrder[]> = { value: null, at: 0, inFlight: null }
const openOrdersCache: ReadCache<BotOrder[]> = { value: null, at: 0, inFlight: null }

let cachedSnapshot: MomentumSnapshot | null = null
let cachedSnapshotAt = 0
let snapshotRefreshInFlight: Promise<void> | null = null
let snapshotRefreshAttemptAt = 0
let cachedBotCrypto: MomentumCandidate[] = []
let cachedBotCryptoMode: BotMode | null = null
let cachedBotCryptoAt = 0
let botCryptoRefreshInFlight: Promise<void> | null = null
let botCryptoRefreshAttemptAt = 0
let cryptoAssets: Set<string> | null = null
let cryptoAssetsAt = 0
const assetInfoCache = new Map<string, { at: number; asset: AlpacaAssetRaw | null }>()
let loopStarted = false
let loopHandle: ReturnType<typeof setInterval> | null = null
let fastHandle: ReturnType<typeof setInterval> | null = null
let armedCount = 0
let triggeredCount = 0
let lastStatusLogAt = 0
let lastStatusSignature = ''
const decisionAuditCache = new Map<string, { signature: string; lastWrittenAt: number }>()
let alpacaBackoffUntil = 0
let lastRateLimitLogAt = 0
let tickRunning = false // guards against overlapping ticks when one runs longer than TICK_MS
let lastOverlapLogAt = 0

type PaperBotRuntimeGlobal = typeof globalThis & {
  __paperBotLoopHandle?: ReturnType<typeof setInterval>
  __paperBotFastHandle?: ReturnType<typeof setInterval>
  __paperBotBinanceWs?: { close: () => void } | null
  __paperBotCrashGuardsInstalled?: boolean
}

const CLOSED_WITHOUT_FILL_STATUSES = new Set(['canceled', 'expired', 'rejected', 'suspended'])
const LIVE_ORDER_STATUSES = new Set([
  'accepted',
  'accepted_for_bidding',
  'held',
  'new',
  'partially_filled',
  'pending_cancel',
  'pending_new',
  'pending_replace',
])

// ---- helpers --------------------------------------------------------------
function envValue(name: string) {
  return typeof process !== 'undefined' ? process?.env?.[name]?.trim() : undefined
}

function envNumber(name: string, fallback: number) {
  const raw = envValue(name)
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function costModelEnabled() {
  const raw = envValue('PAPER_BOT_COST_MODEL')
  return raw === undefined || raw === '' ? true : !/^(0|false|off|no)$/i.test(raw)
}

function costConfig(assetClass: 'stock' | 'crypto', venue: ExecutionVenue = 'alpaca') {
  if (assetClass === 'crypto') {
    return {
      slippageBps: envNumber('PAPER_BOT_CRYPTO_SLIPPAGE_BPS', COST_MODEL_DEFAULTS.cryptoSlippageBps),
      feeBps: venue === 'binance'
        ? envNumber('PAPER_BOT_BINANCE_TAKER_FEE_BPS', COST_MODEL_DEFAULTS.binanceCryptoFeeBps)
        : envNumber('PAPER_BOT_CRYPTO_FEE_BPS', COST_MODEL_DEFAULTS.cryptoFeeBps),
      spreadFloorPct: COST_MODEL_DEFAULTS.cryptoSpreadFloorPct,
    }
  }
  return {
    slippageBps: envNumber('PAPER_BOT_STOCK_SLIPPAGE_BPS', COST_MODEL_DEFAULTS.stockSlippageBps),
    feeBps: envNumber('PAPER_BOT_STOCK_FEE_BPS', COST_MODEL_DEFAULTS.stockFeeBps),
    spreadFloorPct: COST_MODEL_DEFAULTS.stockSpreadFloorPct,
  }
}

// Estimated round-trip (entry + exit) execution cost in dollars for a trade of
// `notional` dollars in an asset whose live spread was `spreadPct` percent.
//  - spread crossing: a marketable order pays ~half the spread vs mid per leg,
//    so a round trip costs ~the full spread; floored so 0-spread rows still pay.
//  - slippage: adverse fill beyond the quote, charged on both legs.
//  - fees: per-leg broker fee (crypto taker; stocks ~0).
function estimateTradeCost(
  assetClass: 'stock' | 'crypto',
  notional: number,
  spreadPct: number | null | undefined,
  venue: ExecutionVenue = 'alpaca',
) {
  if (!costModelEnabled() || !Number.isFinite(notional) || notional <= 0) return 0
  const costs = costConfig(assetClass, venue)
  const reportedSpread = typeof spreadPct === 'number' && Number.isFinite(spreadPct) ? Math.abs(spreadPct) : 0
  const spread = Math.max(costs.spreadFloorPct, reportedSpread)
  const spreadCost = notional * (spread / 100) // full spread across the round trip
  const slippageCost = notional * (costs.slippageBps / 10_000) * 2
  const feeCost = notional * (costs.feeBps / 10_000) * 2
  return spreadCost + slippageCost + feeCost
}

// Round-trip friction as a percentage of entry notional. This is the same model
// used by estimateTradeCost(), exposed in percentage form so entry and trailing
// logic can reason about whether a target/locked stop clears live-like costs.
export function modeledRoundTripCostPct(
  assetClass: 'stock' | 'crypto',
  spreadPct: number | null | undefined,
  venue: ExecutionVenue = 'alpaca',
) {
  if (!costModelEnabled()) return 0
  const costs = costConfig(assetClass, venue)
  const reportedSpread = typeof spreadPct === 'number' && Number.isFinite(spreadPct) ? Math.abs(spreadPct) : 0
  const spread = Math.max(costs.spreadFloorPct, reportedSpread)
  const perLegBps = Math.max(0, costs.slippageBps) + Math.max(0, costs.feeBps)
  return spread + (perLegBps * 2) / 100
}

// Cost/net helpers that work retroactively on any closed-sell history row, so the
// whole existing journal is re-scored the moment the model is enabled or retuned.
function historyEntryCost(entry: BotHistoryEntry) {
  if (entry.side !== 'sell' || entry.pnl === null) return 0
  const assetClass = entry.setup?.assetClass ?? (entry.symbol.includes('/') ? 'crypto' : 'stock')
  const venue =
    entry.setup?.venue ??
    (assetClass === 'crypto' && normSymbol(entry.symbol).endsWith('USDT') ? 'binance' : 'alpaca')
  const notional =
    entry.notional ?? (entry.qty !== null && entry.price !== null ? Math.abs(entry.qty * entry.price) : 0)
  return estimateTradeCost(assetClass, notional ?? 0, entry.setup?.spreadPct ?? null, venue)
}

function historyEntryNetPnl(entry: BotHistoryEntry) {
  return (entry.pnl ?? 0) - historyEntryCost(entry)
}

const TRADE_LOG_HEADER = [
  'timestamp',
  'mode',
  'symbol',
  'assetClass',
  'exitReason',
  'outcome',
  'holdSeconds',
  'qty',
  'notional',
  'exitPrice',
  'spreadPct',
  'score',
  'aboveVwap',
  'volumePulse',
  'timeAdjustedRvol',
  'microPullback',
  'microPullbackScore',
  'microTape1mPct',
  'microTapePulse',
  'vwapExtensionPct',
  'floatTurnover',
  'trendLabel',
  'edgeScore',
  'grossPnl',
  'estCost',
  'netPnl',
  // Appended at the end so older rows stay column-aligned under the new header.
  'maxFavorableR',
  'maxAdverseR',
].join(',')

function ensureTradeLogHeader() {
  if (!existsSync(TRADE_LOG_FILE)) {
    writeFileSync(TRADE_LOG_FILE, `${TRADE_LOG_HEADER}\n`, 'utf8')
    return
  }
  const content = readFileSync(TRADE_LOG_FILE, 'utf8')
  const newlineIndex = content.indexOf('\n')
  const firstLine = (newlineIndex >= 0 ? content.slice(0, newlineIndex) : content).trim()
  if (firstLine === TRADE_LOG_HEADER || !firstLine.startsWith('timestamp,')) return
  const body = newlineIndex >= 0 ? content.slice(newlineIndex + 1) : ''
  writeFileSync(TRADE_LOG_FILE, `${TRADE_LOG_HEADER}\n${body}`, 'utf8')
}

// Append the closed trade to the never-truncated CSV dataset (TRADE_LOG_FILE).
function appendTradeLog(entry: BotHistoryEntry) {
  if (entry.side !== 'sell' || entry.pnl === null) return
  try {
    const setup = entry.setup
    const cost = historyEntryCost(entry)
    const cell = (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return ''
      const text = String(value)
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const row = [
      entry.time,
      entry.mode,
      entry.symbol,
      setup?.assetClass ?? '',
      entry.reason,
      entry.outcome,
      entry.holdSeconds ?? '',
      entry.qty ?? '',
      entry.notional ?? '',
      entry.price ?? '',
      setup?.spreadPct ?? '',
      setup?.score ?? '',
      setup ? (setup.aboveVwap ? 1 : 0) : '',
      setup?.volumePulse ?? '',
      setup?.timeAdjustedRelativeVolume ?? '',
      setup?.microPullbackState ?? '',
      setup?.microPullbackScore ?? '',
      setup?.microTapeOneMinuteMovePct ?? '',
      setup?.microTapePulse ?? '',
      setup?.vwapExtensionPct ?? '',
      setup?.floatTurnover ?? '',
      setup?.technical?.trendLabel ?? '',
      setup?.technical?.edgeScore ?? '',
      entry.pnl,
      cost.toFixed(4),
      ((entry.pnl ?? 0) - cost).toFixed(4),
      entry.maxFavorableR ?? '',
      entry.maxAdverseR ?? '',
    ]
      .map(cell)
      .join(',')
    ensureTradeLogHeader()
    appendFileSync(TRADE_LOG_FILE, `${row}\n`, 'utf8')
  } catch (error) {
    pushLog('error', '-', `Could not append trade log: ${message(error)}`)
  }
}

function plannedRiskDollars(entry: BotHistoryEntry) {
  const setup = entry.setup
  if (!setup || entry.qty === null) return null
  const riskPerShare = Math.max(0, setup.trigger - setup.stop)
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
  return riskPerShare * Math.abs(entry.qty)
}

function reviewTags(entry: BotHistoryEntry, netPnl: number | null, actualR: number | null) {
  const tags: string[] = [entry.side === 'buy' ? 'entry' : 'exit', `mode-${entry.mode}`, `outcome-${entry.outcome}`]
  const setup = entry.setup
  if (!setup) tags.push('missing-setup-context')
  else {
    tags.push(`asset-${setup.assetClass}`, `entry-${setup.entryMode}`, `status-${setup.status}`)
    if (setup.assetClass === 'stock' && setup.spreadPct >= 0.5) tags.push('wide-stock-spread')
    if (setup.assetClass === 'stock' && setup.spreadPct < 0.25) tags.push('tight-stock-spread')
    if ((setup.vwapExtensionPct ?? 0) >= 10) tags.push('extended-from-vwap')
    if ((setup.vwapExtensionPct ?? 0) <= 6) tags.push('controlled-vwap-extension')
    if ((setup.timeAdjustedRelativeVolume ?? 0) >= 20) tags.push('hot-time-rvol')
    if ((setup.microTapeOneMinuteMovePct ?? 0) >= 1) tags.push('micro-tape-rising-fast')
    if (setup.microPullbackState) tags.push(`micro-${setup.microPullbackState.toLowerCase()}`)
    if (setup.technical) {
      tags.push(`trend-${setup.technical.trendLabel}`)
      tags.push(`fib-${setup.technical.fibZone.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
    }
  }

  const reason = entry.reason.toLowerCase()
  if (reason.includes('target')) tags.push('target-exit')
  if (reason.includes('stop')) tags.push('stop-exit')
  if (reason.includes('lost vwap')) tags.push('lost-vwap-exit')
  if (reason.includes('data quality')) tags.push('data-quality-exit')

  if (entry.side === 'sell' && entry.pnl !== null) {
    if (entry.pnl > 0) tags.push('gross-win')
    else if (entry.pnl < 0) tags.push('gross-loss')
    else tags.push('gross-flat')
    if (netPnl !== null) {
      if (netPnl > 0) tags.push('net-win')
      else if (netPnl < 0) tags.push('net-loss')
      if (entry.pnl > 0 && netPnl <= 0) tags.push('gross-win-cost-drag')
    }
    if ((entry.maxFavorableR ?? 0) >= 0.5 && entry.pnl < 0) tags.push('gave-back-winner')
    if ((entry.maxAdverseR ?? 0) >= 1.2) tags.push('exceeded-planned-risk')
    if ((entry.maxFavorableR ?? 0) < 0.6 && entry.pnl > 0) tags.push('small-fast-winner')
    if (actualR !== null && actualR < -1.1) tags.push('loss-beyond-1r')
  }
  return [...new Set(tags)]
}

function appendTradeReview(entry: BotHistoryEntry) {
  try {
    const cost = entry.side === 'sell' && entry.pnl !== null ? historyEntryCost(entry) : null
    const netPnl = entry.side === 'sell' && entry.pnl !== null ? entry.pnl - (cost ?? 0) : null
    const riskDollars = plannedRiskDollars(entry)
    const actualR = entry.pnl !== null && riskDollars !== null && riskDollars > 0 ? Math.round((entry.pnl / riskDollars) * 1000) / 1000 : null
    const setup = entry.setup
    const review = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      eventId: entry.id,
      eventType: entry.side === 'buy' ? 'entry' : 'exit',
      trade: {
        time: entry.time,
        orderId: entry.orderId ?? null,
        symbol: entry.symbol,
        side: entry.side,
        mode: entry.mode,
        reason: entry.reason,
        outcome: entry.outcome,
        qty: entry.qty,
        notional: entry.notional,
        price: entry.price,
        holdSeconds: entry.holdSeconds ?? null,
      },
      performance: {
        grossPnl: entry.pnl,
        grossPnlPct: entry.pnlPct,
        estimatedRoundTripCost: cost,
        netPnl,
        plannedRiskDollars: riskDollars,
        actualR,
        maxFavorableR: entry.maxFavorableR ?? null,
        maxAdverseR: entry.maxAdverseR ?? null,
      },
      setup,
      plan: setup
        ? {
            trigger: setup.trigger,
            stop: setup.stop,
            target1: setup.target1,
            target2: setup.target2,
            riskPct: setup.riskPct,
          }
        : null,
      review: {
        tags: reviewTags(entry, netPnl, actualR),
        primaryIssue:
          entry.side === 'sell' && entry.pnl !== null && entry.pnl < 0
            ? (entry.maxFavorableR ?? 0) >= 0.5
              ? 'Trade moved in favor, then reversed before protection captured it.'
              : 'Trade never moved far enough in favor before exit.'
            : entry.side === 'sell' && entry.pnl !== null && netPnl !== null && netPnl <= 0
              ? 'Gross result was not enough to overcome modeled execution costs.'
              : null,
      },
    }
    appendFileSync(TRADE_REVIEW_FILE, `${JSON.stringify(review)}\n`, 'utf8')
  } catch (error) {
    pushLog('error', '-', `Could not append trade review journal: ${message(error)}`)
  }
}

function backfillTradeReviewJournal() {
  if (history.length === 0 || existsSync(TRADE_REVIEW_FILE)) return
  for (const entry of [...history].reverse()) appendTradeReview(entry)
  pushLog('info', '-', `Backfilled ${history.length} trade review row(s) to paper-bot-review.jsonl`)
}

function bucketLabel(value: number, buckets: Array<{ max: number; key: string; label: string }>, fallback: { key: string; label: string }) {
  return buckets.find((bucket) => value <= bucket.max) ?? fallback
}

function scoreBucket(score: number) {
  if (score >= 90) return { key: 'score90', label: 'score 90+' }
  if (score >= 80) return { key: 'score80', label: 'score 80-89' }
  if (score >= 70) return { key: 'score70', label: 'score 70-79' }
  return { key: 'scoreSub70', label: 'score <70' }
}

function distanceBucket(distance: number) {
  return bucketLabel(
    distance,
    [
      { max: 0.75, key: 'highTight', label: '<0.75% off high' },
      { max: 2, key: 'highNear', label: '<2% off high' },
      { max: 4, key: 'highWide', label: '<4% off high' },
    ],
    { key: 'highFar', label: 'far from high' },
  )
}

function timeRvolBucket(value: number | null) {
  if (value === null) return { key: 'todUnknown', label: 'time rVol unknown' }
  if (value >= 3) return { key: 'todHot', label: 'hot time rVol' }
  if (value >= 1.5) return { key: 'todGood', label: 'good time rVol' }
  if (value >= 1) return { key: 'todOk', label: 'ok time rVol' }
  return { key: 'todWeak', label: 'weak time rVol' }
}

function pulseBucket(value: number | null) {
  if (value === null) return { key: 'pulseUnknown', label: 'pulse unknown' }
  if (value >= 3) return { key: 'pulse3', label: '3x+ pulse' }
  if (value >= 2) return { key: 'pulse2', label: '2x+ pulse' }
  if (value >= 1.2) return { key: 'pulseOk', label: 'pulse ok' }
  return { key: 'pulseWeak', label: 'weak pulse' }
}

function vwapExtensionBucket(value: number | null) {
  if (value === null) return { key: 'vwapUnknown', label: 'VWAP ext unknown' }
  if (value >= 15) return { key: 'vwapExtreme', label: 'extreme VWAP extension' }
  if (value >= 8) return { key: 'vwapExtended', label: 'extended from VWAP' }
  if (value >= 0) return { key: 'vwapControlled', label: 'controlled VWAP extension' }
  return { key: 'vwapBelow', label: 'below VWAP' }
}

function floatTurnoverBucket(value: number | null) {
  if (value === null) return { key: 'floatUnknown', label: 'float unknown' }
  if (value >= 1) return { key: 'floatFull', label: 'full-float rotation' }
  if (value >= 0.5) return { key: 'floatHalf', label: 'half-float rotation' }
  return { key: 'floatLow', label: 'low float rotation' }
}

function microTapeBucket(movePct: number | null, pulse: number | null) {
  if (movePct === null) return { key: 'tapeUnknown', label: '10s tape unknown' }
  if (movePct <= -0.7) return { key: 'tapeFading', label: '10s tape fading' }
  if (movePct >= 1 && (pulse ?? 0) >= 1.5) return { key: 'tapeRisingHot', label: '10s tape rising on volume' }
  if (movePct >= 0.3) return { key: 'tapeRising', label: '10s tape rising' }
  return { key: 'tapeFlat', label: '10s tape flat' }
}

function setupMemoryFingerprint(setup: BotTradeSetup) {
  const score = scoreBucket(setup.score)
  const distance = distanceBucket(setup.distanceFromHighPct)
  const trend = setup.technical?.trendLabel ?? 'trend-unknown'
  const baseParts = [
    setup.assetClass,
    setup.entryMode,
    score.key,
    setup.aboveVwap ? 'aboveVwap' : 'belowVwap',
    distance.key,
    trend,
  ]
  const baseLabels = [
    setup.assetClass,
    setup.entryMode,
    score.label,
    setup.aboveVwap ? 'above VWAP' : 'below VWAP',
    distance.label,
    trend,
  ]

  if (setup.assetClass === 'stock') {
    const tod = timeRvolBucket(setup.timeAdjustedRelativeVolume)
    const micro = setup.microPullbackState ? `micro${setup.microPullbackState}` : 'microUnknown'
    const tape = microTapeBucket(setup.microTapeOneMinuteMovePct, setup.microTapePulse)
    const vwap = vwapExtensionBucket(setup.vwapExtensionPct)
    const float = floatTurnoverBucket(setup.floatTurnover)
    return {
      key: [...baseParts, tod.key, micro, tape.key, vwap.key, float.key].join('|'),
      label: [
        ...baseLabels,
        tod.label,
        setup.microPullbackState ? `micro ${setup.microPullbackState.toLowerCase()}` : 'micro unknown',
        tape.label,
        vwap.label,
        float.label,
      ].join(' / '),
      assetClass: setup.assetClass,
    }
  }

  const pulse = pulseBucket(setup.volumePulse)
  const quote =
    setup.quoteVolume !== null && setup.quoteVolume >= 200_000_000
      ? { key: 'quote200m', label: '$200M+ quote volume' }
      : setup.quoteVolume !== null && setup.quoteVolume >= 50_000_000
        ? { key: 'quote50m', label: '$50M+ quote volume' }
        : { key: 'quoteSub50m', label: '<$50M quote volume' }
  return {
    key: [...baseParts, pulse.key, quote.key].join('|'),
    label: [...baseLabels, pulse.label, quote.label].join(' / '),
    assetClass: setup.assetClass,
  }
}

function setupMemoryToPublic(entry: SetupMemoryStoredEntry): BotSetupMemoryEntry {
  const netRealizedPl = entry.realizedPl - entry.estimatedCost
  return {
    ...entry,
    winRate: entry.trades > 0 ? entry.wins / entry.trades : null,
    avgPnl: entry.trades > 0 ? entry.realizedPl / entry.trades : 0,
    netRealizedPl,
    netAvgPnl: entry.trades > 0 ? netRealizedPl / entry.trades : 0,
  }
}

function sortedSetupMemory(limit = 8) {
  return [...setupMemory.values()]
    .map(setupMemoryToPublic)
    .sort((a, b) => {
      const aWeak = a.trades >= 3 && a.netAvgPnl < 0 ? 1 : 0
      const bWeak = b.trades >= 3 && b.netAvgPnl < 0 ? 1 : 0
      return bWeak - aWeak || b.trades - a.trades || a.netAvgPnl - b.netAvgPnl
    })
    .slice(0, limit)
}

function persistSetupMemory() {
  const payload: SetupMemoryFile = {
    version: SETUP_MEMORY_VERSION,
    updatedAt: new Date().toISOString(),
    entries: [...setupMemory.values()].sort((a, b) => b.trades - a.trades).slice(0, 500),
  }
  try {
    writeFileSync(SETUP_MEMORY_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch (error) {
    pushLog('error', '-', `Could not write setup memory file: ${message(error)}`)
  }
}

function updateSetupMemory(entry: BotHistoryEntry, persist = true) {
  if (entry.side !== 'sell' || entry.pnl === null || !entry.setup) return
  const fingerprint = setupMemoryFingerprint(entry.setup)
  const existing = setupMemory.get(fingerprint.key) ?? {
    key: fingerprint.key,
    label: fingerprint.label,
    assetClass: fingerprint.assetClass,
    trades: 0,
    wins: 0,
    losses: 0,
    flats: 0,
    realizedPl: 0,
    estimatedCost: 0,
    lastUpdated: null,
    lastOutcome: null,
  }
  existing.label = fingerprint.label
  existing.assetClass = fingerprint.assetClass
  existing.trades += 1
  if (entry.pnl > 0) existing.wins += 1
  else if (entry.pnl < 0) existing.losses += 1
  else existing.flats += 1
  existing.realizedPl += entry.pnl
  existing.estimatedCost += historyEntryCost(entry)
  existing.lastUpdated = entry.time
  existing.lastOutcome = entry.pnl > 0 ? 'win' : entry.pnl < 0 ? 'loss' : 'flat'
  setupMemory.set(fingerprint.key, existing)
  if (persist) persistSetupMemory()
}

function rebuildSetupMemoryFromHistory() {
  setupMemory.clear()
  for (const entry of [...history].reverse()) updateSetupMemory(entry, false)
  persistSetupMemory()
}

function loadSetupMemoryFromDisk() {
  try {
    if (!existsSync(SETUP_MEMORY_FILE)) {
      rebuildSetupMemoryFromHistory()
      return
    }
    const parsed = JSON.parse(readFileSync(SETUP_MEMORY_FILE, 'utf8')) as Partial<SetupMemoryFile>
    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    setupMemory.clear()
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Partial<SetupMemoryStoredEntry>
      if (
        typeof entry.key !== 'string' ||
        typeof entry.label !== 'string' ||
        (entry.assetClass !== 'stock' && entry.assetClass !== 'crypto') ||
        typeof entry.trades !== 'number'
      ) {
        continue
      }
      setupMemory.set(entry.key, {
        key: entry.key,
        label: entry.label,
        assetClass: entry.assetClass,
        trades: Math.max(0, Math.round(entry.trades)),
        wins: typeof entry.wins === 'number' ? Math.max(0, Math.round(entry.wins)) : 0,
        losses: typeof entry.losses === 'number' ? Math.max(0, Math.round(entry.losses)) : 0,
        flats: typeof entry.flats === 'number' ? Math.max(0, Math.round(entry.flats)) : 0,
        realizedPl: typeof entry.realizedPl === 'number' && Number.isFinite(entry.realizedPl) ? entry.realizedPl : 0,
        estimatedCost: typeof entry.estimatedCost === 'number' && Number.isFinite(entry.estimatedCost) ? entry.estimatedCost : 0,
        lastUpdated: typeof entry.lastUpdated === 'string' ? entry.lastUpdated : null,
        lastOutcome: entry.lastOutcome === 'win' || entry.lastOutcome === 'loss' || entry.lastOutcome === 'flat' ? entry.lastOutcome : null,
      })
    }
    if (setupMemory.size === 0 && history.some((entry) => entry.side === 'sell' && entry.setup)) rebuildSetupMemoryFromHistory()
  } catch {
    rebuildSetupMemoryFromHistory()
  }
}

function credentials() {
  const key = envValue('ALPACA_API_KEY_ID') || envValue('APCA_API_KEY_ID')
  const secret = envValue('ALPACA_API_SECRET_KEY') || envValue('APCA_API_SECRET_KEY')
  return key && secret ? { key, secret } : null
}

export function isBotConfigured() {
  return configurationBlocker() === null
}

function tradingBaseUrl() {
  const raw = envValue('ALPACA_TRADING_BASE_URL') || 'https://paper-api.alpaca.markets'
  return raw.replace(/\/+$/, '').replace(/\/v2$/, '')
}

function liveTradingBlocker() {
  const base = tradingBaseUrl()
  if (/paper-api\.alpaca\.markets/i.test(base)) return null
  if (envValue('ALLOW_LIVE_TRADING') === LIVE_TRADING_ACK) return null
  return `Live Alpaca trading is blocked. Keep ALPACA_TRADING_BASE_URL on paper-api.alpaca.markets or set ALLOW_LIVE_TRADING=${LIVE_TRADING_ACK} after independent testing.`
}

function isPaperTradingBase() {
  return /paper-api\.alpaca\.markets/i.test(tradingBaseUrl())
}

function liveNumber(name: string, fallback: number, floor: number) {
  return Math.max(floor, envNumber(name, fallback))
}

export function positionCountLimitFor(paperTrading: boolean, configuredLiveLimit: number) {
  return paperTrading ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor(configuredLiveLimit))
}

function liveMaxPositions() {
  // Paper research is deliberately count-unbounded: cash, per-trade risk,
  // portfolio risk, and minimum notional remain the real capacity limits. This
  // lets the lab collect as many valid trade observations as the account can
  // safely fund without carrying an arbitrary mode slot ceiling into results.
  if (isPaperTradingBase()) return positionCountLimitFor(true, LIVE_DEFAULT_MAX_POSITIONS)
  return positionCountLimitFor(
    false,
    liveNumber('LIVE_BOT_MAX_POSITIONS', LIVE_DEFAULT_MAX_POSITIONS, 1),
  )
}

function reportedMaxPositions() {
  return isPaperTradingBase() ? 0 : liveMaxPositions()
}

function positionCapacityLabel() {
  return isPaperTradingBase() ? 'cash/risk-driven positions (no count cap)' : `${liveMaxPositions()} max positions`
}

function minNotionalForExecution() {
  if (isPaperTradingBase()) return MIN_NOTIONAL
  return liveNumber('LIVE_BOT_MIN_NOTIONAL', LIVE_DEFAULT_MIN_NOTIONAL, 1)
}

function maxNotionalForExecution(assetClass: AssetClass) {
  const paperCap = (assetClass === 'crypto' ? CRYPTO_MAX_NOTIONAL : MAX_NOTIONAL) * cfg().sizeMultiplier
  if (isPaperTradingBase()) return paperCap
  const liveCap =
    assetClass === 'crypto'
      ? liveNumber('LIVE_BOT_CRYPTO_MAX_NOTIONAL', LIVE_DEFAULT_CRYPTO_MAX_NOTIONAL, 1)
      : liveNumber('LIVE_BOT_STOCK_MAX_NOTIONAL', LIVE_DEFAULT_STOCK_MAX_NOTIONAL, 1)
  return Math.min(paperCap, liveCap)
}

function cryptoVenue(): CryptoVenue {
  const raw = envValue('BOT_CRYPTO_VENUE')?.toLowerCase()
  return raw === 'binance' ? 'binance' : 'alpaca'
}

function cryptoOnBinance() {
  return cryptoVenue() === 'binance'
}

function cryptoVenueLabel() {
  if (!cryptoEnabled()) return 'crypto off (stocks only)'
  return cryptoOnBinance() ? 'Binance Spot Testnet crypto' : 'Alpaca paper crypto'
}

function executionLabel(venue: ExecutionVenue) {
  return venue === 'binance' ? 'Binance testnet' : 'Alpaca paper'
}

// Stocks-only by default: the bot trades only Alpaca US stocks and never touches
// crypto/Binance. Flip BOT_ENABLE_CRYPTO=1 to re-enable crypto execution.
function cryptoEnabled() {
  return /^(1|true|on|yes)$/i.test(envValue('BOT_ENABLE_CRYPTO') ?? '')
}

// Stocks are tradable on Alpaca through the whole extended-hours window
// (pre-market 04:00 ET through after-hours 20:00 ET), not just 09:30-16:00 RTH.
// Extended-hours orders MUST be LIMIT orders flagged extended_hours=true.
function isStockTradableNow(now = new Date()) {
  const session = computedStockMarketStatus(now)
  return session === 'OPEN' || session === 'PRE_MARKET' || session === 'AFTER_HOURS'
}

function isExtendedHoursNow(now = new Date()) {
  const session = computedStockMarketStatus(now)
  return session === 'PRE_MARKET' || session === 'AFTER_HOURS'
}

function configurationBlocker() {
  if (!credentials()) return 'Alpaca credentials are not configured.'
  if (cryptoEnabled() && cryptoOnBinance() && !binanceClientConfigured()) {
    return 'Binance testnet keys are not configured while BOT_CRYPTO_VENUE=binance.'
  }
  return null
}

function num(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'unexpected error'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Crypto symbols are inconsistent across Alpaca endpoints ("BTC/USD" in orders,
// sometimes "BTCUSD" in positions). Normalize to alphanumeric for matching.
function normSymbol(symbol: string) {
  return symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function cryptoBaseFromTicker(ticker: string) {
  return ticker.replace(/USDT$/, '').toUpperCase()
}

function alpacaCryptoPair(base: string, quote: string) {
  return `${base.toUpperCase()}/${quote.toUpperCase()}`
}

function alpacaSymbolFor(candidate: MomentumCandidate): string {
  if (candidate.assetClass === 'crypto') {
    return alpacaCryptoPair(cryptoBaseFromTicker(candidate.ticker), 'USD')
  }
  return candidate.ticker
}

function binanceSymbolFor(candidate: MomentumCandidate): string | null {
  if (candidate.assetClass !== 'crypto') return null
  return mapBaseToBinanceSymbol(cryptoBaseFromTicker(candidate.ticker))
}

function cryptoBaseFromSymbol(symbol: string): string | null {
  const m = symbol.toUpperCase().match(/^([A-Z0-9]+?)\/?USD[T]?$/)
  return m ? m[1] : null
}

function binanceDisplaySymbol(symbol: string) {
  const base = cryptoBaseFromSymbol(symbol)
  return base ? `${base}/USDT` : symbol
}

function botDisplaySymbol(candidate: MomentumCandidate) {
  const resolved = resolveTradableSymbol(candidate)
  if (resolved?.venue === 'binance') return binanceDisplaySymbol(resolved.symbol)
  return resolved?.symbol ?? candidate.displaySymbol
}

// Mirror bot activity to the server's stdout/stderr so it can be tailed from the
// terminal (or the preview logs) for debugging, independent of the in-memory UI
// log. 'tick' is a per-tick heartbeat; everything else maps to a log level.
function serverLog(level: BotLogLevel | 'tick', symbol: string, msg: string) {
  const line = `[paper-bot] ${level.toUpperCase()} ${symbol === '-' ? '' : `${symbol} `}${msg}`
  if (level === 'error') console.error(line)
  else console.log(line)
}

function pushLog(level: BotLogLevel, symbol: string, msg: string) {
  log.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    level,
    symbol,
    message: msg,
  })
  if (log.length > LOG_LIMIT) log.length = LOG_LIMIT
  // Buys, sells, and errors are the events worth seeing in the server console.
  if (level === 'buy' || level === 'sell' || level === 'error') serverLog(level, symbol, msg)
}

type BotMemoryFile = {
  version: number
  updatedAt: string
  history: BotHistoryEntry[]
}

function validMode(value: unknown): value is BotMode {
  return value === 'safe' || value === 'active' || value === 'turbo'
}

function cleanTechnicalContext(value: unknown): BotTechnicalContext | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<BotTechnicalContext>
  if (
    typeof raw.trendScore !== 'number' ||
    typeof raw.trendLabel !== 'string' ||
    typeof raw.fibZone !== 'string' ||
    typeof raw.edgeScore !== 'number'
  ) {
    return null
  }
  if (raw.trendLabel !== 'strong-uptrend' && raw.trendLabel !== 'uptrend' && raw.trendLabel !== 'mixed' && raw.trendLabel !== 'weak') {
    return null
  }
  return {
    trendScore: clamp(raw.trendScore, 0, 100),
    trendLabel: raw.trendLabel,
    fibZone: raw.fibZone,
    fibRetracementPct:
      typeof raw.fibRetracementPct === 'number' && Number.isFinite(raw.fibRetracementPct) ? raw.fibRetracementPct : null,
    fibNearestLevel:
      typeof raw.fibNearestLevel === 'number' && Number.isFinite(raw.fibNearestLevel) ? raw.fibNearestLevel : null,
    edgeScore: clamp(raw.edgeScore, 0, 100),
    notes: Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string').slice(0, 4) : [],
  }
}

function cleanSetup(value: unknown): BotTradeSetup | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<BotTradeSetup>
  if (
    (raw.assetClass !== 'stock' && raw.assetClass !== 'crypto') ||
    raw.status === undefined ||
    typeof raw.entryMode !== 'string' ||
    typeof raw.score !== 'number' ||
    typeof raw.aboveVwap !== 'boolean' ||
    typeof raw.relativeVolume !== 'number' ||
    typeof raw.distanceFromHighPct !== 'number' ||
    typeof raw.changePct !== 'number' ||
    typeof raw.spreadPct !== 'number' ||
    typeof raw.trigger !== 'number' ||
    typeof raw.stop !== 'number' ||
    typeof raw.target1 !== 'number' ||
    typeof raw.target2 !== 'number' ||
    typeof raw.riskPct !== 'number'
  ) {
    return null
  }
  return {
    assetClass: raw.assetClass,
    venue: raw.venue === 'binance' ? 'binance' : 'alpaca',
    entryMode: raw.entryMode as BotTradePlan['mode'],
    score: raw.score,
    status: raw.status,
    aboveVwap: raw.aboveVwap,
    volumePulse: typeof raw.volumePulse === 'number' && Number.isFinite(raw.volumePulse) ? raw.volumePulse : null,
    quoteVolume: typeof raw.quoteVolume === 'number' && Number.isFinite(raw.quoteVolume) ? raw.quoteVolume : null,
    relativeVolume: raw.relativeVolume,
    timeAdjustedRelativeVolume:
      typeof raw.timeAdjustedRelativeVolume === 'number' && Number.isFinite(raw.timeAdjustedRelativeVolume)
        ? raw.timeAdjustedRelativeVolume
        : null,
    distanceFromHighPct: raw.distanceFromHighPct,
    changePct: raw.changePct,
    vwapExtensionPct: typeof raw.vwapExtensionPct === 'number' && Number.isFinite(raw.vwapExtensionPct) ? raw.vwapExtensionPct : null,
    spreadPct: raw.spreadPct,
    floatTurnover: typeof raw.floatTurnover === 'number' && Number.isFinite(raw.floatTurnover) ? raw.floatTurnover : null,
    microPullbackState:
      raw.microPullbackState === 'NONE' ||
      raw.microPullbackState === 'FORMING' ||
      raw.microPullbackState === 'READY' ||
      raw.microPullbackState === 'FAILED' ||
      raw.microPullbackState === 'EXTENDED'
        ? raw.microPullbackState
        : null,
    microPullbackScore:
      typeof raw.microPullbackScore === 'number' && Number.isFinite(raw.microPullbackScore) ? raw.microPullbackScore : null,
    atr: typeof raw.atr === 'number' && Number.isFinite(raw.atr) && raw.atr > 0 ? raw.atr : null,
    supportDistancePct:
      typeof raw.supportDistancePct === 'number' && Number.isFinite(raw.supportDistancePct) ? raw.supportDistancePct : null,
    resistanceDistancePct:
      typeof raw.resistanceDistancePct === 'number' && Number.isFinite(raw.resistanceDistancePct) ? raw.resistanceDistancePct : null,
    microTapeOneMinuteMovePct:
      typeof raw.microTapeOneMinuteMovePct === 'number' && Number.isFinite(raw.microTapeOneMinuteMovePct)
        ? raw.microTapeOneMinuteMovePct
        : null,
    microTapePulse: typeof raw.microTapePulse === 'number' && Number.isFinite(raw.microTapePulse) ? raw.microTapePulse : null,
    trigger: raw.trigger,
    stop: raw.stop,
    target1: raw.target1,
    target2: raw.target2,
    riskPct: raw.riskPct,
    technical: cleanTechnicalContext(raw.technical),
  }
}

function cleanHistoryEntry(value: unknown): BotHistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<BotHistoryEntry>
  if (
    typeof raw.id !== 'string' ||
    typeof raw.time !== 'string' ||
    typeof raw.symbol !== 'string' ||
    (raw.side !== 'buy' && raw.side !== 'sell') ||
    typeof raw.reason !== 'string' ||
    (raw.outcome !== 'open' && raw.outcome !== 'win' && raw.outcome !== 'loss' && raw.outcome !== 'flat') ||
    !validMode(raw.mode)
  ) {
    return null
  }
  return {
    id: raw.id,
    time: raw.time,
    orderId: typeof raw.orderId === 'string' ? raw.orderId : null,
    symbol: raw.symbol,
    side: raw.side,
    reason: raw.reason,
    qty: typeof raw.qty === 'number' && Number.isFinite(raw.qty) ? raw.qty : null,
    notional: typeof raw.notional === 'number' && Number.isFinite(raw.notional) ? raw.notional : null,
    price: typeof raw.price === 'number' && Number.isFinite(raw.price) ? raw.price : null,
    pnl: typeof raw.pnl === 'number' && Number.isFinite(raw.pnl) ? raw.pnl : null,
    pnlPct: typeof raw.pnlPct === 'number' && Number.isFinite(raw.pnlPct) ? raw.pnlPct : null,
    outcome: raw.outcome,
    mode: raw.mode,
    holdSeconds: typeof raw.holdSeconds === 'number' && Number.isFinite(raw.holdSeconds) ? raw.holdSeconds : null,
    setup: cleanSetup(raw.setup),
    maxFavorableR: typeof raw.maxFavorableR === 'number' && Number.isFinite(raw.maxFavorableR) ? raw.maxFavorableR : null,
    maxAdverseR: typeof raw.maxAdverseR === 'number' && Number.isFinite(raw.maxAdverseR) ? raw.maxAdverseR : null,
  }
}

function persistHistory() {
  const payload: BotMemoryFile = {
    version: MEMORY_VERSION,
    updatedAt: new Date().toISOString(),
    history: history.slice(0, HISTORY_LIMIT),
  }
  try {
    writeFileSync(MEMORY_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch (error) {
    pushLog('error', '-', `Could not write bot memory file: ${message(error)}`)
  }
}

function loadHistoryFromDisk() {
  try {
    if (!existsSync(MEMORY_FILE)) {
      persistHistory()
      return
    }
    const parsed = JSON.parse(readFileSync(MEMORY_FILE, 'utf8')) as Partial<BotMemoryFile>
    const entries = Array.isArray(parsed.history) ? parsed.history.map(cleanHistoryEntry).filter((entry) => entry !== null) : []
    history.splice(0, history.length, ...entries.slice(0, HISTORY_LIMIT))
    if (history.length > 0) pushLog('info', '-', `Loaded ${history.length} trade journal row(s) from paper-bot-memory.json`)
  } catch (error) {
    pushLog('error', '-', `Could not read bot memory file: ${message(error)}`)
  }
}

loadHistoryFromDisk()
backfillTradeReviewJournal()
loadSetupMemoryFromDisk()

const equitySeries: EquityPoint[] = []
let lastEquitySampleAt = 0
let lastEquityPersistAt = 0
let equitySeriesKey = 'crypto=alpaca;currency=USD'

function accountEquitySeriesKey(account: BotAccount) {
  return `crypto=${cryptoVenue()};currency=${account.currency}`
}

function loadEquitySeriesFromDisk() {
  try {
    if (!existsSync(EQUITY_FILE)) return
    const parsed = JSON.parse(readFileSync(EQUITY_FILE, 'utf8')) as { accountKey?: unknown; points?: unknown }
    equitySeriesKey = typeof parsed.accountKey === 'string' ? parsed.accountKey : 'crypto=alpaca;currency=USD'
    const points = Array.isArray(parsed.points) ? parsed.points : []
    for (const raw of points) {
      if (!raw || typeof raw !== 'object') continue
      const point = raw as Partial<EquityPoint>
      if (typeof point.t === 'string' && typeof point.equity === 'number' && typeof point.cash === 'number') {
        equitySeries.push({ t: point.t, equity: point.equity, cash: point.cash })
      }
    }
    if (equitySeries.length > EQUITY_SERIES_LIMIT) equitySeries.splice(0, equitySeries.length - EQUITY_SERIES_LIMIT)
  } catch {
    /* a corrupt curve file is non-fatal; start a fresh series */
  }
}

function persistEquitySeries(force = false) {
  const now = Date.now()
  if (!force && now - lastEquityPersistAt < EQUITY_SAMPLE_MS) return
  lastEquityPersistAt = now
  try {
    writeFileSync(EQUITY_FILE, `${JSON.stringify({ updatedAt: new Date().toISOString(), accountKey: equitySeriesKey, points: equitySeries })}\n`, 'utf8')
  } catch {
    /* ignore: the chart is best-effort */
  }
}

// Sample account value so the UI can chart equity going up/down as the bot trades.
// Idle ~1 point/min; a trade that moves equity/cash records a point immediately so
// the step shows up right away rather than being averaged out by the throttle.
function recordEquityPoint(account: BotAccount | null) {
  if (!account || !Number.isFinite(account.equity)) return
  const now = Date.now()
  const accountKey = accountEquitySeriesKey(account)
  if (equitySeriesKey !== accountKey) {
    equitySeriesKey = accountKey
    equitySeries.splice(0, equitySeries.length)
    lastEquitySampleAt = 0
    lastEquityPersistAt = 0
  }
  const last = equitySeries[equitySeries.length - 1]
  const moved = !last || Math.abs(account.equity - last.equity) > 0.01 || Math.abs(account.cash - last.cash) > 0.01
  if (last && now - lastEquitySampleAt < EQUITY_SAMPLE_MS && !moved) return
  lastEquitySampleAt = now
  equitySeries.push({
    t: new Date(now).toISOString(),
    equity: Math.round(account.equity * 100) / 100,
    cash: Math.round(account.cash * 100) / 100,
  })
  if (equitySeries.length > EQUITY_SERIES_LIMIT) equitySeries.splice(0, equitySeries.length - EQUITY_SERIES_LIMIT)
  persistEquitySeries(moved && equitySeries.length <= 2)
}

loadEquitySeriesFromDisk()

function pushHistory(entry: Omit<BotHistoryEntry, 'id' | 'time'>) {
  const recorded: BotHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    ...entry,
  }
  if (recorded.orderId && history.some((existing) => existing.orderId === recorded.orderId)) return
  history.unshift(recorded)
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  persistHistory()
  appendTradeLog(recorded)
  appendTradeReview(recorded)
  updateSetupMemory(recorded)
  notifyDiscordTrade(recorded)
}

function historyStats(): BotStats {
  return history.reduce(
    (stats, entry) => {
      if (entry.side !== 'sell' || entry.pnl === null) return stats
      stats.closedTrades += 1
      stats.realizedPl += entry.pnl
      if (entry.pnl > 0) stats.wins += 1
      else if (entry.pnl < 0) stats.losses += 1
      else stats.flats += 1
      return stats
    },
    { wins: 0, losses: 0, flats: 0, closedTrades: 0, realizedPl: 0 },
  )
}

function pushStatusLog(symbol: string, msg: string) {
  const signature = `${symbol}:${msg}`
  const now = Date.now()
  if (signature === lastStatusSignature && now - lastStatusLogAt < STATUS_LOG_MS) return
  lastStatusSignature = signature
  lastStatusLogAt = now
  pushLog('info', symbol, msg)
}

function orderStatus(order: BotOrder | undefined) {
  return order?.status.trim().toLowerCase() ?? ''
}

function isBotOrder(order: BotOrder) {
  return order.clientOrderId?.startsWith(BOT_CLIENT_ORDER_PREFIX) ?? false
}

function timestampMs(value: string | null) {
  if (!value) return null
  const direct = Date.parse(value)
  if (Number.isFinite(direct)) return direct
  const normalized = value.replace(/\.(\d{3})\d+(Z|[+-]\d\d:\d\d)$/, '.$1$2')
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function orderAgeMs(order: BotOrder) {
  const submitted = timestampMs(order.submittedAt)
  return submitted === null ? null : Math.max(0, Date.now() - submitted)
}

function formatAgeMs(value: number | null) {
  if (value === null) return 'unknown age'
  if (value < 60_000) return `${Math.max(1, Math.round(value / 1000))}s`
  return `${Math.round(value / 60_000)}m`
}

function formatClock(ms: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms))
}

export function newYorkMinutesNow(now = new Date()): number {
  try {
    const estStr = now.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const [hour, minute] = estStr.split(':').map(Number)
    return hour * 60 + minute
  } catch {
    return 0
  }
}

// ---- scheduled macro-event blackout ---------------------------------------
// High-impact US data prints (FOMC decisions, CPI, NFP) blow out spreads, gap
// price through stops, and whipsaw the first minutes — a tight cluster of
// negative-expectancy fills the live-cost gate can't see coming (it trusts the
// last *calm* spread). These events sit on a fixed calendar, so the bot just
// stands aside: NEW entries pause for a short window around each print while open
// positions keep their normal stops/trails (exits are never blocked). NFP is the
// first Friday 08:30 ET (computed, never goes stale); FOMC dates are seeded
// below; CPI (no clean monthly rule) is supplied via PAPER_BOT_MACRO_EVENTS.
// Default on; disable with PAPER_BOT_MACRO_BLACKOUT=false.
type MacroEvent = { label: string; at: number }

// FOMC rate-decision announcements: 2nd meeting day, 14:00 ET.
// Verify/update yearly at federalreserve.gov/monetarypolicy/fomccalendars.htm
const FOMC_DECISION_DATES_ET = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
]

// UTC offset (minutes) of America/New_York at `at` — 240 (EDT) or 300 (EST).
function newYorkOffsetMinutes(at: Date): number {
  const asUtc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }))
  const asEt = new Date(at.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return Math.round((asUtc.getTime() - asEt.getTime()) / 60_000)
}

// Resolve an America/New_York wall-clock time to its UTC instant, DST-correct.
function newYorkWallClockToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const approx = Date.UTC(year, month - 1, day, hour, minute)
  return approx + newYorkOffsetMinutes(new Date(approx)) * 60_000
}

// Nonfarm payrolls: first Friday of the month, 08:30 ET.
function firstFridayNfpMs(year: number, month: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0=Sun … 6=Sat
  const day = 1 + ((5 - firstDow + 7) % 7)
  return newYorkWallClockToUtcMs(year, month, day, 8, 30)
}

// Operator-supplied events as "LABEL@ISO" (UTC), comma-separated. CPI lives here,
// e.g. PAPER_BOT_MACRO_EVENTS="CPI@2026-07-15T12:30:00Z,CPI@2026-08-12T12:30:00Z".
function parseEnvMacroEvents(): MacroEvent[] {
  const raw = envValue('PAPER_BOT_MACRO_EVENTS')
  if (!raw) return []
  const events: MacroEvent[] = []
  for (const token of raw.split(',')) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const split = trimmed.lastIndexOf('@')
    const label = split > 0 ? trimmed.slice(0, split).trim() : 'macro event'
    const ms = Date.parse(split > 0 ? trimmed.slice(split + 1).trim() : trimmed)
    if (Number.isFinite(ms)) events.push({ label, at: ms })
  }
  return events
}

let macroEventsCache: { key: string; events: MacroEvent[] } | null = null
function macroEvents(now: Date): MacroEvent[] {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const key = `${year}-${month}:${envValue('PAPER_BOT_MACRO_EVENTS') ?? ''}`
  if (macroEventsCache?.key === key) return macroEventsCache.events
  const events: MacroEvent[] = []
  for (const date of FOMC_DECISION_DATES_ET) {
    const [y, m, d] = date.split('-').map(Number)
    events.push({ label: 'FOMC rate decision', at: newYorkWallClockToUtcMs(y, m, d, 14, 0) })
  }
  // This month and next, so the window is always covered near a month boundary.
  events.push({ label: 'Nonfarm payrolls', at: firstFridayNfpMs(year, month) })
  events.push({
    label: 'Nonfarm payrolls',
    at: firstFridayNfpMs(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1),
  })
  events.push(...parseEnvMacroEvents())
  macroEventsCache = { key, events }
  return events
}

function macroBlackoutEnabled() {
  return !/^(0|false|off|no)$/i.test(envValue('PAPER_BOT_MACRO_BLACKOUT') ?? '')
}

// Reason string if `now` falls inside any event's [T-pre, T+post] window, else null.
export function macroBlackoutReason(now = new Date()): string | null {
  if (!macroBlackoutEnabled()) return null
  const preMs = Math.max(0, envNumber('PAPER_BOT_MACRO_BLACKOUT_PRE_MIN', 2)) * 60_000
  const postMs = Math.max(0, envNumber('PAPER_BOT_MACRO_BLACKOUT_POST_MIN', 10)) * 60_000
  const t = now.getTime()
  for (const event of macroEvents(now)) {
    if (t >= event.at - preMs && t <= event.at + postMs) {
      const deltaMin = Math.round((event.at - t) / 60_000)
      const phase = t <= event.at ? `in ${Math.max(0, deltaMin)} min` : `${Math.abs(deltaMin)} min ago`
      return `macro blackout: ${event.label} ${phase}; pausing new entries through the print`
    }
  }
  return null
}

// The next few scheduled prints for the bot UI calendar: events whose blackout
// window has not fully passed, soonest first. Empty when the feature is disabled.
export function upcomingMacroBlackouts(now = new Date(), limit = 5): BotMacroEvent[] {
  if (!macroBlackoutEnabled()) return []
  const preMs = Math.max(0, envNumber('PAPER_BOT_MACRO_BLACKOUT_PRE_MIN', 2)) * 60_000
  const postMs = Math.max(0, envNumber('PAPER_BOT_MACRO_BLACKOUT_POST_MIN', 10)) * 60_000
  const t = now.getTime()
  return macroEvents(now)
    .filter((event) => event.at + postMs >= t)
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map((event) => ({
      label: event.label,
      at: new Date(event.at).toISOString(),
      minutesUntil: Math.round((event.at - t) / 60_000),
      active: t >= event.at - preMs && t <= event.at + postMs,
    }))
}

function localDayKey(value: number | string | Date = Date.now()) {
  const date = value instanceof Date ? value : new Date(value)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function nextLocalDayMs() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}

function todayHistoryEntries() {
  const today = localDayKey()
  return history.filter((entry) => localDayKey(entry.time) === today)
}

function todayStats() {
  return todayHistoryEntries().reduce(
    (stats, entry) => {
      if (entry.side === 'buy') stats.entries += 1
      if (entry.side !== 'sell' || entry.pnl === null) return stats
      stats.closed += 1
      stats.realizedPl += entry.pnl
      if (entry.pnl > 0) stats.wins += 1
      else if (entry.pnl < 0) stats.losses += 1
      return stats
    },
    { entries: 0, closed: 0, wins: 0, losses: 0, realizedPl: 0 },
  )
}

function lossStreak(entries = history) {
  let streak = 0
  for (const entry of entries) {
    if (entry.side !== 'sell' || entry.pnl === null) continue
    if (entry.pnl < 0) streak += 1
    else break
  }
  return streak
}

function symbolTodayEntries(normalized: string) {
  return todayHistoryEntries().filter((entry) => entry.side === 'buy' && normSymbol(entry.symbol) === normalized).length
}

function symbolTodayLosses(normalized: string) {
  return todayHistoryEntries().filter(
    (entry) => entry.side === 'sell' && entry.pnl !== null && entry.pnl < 0 && normSymbol(entry.symbol) === normalized,
  ).length
}

function hasOpenJournalPosition(normalized: string) {
  for (const entry of history) {
    if (normSymbol(entry.symbol) !== normalized) continue
    return entry.side === 'buy'
  }
  return false
}

function recordAdoptedPositionHistory(position: BotPosition, normalized: string) {
  if (hasOpenJournalPosition(normalized)) return
  const price = position.avgEntry || position.currentPrice
  const meta = tracked.get(normalized)
  pushHistory({
    orderId: null,
    symbol: position.symbol,
    side: 'buy',
    reason: `adopted live ${executionLabel(position.venue)} position after restart`,
    qty: position.qty,
    notional: position.marketValue,
    price,
    pnl: null,
    pnlPct: null,
    outcome: 'open',
    mode: botMode,
    holdSeconds: null,
    setup: meta?.setup ?? null,
  })
}

function symbolLossStreak(normalized: string) {
  return lossStreak(history.filter((entry) => normSymbol(entry.symbol) === normalized))
}

export function isCooldownActive(cooldown: { until: number } | null | undefined, now = Date.now()) {
  return cooldown !== null && cooldown !== undefined && now < cooldown.until
}

function activeTradeCooldown(normalized: string) {
  const cooldown = tradeCooldowns.get(normalized)
  if (!cooldown) return null
  if (isCooldownActive(cooldown)) return cooldown
  tradeCooldowns.delete(normalized)
  return null
}

function cooldownSummary(cooldown: { until: number; reason: string }) {
  return `${cooldown.reason}; retry after ${formatClock(cooldown.until)}`
}

function activeNoFillCooldown(normalized: string) {
  const cooldown = noFillCooldowns.get(normalized)
  if (!cooldown) return null
  if (Date.now() < cooldown.until) return cooldown
  noFillCooldowns.delete(normalized)
  return null
}

function noFillCooldownSummary(cooldown: NoFillCooldown) {
  return cooldownSummary(cooldown)
}

function describeNoFill(status: string, budget?: number, venue: ExecutionVenue = 'alpaca') {
  const broker = executionLabel(venue)
  const size = budget && budget > 0 ? ` (${botPrice(budget)} attempt)` : ''
  if (status === 'canceled') return `${broker} canceled the last buy${size} before any fill`
  if (status === 'expired') return `${broker} expired the last buy${size} before any fill`
  if (status === 'rejected') return `${broker} rejected the last buy${size}`
  return `${broker} did not fill the last buy${size}`
}

function setNoFillCooldown(symbol: string, reason: string, durationMs = NO_FILL_COOLDOWN_MS) {
  noFillCooldowns.set(normSymbol(symbol), {
    until: Date.now() + durationMs,
    reason,
  })
}

function setTradeCooldown(symbol: string, reason: string, until: number) {
  tradeCooldowns.set(normSymbol(symbol), { until, reason })
}

function alpacaBackoffReason() {
  if (Date.now() >= alpacaBackoffUntil) return null
  return `Alpaca rate limit active; broker calls paused until ${formatClock(alpacaBackoffUntil)}`
}

function setAlpacaRateLimitBackoff(response: Response, path: string) {
  const retryAfter = Number(response.headers.get('retry-after'))
  const durationMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : ALPACA_RATE_LIMIT_BACKOFF_MS
  alpacaBackoffUntil = Math.max(alpacaBackoffUntil, Date.now() + durationMs)
  const reason = alpacaBackoffReason() ?? 'Alpaca rate limit active'
  botState.lastError = reason
  if (Date.now() - lastRateLimitLogAt > 30_000) {
    lastRateLimitLogAt = Date.now()
    pushLog('error', '-', `${reason} after ${path}`)
  }
}

export function retunePlanForFill(plan: BotTradePlan, fillPrice: number, mode: BotMode, assetClass: AssetClass) {
  if (fillPrice <= 0 || plan.trigger <= 0 || plan.stop <= 0) {
    return { plan, retuned: false, slippagePct: 0 }
  }
  const slippagePct = ((fillPrice - plan.trigger) / plan.trigger) * 100
  const staleTargets = plan.target1 <= fillPrice || plan.target2 <= fillPrice
  const actualRisk = fillPrice - plan.stop
  const actualTarget1R = actualRisk > 0 ? (plan.target1 - fillPrice) / actualRisk : Number.NEGATIVE_INFINITY
  const actualTarget2R = actualRisk > 0 ? (plan.target2 - fillPrice) / actualRisk : Number.NEGATIVE_INFINITY
  const turboNeedsRetune =
    mode === 'turbo' && (slippagePct > TURBO_BAD_FILL_RETUNE_PCT || staleTargets || plan.stop >= fillPrice)
  const stockNeedsRetune =
    assetClass === 'stock' &&
    mode !== 'turbo' &&
    plan.mode !== 'reversion' &&
    (slippagePct > STOCK_BAD_FILL_RETUNE_PCT ||
      staleTargets ||
      plan.stop >= fillPrice ||
      actualTarget1R < 0.9 ||
      actualTarget2R < 1.4)
  const seriousCryptoNeedsRetune =
    assetClass === 'crypto' &&
    mode !== 'turbo' &&
    (slippagePct > STOCK_BAD_FILL_RETUNE_PCT ||
      staleTargets ||
      plan.stop >= fillPrice ||
      actualTarget1R < 0.9 ||
      actualTarget2R < 1.4)
  if (!turboNeedsRetune && !stockNeedsRetune && !seriousCryptoNeedsRetune) {
    return { plan, retuned: false, slippagePct }
  }

  const riskPct = clamp((plan.trigger - plan.stop) / plan.trigger, 0.0035, 0.025)
  const target1Pct = clamp((plan.target1 - plan.trigger) / plan.trigger, riskPct * 1.15, 0.04)
  const target2Pct = clamp((plan.target2 - plan.trigger) / plan.trigger, target1Pct * 1.5, 0.065)
  const retuned: BotTradePlan = {
    ...plan,
    trigger: roundBotPrice(fillPrice, fillPrice),
    stop: roundBotPrice(fillPrice * (1 - riskPct), fillPrice),
    target1: roundBotPrice(fillPrice * (1 + target1Pct), fillPrice),
    target2: roundBotPrice(fillPrice * (1 + target2Pct), fillPrice),
  }
  return { plan: retuned, retuned: true, slippagePct }
}

function clearReadCaches() {
  accountCache.at = 0
  binanceAccountCache.at = 0
  positionsCache.at = 0
  ordersCache.at = 0
  openOrdersCache.at = 0
}

async function cachedRead<T>(cache: ReadCache<T>, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  if (cache.value !== null && now - cache.at < ttlMs) return cache.value
  if (cache.inFlight) return cache.inFlight
  const backoff = alpacaBackoffReason()
  if (backoff) {
    if (cache.value !== null) return cache.value
    throw new Error(backoff)
  }
  cache.inFlight = loader()
    .then((value) => {
      cache.value = value
      cache.at = Date.now()
      return value
    })
    .finally(() => {
      cache.inFlight = null
    })
  return cache.inFlight
}

function recordTradeExitCooldown(normalized: string, pending: PendingExit) {
  const symbol = pending.symbol
  // Paper USED to skip this entirely, which is what let turbo churn a single coin
  // overnight — buy, lose-VWAP/scratch, instantly re-buy, repeat — bleeding the
  // spread on every round trip. Paper now gets a lighter cooldown so it stops
  // re-buying the SAME symbol immediately (it can still trade other coins), while
  // live keeps its stricter day-lock schedule.
  const paper = isPaperTradingBase()
  if (pending.pnl < 0) {
    const lossesToday = symbolTodayLosses(normalized)
    const streak = symbolLossStreak(normalized)
    const lockForDay = !paper && (lossesToday >= cfg().symbolDailyLossLimit || streak >= cfg().symbolDailyLossLimit)
    const base = paper ? PAPER_REENTRY_LOSS_COOLDOWN_MS : cfg().lossCooldownMs
    const until = lockForDay ? nextLocalDayMs() : Date.now() + base
    const reason = lockForDay
      ? `locked after ${lossesToday} loss(es) today on ${symbol}`
      : `${pending.reason} cooldown (${botPrice(pending.pnl)})`
    setTradeCooldown(symbol, reason, until)
    return
  }

  // Win OR scratch (pnl >= 0). The "lost VWAP" scratch exits sit at ~0, and used
  // to set no cooldown at all on paper — the exact overnight churn path. Always
  // impose at least a short diversity cooldown so a scratch can't re-arm instantly.
  const winCd = paper ? PAPER_REENTRY_SCRATCH_COOLDOWN_MS : WIN_REENTRY_COOLDOWN_MS
  setTradeCooldown(symbol, `recent exit cooldown for diversity (${botPrice(pending.pnl)})`, Date.now() + winCd)
}

function emptyDiagnostics(mode: BotMode): BotDiagnostics {
  return {
    mode,
    closedTrades: 0,
    winRate: null,
    realizedPl: 0,
    avgPnl: null,
    avgWin: null,
    avgLoss: null,
    profitFactor: null,
    expectancy: null,
    costModeled: costModelEnabled(),
    estimatedCost: 0,
    netRealizedPl: 0,
    netExpectancy: null,
    netProfitFactor: null,
    byExitReason: [],
    bySetup: [],
    notes: ['No closed trades in this mode yet.'],
  }
}

function diagnosticBucket(map: Map<string, BotDiagnosticBucket>, key: string, label: string, entry: BotHistoryEntry) {
  let bucket = map.get(key)
  if (!bucket) {
    bucket = { key, label, trades: 0, wins: 0, losses: 0, flats: 0, realizedPl: 0, avgPnl: 0 }
    map.set(key, bucket)
  }
  bucket.trades += 1
  bucket.realizedPl += entry.pnl ?? 0
  if ((entry.pnl ?? 0) > 0) bucket.wins += 1
  else if ((entry.pnl ?? 0) < 0) bucket.losses += 1
  else bucket.flats += 1
  bucket.avgPnl = bucket.realizedPl / bucket.trades
}

function exitBucket(entry: BotHistoryEntry) {
  const reason = entry.reason.toLowerCase()
  if (reason.includes('stop')) return { key: 'stop', label: 'Stop exits' }
  if (reason.includes('time')) return { key: 'time', label: 'Time exits' }
  if (reason.includes('final target')) return { key: 'target2', label: 'Final target exits' }
  if (reason.includes('first target')) return { key: 'target1', label: 'First target exits' }
  if (reason.includes('lost vwap')) return { key: 'lost-vwap', label: 'Lost VWAP exits' }
  if (reason.includes('data quality')) return { key: 'data', label: 'Data quality exits' }
  return { key: 'other', label: entry.reason || 'Other exits' }
}

function setupBucketDefs(setup: BotTradeSetup) {
  const buckets = [
    { key: `entry-${setup.entryMode}`, label: `Entry ${setup.entryMode}` },
    setup.aboveVwap ? { key: 'above-vwap', label: 'Above VWAP entries' } : { key: 'below-vwap', label: 'VWAP reclaim probes' },
    setup.score >= 70 ? { key: 'score-70', label: 'Score 70+ entries' } : { key: 'score-55-69', label: 'Score 55-69 entries' },
  ]
  if (setup.assetClass === 'crypto') {
    const pulse = setup.volumePulse ?? 0
    buckets.push(
      pulse >= 2
        ? { key: 'pulse-2', label: '2x+ pulse entries' }
        : pulse >= 1.05
          ? { key: 'pulse-ok', label: '1.05-2x pulse entries' }
          : { key: 'pulse-weak', label: 'Weak/unknown pulse entries' },
    )
  } else {
    const timeRvol = setup.timeAdjustedRelativeVolume ?? 0
    buckets.push(
      timeRvol >= 3
        ? { key: 'tod-rvol-hot', label: 'Hot time-adjusted volume entries' }
        : timeRvol >= 1.2
          ? { key: 'tod-rvol-ok', label: 'OK time-adjusted volume entries' }
          : { key: 'tod-rvol-weak', label: 'Weak time-adjusted volume entries' },
    )
    if (setup.microPullbackState) {
      buckets.push({
        key: `micro-${setup.microPullbackState.toLowerCase()}`,
        label: `Micro pullback ${setup.microPullbackState.toLowerCase()}`,
      })
    }
    if (setup.vwapExtensionPct !== null && setup.vwapExtensionPct >= 10) {
      buckets.push({ key: 'stock-vwap-extended', label: 'Stock extended from VWAP entries' })
    }
    if (setup.floatTurnover !== null && setup.floatTurnover >= 1) {
      buckets.push({ key: 'float-rotation-full', label: 'Full-float rotation entries' })
    }
    if (setup.microTapeOneMinuteMovePct !== null) {
      const tape = microTapeBucket(setup.microTapeOneMinuteMovePct, setup.microTapePulse)
      buckets.push({ key: tape.key, label: tape.label })
    }
  }
  if (setup.technical) {
    buckets.push({ key: `trend-${setup.technical.trendLabel}`, label: `Trend ${setup.technical.trendLabel}` })
    buckets.push({ key: `fib-${setup.technical.fibZone}`, label: `Zone ${setup.technical.fibZone}` })
    if (setup.technical.edgeScore < 60) buckets.push({ key: 'edge-weak', label: 'Low technical edge entries' })
    else if (setup.technical.edgeScore >= 75) buckets.push({ key: 'edge-strong', label: 'Strong technical edge entries' })
  }
  if (setup.distanceFromHighPct > 2) buckets.push({ key: 'far-high', label: 'Far from high entries' })
  return buckets
}

function setupBuckets(entry: BotHistoryEntry) {
  const setup = entry.setup
  return setup ? setupBucketDefs(setup) : [{ key: 'legacy', label: 'Legacy trades without setup context' }]
}

function actionableLearningBucket(key: string) {
  return (
    key === 'below-vwap' ||
    key === 'far-high' ||
    key === 'edge-weak' ||
    key === 'score-55-69' ||
    key === 'tod-rvol-weak' ||
    key === 'micro-extended' ||
    key === 'micro-failed' ||
    key === 'tapeFading' ||
    key === 'stock-vwap-extended' ||
    key.startsWith('fib-') ||
    key.startsWith('pulse-')
  )
}

function setupBucketPerformance(key: string): BotDiagnosticBucket | null {
  const bucket: BotDiagnosticBucket = { key, label: key, trades: 0, wins: 0, losses: 0, flats: 0, realizedPl: 0, avgPnl: 0 }
  for (const entry of history) {
    if (entry.mode !== 'turbo' || entry.side !== 'sell' || entry.pnl === null || !entry.setup) continue
    const match = setupBucketDefs(entry.setup).find((item) => item.key === key)
    if (!match) continue
    bucket.label = match.label
    diagnosticBucket(new Map([[key, bucket]]), key, match.label, entry)
  }
  return bucket.trades > 0 ? bucket : null
}

function badLearningBucket(bucket: BotDiagnosticBucket) {
  if (bucket.trades < TURBO_LEARNING_MIN_TRADES) return false
  const lossRate = bucket.losses / bucket.trades
  return bucket.avgPnl <= TURBO_LEARNING_MAX_AVG_PNL && lossRate >= TURBO_LEARNING_LOSS_RATE
}

function diagnoseMode(mode: BotMode): BotDiagnostics {
  const closed = history.filter((entry) => entry.mode === mode && entry.side === 'sell' && entry.pnl !== null)
  if (closed.length === 0) return emptyDiagnostics(mode)

  const realizedPl = closed.reduce((total, entry) => total + (entry.pnl ?? 0), 0)
  const wins = closed.filter((entry) => (entry.pnl ?? 0) > 0)
  const losses = closed.filter((entry) => (entry.pnl ?? 0) < 0)
  const grossWin = wins.reduce((total, entry) => total + (entry.pnl ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((total, entry) => total + (entry.pnl ?? 0), 0))
  // Net of the modeled live-execution cost — the read that actually matters.
  const estimatedCost = closed.reduce((total, entry) => total + historyEntryCost(entry), 0)
  const netRealizedPl = realizedPl - estimatedCost
  const netExpectancy = netRealizedPl / closed.length
  const netGrossWin = closed.reduce((total, entry) => {
    const net = historyEntryNetPnl(entry)
    return net > 0 ? total + net : total
  }, 0)
  const netGrossLoss = Math.abs(
    closed.reduce((total, entry) => {
      const net = historyEntryNetPnl(entry)
      return net < 0 ? total + net : total
    }, 0),
  )
  const netProfitFactor = netGrossLoss > 0 ? netGrossWin / netGrossLoss : netGrossWin > 0 ? Number.POSITIVE_INFINITY : null
  const byExit = new Map<string, BotDiagnosticBucket>()
  const bySetup = new Map<string, BotDiagnosticBucket>()
  for (const entry of closed) {
    const exit = exitBucket(entry)
    diagnosticBucket(byExit, exit.key, exit.label, entry)
    for (const setup of setupBuckets(entry)) {
      diagnosticBucket(bySetup, setup.key, setup.label, entry)
    }
  }
  const sortBuckets = (items: BotDiagnosticBucket[]) =>
    items.sort((a, b) => a.avgPnl - b.avgPnl || b.trades - a.trades).slice(0, 6)
  const exitBuckets = sortBuckets([...byExit.values()])
  const setupIssueBuckets = sortBuckets([...bySetup.values()])
  const notes: string[] = []
  const worstExit = exitBuckets.find((bucket) => bucket.losses > 0)
  const worstSetup = setupIssueBuckets.find((bucket) => bucket.losses > 0)
  if (worstExit) {
    notes.push(`${worstExit.label} are the weakest exit bucket: ${botPrice(worstExit.avgPnl)} avg over ${worstExit.trades} trade(s).`)
  }
  if (worstSetup) {
    notes.push(`${worstSetup.label} are dragging Turbo: ${botPrice(worstSetup.avgPnl)} avg over ${worstSetup.trades} trade(s).`)
  }
  if (closed.length < 20) notes.push(`Only ${closed.length} closed ${mode} trade(s) so far; treat this as an early read.`)
  if (grossLoss > grossWin && losses.length > 0) notes.push('Gross losses exceed gross wins; Turbo should keep favoring higher pulse/above-VWAP entries.')
  if (notes.length === 0) notes.push('No obvious weak bucket yet; keep collecting trades.')
  if (costModelEnabled()) {
    const verdict = netRealizedPl >= 0 ? 'still green' : 'underwater'
    notes.unshift(
      `Net of modeled costs (${botPrice(estimatedCost)} total spread+slippage+fees): expectancy ${botPrice(
        netExpectancy,
      )}/trade, realized ${botPrice(netRealizedPl)} — ${verdict}. This is the live-realistic read; gross paper P&L overstates it.`,
    )
  }

  return {
    mode,
    closedTrades: closed.length,
    winRate: wins.length / closed.length,
    realizedPl,
    avgPnl: realizedPl / closed.length,
    avgWin: wins.length > 0 ? grossWin / wins.length : null,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : null,
    expectancy: realizedPl / closed.length,
    costModeled: costModelEnabled(),
    estimatedCost,
    netRealizedPl,
    netExpectancy,
    netProfitFactor,
    byExitReason: exitBuckets,
    bySetup: setupIssueBuckets,
    notes,
  }
}

function riskEquity() {
  const equity = accountCache.value?.equity ?? accountCache.value?.cash ?? 0
  return equity > 0 ? equity : DEFAULT_RISK_EQUITY
}

function hardPositionLimit() {
  return liveMaxPositions()
}

function hasOpenPositionCapacity(positions: BotPosition[]) {
  return positions.length < hardPositionLimit()
}

export function dailyRiskReasonFor(
  stats: Pick<ReturnType<typeof todayStats>, 'wins' | 'losses' | 'realizedPl'>,
  streak: number,
  equity: number,
  mode: BotMode = botMode,
) {
  const config = BOT_MODES[mode]
  if (stats.losses >= config.dailyNoWinLossLimit && stats.wins === 0) {
    return `daily risk warning: ${stats.wins}W / ${stats.losses}L today`
  }
  const monetaryReason = monetaryDailyRiskReasonFor(stats, equity, mode)
  if (monetaryReason) return monetaryReason
  if (streak >= config.dailyLossStreakLimit) {
    return `daily loss streak warning (${streak} losses in a row)`
  }
  return null
}

export function monetaryDailyRiskReasonFor(
  stats: Pick<ReturnType<typeof todayStats>, 'realizedPl'>,
  equity: number,
  mode: BotMode = botMode,
) {
  const lossCap = -Math.max(25, equity * BOT_MODES[mode].dailyLossCapPct)
  return stats.realizedPl <= lossCap
    ? `daily loss warning (${botPrice(stats.realizedPl)} realized today, cap ${botPrice(lossCap)})`
    : null
}

function dailyRiskPauseReason() {
  const stats = todayStats()
  const streak = lossStreak(todayHistoryEntries())
  return dailyRiskReasonFor(stats, streak, riskEquity())
}

function hardDailyRiskPauseReason() {
  const reason = dailyRiskPauseReason()
  if (!reason) return null
  // Paper research must not stop merely because it reached an arbitrary trade or
  // loss count; that biases the dataset toward short sessions. Keep the monetary
  // drawdown circuit breaker so sample collection cannot consume the account.
  if (isPaperTradingBase()) {
    return envValue('PAPER_BOT_ENFORCE_DAILY_RISK_GUARD') !== 'false'
      ? monetaryDailyRiskReasonFor(todayStats(), riskEquity())
      : null
  }
  return envValue('ALLOW_LIVE_DAILY_RISK_BYPASS') === 'I_UNDERSTAND_THIS_CAN_KEEP_TRADING_AFTER_LOSSES'
    ? null
    : reason
}

function symbolRiskBlocker(candidate: MomentumCandidate, resolvedSymbol?: string) {
  const symbol = resolvedSymbol ?? resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate)
  const normalized = normSymbol(symbol)
  const cooldown = activeTradeCooldown(normalized)
  if (cooldown) return cooldownSummary(cooldown)
  if (isPaperTradingBase()) return null

  const entriesToday = symbolTodayEntries(normalized)
  if (entriesToday >= cfg().symbolDailyEntryLimit) {
    return `daily symbol entry limit reached (${entriesToday}/${cfg().symbolDailyEntryLimit}); retry after ${formatClock(nextLocalDayMs())}`
  }

  const lossesToday = symbolTodayLosses(normalized)
  if (lossesToday >= cfg().symbolDailyLossLimit) {
    return `locked after ${lossesToday} loss(es) today; retry after ${formatClock(nextLocalDayMs())}`
  }

  return null
}

function findOrder(orders: BotOrder[], symbol: string, orderId: string | null, clientOrderId?: string | null) {
  const normalized = normSymbol(symbol)
  return orders.find(
    (order) =>
      (orderId !== null && order.id === orderId) ||
      (clientOrderId !== undefined && clientOrderId !== null && order.clientOrderId === clientOrderId) ||
      normSymbol(order.symbol) === normalized,
  )
}

function isPendingEntry(normalized: string) {
  return pendingEntries.has(normalized)
}

function isPendingExit(normalized: string) {
  return pendingExits.has(normalized)
}

function confirmEntryFill(normalized: string, pending: PendingEntry, position: BotPosition) {
  const price = position.avgEntry || position.currentPrice || pending.expectedPrice
  const qty = position.qty || pending.expectedQty
  const notional = position.marketValue || pending.budget
  const fillPlan = retunePlanForFill(pending.plan, price, pending.mode, pending.assetClass)
  const plan = fillPlan.plan
  const setup = {
    ...pending.setup,
    trigger: plan.trigger,
    stop: plan.stop,
    target1: plan.target1,
    target2: plan.target2,
    riskPct: plannedRiskPct(plan, {
      assetClass: pending.assetClass,
      spreadPct: pending.setup.spreadPct,
    } as MomentumCandidate),
  }
  const initialRisk = Math.max(price * 0.002, price - plan.stop)

  tracked.set(normalized, {
    entry: price,
    stop: plan.stop,
    target1: plan.target1,
    target2: plan.target2,
    initialRisk,
    openedAt: pending.submittedAt,
    peakPrice: Math.max(price, position.currentPrice || price),
    atr: setup.atr,
    troughPrice: Math.min(price, position.currentPrice || price),
    lastStopRaisedAt: 0,
    target1Hit: false,
    assetClass: pending.assetClass,
    venue: pending.venue,
    qty: qty ?? null,
    displaySymbol: pending.displaySymbol,
    botMode: pending.mode,
    mode: plan.mode,
    setup,
  })
  pendingEntries.delete(normalized)
  if (fillPlan.retuned) {
    pushLog(
      'info',
      position.symbol || pending.symbol,
      `Fill retuned by ${fillPlan.slippagePct.toFixed(2)}%; new stop ${botPrice(plan.stop)}, targets ${botPrice(plan.target1)} / ${botPrice(plan.target2)}`,
    )
  }
  if (!isPaperTradingBase() && pending.expectedPrice > 0 && price > 0) {
    const fillSlippageBps = ((price - pending.expectedPrice) / pending.expectedPrice) * 10_000
    pushLog(
      'info',
      position.symbol || pending.symbol,
      `Live fill audit: expected ${botPrice(pending.expectedPrice)}, filled ${botPrice(price)} (${fillSlippageBps.toFixed(1)} bps), notional ${botPrice(notional)}`,
    )
  }
  pushLog(
    'buy',
    position.symbol || pending.symbol,
    `Filled buy @ ${botPrice(price)} (${plan.mode}, score ${pending.score})`,
  )
  recordMakerShadowFill(pending, price, qty, notional, position.symbol || pending.symbol)
  pushHistory({
    orderId: pending.orderId,
    symbol: position.symbol || pending.symbol,
    side: 'buy',
    reason: `${pending.plan.mode} fill, score ${pending.score}`,
    qty,
    notional,
    price,
    pnl: null,
    pnlPct: null,
    outcome: 'open',
    mode: pending.mode,
    holdSeconds: null,
    setup,
  })
}

function trackPositionFromPlan(normalized: string, position: BotPosition, candidate: MomentumCandidate, plan: BotTradePlan) {
  const entry = position.avgEntry || position.currentPrice || plan.trigger
  const fillPlan = retunePlanForFill(plan, entry, botMode, position.assetClass)
  const tunedPlan = fillPlan.plan
  const initialRisk = Math.max(entry * 0.002, entry - tunedPlan.stop)
  tracked.set(normalized, {
    entry,
    stop: tunedPlan.stop,
    target1: tunedPlan.target1,
    target2: tunedPlan.target2,
    initialRisk,
    openedAt: Date.now(),
    peakPrice: Math.max(entry, position.currentPrice || entry),
    atr: candidate.microPullback?.atr ?? null,
    troughPrice: Math.min(entry, position.currentPrice || entry),
    lastStopRaisedAt: 0,
    target1Hit: false,
    assetClass: position.assetClass,
    venue: position.venue,
    qty: position.qty || null,
    displaySymbol: position.symbol || candidate.displaySymbol,
    botMode,
    mode: tunedPlan.mode,
    setup: tradeSetupSnapshot(candidate, tunedPlan),
  })
}

// Manage a held position whose symbol has dropped off the radar shortlist, so the
// bot has no live candidate to build a plan from. Without this, such a position
// floats forever with no stop/target (it was bought on momentum, its score then
// faded out of the scan). Synthesize a sensible stop/target from the fill price so
// EVERY position the bot holds is always risk-managed.
function trackOrphanPosition(normalized: string, position: BotPosition) {
  const entry = position.avgEntry || position.currentPrice
  if (!Number.isFinite(entry) || entry <= 0) return
  const stopPct = position.assetClass === 'crypto' ? 0.012 : 0.015
  const stop = roundBotPrice(entry * (1 - stopPct), entry)
  const initialRisk = Math.max(entry * 0.002, entry - stop)
  tracked.set(normalized, {
    entry,
    stop,
    target1: roundBotPrice(entry + initialRisk * 1.5, entry),
    target2: roundBotPrice(entry + initialRisk * 2.4, entry),
    initialRisk,
    openedAt: Date.now(),
    peakPrice: Math.max(entry, position.currentPrice || entry),
    atr: null,
    troughPrice: Math.min(entry, position.currentPrice || entry),
    lastStopRaisedAt: 0,
    target1Hit: false,
    assetClass: position.assetClass,
    venue: position.venue,
    qty: position.qty || null,
    displaySymbol: position.symbol,
    botMode,
    mode: 'quick-scalp',
    setup: null,
  })
}

function reconcilePendingEntries(positions: BotPosition[], orders: BotOrder[]) {
  const now = Date.now()
  const positionBySymbol = new Map(positions.map((position) => [normSymbol(position.symbol), position]))

  for (const [normalized, pending] of pendingEntries) {
    const position = positionBySymbol.get(normalized)
    if (position && position.qty > 0) {
      confirmEntryFill(normalized, pending, position)
      continue
    }

    const order = findOrder(orders, pending.symbol, pending.orderId, pending.clientOrderId)
    const status = orderStatus(order)
    if (status && CLOSED_WITHOUT_FILL_STATUSES.has(status)) {
      pendingEntries.delete(normalized)
      const reason = describeNoFill(status, pending.budget, pending.venue)
      const cooldownMs = status === 'rejected' ? REJECTED_COOLDOWN_MS : NO_FILL_COOLDOWN_MS
      setNoFillCooldown(pending.symbol, reason, cooldownMs)
      pushLog(
        status === 'rejected' ? 'error' : 'skip',
        pending.symbol,
        `${reason}; cooling down this symbol for ${Math.round(cooldownMs / 1000)}s`,
      )
      continue
    }

    if (now - pending.submittedAt > PENDING_TTL_MS && (!status || !LIVE_ORDER_STATUSES.has(status))) {
      pendingEntries.delete(normalized)
      const detail = status === 'filled' ? 'filled order has no matching Alpaca position' : 'order was not confirmed'
      const cooldownMs = status === 'filled' ? ORPHAN_FILL_COOLDOWN_MS : NO_FILL_COOLDOWN_MS
      setNoFillCooldown(pending.symbol, `Alpaca ${detail}`, cooldownMs)
      pushLog('skip', pending.symbol, `Buy ${detail} after ${Math.round(PENDING_TTL_MS / 1000)}s; not journaled`)
    }
  }
}

function finalizePendingExit(normalized: string, pending: PendingExit, label: 'Closed' | 'Trimmed' = 'Closed') {
  pendingExits.delete(normalized)
  const meta = tracked.get(normalized)
  const { maxFavorableR, maxAdverseR } = meta
    ? excursionR(meta)
    : { maxFavorableR: null, maxAdverseR: null }
  if (pending.fullClose) tracked.delete(normalized)
  else if (meta && pending.remainingQty !== null) meta.qty = pending.remainingQty
  pushLog('sell', pending.symbol, `${label}: ${pending.reason} @ ${botPrice(pending.price)}`)
  pushHistory({
    orderId: pending.orderId,
    symbol: pending.symbol,
    side: 'sell',
    reason: pending.reason,
    qty: pending.qty,
    notional: pending.notional,
    price: pending.price,
    pnl: pending.pnl,
    pnlPct: pending.pnlPct,
    outcome: pending.pnl > 0 ? 'win' : pending.pnl < 0 ? 'loss' : 'flat',
    mode: pending.mode,
    holdSeconds: pending.holdSeconds,
    setup: pending.setup,
    maxFavorableR,
    maxAdverseR,
  })
  if (pending.fullClose) recordTradeExitCooldown(normalized, pending)
}

function reconcilePendingExits(positions: BotPosition[], orders: BotOrder[]) {
  const now = Date.now()
  const positionBySymbol = new Map(positions.map((position) => [normSymbol(position.symbol), position]))
  const held = new Set(positionBySymbol.keys())

  for (const [normalized, pending] of pendingExits) {
    if (!held.has(normalized)) {
      finalizePendingExit(normalized, pending)
      continue
    }

    const order = findOrder(orders, pending.symbol, pending.orderId)
    const status = orderStatus(order)
    const currentPosition = positionBySymbol.get(normalized)
    const partialTrimFilled =
      !pending.fullClose &&
      ((status !== null && status === 'filled') ||
        (currentPosition !== undefined &&
          pending.remainingQty !== null &&
          currentPosition.qty <= pending.remainingQty + Math.max(0.00000001, pending.qty * 0.02)))
    if (partialTrimFilled) {
      finalizePendingExit(normalized, pending, 'Trimmed')
      continue
    }
    if (status && CLOSED_WITHOUT_FILL_STATUSES.has(status)) {
      pendingExits.delete(normalized)
      pushLog(status === 'rejected' ? 'error' : 'skip', pending.symbol, `${pending.fullClose ? 'Close' : 'Trim'} order ${status}; position still open`)
      continue
    }

    if (now - pending.submittedAt > PENDING_TTL_MS && (!status || !LIVE_ORDER_STATUSES.has(status))) {
      pendingExits.delete(normalized)
      pushLog('error', pending.symbol, `${pending.fullClose ? 'Close' : 'Trim'} unconfirmed after ${Math.round(PENDING_TTL_MS / 1000)}s; position still open`)
    }
  }
}

async function alpacaFetch<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  const creds = credentials()
  if (!creds) throw new Error('Alpaca credentials are not configured.')
  const method = init?.method ?? 'GET'
  const backoff = alpacaBackoffReason()
  if (backoff) throw new Error(backoff)
  const response = await fetch(`${tradingBaseUrl()}/v2${path}`, {
    method,
    body: init?.body,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'APCA-API-KEY-ID': creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
    },
    signal: AbortSignal.timeout(12_000),
  })
  const text = await response.text()
  if (!response.ok) {
    if (response.status === 429) {
      setAlpacaRateLimitBackoff(response, `${method} ${path}`)
      throw new Error(alpacaBackoffReason() ?? 'Alpaca rate limit exceeded')
    }
    throw new Error(`Alpaca ${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

// ---- Alpaca reads ---------------------------------------------------------
type AlpacaAccountRaw = {
  cash?: string
  equity?: string
  buying_power?: string
  non_marginable_buying_power?: string
  currency?: string
}

async function readAccountFromAlpaca(): Promise<BotAccount> {
  const data = await alpacaFetch<AlpacaAccountRaw>('/account')
  return {
    cash: num(data.cash),
    equity: num(data.equity),
    buyingPower: num(data.buying_power),
    nonMarginableBuyingPower: num(data.non_marginable_buying_power),
    currency: data.currency ?? 'USD',
  }
}

async function fetchAccount(): Promise<BotAccount> {
  return cachedRead(accountCache, ALPACA_ACCOUNT_CACHE_MS, readAccountFromAlpaca)
}

async function readAccountFromBinance(): Promise<BotAccount> {
  const cash = await binanceUsdtBalance()
  const positions = await readPositionsFromBinanceTracked()
  const positionEquity = positions.reduce((total, position) => total + Math.max(0, position.marketValue), 0)
  return {
    cash,
    equity: cash + positionEquity,
    buyingPower: cash,
    nonMarginableBuyingPower: cash,
    currency: 'USDT',
  }
}

async function fetchBinanceAccount(): Promise<BotAccount> {
  return cachedRead(binanceAccountCache, BINANCE_ACCOUNT_CACHE_MS, readAccountFromBinance)
}

function combineAccounts(alpaca: BotAccount, binance: BotAccount | null): BotAccount {
  if (!binance) return alpaca
  return {
    cash: alpaca.cash + binance.cash,
    equity: alpaca.equity + binance.equity,
    buyingPower: alpaca.buyingPower + binance.buyingPower,
    nonMarginableBuyingPower: alpaca.nonMarginableBuyingPower + binance.nonMarginableBuyingPower,
    currency: 'USD+USDT',
  }
}

async function fetchDisplayAccount(): Promise<BotAccount> {
  const alpaca = await fetchAccount()
  // Stocks-only: the displayed balance is purely the Alpaca (paper) account.
  if (!cryptoEnabled() || !cryptoOnBinance()) return alpaca
  const binance = await fetchBinanceAccount()
  return combineAccounts(alpaca, binance)
}

type AlpacaPositionRaw = {
  symbol?: string
  qty?: string
  avg_entry_price?: string
  current_price?: string
  market_value?: string
  unrealized_pl?: string
  unrealized_plpc?: string
  side?: string
  asset_class?: string
}

async function readPositionsFromAlpaca(): Promise<BotPosition[]> {
  const data = await alpacaFetch<AlpacaPositionRaw[]>('/positions')
  return (Array.isArray(data) ? data : []).map((raw) => {
    const symbol = raw.symbol ?? ''
    const meta = tracked.get(normSymbol(symbol))
    return {
      symbol,
      displaySymbol: meta?.displaySymbol ?? symbol,
      assetClass: raw.asset_class === 'crypto' ? 'crypto' : 'stock',
      venue: 'alpaca',
      side: raw.side ?? 'long',
      qty: num(raw.qty),
      avgEntry: num(raw.avg_entry_price),
      currentPrice: num(raw.current_price),
      marketValue: num(raw.market_value),
      unrealizedPl: num(raw.unrealized_pl),
      unrealizedPlPct: num(raw.unrealized_plpc) * 100,
      stop: meta?.stop ?? null,
      target1: meta?.target1 ?? null,
      target2: meta?.target2 ?? null,
    }
  })
}

async function readPositionsFromBinanceTracked(): Promise<BotPosition[]> {
  if (!cryptoOnBinance()) return []
  const positions: BotPosition[] = []
  for (const [normalized, meta] of tracked) {
    if (meta.assetClass !== 'crypto' || meta.venue !== 'binance') continue
    const qty = meta.qty ?? 0
    if (qty <= 0) continue
    const base = cryptoBaseFromSymbol(meta.displaySymbol) ?? cryptoBaseFromSymbol(normalized)
    const symbol = base ? mapBaseToBinanceSymbol(base) : null
    if (!symbol) continue
    const freshPrice = freshBinancePrice(base ?? '')
    const currentPrice = freshPrice ?? (await binanceTickerPrice(symbol).catch(() => meta.peakPrice || meta.entry))
    const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : meta.entry
    const marketValue = qty * price
    const pnl = (price - meta.entry) * qty
    positions.push({
      symbol,
      displaySymbol: meta.displaySymbol || binanceDisplaySymbol(symbol),
      assetClass: 'crypto',
      venue: 'binance',
      side: 'long',
      qty,
      avgEntry: meta.entry,
      currentPrice: price,
      marketValue,
      unrealizedPl: pnl,
      unrealizedPlPct: meta.entry > 0 ? ((price - meta.entry) / meta.entry) * 100 : 0,
      stop: meta.stop,
      target1: meta.target1,
      target2: meta.target2,
    })
  }
  return positions
}

async function readPositionsFromBroker(): Promise<BotPosition[]> {
  const [alpacaPositions, binancePositions] = await Promise.all([
    readPositionsFromAlpaca(),
    cryptoEnabled() ? readPositionsFromBinanceTracked() : Promise.resolve([] as BotPosition[]),
  ])
  return [...alpacaPositions, ...binancePositions]
}

async function fetchPositions(): Promise<BotPosition[]> {
  return cachedRead(positionsCache, ALPACA_POSITION_CACHE_MS, readPositionsFromBroker)
}

type AlpacaOrderRaw = {
  id?: string
  client_order_id?: string
  symbol?: string
  side?: string
  qty?: string
  notional?: string
  type?: string
  status?: string
  filled_avg_price?: string
  submitted_at?: string
}

function mapOrder(raw: AlpacaOrderRaw): BotOrder {
  return {
    id: raw.id ?? `${raw.symbol ?? '?'}-${raw.submitted_at ?? ''}`,
    clientOrderId: raw.client_order_id ?? null,
    symbol: raw.symbol ?? '',
    venue: 'alpaca',
    side: raw.side ?? '',
    qty: numOrNull(raw.qty),
    notional: numOrNull(raw.notional),
    type: raw.type ?? '',
    status: raw.status ?? '',
    filledAvgPrice: numOrNull(raw.filled_avg_price),
    submittedAt: raw.submitted_at ?? null,
  }
}

async function readOrdersFromAlpaca(): Promise<BotOrder[]> {
  const data = await alpacaFetch<AlpacaOrderRaw[]>(
    `/orders?status=all&limit=${ORDER_FETCH_LIMIT}&direction=desc&nested=false`,
  )
  return (Array.isArray(data) ? data : []).map(mapOrder)
}

async function fetchOrders(): Promise<BotOrder[]> {
  return cachedRead(ordersCache, ALPACA_ORDER_CACHE_MS, readOrdersFromAlpaca)
}

async function readOpenOrdersFromAlpaca(): Promise<BotOrder[]> {
  const data = await alpacaFetch<AlpacaOrderRaw[]>('/orders?status=open&limit=100&nested=false')
  return (Array.isArray(data) ? data : []).map(mapOrder)
}

async function fetchOpenOrders(): Promise<BotOrder[]> {
  return cachedRead(openOrdersCache, ALPACA_ORDER_CACHE_MS, readOpenOrdersFromAlpaca)
}

async function cancelOrder(order: BotOrder) {
  await alpacaFetch<unknown>(`/orders/${encodeURIComponent(order.id)}`, { method: 'DELETE' })
  clearReadCaches()
}

async function cancelStaleBotOpenOrders(openOrders: BotOrder[]) {
  const remaining: BotOrder[] = []
  for (const order of openOrders) {
    const normalized = normSymbol(order.symbol)
    const status = orderStatus(order)
    const age = orderAgeMs(order)
    const staleBotBuy =
      isBotOrder(order) &&
      order.side.toLowerCase() === 'buy' &&
      LIVE_ORDER_STATUSES.has(status) &&
      age !== null &&
      age > PENDING_TTL_MS

    if (!staleBotBuy) {
      remaining.push(order)
      continue
    }

    try {
      await cancelOrder(order)
      pendingEntries.delete(normalized)
      setNoFillCooldown(order.symbol, `Alpaca left the paper buy open for ${formatAgeMs(age)} without a fill`, NO_FILL_COOLDOWN_MS)
      pushLog(
        'skip',
        order.symbol,
        `Canceled stale open buy order (${status}, ${formatAgeMs(age)} old); cooling down this symbol before retry`,
      )
    } catch (error) {
      remaining.push(order)
      pushLog('error', order.symbol, `Could not cancel stale open buy order: ${message(error)}`)
    }
  }
  return remaining
}

async function cancelOpenEntryOrdersForWindDown(openOrders: BotOrder[]) {
  const remaining: BotOrder[] = []
  for (const order of openOrders) {
    const normalized = normSymbol(order.symbol)
    const status = orderStatus(order)
    const openBotBuy = isBotOrder(order) && order.side.toLowerCase() === 'buy' && LIVE_ORDER_STATUSES.has(status)

    if (!openBotBuy) {
      remaining.push(order)
      continue
    }

    try {
      await cancelOrder(order)
      pendingEntries.delete(normalized)
      setNoFillCooldown(order.symbol, 'Wind-down canceled the open paper buy order', NO_FILL_COOLDOWN_MS)
      pushLog('skip', order.symbol, 'Wind-down canceled open buy order; no new entries until restarted')
    } catch (error) {
      remaining.push(order)
      pushLog('error', order.symbol, `Could not cancel wind-down buy order: ${message(error)}`)
    }
  }
  return remaining
}

async function cancelOpenEntryOrdersForImmediateStop(openOrders: BotOrder[]) {
  for (const order of openOrders) {
    const normalized = normSymbol(order.symbol)
    const status = orderStatus(order)
    const openBotBuy = isBotOrder(order) && order.side.toLowerCase() === 'buy' && LIVE_ORDER_STATUSES.has(status)
    if (!openBotBuy) continue

    try {
      await cancelOrder(order)
      pendingEntries.delete(normalized)
      setNoFillCooldown(order.symbol, 'Immediate stop canceled the open paper buy order', NO_FILL_COOLDOWN_MS)
      pushLog('skip', order.symbol, 'Immediate stop canceled open buy order before liquidation')
    } catch (error) {
      pushLog('error', order.symbol, `Could not cancel immediate-stop buy order: ${message(error)}`)
    }
  }
}

type AlpacaAssetRaw = { symbol?: string; tradable?: boolean; status?: string; fractionable?: boolean; asset_class?: string }

async function loadCryptoAssets(): Promise<Set<string>> {
  if (cryptoAssets && Date.now() - cryptoAssetsAt < CRYPTO_ASSET_TTL_MS) return cryptoAssets
  try {
    const data = await alpacaFetch<AlpacaAssetRaw[]>('/assets?asset_class=crypto&status=active')
    cryptoAssets = new Set(
      (Array.isArray(data) ? data : [])
        .filter((asset) => asset.tradable && asset.symbol)
        .map((asset) => normSymbol(asset.symbol as string)),
    )
    cryptoAssetsAt = Date.now()
  } catch (error) {
    pushLog('error', '-', `Crypto asset list failed: ${message(error)}`)
    cryptoAssets = cryptoAssets ?? new Set()
  }
  return cryptoAssets
}

async function fetchAssetInfo(symbol: string): Promise<AlpacaAssetRaw | null> {
  const normalized = normSymbol(symbol)
  const cached = assetInfoCache.get(normalized)
  if (cached && Date.now() - cached.at < ASSET_INFO_TTL_MS) return cached.asset
  try {
    const asset = await alpacaFetch<AlpacaAssetRaw>(`/assets/${encodeURIComponent(symbol)}`)
    const clean = asset && typeof asset === 'object' ? asset : null
    assetInfoCache.set(normalized, { at: Date.now(), asset: clean })
    return clean
  } catch (error) {
    assetInfoCache.set(normalized, { at: Date.now(), asset: null })
    pushStatusLog(symbol, `Could not preflight Alpaca asset details: ${message(error)}`)
    return null
  }
}

function resolveTradableSymbol(candidate: MomentumCandidate): ResolvedSymbol | null {
  if (candidate.assetClass === 'stock') {
    return { symbol: candidate.ticker, assetClass: 'stock', venue: 'alpaca' }
  }
  const base = cryptoBaseFromTicker(candidate.ticker)
  if (BOT_EXCLUDED_CRYPTO_BASES.has(base)) return null

  if (cryptoOnBinance()) {
    const symbol = binanceSymbolFor(candidate)
    return symbol ? { symbol, assetClass: 'crypto', venue: 'binance' } : null
  }

  const usdPair = alpacaCryptoPair(base, 'USD')
  if (cryptoAssets?.has(normSymbol(usdPair))) {
    return { symbol: usdPair, assetClass: 'crypto', venue: 'alpaca' }
  }
  return null
}

function tradabilityBlocker(candidate: MomentumCandidate) {
  if (candidate.assetClass === 'crypto' && BOT_EXCLUDED_CRYPTO_BASES.has(cryptoBaseFromTicker(candidate.ticker))) {
    return 'stablecoin base pair ignored by bot'
  }
  if (candidate.assetClass === 'crypto' && cryptoOnBinance()) {
    if (!binanceClientConfigured()) return 'Binance testnet keys are not configured'
    return resolveTradableSymbol(candidate) ? null : 'not mapped to a Binance USDT spot pair'
  }
  if (candidate.assetClass === 'crypto') {
    const base = cryptoBaseFromTicker(candidate.ticker)
    const usdtPair = alpacaCryptoPair(base, 'USDT')
    if (cryptoAssets?.has(normSymbol(usdtPair))) {
      return `${usdtPair} needs USDT quote balance; bot is using USD cash only`
    }
  }
  return resolveTradableSymbol(candidate) ? null : 'not tradable on Alpaca paper'
}

// Binance base symbols (ticker minus the USDT suffix) the bot may consider this
// tick. Safe mode uses the curated majors; active mode uses every coin Alpaca
// currently lists, derived from the live tradable-asset set.
function activeAlpacaBases(): Set<string> {
  const bases = new Set<string>()
  if (cryptoAssets) {
    for (const normalized of cryptoAssets) {
      const base = normalized.endsWith('USD') ? normalized.slice(0, -3) : ''
      if (base && !BOT_EXCLUDED_CRYPTO_BASES.has(base)) bases.add(base)
    }
  }
  return bases
}

function botCryptoUniverse(): Set<string> | undefined {
  if (cfg().curatedOnly) return new Set(SAFE_CRYPTO_BASES)
  return cryptoOnBinance() ? undefined : activeAlpacaBases()
}

function nearestFibLevel(value: number) {
  return FIB_LEVELS.reduce((nearest, level) => (Math.abs(level - value) < Math.abs(nearest - value) ? level : nearest), FIB_LEVELS[0])
}

function fibZoneLabel(retracement: number | null, nearest: number | null) {
  if (retracement === null || nearest === null) return 'unknown fib'
  if (retracement <= 0.15) return 'breakout shelf'
  if (retracement >= 0.72) return 'deep pullback'
  return `fib ${(nearest * 100).toFixed(1)}`
}

function technicalContext(candidate: MomentumCandidate, plan?: BotTradePlan | null): BotTechnicalContext {
  const price = candidate.price
  const swingHigh = Math.max(candidate.highOfDay || 0, price, plan?.target2 ?? 0)
  const fallbackLow = price > 0 ? price * 0.985 : 0
  const lowCandidates = [candidate.vwap, plan?.stop ?? null, candidate.signal.stopLoss, fallbackLow].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < swingHigh,
  )
  const swingLow = lowCandidates.length > 0 ? Math.min(...lowCandidates) : 0
  const range = swingHigh > swingLow ? swingHigh - swingLow : 0
  const fibRetracementPct = range > 0 && price > 0 ? clamp((swingHigh - price) / range, 0, 1) : null
  const fibNearestLevel = fibRetracementPct === null ? null : nearestFibLevel(fibRetracementPct)
  const fibZone = fibZoneLabel(fibRetracementPct, fibNearestLevel)
  const pulse = candidate.volumePulse ?? 0
  const liquidity = candidateDollarVolume(candidate)

  let trendScore = 38
  if (candidate.aboveVwap) trendScore += 18
  else trendScore -= 14
  if (candidate.changePct > 0) trendScore += 7
  if (candidate.changePct >= 5) trendScore += 7
  if (candidate.changePct >= 10) trendScore += 5
  if ((candidate.secondaryMovePct ?? 0) > 0) trendScore += 6
  if ((candidate.secondaryMovePct ?? 0) >= 2) trendScore += 6
  if ((candidate.oneHourMovePct ?? 0) >= 1.5) trendScore += 5
  else if ((candidate.oneHourMovePct ?? 0) >= 0.3) trendScore += 2
  else if ((candidate.oneHourMovePct ?? 0) <= -1) trendScore -= 6
  if ((candidate.fifteenMinuteMovePct ?? 0) >= 0.5) trendScore += 3
  else if ((candidate.fifteenMinuteMovePct ?? 0) < -0.3) trendScore -= 3
  if (pulse >= 1.25) trendScore += 7
  if (pulse >= 2) trendScore += 6
  if (liquidity >= 50_000_000) trendScore += 7
  if (candidate.distanceFromHighPct <= 0.7) trendScore += 8
  else if (candidate.distanceFromHighPct <= 2) trendScore += 4
  else trendScore -= Math.min(12, (candidate.distanceFromHighPct - 2) * 1.5)
  if (candidate.spreadPct <= (candidate.assetClass === 'crypto' ? 0.18 : 0.7)) trendScore += 3
  if ((candidate.vwapExtensionPct ?? 0) > (candidate.assetClass === 'crypto' ? 9 : 18) && pulse < 1.5) {
    trendScore -= 8
  }
  if (candidate.assetClass === 'stock' && candidate.microPullback) {
    if (candidate.microPullback.state === 'READY') trendScore += 10
    else if (candidate.microPullback.state === 'FORMING') trendScore += 4
    else if (candidate.microPullback.state === 'FAILED') trendScore -= 12
    else if (candidate.microPullback.state === 'EXTENDED') trendScore -= 6
  }
  const stockTimeAdjustedRvol =
    candidate.assetClass === 'stock' ? candidate.sessionVolume?.timeAdjustedRelativeVolume ?? null : null
  if (stockTimeAdjustedRvol !== null) {
    const timeRvol = stockTimeAdjustedRvol
    if (timeRvol >= 3) trendScore += 7
    else if (timeRvol >= 1.5) trendScore += 4
    else if (timeRvol < 1) trendScore -= 6
  }
  if (candidate.assetClass === 'stock' && candidate.microBars && candidate.microBars.bars >= 6) {
    const microMove = candidate.microBars.oneMinuteMovePct ?? 0
    const microPulse = candidate.microBars.microVolumePulse ?? 0
    if (microMove >= 1) trendScore += 4
    else if (microMove <= -0.7) trendScore -= 7
    if (microPulse >= 2) trendScore += 3
  }
  if (fibRetracementPct !== null) {
    if (fibRetracementPct <= 0.382) trendScore += 6
    else if (fibRetracementPct >= 0.618) trendScore -= 7
  }

  trendScore = Math.round(clamp(trendScore, 0, 100))
  const fibEdge =
    fibRetracementPct === null
      ? 0
      : fibRetracementPct <= 0.382
        ? 6
        : fibRetracementPct <= 0.618 && candidate.aboveVwap
          ? 2
          : -8
  const edgeScore = Math.round(clamp(trendScore + fibEdge + (candidate.score - cfg().minScore) * 0.25, 0, 100))
  const trendLabel =
    trendScore >= 78 ? 'strong-uptrend' : trendScore >= 62 ? 'uptrend' : trendScore >= 46 ? 'mixed' : 'weak'
  const notes = [
    trendLabel,
    fibZone,
    candidate.aboveVwap ? 'above VWAP' : 'below VWAP',
    pulse > 0 ? `${pulse.toFixed(2)}x pulse` : 'pulse n/a',
    candidate.oneHourMovePct !== null ? `1h ${candidate.oneHourMovePct.toFixed(2)}%` : '1h n/a',
    candidate.vwapExtensionPct !== null ? `VWAP ext ${candidate.vwapExtensionPct.toFixed(2)}%` : 'VWAP ext n/a',
    stockTimeAdjustedRvol !== null
      ? `time rVol ${stockTimeAdjustedRvol.toFixed(2)}x`
      : '',
    candidate.assetClass === 'stock' && candidate.microBars?.oneMinuteMovePct !== null && candidate.microBars?.oneMinuteMovePct !== undefined
      ? `10s 1m ${candidate.microBars.oneMinuteMovePct.toFixed(2)}%`
      : '',
    candidate.assetClass === 'stock' && candidate.microPullback ? candidate.microPullback.label : '',
  ]
    .filter(Boolean)

  return {
    trendScore,
    trendLabel,
    fibZone,
    fibRetracementPct: fibRetracementPct === null ? null : Math.round(fibRetracementPct * 1000) / 1000,
    fibNearestLevel,
    edgeScore,
    notes,
  }
}

function tradeSetupSnapshot(candidate: MomentumCandidate, plan: BotTradePlan): BotTradeSetup {
  const resolved = resolveTradableSymbol(candidate)
  return {
    assetClass: candidate.assetClass,
    venue: resolved?.venue ?? (candidate.assetClass === 'crypto' && cryptoOnBinance() ? 'binance' : 'alpaca'),
    entryMode: plan.mode,
    score: candidate.score,
    status: candidate.status,
    aboveVwap: candidate.aboveVwap,
    volumePulse: candidate.volumePulse,
    quoteVolume: candidate.quoteVolume,
    relativeVolume: candidate.relativeVolume,
    timeAdjustedRelativeVolume: candidate.sessionVolume?.timeAdjustedRelativeVolume ?? null,
    distanceFromHighPct: candidate.distanceFromHighPct,
    changePct: candidate.changePct,
    vwapExtensionPct: candidate.vwapExtensionPct,
    spreadPct: candidate.spreadPct,
    floatTurnover: candidate.floatTurnover,
    microPullbackState: candidate.microPullback?.state ?? null,
    microPullbackScore: candidate.microPullback?.score ?? null,
    atr: candidate.microPullback?.atr ?? null,
    supportDistancePct: candidate.microPullback?.supportDistancePct ?? null,
    resistanceDistancePct: candidate.microPullback?.resistanceDistancePct ?? null,
    microTapeOneMinuteMovePct: candidate.microBars?.oneMinuteMovePct ?? null,
    microTapePulse: candidate.microBars?.microVolumePulse ?? null,
    trigger: plan.trigger,
    stop: plan.stop,
    target1: plan.target1,
    target2: plan.target2,
    riskPct: plannedRiskPct(plan, candidate),
    technical: technicalContext(candidate, plan),
  }
}

// ---- Alpaca crypto maker-shadow telemetry ---------------------------------
type AlpacaCryptoQuoteRaw = {
  T?: string
  S?: string
  bp?: string | number
  bs?: string | number
  ap?: string | number
  'as'?: string | number
  t?: string
}

export type AlpacaCryptoBbo = {
  symbol: string
  bid: number | null
  bidSize: number | null
  ask: number | null
  askSize: number | null
  mid: number | null
  spreadBps: number | null
  timestamp: string | null
  receivedAt: string
}

function makerShadowEnabled() {
  const raw = envValue('PAPER_BOT_MAKER_SHADOW')
  return raw === undefined || raw === '' ? true : !/^(0|false|off|no)$/i.test(raw)
}

function makerShadowId(symbol: string, clientOrderId: string) {
  return `${clientOrderId}-${normSymbol(symbol)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function appendMakerShadow(event: Record<string, unknown>) {
  try {
    appendFileSync(MAKER_SHADOW_FILE, `${JSON.stringify(event)}\n`, 'utf8')
  } catch (error) {
    pushLog('error', '-', `Could not append maker shadow journal: ${message(error)}`)
  }
}

function pickAlpacaQuote(raw: unknown, symbol: string): AlpacaCryptoQuoteRaw | null {
  if (!raw || typeof raw !== 'object') return null
  const container = raw as { quotes?: unknown; latestQuotes?: unknown }
  const quotes = container.quotes ?? container.latestQuotes
  const normalized = normSymbol(symbol)
  if (Array.isArray(quotes)) {
    return (
      quotes.find((quote) => {
        if (!quote || typeof quote !== 'object') return false
        const quoteSymbol = String((quote as AlpacaCryptoQuoteRaw).S ?? '')
        return normSymbol(quoteSymbol) === normalized
      }) as AlpacaCryptoQuoteRaw | undefined
    ) ?? null
  }
  if (quotes && typeof quotes === 'object') {
    for (const [key, value] of Object.entries(quotes as Record<string, unknown>)) {
      if (normSymbol(key) === normalized) return value as AlpacaCryptoQuoteRaw
      if (value && typeof value === 'object' && normSymbol(String((value as AlpacaCryptoQuoteRaw).S ?? '')) === normalized) {
        return value as AlpacaCryptoQuoteRaw
      }
    }
  }
  return null
}

async function fetchAlpacaCryptoBbo(symbol: string): Promise<AlpacaCryptoBbo | null> {
  const creds = credentials()
  if (!creds) return null
  const params = new URLSearchParams({ symbols: symbol })
  const response = await fetch(`https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?${params.toString()}`, {
    headers: {
      accept: 'application/json',
      'APCA-API-KEY-ID': creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
    },
    signal: AbortSignal.timeout(4_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Alpaca crypto quote ${response.status}: ${text.slice(0, 200)}`)
  const quote = pickAlpacaQuote(text ? JSON.parse(text) : {}, symbol)
  if (!quote) return null
  const bid = numOrNull(quote.bp)
  const ask = numOrNull(quote.ap)
  const mid = bid !== null && ask !== null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null
  return {
    symbol,
    bid,
    bidSize: numOrNull(quote.bs),
    ask,
    askSize: numOrNull(quote['as']),
    mid,
    spreadBps: mid !== null && ask !== null && bid !== null ? ((ask - bid) / mid) * 10_000 : null,
    timestamp: quote.t ?? null,
    receivedAt: new Date().toISOString(),
  }
}

export function alpacaCryptoExecutionBlocker(
  candidate: Pick<MomentumCandidate, 'price'>,
  quote: AlpacaCryptoBbo | null,
  now = Date.now(),
) {
  if (!quote || quote.bid === null || quote.ask === null || quote.mid === null || quote.spreadBps === null) {
    return 'Alpaca execution bid/ask unavailable'
  }
  if (quote.bid <= 0 || quote.ask <= quote.bid || quote.mid <= 0) return 'Alpaca execution bid/ask is invalid'
  if (!quote.timestamp) return 'Alpaca execution quote has no exchange timestamp'
  const quoteAt = Date.parse(quote.timestamp)
  if (!Number.isFinite(quoteAt)) return 'Alpaca execution quote timestamp is invalid'
  const quoteAgeMs = Math.max(0, now - quoteAt)
  if (quoteAgeMs > cfg().cryptoMaxQuoteAgeMs) {
    return `Alpaca execution quote is stale (${Math.round(quoteAgeMs / 1000)}s)`
  }
  const spreadPct = quote.spreadBps / 100
  if (spreadPct > MOMENTUM_RULES.crypto.maxSpreadPct) {
    return `Alpaca execution spread ${spreadPct.toFixed(2)}% exceeds ${MOMENTUM_RULES.crypto.maxSpreadPct.toFixed(2)}%`
  }
  if (candidate.price <= 0) return 'scanner price is invalid for execution comparison'
  const divergencePct = (Math.abs(quote.mid - candidate.price) / candidate.price) * 100
  if (divergencePct > ALPACA_CRYPTO_MAX_PRICE_DIVERGENCE_PCT) {
    return `Alpaca execution price diverges ${divergencePct.toFixed(2)}% from the Binance signal`
  }
  return null
}

export function rebaseTradePlanForEntry(plan: BotTradePlan, entryPrice: number): BotTradePlan {
  if (entryPrice <= 0 || plan.trigger <= 0 || plan.stop <= 0 || plan.stop >= plan.trigger) return plan
  const riskPct = (plan.trigger - plan.stop) / plan.trigger
  const target1Pct = Math.max(0, (plan.target1 - plan.trigger) / plan.trigger)
  const target2Pct = Math.max(target1Pct, (plan.target2 - plan.trigger) / plan.trigger)
  return {
    ...plan,
    trigger: roundBotPrice(entryPrice, entryPrice),
    stop: roundBotPrice(entryPrice * (1 - riskPct), entryPrice),
    target1: roundBotPrice(entryPrice * (1 + target1Pct), entryPrice),
    target2: roundBotPrice(entryPrice * (1 + target2Pct), entryPrice),
  }
}

function passiveBuyLimitFromBbo(quote: AlpacaCryptoBbo | null) {
  if (!quote || quote.bid === null || quote.ask === null || quote.bid <= 0 || quote.ask <= quote.bid) return null
  return roundBotPrice(quote.bid, quote.ask)
}

function startMakerShadowIntent(args: {
  candidate: MomentumCandidate
  resolved: ResolvedSymbol
  plan: BotTradePlan
  clientOrderId: string
  qty: number
  notional: number
}) {
  if (!makerShadowEnabled()) return null
  if (args.resolved.venue !== 'alpaca' || args.resolved.assetClass !== 'crypto') return null
  const id = makerShadowId(args.resolved.symbol, args.clientOrderId)
  void (async () => {
    const recordedAt = new Date().toISOString()
    try {
      const quote = await fetchAlpacaCryptoBbo(args.resolved.symbol)
      const passiveLimit = passiveBuyLimitFromBbo(quote)
      appendMakerShadow({
        schemaVersion: 1,
        event: 'intent',
        id,
        recordedAt,
        symbol: args.resolved.symbol,
        clientOrderId: args.clientOrderId,
        side: 'buy',
        liveRoute: 'taker-market',
        shadowRoute: 'maker-gtc-limit',
        qty: args.qty,
        notional: args.notional,
        candidate: {
          ticker: args.candidate.ticker,
          score: args.candidate.score,
          status: args.candidate.status,
          strategy: args.candidate.strategy ?? 'momentum',
          price: args.candidate.price,
          spreadPctFromScanner: args.candidate.spreadPct,
          volumePulse: args.candidate.volumePulse,
          quoteVolume: args.candidate.quoteVolume,
        },
        plan: args.plan,
        alpacaBbo: quote,
        shadow: {
          passiveLimit,
          wouldBeNonMarketable: quote !== null && passiveLimit !== null && quote.ask !== null ? passiveLimit < quote.ask : null,
          distanceFromAskBps:
            quote !== null && passiveLimit !== null && quote.ask !== null && quote.mid !== null
              ? ((quote.ask - passiveLimit) / quote.mid) * 10_000
              : null,
        },
      })
    } catch (error) {
      appendMakerShadow({
        schemaVersion: 1,
        event: 'intent_error',
        id,
        recordedAt,
        symbol: args.resolved.symbol,
        clientOrderId: args.clientOrderId,
        error: message(error),
      })
    }
  })()
  return id
}

function recordMakerShadowFill(pending: PendingEntry, fillPrice: number, qty: number | null, notional: number | null, symbol: string) {
  if (!pending.makerShadowId || pending.assetClass !== 'crypto' || pending.venue !== 'alpaca') return
  const filledAt = new Date().toISOString()
  appendMakerShadow({
    schemaVersion: 1,
    event: 'fill',
    id: pending.makerShadowId,
    recordedAt: filledAt,
    symbol,
    clientOrderId: pending.clientOrderId,
    orderId: pending.orderId,
    liveRoute: 'taker-market',
    side: 'buy',
    fillPrice,
    qty,
    notional,
  })
  for (const horizonMs of MAKER_SHADOW_MARKOUT_MS) {
    setTimeout(() => {
      void recordMakerShadowMarkout({
        id: pending.makerShadowId as string,
        symbol,
        clientOrderId: pending.clientOrderId,
        orderId: pending.orderId,
        fillPrice,
        horizonMs,
        filledAt,
      })
    }, horizonMs)
  }
}

async function recordMakerShadowMarkout(args: {
  id: string
  symbol: string
  clientOrderId: string
  orderId: string | null
  fillPrice: number
  horizonMs: number
  filledAt: string
}) {
  try {
    const quote = await fetchAlpacaCryptoBbo(args.symbol)
    const mid = quote?.mid ?? null
    appendMakerShadow({
      schemaVersion: 1,
      event: 'markout',
      id: args.id,
      recordedAt: new Date().toISOString(),
      filledAt: args.filledAt,
      symbol: args.symbol,
      clientOrderId: args.clientOrderId,
      orderId: args.orderId,
      side: 'buy',
      horizonMs: args.horizonMs,
      fillPrice: args.fillPrice,
      alpacaBbo: quote,
      markoutBps: mid !== null && args.fillPrice > 0 ? ((mid - args.fillPrice) / args.fillPrice) * 10_000 : null,
    })
  } catch (error) {
    appendMakerShadow({
      schemaVersion: 1,
      event: 'markout_error',
      id: args.id,
      recordedAt: new Date().toISOString(),
      symbol: args.symbol,
      clientOrderId: args.clientOrderId,
      orderId: args.orderId,
      horizonMs: args.horizonMs,
      error: message(error),
    })
  }
}

// ---- Alpaca writes --------------------------------------------------------
async function submitBuy(
  candidate: MomentumCandidate,
  resolved: ResolvedSymbol,
  budget: number,
  plan: BotTradePlan,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  // Safe/active dedupe one entry per symbol per day. Turbo appends a unique
  // stamp so it can re-buy the same symbol after a position closes — that is
  // what produces the constant stream of trades.
  const stamp = cfg().relaxStatusGate ? `-${Date.now().toString(36)}` : ''
  const clientOrderId = `mbot-${normSymbol(resolved.symbol)}-${today}${stamp}`

  if (resolved.venue === 'alpaca' && resolved.assetClass === 'crypto') {
    const quote = await fetchAlpacaCryptoBbo(resolved.symbol).catch((error) => {
      pushStatusLog(resolved.symbol, `Alpaca execution quote failed: ${message(error)}`)
      return null
    })
    const executionBlock = alpacaCryptoExecutionBlocker(candidate, quote)
    if (executionBlock || !quote || quote.ask === null || quote.spreadBps === null) {
      pushStatusLog(resolved.symbol, executionBlock ?? 'Alpaca execution quote is incomplete')
      return 0
    }
    candidate = {
      ...candidate,
      price: quote.ask,
      spreadPct: quote.spreadBps / 100,
      spreadAvailable: true,
      quoteTimestamp: quote.timestamp,
      quoteAgeMinutes: quote.timestamp ? Math.max(0, (Date.now() - Date.parse(quote.timestamp)) / 60_000) : null,
      marketDataCoverage: 'CRYPTO_EXCHANGE',
      updatedAt: new Date().toISOString(),
    }
    plan = rebaseTradePlanForEntry(plan, quote.ask)
    const repricedBlock = botAutoBlocker(candidate, plan)
    if (repricedBlock) {
      pushStatusLog(resolved.symbol, `Alpaca execution preflight blocked: ${repricedBlock}`)
      return 0
    }
  }

  const timeVal = newYorkMinutesNow()
  let activeBudget = budget
  let riskPerTradePct = cfg().riskPerTradePct

  if (timeVal >= 690 && timeVal < 840) { // 11:30 - 14:00 New York (Midday Lull)
    activeBudget *= 0.5
    riskPerTradePct *= 0.5
  }

  const account = resolved.venue === 'binance' ? await fetchBinanceAccount() : await fetchAccount()
  const accountEquity = account?.equity ?? DEFAULT_RISK_EQUITY

  const stopLoss = plan.stop
  if (stopLoss === null || stopLoss <= 0 || candidate.price <= stopLoss) {
    pushLog('skip', resolved.symbol, `Invalid stop distance (price ${candidate.price} vs stop ${stopLoss})`)
    return 0
  }

  const riskPerShare = candidate.price - stopLoss
  const riskAmount = accountEquity * riskPerTradePct * cfg().sizeMultiplier * modeSizeScale(candidate)
  const minNotional = minNotionalForExecution()

  let finalQty: number
  if (resolved.assetClass === 'crypto') {
    const riskSizedQty = riskAmount / riskPerShare
    const budgetSizedQty = activeBudget / candidate.price
    const rawQty = Math.min(riskSizedQty, budgetSizedQty)
    finalQty = Math.round(rawQty * 100_000_000) / 100_000_000
  } else {
    const riskSizedQty = riskAmount / riskPerShare
    const budgetSizedQty = activeBudget / candidate.price
    const rawQty = Math.min(riskSizedQty, budgetSizedQty)
    // Paper accounts are small here, so high-priced fractionable stocks like
    // TSLA can be valid risk-sized entries below one full share. Keep whole-share
    // behavior when the budget supports at least one share, but let sub-share
    // paper entries continue to the Alpaca fractionable/notional branch below.
    finalQty = isPaperTradingBase() && rawQty >= 1 ? Math.floor(rawQty) : Math.floor(rawQty * 1_000_000_000) / 1_000_000_000
  }

  if (finalQty <= 0) {
    pushLog('skip', resolved.symbol, `Sized quantity ${finalQty} is 0; skipping entry`)
    return 0
  }

  let finalBudget = finalQty * candidate.price

  if (finalBudget < minNotional) {
    pushLog('skip', resolved.symbol, `Sized budget $${finalBudget.toFixed(2)} is below minimum $${minNotional}; skipping entry`)
    return 0
  }

  const makerShadowId = startMakerShadowIntent({
    candidate,
    resolved,
    plan,
    clientOrderId,
    qty: finalQty,
    notional: finalBudget,
  })

  if (resolved.venue === 'binance') {
    const base = cryptoBaseFromSymbol(resolved.symbol)
    if (!base) throw new Error(`Could not derive Binance base from ${resolved.symbol}`)
    const fill = await placeBinanceMarketBuy(base, finalBudget, clientOrderId)
    if (fill.qty <= 0 || fill.avgPrice <= 0) throw new Error(`Binance buy returned no fill for ${resolved.symbol}`)
    clearReadCaches()
    const displaySymbol = binanceDisplaySymbol(fill.symbol)
    const pending: PendingEntry = {
      submittedAt: Date.now(),
      symbol: fill.symbol,
      displaySymbol,
      assetClass: 'crypto',
      venue: 'binance',
      clientOrderId,
      orderId: String(fill.orderId),
      score: candidate.score,
      budget: fill.quote || finalBudget,
      expectedPrice: candidate.price,
      expectedQty: fill.qty,
      plan,
      mode: botMode,
      setup: tradeSetupSnapshot(candidate, plan),
    }
    const position: BotPosition = {
      symbol: fill.symbol,
      displaySymbol,
      assetClass: 'crypto',
      venue: 'binance',
      side: 'long',
      qty: fill.qty,
      avgEntry: fill.avgPrice,
      currentPrice: fill.avgPrice,
      marketValue: fill.quote,
      unrealizedPl: 0,
      unrealizedPlPct: 0,
      stop: plan.stop,
      target1: plan.target1,
      target2: plan.target2,
    }
    pendingEntries.set(normSymbol(fill.symbol), pending)
    confirmEntryFill(normSymbol(fill.symbol), pending, position)
    return fill.quote || finalBudget
  }

  const body: Record<string, string | number | boolean> = {
    symbol: resolved.symbol,
    side: 'buy',
    type: 'market',
    client_order_id: clientOrderId,
  }
  if (resolved.assetClass === 'stock') {
    const asset = await fetchAssetInfo(resolved.symbol)
    if (asset?.tradable === false || asset?.status === 'inactive') {
      setNoFillCooldown(resolved.symbol, 'Alpaca asset is not tradable right now', REJECTED_COOLDOWN_MS)
      pushLog('skip', resolved.symbol, 'Alpaca asset is not tradable right now; cooling down this symbol')
      return 0
    }
    if (asset?.fractionable === false) {
      finalQty = Math.floor(finalQty)
      finalBudget = finalQty * candidate.price
      if (finalQty < 1) {
        setNoFillCooldown(resolved.symbol, `Budget ${botPrice(finalBudget)} cannot buy one whole share`, NO_FILL_COOLDOWN_MS)
        pushLog('skip', resolved.symbol, `Budget ${botPrice(finalBudget)} cannot buy one whole share; skipped non-fractionable stock`)
        return 0
      }
      body.qty = finalQty.toString()
    } else if (finalQty < 1) {
      if (isExtendedHoursNow()) {
        setNoFillCooldown(resolved.symbol, 'Fractional stock probes are regular-hours only', NO_FILL_COOLDOWN_MS)
        pushLog('skip', resolved.symbol, 'Fractional stock probe skipped outside regular hours')
        return 0
      }
      const notional = Math.floor(finalBudget * 100) / 100
      if (notional < minNotional) {
        pushLog('skip', resolved.symbol, `Fractional notional ${botPrice(notional)} is below minimum ${botPrice(minNotional)}; skipping stock`)
        return 0
      }
      body.notional = notional
      finalBudget = notional
    } else {
      if (finalQty < 1) {
        setNoFillCooldown(resolved.symbol, `Budget ${botPrice(finalBudget)} is less than 1 share`, NO_FILL_COOLDOWN_MS)
        pushLog('skip', resolved.symbol, `Budget ${botPrice(finalBudget)} is less than 1 share; skipped stock`)
        return 0
      }
      body.qty = finalQty.toString()
    }
    body.time_in_force = 'day'
    if (isExtendedHoursNow()) {
      // Alpaca rejects market orders outside 09:30-16:00 ET; pre-/after-hours
      // entries must be marketable LIMIT orders flagged extended_hours.
      body.type = 'limit'
      body.extended_hours = true
      body.limit_price = String(roundBotPrice(candidate.price * 1.003, candidate.price))
    }
  } else {
    // Alpaca crypto stays market/taker by design. A maker experiment must use
    // Alpaca crypto BBO/orderbook truth, GTC qty-based limits, cancel/replace
    // throttling, and CFEE/FEE reconciliation before lowering the fee model.
    body.qty = finalQty.toString()
    body.time_in_force = 'gtc'
  }
  const order = await alpacaFetch<AlpacaOrderRaw>('/orders', { method: 'POST', body: JSON.stringify(body) })
  clearReadCaches()
  const status = (order.status ?? 'submitted').trim().toLowerCase()
  if (CLOSED_WITHOUT_FILL_STATUSES.has(status)) {
    const reason = describeNoFill(status, finalBudget, resolved.venue)
    const cooldownMs = status === 'rejected' ? REJECTED_COOLDOWN_MS : NO_FILL_COOLDOWN_MS
    setNoFillCooldown(resolved.symbol, reason, cooldownMs)
    pushLog(
      status === 'rejected' ? 'error' : 'skip',
      resolved.symbol,
      `${reason}; cooling down this symbol for ${Math.round(cooldownMs / 1000)}s`,
    )
    return 0
  }

  pendingEntries.set(normSymbol(resolved.symbol), {
    submittedAt: Date.now(),
    symbol: resolved.symbol,
    displaySymbol: resolved.symbol,
    assetClass: resolved.assetClass,
    venue: resolved.venue,
    clientOrderId,
    orderId: order.id ?? null,
    score: candidate.score,
    budget: finalBudget,
    expectedPrice: candidate.price,
    expectedQty: resolved.assetClass === 'stock' ? null : finalQty,
    plan,
    mode: botMode,
    setup: tradeSetupSnapshot(candidate, plan),
    makerShadowId,
  })
  pushLog(
    'info',
    resolved.symbol,
    `Buy order submitted (${status}); waiting for ${executionLabel(resolved.venue)} fill before journaling`,
  )
  return finalBudget
}

type PendingExitOptions = {
  orderId?: string | null
  qty?: number
  remainingQty?: number | null
  notional?: number
  price?: number
  pnl?: number
  pnlPct?: number
  fullClose?: boolean
}

function buildPendingExit(position: BotPosition, reason: string, order: AlpacaOrderRaw | null, options: PendingExitOptions = {}): PendingExit {
  const meta = tracked.get(normSymbol(position.symbol))
  const trackedMode = meta?.botMode ?? botMode
  return {
    submittedAt: Date.now(),
    symbol: position.symbol,
    displaySymbol: position.displaySymbol,
    venue: position.venue,
    orderId: options.orderId ?? order?.id ?? null,
    reason,
    qty: options.qty ?? position.qty,
    remainingQty: options.remainingQty ?? null,
    notional: options.notional ?? position.marketValue,
    price: options.price ?? position.currentPrice,
    pnl: options.pnl ?? position.unrealizedPl,
    pnlPct: options.pnlPct ?? position.unrealizedPlPct,
    mode: trackedMode,
    holdSeconds: meta ? Math.max(0, Math.round((Date.now() - meta.openedAt) / 1000)) : null,
    setup: meta?.setup ?? null,
    fullClose: options.fullClose ?? true,
  }
}

function rememberPendingExit(position: BotPosition, reason: string, order: AlpacaOrderRaw | null, options: PendingExitOptions = {}) {
  const status = String(order?.status ?? 'submitted').trim().toLowerCase()
  if (CLOSED_WITHOUT_FILL_STATUSES.has(status)) {
    pushLog(status === 'rejected' ? 'error' : 'skip', position.symbol, `Close order ${status}; position still open`)
    return false
  }

  pendingExits.set(normSymbol(position.symbol), buildPendingExit(position, reason, order, options))
  pushLog('info', position.symbol, `${options.fullClose === false ? 'Trim' : 'Close'} order submitted (${status}); waiting for ${executionLabel(position.venue)} confirmation`)
  return true
}

async function submitClose(position: BotPosition, reason: string) {
  if (position.venue === 'binance') {
    const base = cryptoBaseFromSymbol(position.symbol)
    if (!base) throw new Error(`Could not derive Binance base from ${position.symbol}`)
    const clientOrderId = `${BOT_CLIENT_ORDER_PREFIX}sell-${normSymbol(position.symbol)}-${Date.now().toString(36)}`
    const fill = await placeBinanceMarketSell(base, position.qty, clientOrderId)
    if (fill.qty <= 0 || fill.avgPrice <= 0) throw new Error(`Binance sell returned no fill for ${position.symbol}`)
    clearReadCaches()
    const meta = tracked.get(normSymbol(position.symbol))
    const pnl = meta ? (fill.avgPrice - meta.entry) * fill.qty : (fill.avgPrice - position.avgEntry) * fill.qty
    const entry = meta?.entry ?? position.avgEntry
    const pending = buildPendingExit(position, reason, null, {
      orderId: String(fill.orderId),
      qty: fill.qty,
      remainingQty: 0,
      notional: fill.quote,
      price: fill.avgPrice,
      pnl,
      pnlPct: entry > 0 ? ((fill.avgPrice - entry) / entry) * 100 : 0,
      fullClose: true,
    })
    finalizePendingExit(normSymbol(position.symbol), pending)
    return
  }
  if (position.assetClass === 'stock' && isExtendedHoursNow()) {
    // Market closes (DELETE /positions) are rejected outside RTH; submit a
    // marketable extended-hours LIMIT sell instead. In thin pre/after-hours books
    // this can fail to fill if price gaps through the limit — the next tick retries.
    const refPrice = position.currentPrice > 0 ? position.currentPrice : position.avgEntry
    const body: Record<string, string | number | boolean> = {
      symbol: position.symbol,
      side: 'sell',
      type: 'limit',
      qty: formatQty(position.qty),
      time_in_force: 'day',
      extended_hours: true,
      limit_price: String(roundBotPrice(refPrice * 0.997, refPrice || 1)),
      client_order_id: `${BOT_CLIENT_ORDER_PREFIX}xsell-${normSymbol(position.symbol)}-${Date.now().toString(36)}`,
    }
    const order = await alpacaFetch<AlpacaOrderRaw>('/orders', { method: 'POST', body: JSON.stringify(body) })
    clearReadCaches()
    rememberPendingExit(position, reason, order)
    return
  }
  const order = await alpacaFetch<AlpacaOrderRaw>(`/positions/${encodeURIComponent(position.symbol)}`, { method: 'DELETE' })
  clearReadCaches()
  rememberPendingExit(position, reason, order)
}

function formatQty(value: number) {
  return value.toFixed(9).replace(/\.?0+$/, '')
}

async function submitPartialClose(position: BotPosition, qty: number, reason: string) {
  const trimQty = Math.min(position.qty, Math.max(0, qty))
  if (trimQty <= 0 || position.qty <= 0 || position.currentPrice <= 0) return false
  const remainingQty = Math.max(0, position.qty - trimQty)
  const trimRatio = Math.min(1, trimQty / position.qty)
  if (position.venue === 'binance') {
    const base = cryptoBaseFromSymbol(position.symbol)
    if (!base) throw new Error(`Could not derive Binance base from ${position.symbol}`)
    const clientOrderId = `${BOT_CLIENT_ORDER_PREFIX}trim-${normSymbol(position.symbol)}-${Date.now().toString(36)}`
    const fill = await placeBinanceMarketSell(base, trimQty, clientOrderId)
    if (fill.qty <= 0 || fill.avgPrice <= 0) return false
    clearReadCaches()
    const meta = tracked.get(normSymbol(position.symbol))
    const entry = meta?.entry ?? position.avgEntry
    const actualRemainingQty = Math.max(0, position.qty - fill.qty)
    const pending = buildPendingExit(position, reason, null, {
      orderId: String(fill.orderId),
      qty: fill.qty,
      remainingQty: actualRemainingQty,
      notional: fill.quote,
      price: fill.avgPrice,
      pnl: entry > 0 ? (fill.avgPrice - entry) * fill.qty : position.unrealizedPl * trimRatio,
      pnlPct: entry > 0 ? ((fill.avgPrice - entry) / entry) * 100 : position.unrealizedPlPct,
      fullClose: actualRemainingQty * fill.avgPrice < MIN_NOTIONAL,
    })
    finalizePendingExit(normSymbol(position.symbol), pending, pending.fullClose ? 'Closed' : 'Trimmed')
    return true
  }
  if (position.assetClass === 'stock' && isExtendedHoursNow()) {
    const refPrice = position.currentPrice > 0 ? position.currentPrice : position.avgEntry
    const body: Record<string, string | number | boolean> = {
      symbol: position.symbol,
      side: 'sell',
      type: 'limit',
      qty: formatQty(trimQty),
      time_in_force: 'day',
      extended_hours: true,
      limit_price: String(roundBotPrice(refPrice * 0.997, refPrice || 1)),
      client_order_id: `${BOT_CLIENT_ORDER_PREFIX}xtrim-${normSymbol(position.symbol)}-${Date.now().toString(36)}`,
    }
    const order = await alpacaFetch<AlpacaOrderRaw>('/orders', { method: 'POST', body: JSON.stringify(body) })
    clearReadCaches()
    return rememberPendingExit(position, reason, order, {
      qty: trimQty,
      remainingQty,
      notional: trimQty * refPrice,
      price: refPrice,
      pnl: position.unrealizedPl * trimRatio,
      pnlPct: position.unrealizedPlPct,
      fullClose: false,
    })
  }
  const path = `/positions/${encodeURIComponent(position.symbol)}?qty=${encodeURIComponent(formatQty(trimQty))}`
  const order = await alpacaFetch<AlpacaOrderRaw>(path, { method: 'DELETE' })
  clearReadCaches()
  return rememberPendingExit(position, reason, order, {
    qty: trimQty,
    remainingQty,
    notional: trimQty * position.currentPrice,
    price: position.currentPrice,
    pnl: position.unrealizedPl * trimRatio,
    pnlPct: position.unrealizedPlPct,
    fullClose: false,
  })
}

function findCloseAllOrderForPosition(orders: AlpacaOrderRaw[], position: BotPosition) {
  const normalized = normSymbol(position.symbol)
  return orders.find((order) => normSymbol(order.symbol ?? '') === normalized) ?? null
}

async function submitCloseAll(positions: BotPosition[], reason: string) {
  const alpacaPositions = positions.filter((position) => position.venue === 'alpaca')
  const binancePositions = positions.filter((position) => position.venue === 'binance')
  let orders: AlpacaOrderRaw[] = []
  if (alpacaPositions.length > 0) {
    const response = await alpacaFetch<AlpacaOrderRaw[] | unknown>('/positions?cancel_orders=true', { method: 'DELETE' })
    orders = Array.isArray(response) ? (response.filter((order) => order && typeof order === 'object') as AlpacaOrderRaw[]) : []
    pushLog('info', '-', `Alpaca close-all submitted for ${alpacaPositions.length} position(s); open orders canceled first`)
  }
  for (const position of alpacaPositions) {
    if (isPendingExit(normSymbol(position.symbol))) continue
    rememberPendingExit(position, reason, findCloseAllOrderForPosition(orders, position))
  }
  for (const position of binancePositions) {
    if (isPendingExit(normSymbol(position.symbol))) continue
    try {
      await submitClose(position, reason)
    } catch (error) {
      pushLog('error', position.symbol, `Binance close-all sell failed: ${message(error)}`)
    }
  }
  clearReadCaches()
}

// ---- signal gates ---------------------------------------------------------
function hardBotBlockers(candidate: MomentumCandidate) {
  return candidate.blockers.filter((blocker) => !cfg().allowedRiskBlockers.has(blocker))
}

export function capStockPlanRisk(plan: BotTradePlan, mode: BotMode = botMode): BotTradePlan {
  if (plan.trigger <= 0 || plan.stop <= 0 || plan.stop >= plan.trigger) return plan
  const maxRiskPct = BOT_MODES[mode].stockMaxInitialRiskPct
  const boundedStop = plan.trigger * (1 - maxRiskPct)
  if (plan.stop >= boundedStop) return plan
  return { ...plan, stop: roundBotPrice(boundedStop, plan.trigger) }
}

function quoteAgeMs(candidate: MomentumCandidate): number | null {
  if (!candidate.quoteTimestamp) return null
  const parsed = Date.parse(candidate.quoteTimestamp)
  return Number.isNaN(parsed) ? null : Math.max(0, Date.now() - parsed)
}

function stockSpreadAutoCap(candidate: MomentumCandidate) {
  if (!cfg().relaxStatusGate || candidate.assetClass !== 'stock') return cfg().stockSpreadCapPct
  const technical = technicalContext(candidate)
  const eliteSetup = candidate.score >= 92 && technical.edgeScore >= 95 && technical.trendScore >= 85
  return eliteSetup ? Math.max(cfg().stockSpreadCapPct, 1.0) : cfg().stockSpreadCapPct
}

function openingStockVolatilityBlocker(now: Date): string | null {
  const timeVal = newYorkMinutesNow(now)
  return timeVal >= 570 && timeVal < 585 ? 'opening 15m spread volatility' : null
}

function broadMarketStockBlocker(candidate: MomentumCandidate): string | null {
  const freshContext = cachedSnapshot?.marketContext
  if (!freshContext) return null
  if (indexDumpInProgress(freshContext.indices?.SPY)) return 'SPY intraday selloff active'
  if (indexDumpInProgress(freshContext.indices?.QQQ)) return 'QQQ intraday selloff active'
  if (
    candidate.estimatedFreeFloat !== null &&
    candidate.estimatedFreeFloat < 15000000 &&
    indexDumpInProgress(freshContext.indices?.IWM)
  ) {
    return 'IWM intraday selloff active'
  }
  return null
}

type StockExecutionStructure = 'orb-breakout' | 'vwap-reclaim' | 'pinned-breakout'

function stockTimeAdjustedRelativeVolume(candidate: MomentumCandidate) {
  return candidate.sessionVolume?.timeAdjustedRelativeVolume ?? null
}

function stockExecutionStructure(candidate: MomentumCandidate): StockExecutionStructure | null {
  if (candidate.assetClass !== 'stock' || isReversionCandidate(candidate)) return null
  if (candidate.score < cfg().minScore) return null
  if (candidate.spreadAvailable === false || candidate.tradingHalted) return null

  const timeAdjustedRvol = stockTimeAdjustedRelativeVolume(candidate)
  const pulse = candidate.volumePulse ?? 0
  const fifteenMinuteMove = candidate.fifteenMinuteMovePct ?? 0
  const oneHourMove = candidate.oneHourMovePct ?? 0
  const cleanSpread = candidate.spreadPct <= Math.min(cfg().stockSpreadCapPct, 0.4)
  const recentBarVolumeOk =
    candidate.latestBarVolume !== null &&
    candidate.averageRecentBarVolume !== null &&
    candidate.averageRecentBarVolume > 0 &&
    candidate.latestBarVolume >= candidate.averageRecentBarVolume * 1.5

  if (
    candidate.distanceFromHighPct <= 0.3 &&
    (timeAdjustedRvol ?? 0) >= 80 &&
    candidate.microPullback?.state === 'READY' &&
    candidate.status === 'CHECK NOW'
  ) {
    return 'pinned-breakout'
  }

  if (
    cleanSpread &&
    candidate.aboveVwap &&
    candidate.marketStatus === 'OPEN' &&
    candidate.openingRangeHigh !== null &&
    candidate.price > candidate.openingRangeHigh &&
    candidate.distanceFromHighPct <= 4 &&
    recentBarVolumeOk &&
    (timeAdjustedRvol ?? 0) >= 2 &&
    fifteenMinuteMove >= 0 &&
    oneHourMove >= -0.2
  ) {
    return 'orb-breakout'
  }

  if (
    cleanSpread &&
    candidate.aboveVwap &&
    candidate.vwap > 0 &&
    candidate.vwapExtensionPct !== null &&
    candidate.vwapExtensionPct >= 0 &&
    candidate.vwapExtensionPct <= 4 &&
    candidate.distanceFromHighPct <= 10 &&
    (candidate.rangePositionPct ?? 0) >= 55 &&
    (timeAdjustedRvol ?? 0) >= 1.8 &&
    oneHourMove >= 0.5 &&
    fifteenMinuteMove >= 0 &&
    pulse >= 0.85
  ) {
    return 'vwap-reclaim'
  }

  return null
}

function stockStructureAllowsPullbackBypass(structure: StockExecutionStructure | null) {
  return structure === 'orb-breakout' || structure === 'vwap-reclaim' || structure === 'pinned-breakout'
}

function stockLivePulseBlocker(candidate: MomentumCandidate): string | null {
  const pulse = candidate.volumePulse
  if (pulse === null) return 'stock 5m volume pulse unavailable for auto'
  if (pulse >= 1.05) return null

  const structure = stockExecutionStructure(candidate)
  if (structure === 'pinned-breakout') return null
  if (pulse >= 0.85 && (structure === 'orb-breakout' || structure === 'vwap-reclaim')) return null
  return `stock 5m volume pulse ${pulse.toFixed(2)}x below auto floor 1.05x without ORB/VWAP reclaim confirmation`
}

// Bot-only stock auto-entry checks that intentionally do NOT touch the radar:
// the dashboard can still show these rows; the bot just won't buy them. This is
// where execution stays strict — a fresh live quote (seconds, not the 5-minute
// UI tolerance) and a tight spread, with a cents floor so a cheap stock's wide
// absolute spread is caught even when the percentage looks small.
// Reversion has the inverse shape of momentum (below VWAP, far from the high), so
// the momentum auto-entry checks (micro-pullback, near-high rVol, fading tape)
// don't apply. Keep only the execution-quality + knife guards that DO matter:
// avoid the volatile open, never fade into a broad-index dump, require a fresh
// quote and a tight spread.
function reversionStockAutoBlocker(candidate: MomentumCandidate, now: Date): string | null {
  if (candidate.tradingHalted) {
    return candidate.tradingHaltReason ? `trading halted: ${candidate.tradingHaltReason}` : 'trading halted'
  }
  if (candidate.spreadAvailable === false) return 'live bid/ask unavailable for auto'
  const openingBlock = openingStockVolatilityBlocker(now)
  if (openingBlock) return openingBlock
  const broadMarketBlock = broadMarketStockBlocker(candidate)
  if (broadMarketBlock) return broadMarketBlock
  const age = quoteAgeMs(candidate)
  if (age === null || age > cfg().stockMaxQuoteAgeMs) {
    return `quote too stale for auto (${age === null ? 'no timestamp' : `${Math.round(age / 1000)}s`})`
  }
  const spreadCap = stockSpreadAutoCap(candidate)
  if (candidate.spreadPct > spreadCap) {
    return `spread ${candidate.spreadPct.toFixed(2)}% over auto cap ${spreadCap}%`
  }
  return null
}

export function stockAutoBlocker(candidate: MomentumCandidate, now = new Date()): string | null {
  if (candidate.assetClass !== 'stock') return null
  if (candidate.tradingHalted) {
    return candidate.tradingHaltReason ? `trading halted: ${candidate.tradingHaltReason}` : 'trading halted'
  }
  if (candidate.spreadAvailable === false) return 'live bid/ask unavailable for auto'
  if (isReversionCandidate(candidate)) return reversionStockAutoBlocker(candidate, now)
  const structure = stockExecutionStructure(candidate)
  const canUseStructurePath = stockStructureAllowsPullbackBypass(structure)
  const openingBlock = openingStockVolatilityBlocker(now)
  if (openingBlock) return openingBlock
  const broadMarketBlock = broadMarketStockBlocker(candidate)
  if (broadMarketBlock) return broadMarketBlock
  if (candidate.microPullback?.state === 'FAILED') return 'micro pullback failed'
  if (candidate.microPullback?.state === 'FORMING' && !canUseStructurePath) return 'micro pullback still forming'
  if (candidate.microPullback?.state === 'EXTENDED' && !canUseStructurePath) {
    return 'stock is extended; waiting for micro pullback'
  }
  if (
    candidate.microPullback?.state === 'READY' &&
    candidate.microPullback.trigger !== null &&
    candidate.price < candidate.microPullback.trigger &&
    !canUseStructurePath
  ) {
    return 'micro pullback trigger not active'
  }
  if (
    candidate.microPullback?.trigger !== null &&
    candidate.microPullback?.trigger !== undefined &&
    candidate.microPullback.stop !== null &&
    candidate.microPullback.nearestResistance !== null
  ) {
    const risk = candidate.microPullback.trigger - candidate.microPullback.stop
    const room = candidate.microPullback.nearestResistance - candidate.microPullback.trigger
    if (risk > 0 && room > 0 && room < risk * 1.1) return 'resistance too close for 1R'
  }
  const timeAdjustedRvol = candidate.sessionVolume?.timeAdjustedRelativeVolume ?? null
  if (timeAdjustedRvol !== null && timeAdjustedRvol < 1.1 && candidate.relativeVolume < 3) {
    return `time-adjusted relVol ${timeAdjustedRvol.toFixed(2)}x too weak for auto`
  }
  if (candidate.microBars && candidate.microBars.bars >= 6 && (candidate.microBars.oneMinuteMovePct ?? 0) < -0.7) {
    return `10s tape fading ${candidate.microBars.oneMinuteMovePct?.toFixed(2)}% over 1m`
  }
  const pulseBlock = stockLivePulseBlocker(candidate)
  if (pulseBlock) return pulseBlock
  const age = quoteAgeMs(candidate)
  if (age === null || age > cfg().stockMaxQuoteAgeMs) {
    return `quote too stale for auto (${age === null ? 'no timestamp' : `${Math.round(age / 1000)}s`})`
  }
  const spreadCap = stockSpreadAutoCap(candidate)
  if (candidate.spreadPct > spreadCap) {
    return `spread ${candidate.spreadPct.toFixed(2)}% over auto cap ${spreadCap}%`
  }
  const absSpread = (candidate.price * candidate.spreadPct) / 100
  if (candidate.price < 10 && absSpread > 0.05) {
    return `spread ~$${absSpread.toFixed(2)} too wide for a sub-$10 stock`
  }
  return null
}

export function costAwareEntryBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  if (!costModelEnabled() || plan.trigger <= 0 || plan.target1 <= plan.trigger) return null
  const venue = resolveTradableSymbol(candidate)?.venue ?? (candidate.assetClass === 'crypto' && cryptoOnBinance() ? 'binance' : 'alpaca')
  const costPct = modeledRoundTripCostPct(candidate.assetClass, candidate.spreadPct, venue)
  const targetEdgePct = ((plan.target1 - plan.trigger) / plan.trigger) * 100
  // Do not demand an unrealistic zero-friction setup, but require enough room
  // that normal spread/slippage consumes less than half the first-target move.
  // A small absolute floor prevents penny-stock scalps whose nominal target is
  // technically above cost but still too small to survive one adverse tick.
  const requiredEdgePct = Math.max(candidate.assetClass === 'stock' ? 0.6 : 0.45, costPct * 2.25)
  if (targetEdgePct + 1e-9 < requiredEdgePct) {
    return `target1 edge ${targetEdgePct.toFixed(2)}% cannot clear modeled ${costPct.toFixed(2)}% round-trip cost with safety margin`
  }
  return null
}

// ---- crypto fee-first entry gate ------------------------------------------
// A crypto round trip pays a taker fee on BOTH legs (Binance ~0.10%/leg,
// Alpaca Tier-1 ~0.25%/leg) PLUS slippage and the spread we cross. On the small,
// fast moves the scanner surfaces, those costs can quietly eat the entire edge —
// the classic "green gross, red net" trap. The universal costAwareEntryBlocker above only asks
// that target1 is theoretically reachable above cost; it does NOT guarantee the
// trade still pays after the full round trip.
//
// So in the two *serious* modes (safe + active) a crypto entry is only allowed
// when the first realistic profit milestone (target1, which the bot trims at and
// trails from) clears the full modeled round-trip cost with margin AND still pays
// a meaningful net reward relative to the risk taken. This is the gate that makes
// "avoid fees first" literal: we never take a crypto trade whose best realistic
// outcome would not bring in more than the trade itself costs.
//
// On the exit side this is already complemented by adaptiveProfitStop(), whose
// breakeven floor is a *net* breakeven (entry * (1 + modeledCostPct)), so a winner
// can never be booked at a price that secretly loses to fees. Turbo (the for-fun
// scalp lab) is intentionally left on the looser universal gate above.
const CRYPTO_NET_EDGE_POLICY: Partial<Record<BotMode, { costMultiple: number; minNetRR: number; netFloorPct: number }>> = {
  // safe: strictest. target1 must clear 3x the round-trip cost, net edge >= 0.5%,
  // and after paying the full round trip the first target still pays >= 0.8x risk.
  safe: { costMultiple: 3.0, minNetRR: 0.8, netFloorPct: 0.5 },
  // active: a touch more permissive so it can still work the wider universe, but
  // every entry must still be net-positive after the full modeled cost.
  active: { costMultiple: 2.6, minNetRR: 0.7, netFloorPct: 0.4 },
}

export function cryptoNetEdgeBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  if (candidate.assetClass !== 'crypto' || !costModelEnabled()) return null
  const policy = CRYPTO_NET_EDGE_POLICY[botMode]
  if (!policy) return null // turbo keeps the looser universal cost gate
  if (plan.trigger <= 0 || plan.stop >= plan.trigger || plan.target1 <= plan.trigger) return null

  const venue = resolveTradableSymbol(candidate)?.venue ?? (cryptoOnBinance() ? 'binance' : 'alpaca')
  const costPct = modeledRoundTripCostPct('crypto', candidate.spreadPct, venue)
  const grossTarget1Pct = ((plan.target1 - plan.trigger) / plan.trigger) * 100
  const riskPct = ((plan.trigger - plan.stop) / plan.trigger) * 100
  const netTarget1Pct = grossTarget1Pct - costPct

  // 1) Fee drag: the round trip may not consume too large a slice of the move.
  if (grossTarget1Pct + 1e-9 < costPct * policy.costMultiple) {
    return `crypto fee gate: first target +${grossTarget1Pct.toFixed(2)}% is under ${policy.costMultiple}x the ${costPct.toFixed(2)}% round-trip cost (fees would eat the move)`
  }
  // 2) After paying the full round trip, the net edge must clear an absolute floor
  //    so a tiny-risk scalp can't pass on ratios alone.
  if (netTarget1Pct + 1e-9 < policy.netFloorPct) {
    return `crypto fee gate: net first-target edge +${netTarget1Pct.toFixed(2)}% after ${costPct.toFixed(2)}% cost is below the ${policy.netFloorPct}% floor`
  }
  // 3) Net reward:risk — after fees, the first target must still pay at least
  //    minNetRR of the risk, keeping the expectancy structure positive.
  if (riskPct > 0 && netTarget1Pct + 1e-9 < riskPct * policy.minNetRR) {
    return `crypto fee gate: net reward ${(netTarget1Pct / riskPct).toFixed(2)}R after ${costPct.toFixed(2)}% cost is below the ${policy.minNetRR}R minimum`
  }
  return null
}

function cryptoAutoBlocker(candidate: MomentumCandidate): string | null {
  if (candidate.assetClass !== 'crypto') return null
  if (candidate.spreadAvailable === false) return 'crypto live bid/ask unavailable for auto'
  const age = quoteAgeMs(candidate)
  if (age === null || age > cfg().cryptoMaxQuoteAgeMs) {
    return `crypto quote too stale for auto (${age === null ? 'no timestamp' : `${Math.round(age / 1000)}s`})`
  }
  const pulseFloor = nightCryptoMinVolumePulse()
  if (candidate.volumePulse !== null && candidate.volumePulse < pulseFloor) {
    return `5m volume pulse ${candidate.volumePulse.toFixed(2)}x below auto floor ${pulseFloor.toFixed(2)}x`
  }
  return null
}

function chaseBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  if (plan.trigger <= 0 || candidate.price <= 0) return null
  const chasePct = ((candidate.price - plan.trigger) / plan.trigger) * 100
  if (chasePct > cfg().maxChasePct) {
    return `price ${chasePct.toFixed(2)}% past trigger; max chase is ${cfg().maxChasePct.toFixed(2)}%`
  }
  return null
}

function latestClosedSell(normalized: string, mode?: BotMode) {
  return history.find(
    (entry) =>
      entry.side === 'sell' &&
      normSymbol(entry.symbol) === normalized &&
      entry.pnl !== null &&
      (!mode || entry.mode === mode),
  )
}

function turboTechnicalBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  if (!cfg().relaxStatusGate) return null
  // Reversion is the inverse of momentum (below VWAP, far from high). Its own
  // scorer + reversionStockAutoBlocker govern it; the turbo momentum gates here
  // (off-high, edge/trend, deep-fib) would reject every valid reclaim.
  if (isReversionCandidate(candidate)) return null
  const technical = technicalContext(candidate, plan)
  // Daytime, turbo refuses IGNORE rows outright. At night the whole tradable crypto
  // set is usually IGNORE (soft post-close tape), so that blanket block freezes the
  // bot. Allow an IGNORE crypto through ONLY when it is a valid VWAP-pullback probe
  // (still up on the day, within range of VWAP) — the rest of the gates (edge, pulse,
  // chase, score floor) and the tight night stop still apply.
  const nightProbeOk = nightCryptoActive() && candidate.assetClass === 'crypto' && isTurboCryptoProbe(candidate)
  if (candidate.status === 'IGNORE' && !nightProbeOk) {
    return 'Turbo blocks IGNORE rows after paper losses; waiting for WATCH/CHECK NOW confirmation'
  }
  if (technical.edgeScore < 42) {
    return `technical edge ${technical.edgeScore}/100 too weak (${technical.notes.join(', ')})`
  }
  if (technical.fibZone === 'deep pullback' || technical.fibZone === 'fib 78.6') {
    return `Turbo blocks late/deep Fibonacci entries (${technical.fibZone}); waiting for cleaner momentum`
  }
  if (candidate.assetClass === 'stock') {
    // These stock gates were tightened "after recent stock stop-outs" — but those
    // stop-outs were caused by scalp stops sitting inside the spread, which is now
    // fixed (wider, spread-padded stops). So the over-correction is walked back a
    // step to let near-miss quality setups trade again, without opening the door to
    // genuinely weak edge.
    if (candidate.score < 79) {
      return `Turbo stock floor ${candidate.score} below 79 after recent stock stop-outs`
    }
    if (candidate.distanceFromHighPct > 4) {
      return `Turbo stock is ${candidate.distanceFromHighPct.toFixed(1)}% off high; avoiding fading spike momentum`
    }
    if (candidate.changePct > 150 && candidate.distanceFromHighPct > 2) {
      return `Turbo blocks extreme stock spike (${candidate.changePct.toFixed(1)}% move) unless it is still near high`
    }
    if (technical.edgeScore < 80 || technical.trendScore < 76) {
      return `Turbo stock edge ${technical.edgeScore}/100 and trend ${technical.trendScore}/100 need stronger confirmation`
    }
  } else if (candidate.assetClass === 'crypto') {
    const cryptoPulseFloor = nightCryptoMinVolumePulse()
    const minChangePct = nightCryptoActive() ? 0.5 : 1.0
    if (candidate.changePct < minChangePct) {
      return `Turbo crypto needs a green 24h trend (${candidate.changePct.toFixed(2)}% < ${minChangePct.toFixed(2)}%)`
    }
    if ((candidate.secondaryMovePct ?? 0) < (nightCryptoActive() ? -0.25 : 0)) {
      return `Turbo crypto short-term trend ${(candidate.secondaryMovePct ?? 0).toFixed(2)}% is not firm enough`
    }
    if ((candidate.volumePulse ?? 0) < cryptoPulseFloor && candidate.quoteVolume !== null) {
      return `Turbo crypto pulse ${(candidate.volumePulse ?? 0).toFixed(2)}x below floor ${cryptoPulseFloor.toFixed(2)}x`
    }
  }
  const learningBlock = turboLearningBlocker(candidate, plan)
  if (learningBlock) return learningBlock
  if (!isPaperTradingBase()) return null

  const normalized = normSymbol(resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate))
  const lastSell = latestClosedSell(normalized, 'turbo')
  if (!lastSell || !lastSell.reason.toLowerCase().includes('stop')) return null
  const lastExitAt = Date.parse(lastSell.time)
  if (!Number.isFinite(lastExitAt) || Date.now() - lastExitAt > PAPER_TURBO_ANTI_CHURN_MS) return null
  if (!strongTurboLearningEscape(candidate, technical)) {
    return `paper anti-churn: last Turbo stop was ${formatAgeMs(Date.now() - lastExitAt)} ago; waiting for a much stronger trend/pulse`
  }
  return null
}

function botAutoBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  return (
    stockAutoBlocker(candidate) ??
    cryptoAutoBlocker(candidate) ??
    costAwareEntryBlocker(candidate, plan) ??
    cryptoNetEdgeBlocker(candidate, plan) ??
    chaseBlocker(candidate, plan) ??
    setupMemoryBlocker(candidate, plan) ??
    turboTechnicalBlocker(candidate, plan)
  )
}

function retuneTrackedPlan(meta: TrackedEntry, plan: BotTradePlan, price: number) {
  const maxExecutableStop = price > 0 ? price * 0.999 : Number.POSITIVE_INFINITY
  const raisedStop = Math.min(maxExecutableStop, plan.stop)
  if (Number.isFinite(raisedStop) && raisedStop > meta.stop) {
    meta.stop = roundBotPrice(raisedStop, price || meta.entry)
  }
  if (!meta.target1Hit && plan.target1 > meta.target1) {
    meta.target1 = roundBotPrice(plan.target1, price || meta.entry)
  }
  if (plan.target2 > meta.target2) {
    meta.target2 = roundBotPrice(plan.target2, price || meta.entry)
  }
}

// Track how far price has run in our favor and against us since entry. Called on
// every tick for every open position (the chokepoint in the manage-exits loop), so
// the peak/trough are current no matter which exit fires. Cheap and idempotent.
function updateExcursion(meta: TrackedEntry, price: number) {
  if (!(price > 0)) return
  meta.peakPrice = Math.max(meta.peakPrice || meta.entry, price)
  meta.troughPrice = Math.min(meta.troughPrice || meta.entry, price)
}

// Convert a closed trade's excursion into R-multiples against its original risk.
// maxFavorableR (peak gain) and maxAdverseR (deepest drawdown, positive magnitude)
// are clamped at 0 so a trade that only ever moved one direction reads cleanly.
function excursionR(meta: TrackedEntry) {
  if (!meta || !(meta.initialRisk > 0)) return { maxFavorableR: null, maxAdverseR: null }
  const round3 = (value: number) => Math.round(value * 1000) / 1000
  return {
    maxFavorableR: round3(Math.max(0, (meta.peakPrice - meta.entry) / meta.initialRisk)),
    maxAdverseR: round3(Math.max(0, (meta.entry - meta.troughPrice) / meta.initialRisk)),
  }
}

export function adaptiveProfitStop(input: {
  entry: number
  currentPrice: number
  peakPrice: number
  currentStop: number
  initialRisk: number
  atr: number | null
  modeledCostPct: number
  breakevenAtR: number
  trailAfterR: number
  trailDistanceR: number
  atrTrailMultiple: number
}) {
  const {
    entry,
    currentPrice,
    peakPrice,
    currentStop,
    initialRisk,
    atr,
    modeledCostPct,
    breakevenAtR,
    trailAfterR,
    trailDistanceR,
    atrTrailMultiple,
  } = input
  if (entry <= 0 || currentPrice <= 0 || initialRisk <= 0) return currentStop
  const profitR = (currentPrice - entry) / initialRisk
  let nextStop = currentStop
  const netBreakeven = entry * (1 + Math.max(0, modeledCostPct) / 100)

  if (profitR >= breakevenAtR) nextStop = Math.max(nextStop, netBreakeven)

  if (profitR >= trailAfterR) {
    const tighten = profitR >= 3 ? 0.65 : profitR >= 2 ? 0.8 : 1
    const riskDistance = initialRisk * trailDistanceR * tighten
    const atrDistance = atr !== null && atr > 0 ? atr * atrTrailMultiple * tighten : 0
    // ATR is a noise floor: volatile names get breathing room, while the R-based
    // distance keeps the trail useful when ATR is unavailable or unusually tiny.
    const trailDistance = Math.max(riskDistance, atrDistance)
    nextStop = Math.max(nextStop, peakPrice - trailDistance)
  }

  // Step floors progressively secure more of a mature trend without guessing
  // its top. They only raise the stop and remain below the current executable
  // price, so a fast runner is not converted into an immediate market exit.
  if (profitR >= 1.5) nextStop = Math.max(nextStop, entry + initialRisk * 0.25, netBreakeven)
  if (profitR >= 2) nextStop = Math.max(nextStop, entry + initialRisk * 0.75, netBreakeven)
  if (profitR >= 3) nextStop = Math.max(nextStop, entry + initialRisk * 1.5, netBreakeven)

  return Math.min(nextStop, currentPrice * 0.999)
}

function applyAdaptiveRiskControls(
  position: BotPosition,
  meta: TrackedEntry,
  price: number,
  candidate?: MomentumCandidate,
) {
  if (price <= 0 || meta.initialRisk <= 0) return
  const mode = BOT_MODES[meta.botMode]
  const now = Date.now()
  const previousStop = meta.stop
  updateExcursion(meta, price)
  const liveAtr = candidate?.microPullback?.atr
  if (typeof liveAtr === 'number' && Number.isFinite(liveAtr) && liveAtr > 0) meta.atr = liveAtr
  const modeledCostPct = modeledRoundTripCostPct(meta.assetClass, meta.setup?.spreadPct ?? null, meta.venue)
  const nextStop = adaptiveProfitStop({
    entry: meta.entry,
    currentPrice: price,
    peakPrice: meta.peakPrice,
    currentStop: meta.stop,
    initialRisk: meta.initialRisk,
    atr: meta.atr,
    modeledCostPct,
    breakevenAtR: mode.breakevenAtR,
    trailAfterR: mode.trailAfterR,
    trailDistanceR: mode.trailDistanceR,
    atrTrailMultiple: mode.atrTrailMultiple,
  })
  const rounded = roundBotPrice(nextStop, price)
  if (rounded > meta.stop) {
    meta.stop = rounded
    const crossedBreakeven = previousStop < meta.entry && meta.stop >= meta.entry
    if (crossedBreakeven || now - meta.lastStopRaisedAt > 60_000) {
      meta.lastStopRaisedAt = now
      pushLog('info', position.symbol, `Adaptive stop raised to ${botPrice(meta.stop)} (${meta.mode})`)
    }
  }
}

function timedExitReason(meta: TrackedEntry, price: number) {
  const mode = BOT_MODES[meta.botMode]
  if (mode.maxHoldMs <= 0 || Date.now() - meta.openedAt < mode.maxHoldMs) return null
  if (price >= meta.target2) return null
  if (price >= meta.entry) return 'time exit'
  return 'time stop'
}

function activeModeDeRiskReason(candidate: MomentumCandidate, position: BotPosition, meta: TrackedEntry, price: number) {
  if (!isPaperTradingBase()) return null
  if (cfg().relaxStatusGate || meta.botMode !== 'turbo' || candidate.assetClass !== 'crypto') return null
  if (price <= 0 || position.unrealizedPlPct > 0.2) return null

  const weakPulse = candidate.volumePulse !== null && candidate.volumePulse < 1
  const fadingTape = (candidate.oneHourMovePct ?? 0) < 0 && (candidate.fifteenMinuteMovePct ?? 0) <= 0
  const lostSignal = candidate.status === 'IGNORE' || candidate.score < cfg().minScore
  if (!lostSignal || (!weakPulse && !fadingTape && candidate.aboveVwap)) return null

  if (position.unrealizedPlPct <= -0.55) return 'active de-risk: weak turbo hold'

  const now = Date.now()
  const defensiveStop = roundBotPrice(Math.min(price * 0.9985, price * 0.999), price)
  if (defensiveStop > meta.stop && defensiveStop < price) {
    meta.stop = defensiveStop
    if (now - meta.lastStopRaisedAt > 45_000) {
      meta.lastStopRaisedAt = now
      pushLog(
        'info',
        position.symbol,
        `Active de-risk tightened weak turbo hold stop to ${botPrice(meta.stop)} (pulse ${
          candidate.volumePulse === null ? 'n/a' : `${candidate.volumePulse.toFixed(2)}x`
        }, 1h ${(candidate.oneHourMovePct ?? 0).toFixed(2)}%)`,
      )
    }
  }
  return null
}

function entryConfirmationKey(resolved: ResolvedSymbol) {
  return normSymbol(resolved.symbol)
}

function resetEntryConfirmation(resolved: ResolvedSymbol) {
  entryConfirmations.delete(entryConfirmationKey(resolved))
}

function entryConfirmationReady(candidate: MomentumCandidate, resolved: ResolvedSymbol, plan: BotTradePlan) {
  if (cfg().entryConfirmHolds <= 1 && cfg().entryConfirmDwellMs <= 0) return true
  const trigger = plan.trigger
  const qualifies =
    candidate.price >= trigger &&
    (candidate.aboveVwap || isTurboCryptoProbe(candidate) || isReversionCandidate(candidate)) &&
    botAutoBlocker(candidate, plan) === null
  const key = entryConfirmationKey(resolved)
  if (!qualifies) {
    entryConfirmations.delete(key)
    return false
  }

  const now = Date.now()
  const existing = entryConfirmations.get(key)
  const triggerChanged = existing ? Math.abs(existing.trigger - trigger) / trigger > 0.002 : false
  const stale = existing ? now - existing.lastSeen > TICK_MS * 3 : false
  const record =
    !existing || triggerChanged || stale
      ? { firstSeen: now, lastSeen: now, trigger, holds: 1 }
      : { ...existing, lastSeen: now, holds: existing.holds + 1 }
  entryConfirmations.set(key, record)
  return record.holds >= cfg().entryConfirmHolds && now - record.firstSeen >= cfg().entryConfirmDwellMs
}

function entryConfirmationSummary(resolved: ResolvedSymbol) {
  const record = entryConfirmations.get(entryConfirmationKey(resolved))
  if (!record) return `confirming entry 0/${cfg().entryConfirmHolds}`
  const dwellLeft = Math.max(0, Math.ceil((cfg().entryConfirmDwellMs - (Date.now() - record.firstSeen)) / 1000))
  const holdText = `confirming entry ${Math.min(record.holds, cfg().entryConfirmHolds)}/${cfg().entryConfirmHolds}`
  return dwellLeft > 0 ? `${holdText}; ${dwellLeft}s hold left` : holdText
}

function roundBotPrice(value: number, reference: number) {
  const digits = reference < 1 ? 6 : reference < 10 ? 3 : 2
  const power = 10 ** digits
  return Math.round(value * power) / power
}

// Large-cap VWAP-reclaim (mean-reversion) candidate: BELOW VWAP and far from the
// high by design, so the bot branches on this everywhere it would otherwise
// require above-VWAP momentum.
function isReversionCandidate(candidate: MomentumCandidate) {
  return candidate.strategy === 'reversion'
}

function stickyReversionKey(candidate: MomentumCandidate) {
  return normSymbol(resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate))
}

function canStickyReversion(candidate: MomentumCandidate) {
  return (
    isReversionCandidate(candidate) &&
    (candidate.status === 'WATCH' || candidate.status === 'CHECK NOW') &&
    candidate.signal.entryTrigger !== null &&
    candidate.signal.stopLoss !== null &&
    candidate.signal.targetOne !== null
  )
}

function mergeStickyReversionWatches(shortlist: MomentumCandidate[]) {
  const now = Date.now()
  const bySymbol = new Map(shortlist.map((candidate) => [stickyReversionKey(candidate), candidate]))
  for (const [symbol, sticky] of stickyReversionWatches) {
    if (now - sticky.seenAt > REVERSION_STICKY_WATCH_MS) {
      stickyReversionWatches.delete(symbol)
      continue
    }
    if (!bySymbol.has(symbol)) {
      bySymbol.set(symbol, sticky.candidate)
    }
  }
  return [...bySymbol.values()]
}

function rememberStickyReversionWatches(shortlist: MomentumCandidate[]) {
  const now = Date.now()
  for (const candidate of shortlist) {
    if (canStickyReversion(candidate)) {
      stickyReversionWatches.set(stickyReversionKey(candidate), { candidate, seenAt: now })
    }
  }
}

function botTriggerPrice(candidate: MomentumCandidate) {
  // Reversion always arms on its reclaim trigger (just above the stretched price),
  // never at the live price — so a WATCH reversion stays armed until it turns up.
  if (isReversionCandidate(candidate)) return candidate.signal.entryTrigger
  if (candidate.status === 'CHECK NOW') return candidate.signal.entryTrigger
  // WATCH probes at the live price; turbo treats any above-VWAP mover the same.
  if (candidate.status === 'WATCH' || cfg().relaxStatusGate) return candidate.price
  return null
}

function isTurboCryptoProbe(candidate: MomentumCandidate) {
  if (!cfg().relaxStatusGate || candidate.assetClass !== 'crypto') return false
  const minChangePct = nightCryptoActive() ? 0.5 : 1.0
  const minSecondaryMove = nightCryptoActive() ? -0.25 : 0
  if (candidate.changePct < minChangePct) return false
  if ((candidate.secondaryMovePct ?? 0) < minSecondaryMove) return false
  if ((candidate.volumePulse ?? 0) < nightVwapBypassMinPulse()) return false
  if (candidate.aboveVwap) return true
  if (candidate.vwap <= 0 || candidate.price <= 0) return false
  const belowVwapPct = ((candidate.vwap - candidate.price) / candidate.vwap) * 100
  // At night, allow only a shallow short-term dip toward VWAP (a pullback is the
  // entry), while still requiring the 24h move to be green and the short move to
  // be roughly flat. This blocks the red-day DOGE-style churn the journal exposed.
  return (
    belowVwapPct >= 0 &&
    belowVwapPct <= nightVwapBypassMaxDistancePct() &&
    (candidate.volumePulse ?? 0) >= nightVwapBypassMinPulse()
  )
}

function scannerStatusBlocker(candidate: MomentumCandidate): string | null {
  if (candidate.status === 'DATA ERROR') {
    return candidate.dataError ? `data error: ${candidate.dataError}` : 'data is not verified'
  }
  if (candidate.status !== 'IGNORE') return null

  const nightProbeOk = nightCryptoActive() && candidate.assetClass === 'crypto' && isTurboCryptoProbe(candidate)
  if (nightProbeOk) return null

  const reason = candidate.blockers[0] ?? candidate.validationNotes[0] ?? null
  return reason ? `scanner ignored setup: ${reason}` : 'scanner ignored setup; waiting for WATCH/CHECK NOW'
}

function candidateDollarVolume(candidate: MomentumCandidate) {
  return candidate.quoteVolume ?? candidate.volume * candidate.price
}

function turboScalpProfile(candidate: MomentumCandidate): {
  mode: BotTradePlan['mode']
  stopPct: number
  target1Pct: number
  target2Pct: number
} {
  const liquidity = candidateDollarVolume(candidate)
  const pulse = candidate.volumePulse ?? 0
  const reclaimProbe = cfg().relaxStatusGate && candidate.assetClass === 'crypto' && !candidate.aboveVwap
  const liquidMomentum =
    candidate.score >= 72 ||
    candidate.changePct >= (candidate.assetClass === 'crypto' ? 8 : 5) ||
    candidate.relativeVolume >= 3 ||
    liquidity >= 50_000_000 ||
    pulse >= 2.2
  const nearHigh = candidate.distanceFromHighPct <= 0.7 || candidate.status === 'CHECK NOW'

  // Stops were tight enough (0.6-1%) to sit inside the bid/ask noise of thin
  // names, so trades were stopped out on spread alone (one HQ scalp died in 8s).
  // Give each setup real room and scale the targets to keep ~1.5:1 / ~2.4:1 R:R.
  if (reclaimProbe) {
    return { mode: 'turbo-probe', stopPct: 0.009, target1Pct: 0.014, target2Pct: 0.022 }
  }
  if (nearHigh) {
    return { mode: 'breakout-scalp', stopPct: 0.011, target1Pct: 0.017, target2Pct: 0.028 }
  }
  if (liquidMomentum) {
    return { mode: 'momentum-scalp', stopPct: 0.014, target1Pct: 0.021, target2Pct: 0.034 }
  }
  return { mode: 'quick-scalp', stopPct: 0.01, target1Pct: 0.015, target2Pct: 0.024 }
}

function turboTradePlan(candidate: MomentumCandidate, entryPrice?: number): BotTradePlan | null {
  if (!cfg().relaxStatusGate || candidate.price <= 0) return null
  const profile = turboScalpProfile(candidate)
  let trigger = candidate.price
  if (candidate.status === 'CHECK NOW' && candidate.signal.entryTrigger !== null) {
    trigger = Math.max(candidate.price, candidate.signal.entryTrigger)
  }
  if (entryPrice !== undefined && entryPrice > 0) {
    trigger = entryPrice
  }
  if (!Number.isFinite(trigger) || trigger <= 0) return null

  const spreadGuardPct =
    candidate.assetClass === 'stock' ? Math.min(0.012, Math.max(0, (candidate.spreadPct / 100) * 1.6)) : 0
  const target1Pct = Math.max(profile.target1Pct, spreadGuardPct)
  const target2Pct = Math.max(profile.target2Pct, target1Pct * 1.55)
  // Pad the stop on stocks by the live spread so a normal bid/ask wobble can't
  // blow straight through it the instant we enter. Crypto books are tight, so the
  // base profile stop already clears the noise there.
  const stockSpreadCushion =
    candidate.assetClass === 'stock' ? Math.min(0.01, Math.max(0, (candidate.spreadPct / 100) * 1.5)) : 0
  const stopPct = profile.stopPct + stockSpreadCushion
  let stop = trigger * (1 - stopPct)
  // Anchor to VWAP only when it sits BELOW the fixed-distance stop — i.e. use it
  // to give a strong trend a touch more room, never to tighten the stop up into
  // the spread (which is what manufactured the instant stop-outs).
  if (candidate.aboveVwap && candidate.vwap > 0) {
    const vwapStop = candidate.vwap * 0.997
    if (vwapStop < stop && vwapStop >= trigger * (1 - stopPct * 2)) stop = vwapStop
  }
  if (stop >= trigger) stop = trigger * (1 - stopPct)

  return {
    trigger: roundBotPrice(trigger, trigger),
    stop: roundBotPrice(stop, trigger),
    target1: roundBotPrice(trigger * (1 + target1Pct), trigger),
    target2: roundBotPrice(trigger * (1 + target2Pct), trigger),
    mode: profile.mode,
  }
}

// Lift the reversion plan straight from its signal (trigger = reclaim level,
// target1 = VWAP). The reversion scorer already did the structural work, so the
// bot just executes it; no momentum-style scalp profile applies.
function reversionTradePlan(candidate: MomentumCandidate): BotTradePlan | null {
  if (!isReversionCandidate(candidate) || candidate.price <= 0) return null
  const { entryTrigger: trigger, stopLoss: stop, targetOne: target1, targetTwo: target2 } = candidate.signal
  if (trigger === null || stop === null || target1 === null || target2 === null || stop >= trigger) return null
  return { trigger, stop, target1, target2, mode: 'reversion' }
}

function finalizeBotTradePlan(candidate: MomentumCandidate, plan: BotTradePlan | null): BotTradePlan | null {
  if (!plan) return null
  return candidate.assetClass === 'stock' ? capStockPlanRisk(plan) : plan
}

function botTradePlan(candidate: MomentumCandidate, entryPrice?: number): BotTradePlan | null {
  const reversionPlan = reversionTradePlan(candidate)
  if (reversionPlan) return finalizeBotTradePlan(candidate, reversionPlan)
  const turboPlan = turboTradePlan(candidate, entryPrice)
  if (turboPlan) return finalizeBotTradePlan(candidate, turboPlan)

  if (candidate.status === 'CHECK NOW') {
    const trigger = candidate.signal.entryTrigger
    const stop = candidate.signal.stopLoss
    const target1 = candidate.signal.targetOne
    const target2 = candidate.signal.targetTwo
    if (trigger === null || stop === null || target1 === null || target2 === null || stop >= trigger) return null
    return finalizeBotTradePlan(candidate, { trigger, stop, target1, target2, mode: 'breakout' })
  }

  if ((candidate.status !== 'WATCH' && !cfg().relaxStatusGate) || candidate.price <= 0) return null
  if (candidate.vwap <= 0 && !isTurboCryptoProbe(candidate)) return null
  const stopVwapBuffer = candidate.assetClass === 'crypto' ? 0.99 : 0.985
  const stopMaxLossBuffer = candidate.assetClass === 'crypto' ? (candidate.aboveVwap ? 0.975 : 0.985) : 0.965
  let stop =
    candidate.vwap > 0 && candidate.aboveVwap
      ? Math.max(candidate.vwap * stopVwapBuffer, candidate.price * stopMaxLossBuffer)
      : candidate.price * stopMaxLossBuffer
  if (stop >= candidate.price) stop = candidate.price * stopMaxLossBuffer
  stop = roundBotPrice(stop, candidate.price)
  const risk = candidate.price - stop
  if (!Number.isFinite(risk) || risk <= 0) return null
  return finalizeBotTradePlan(candidate, {
    trigger: roundBotPrice(candidate.price, candidate.price),
    stop,
    target1: roundBotPrice(candidate.price + risk * 1.2, candidate.price),
    target2: roundBotPrice(candidate.price + risk * 2, candidate.price),
    mode: candidate.aboveVwap ? 'watch-probe' : 'turbo-probe',
  })
}

function isBotCandidate(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  if (hardDailyRiskPauseReason()) return false
  if (macroBlackoutReason()) return false
  if (candidate.assetClass === 'stock' && !stockMarketOpen) return false
  const resolved = resolveTradableSymbol(candidate)
  if (!resolved) return false
  if (activeNoFillCooldown(normSymbol(resolved.symbol))) return false
  if (symbolRiskBlocker(candidate, resolved.symbol)) return false
  const turboCrypto = isTurboCryptoProbe(candidate)
  const plan = botTradePlan(candidate)
  if (candidate.dataQuality !== 'VERIFIED' || !plan) return false
  if (scannerStatusBlocker(candidate)) return false
  if (!candidate.aboveVwap && !turboCrypto && !isReversionCandidate(candidate)) return false
  if (candidate.score < entryScoreFloor(candidate)) return false
  if (botAutoBlocker(candidate, plan)) return false
  if (cfg().relaxStatusGate) return true // turbo: tradable + verified + pulse/liquidity/price discipline is enough
  if (candidate.status === 'CHECK NOW') return true
  return candidate.status === 'WATCH' && hardBotBlockers(candidate).length === 0
}

function botBlockReason(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  if (botState.draining) return 'wind-down active: new buys paused until current positions close'
  const dailyPause = hardDailyRiskPauseReason()
  if (dailyPause) return dailyPause
  const macroPause = macroBlackoutReason()
  if (macroPause) return macroPause
  if (candidate.assetClass === 'stock' && !stockMarketOpen) return 'stock market is closed'
  const resolved = resolveTradableSymbol(candidate)
  if (!resolved) return tradabilityBlocker(candidate) ?? `not tradable on ${cryptoOnBinance() ? 'Binance testnet' : 'Alpaca paper'}`
  const cooldown = activeNoFillCooldown(normSymbol(resolved.symbol))
  if (cooldown) return noFillCooldownSummary(cooldown)
  const symbolBlock = symbolRiskBlocker(candidate, resolved.symbol)
  if (symbolBlock) return symbolBlock
  if (candidate.dataQuality !== 'VERIFIED') return 'data is not verified'
  const scannerBlock = scannerStatusBlocker(candidate)
  if (scannerBlock) return scannerBlock
  if (!candidate.aboveVwap && !isTurboCryptoProbe(candidate) && !isReversionCandidate(candidate)) return 'below VWAP'
  const plan = botTradePlan(candidate)
  if (!plan) return candidate.blockers[0] ?? 'live refresh invalidated the setup; waiting for the next full scan'
  const scoreFloor = entryScoreFloor(candidate)
  if (candidate.score < scoreFloor) {
    return `score ${candidate.score} below bot floor ${scoreFloor}${nightCryptoActive() && candidate.assetClass === 'crypto' ? ' (night)' : ''}`
  }
  const autoBlock = botAutoBlocker(candidate, plan)
  if (autoBlock) return autoBlock
  const hardBlocker = hardBotBlockers(candidate)[0]
  if (hardBlocker) return hardBlocker
  if (candidate.status !== 'WATCH' && candidate.status !== 'CHECK NOW') return `status ${candidate.status}`
  if (isTriggered(candidate, stockMarketOpen)) return entryConfirmationSummary(resolved)
  return 'waiting for trigger'
}

function botPrice(value: number | null) {
  if (value === null) return 'n/a'
  return `$${value.toFixed(value < 1 ? 6 : value < 10 ? 3 : 2)}`
}

function losingSetupAverage(predicate: (setup: BotTradeSetup) => boolean) {
  const matched = history.filter(
    (entry) => entry.mode === 'turbo' && entry.side === 'sell' && entry.pnl !== null && entry.setup && predicate(entry.setup),
  )
  if (matched.length < 3) return null
  return matched.reduce((total, entry) => total + (entry.pnl ?? 0), 0) / matched.length
}

function strongTurboLearningEscape(candidate: MomentumCandidate, technical: BotTechnicalContext) {
  const pulse = candidate.volumePulse ?? 0
  return (
    candidate.score >= 82 &&
    candidate.aboveVwap &&
    technical.edgeScore >= 90 &&
    pulse >= 3 &&
    candidate.distanceFromHighPct <= 0.45
  )
}

function turboLearningBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  if (!cfg().relaxStatusGate) return null
  const setup = tradeSetupSnapshot(candidate, plan)
  const technical = setup.technical ?? technicalContext(candidate, plan)
  const badBuckets = setupBucketDefs(setup)
    .filter((bucket) => actionableLearningBucket(bucket.key))
    .map((bucket) => setupBucketPerformance(bucket.key))
    .filter((bucket): bucket is BotDiagnosticBucket => bucket !== null && badLearningBucket(bucket))

  if (badBuckets.length === 0) return null
  if (strongTurboLearningEscape(candidate, technical)) return null

  const criticalBucket =
    badBuckets.find((bucket) => bucket.key === 'score-55-69' || bucket.key === 'below-vwap' || bucket.key === 'far-high') ??
    (badBuckets.length >= 2 ? badBuckets.sort((a, b) => a.avgPnl - b.avgPnl)[0] : null)
  if (!criticalBucket) return null

  const lossRate = Math.round((criticalBucket.losses / criticalBucket.trades) * 100)
  return `Turbo learning block: ${criticalBucket.label} is ${lossRate}% losses over ${criticalBucket.trades} trades (${botPrice(criticalBucket.avgPnl)} avg); waiting for a stronger edge`
}

function setupMemoryForPlan(candidate: MomentumCandidate, plan: BotTradePlan): BotSetupMemoryEntry | null {
  const setup = tradeSetupSnapshot(candidate, plan)
  const fingerprint = setupMemoryFingerprint(setup)
  const stored = setupMemory.get(fingerprint.key)
  return stored ? setupMemoryToPublic(stored) : null
}

function badSetupMemory(entry: BotSetupMemoryEntry) {
  if (entry.trades < SETUP_MEMORY_MIN_TRADES) return false
  const lossRate = entry.losses / entry.trades
  return lossRate >= SETUP_MEMORY_BLOCK_LOSS_RATE && entry.netAvgPnl <= SETUP_MEMORY_BLOCK_NET_AVG_PNL
}

function setupMemoryEscape(candidate: MomentumCandidate, technical: BotTechnicalContext) {
  const pulse = candidate.volumePulse ?? 0
  const timeRvol = candidate.sessionVolume?.timeAdjustedRelativeVolume ?? 0
  const stockMicroReady = candidate.assetClass === 'stock' && candidate.microPullback?.state === 'READY' && timeRvol >= 2
  const cryptoPulseReady = candidate.assetClass === 'crypto' && pulse >= 3
  return candidate.score >= 92 && candidate.aboveVwap && technical.edgeScore >= 90 && (stockMicroReady || cryptoPulseReady)
}

function setupMemoryBlocker(candidate: MomentumCandidate, plan: BotTradePlan): string | null {
  const memory = setupMemoryForPlan(candidate, plan)
  if (!memory || !badSetupMemory(memory)) return null
  const technical = technicalContext(candidate, plan)
  if (setupMemoryEscape(candidate, technical)) return null
  const lossRate = Math.round((memory.losses / memory.trades) * 100)
  return `Setup memory block: ${memory.label} is ${lossRate}% losses over ${memory.trades} trades (${botPrice(memory.netAvgPnl)} net avg)`
}

function setupMemorySizeScale(candidate: MomentumCandidate, plan: BotTradePlan | null) {
  if (!plan) return 1
  const memory = setupMemoryForPlan(candidate, plan)
  if (!memory || memory.trades < 3) return 1
  if (memory.netAvgPnl > 0 && (memory.winRate ?? 0) >= 0.5) return 1.05
  if (badSetupMemory(memory)) return 0.45
  if (memory.netAvgPnl < 0) return 0.75
  return 1
}

function turboLearningScale(candidate: MomentumCandidate) {
  if (!cfg().relaxStatusGate) return 1
  let scale = 1
  const technical = technicalContext(candidate)
  const lowScoreAvg = losingSetupAverage((setup) => setup.score < 70)
  if (lowScoreAvg !== null && lowScoreAvg < 0 && candidate.score < 70) scale *= 0.75
  const reclaimAvg = losingSetupAverage((setup) => !setup.aboveVwap)
  if (reclaimAvg !== null && reclaimAvg < 0 && !candidate.aboveVwap) scale *= 0.7
  const weakPulseAvg = losingSetupAverage((setup) => setup.assetClass === 'crypto' && (setup.volumePulse ?? 0) < 1.25)
  if (weakPulseAvg !== null && weakPulseAvg < 0 && candidate.assetClass === 'crypto' && (candidate.volumePulse ?? 0) < 1.25) {
    scale *= 0.75
  }
  const weakStockTimeRvolAvg = losingSetupAverage(
    (setup) => setup.assetClass === 'stock' && (setup.timeAdjustedRelativeVolume ?? 0) < 1.2,
  )
  if (
    weakStockTimeRvolAvg !== null &&
    weakStockTimeRvolAvg < 0 &&
    candidate.assetClass === 'stock' &&
    (candidate.sessionVolume?.timeAdjustedRelativeVolume ?? 0) < 1.2
  ) {
    scale *= 0.7
  }
  const extendedMicroAvg = losingSetupAverage(
    (setup) => setup.assetClass === 'stock' && setup.microPullbackState === 'EXTENDED',
  )
  if (
    extendedMicroAvg !== null &&
    extendedMicroAvg < 0 &&
    candidate.assetClass === 'stock' &&
    candidate.microPullback?.state === 'EXTENDED'
  ) {
    scale *= 0.65
  }
  const weakEdgeAvg = losingSetupAverage((setup) => (setup.technical?.edgeScore ?? 100) < 60)
  if (weakEdgeAvg !== null && weakEdgeAvg < 0 && technical.edgeScore < 60) scale *= 0.65
  return Math.max(0.35, scale)
}

export function stockCapitalizationRiskScale(
  candidate: Pick<MomentumCandidate, 'assetClass' | 'marketCap' | 'estimatedFreeFloat'>,
) {
  if (candidate.assetClass !== 'stock') return 1
  // A low float can gap through a stop even when the quoted spread looks clean.
  // It is the strongest sizing warning and therefore overrides market cap.
  if (candidate.estimatedFreeFloat !== null && candidate.estimatedFreeFloat < 15_000_000) return 0.45
  const band = stockCapBand(candidate)
  if (band === 'micro-small') return candidate.marketCap !== null && candidate.marketCap < 300_000_000 ? 0.5 : 0.65
  if (band === 'mid') return 0.85
  return 1
}

function modeSizeScale(candidate: MomentumCandidate) {
  const scoreScale = cfg().relaxStatusGate
    ? Math.min(1, Math.max(0.45, 0.45 + (candidate.score - cfg().minScore) / 45))
    : Math.min(1.1, Math.max(0.65, 0.65 + (candidate.score - cfg().minScore) / 20))
  const stats = todayStats()
  const lossDrag = stats.losses > stats.wins ? Math.max(0.45, 1 - (stats.losses - stats.wins) * 0.1) : 1
  const liquidityScale = candidateDollarVolume(candidate) >= 50_000_000 ? 1 : 0.75
  const stockStructure = stockExecutionStructure(candidate)
  const stockStructureScale =
    candidate.assetClass === 'stock' && stockStructure !== null && candidate.volumePulse !== null && candidate.volumePulse < 1.05
      ? 0.78
      : 1
  const pulseScale =
    candidate.assetClass === 'crypto' && candidate.volumePulse !== null
      ? candidate.volumePulse >= 2
        ? 1.08
        : candidate.volumePulse >= cfg().cryptoMinVolumePulse
          ? 1
          : 0.65
      : 1
  const maxScale = cfg().relaxStatusGate ? 1 : 1.1
  const plan = botTradePlan(candidate)
  return Math.min(
    maxScale,
    Math.max(
      0.35,
      scoreScale *
        lossDrag *
        liquidityScale *
        pulseScale *
        stockStructureScale *
        stockCapitalizationRiskScale(candidate) *
        setupMemorySizeScale(candidate, plan) *
        turboLearningScale(candidate),
    ),
  )
}

function entryRank(candidate: MomentumCandidate) {
  const normalized = normSymbol(resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate))
  const liquidity = candidateDollarVolume(candidate)
  const technical = technicalContext(candidate)
  const liquidityBonus = liquidity >= 200_000_000 ? 10 : liquidity >= 50_000_000 ? 5 : liquidity >= 10_000_000 ? 2 : 0
  const setupBonus = candidate.aboveVwap ? 4 : 0
  const statusBonus = candidate.status === 'CHECK NOW' ? 8 : candidate.status === 'WATCH' ? 3 : 0
  const pulseBonus =
    candidate.assetClass === 'crypto' && candidate.volumePulse !== null
      ? candidate.volumePulse >= 3
        ? 10
        : candidate.volumePulse >= 2
          ? 7
          : candidate.volumePulse >= cfg().cryptoMinVolumePulse
            ? 3
            : -8
      : 0
  const stockTimeRvol = candidate.assetClass === 'stock' ? candidate.sessionVolume?.timeAdjustedRelativeVolume ?? null : null
  const stockStructure = stockExecutionStructure(candidate)
  const stockStructureBonus =
    stockStructure === 'orb-breakout' ? 9 : stockStructure === 'vwap-reclaim' ? 7 : stockStructure === 'pinned-breakout' ? 5 : 0
  const stockVolumeBonus =
    stockTimeRvol !== null
      ? stockTimeRvol >= 3
        ? 8
        : stockTimeRvol >= 1.5
          ? 4
          : stockTimeRvol < 1
            ? -8
            : 0
      : 0
  const microBonus =
    candidate.assetClass === 'stock'
      ? candidate.microPullback?.state === 'READY'
        ? 8
        : candidate.microPullback?.state === 'FORMING'
          ? -6
          : candidate.microPullback?.state === 'EXTENDED' || candidate.microPullback?.state === 'FAILED'
            ? -12
            : 0
      : 0
  // Distance-from-high and below-VWAP are momentum penalties; they are
  // meaningless for reversion (which is far from the high and below VWAP by
  // design), so zero them out for reversion candidates.
  const reversion = isReversionCandidate(candidate)
  const distancePenalty = reversion ? 0 : Math.min(12, Math.max(0, candidate.distanceFromHighPct - 0.5) * 1.5)
  const spreadPenalty = candidate.assetClass === 'stock' ? Math.min(10, candidate.spreadPct * 2) : 0
  const vwapPenalty = reversion ? 0 : candidate.aboveVwap ? 0 : 6
  const recentPenalty = symbolTodayEntries(normalized) * 18 + symbolTodayLosses(normalized) * 35
  // Stocks-first: while the US session is open the bot leads with stocks, leaving
  // crypto to fill only the slots no stock setup wants. Crypto stays the overnight
  // engine (this bonus is 0 when the session is closed).
  const stocksFirstBonus = stockSessionOpenNow && candidate.assetClass === 'stock' ? 30 : 0
  return (
    candidate.score +
    stocksFirstBonus +
    liquidityBonus +
    setupBonus +
    statusBonus +
    pulseBonus +
    stockVolumeBonus +
    stockStructureBonus +
    microBonus +
    (technical.edgeScore - 50) / 3 +
    Math.min(8, Math.max(0, candidate.changePct / 2)) -
    distancePenalty -
    spreadPenalty -
    vwapPenalty -
    recentPenalty
  )
}

// Keep a bounded set of high-quality near misses warm between full one-minute
// scans. A candidate that is IGNORE now can become WATCH/CHECK NOW after a fresh
// quote, volume bar, or pullback reclaim; previously it was not refreshed at all
// until the next full scan, so short valid windows were easy to miss. These rows
// remain subject to every normal scanner and execution gate and are never made
// buyable merely by entering this observation pool.
export function selectBotObservationCandidates(
  candidates: MomentumCandidate[],
  assetClass: AssetClass,
  limit = BOT_OBSERVATION_LIMIT_PER_ASSET,
) {
  const nearScoreFloor = Math.max(MOMENTUM_RULES.watchScore, cfg().minScore - BOT_OBSERVATION_SCORE_MARGIN)
  const statusRank: Record<MomentumCandidate['status'], number> = {
    'CHECK NOW': 3,
    WATCH: 2,
    IGNORE: 1,
    'DATA ERROR': 0,
  }
  return candidates
    .filter((candidate) => candidate.assetClass === assetClass)
    .filter((candidate) => candidate.price > 0 && candidate.dataQuality === 'VERIFIED' && candidate.status !== 'DATA ERROR')
    .filter(
      (candidate) =>
        candidate.status === 'WATCH' ||
        candidate.status === 'CHECK NOW' ||
        candidate.score >= nearScoreFloor ||
        (candidate.strategy === 'reversion' && candidate.score >= REVERSION_MIN_SCORE),
    )
    .filter(
      (candidate) =>
        candidate.assetClass !== 'stock' ||
        (candidate.marketStatus !== 'CLOSED' && candidate.marketStatus !== 'WEEKEND'),
    )
    .sort(
      (left, right) =>
        statusRank[right.status] - statusRank[left.status] ||
        Number(right.spreadAvailable !== false) - Number(left.spreadAvailable !== false) ||
        Number(!right.tradingHalted) - Number(!left.tradingHalted) ||
        entryRank(right) - entryRank(left),
    )
    .slice(0, Math.max(0, limit))
}

type AllocationOpportunity = {
  symbol: string
  candidate: MomentumCandidate
  rank: number
  triggered: boolean
  armed: boolean
}

type AllocationContext = {
  opportunities: AllocationOpportunity[]
}

type BudgetDecision = {
  amount: number
  desiredAmount: number
  reserveCash: number
  reason: string
}

function isNearAllocationOpportunity(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  if (!isBotCandidate(candidate, stockMarketOpen)) return false
  const trigger = botTriggerPrice(candidate)
  if (trigger === null || candidate.price <= 0) return false
  if (isTriggered(candidate, stockMarketOpen) || isArmed(candidate, stockMarketOpen)) return true
  const distanceToTriggerPct = ((trigger - candidate.price) / candidate.price) * 100
  return distanceToTriggerPct >= 0 && distanceToTriggerPct <= (candidate.assetClass === 'crypto' ? 1.2 : 0.8)
}

function buildAllocationContext(
  shortlist: MomentumCandidate[],
  heldOrPending: Set<string>,
  stockMarketOpen: boolean,
): AllocationContext {
  const opportunities = shortlist
    .map((candidate): AllocationOpportunity | null => {
      const resolved = resolveTradableSymbol(candidate)
      if (!resolved) return null
      const symbol = normSymbol(resolved.symbol)
      if (heldOrPending.has(symbol) || activeNoFillCooldown(symbol)) return null
      if (!isNearAllocationOpportunity(candidate, stockMarketOpen)) return null
      return {
        symbol,
        candidate,
        rank: entryRank(candidate),
        triggered: isTriggered(candidate, stockMarketOpen),
        armed: isArmed(candidate, stockMarketOpen),
      }
    })
    .filter((entry): entry is AllocationOpportunity => entry !== null)
    .sort((a, b) => b.rank - a.rank)
  return { opportunities }
}

function allocationPressure(candidate: MomentumCandidate, resolved: ResolvedSymbol, context: AllocationContext) {
  const symbol = normSymbol(resolved.symbol)
  const currentRank = entryRank(candidate)
  const competing = context.opportunities.filter(
    (opportunity) => opportunity.symbol !== symbol && opportunity.rank >= currentRank - 10,
  )
  const veryNear = competing.filter((opportunity) => opportunity.triggered || opportunity.armed)
  return { currentRank, competing, veryNear }
}

function dynamicPaperSizingScale(candidate: MomentumCandidate, resolved: ResolvedSymbol, context: AllocationContext) {
  const { competing, veryNear } = allocationPressure(candidate, resolved, context)
  const technical = technicalContext(candidate)
  const lonelyScale = veryNear.length === 0 ? 1.8 : veryNear.length === 1 ? 1.35 : 1
  const scoreScale = candidate.score >= 90 ? 1.25 : candidate.score >= 82 ? 1.12 : candidate.score >= 72 ? 1 : 0.82
  const edgeScale = technical.edgeScore >= 90 ? 1.16 : technical.edgeScore >= 78 ? 1.08 : technical.edgeScore < 60 ? 0.78 : 1
  const statusScale = candidate.status === 'CHECK NOW' ? 1.18 : candidate.status === 'WATCH' ? 1.05 : 0.92
  const crowdPenalty = competing.length >= 3 ? 0.82 : competing.length === 2 ? 0.92 : 1
  return clamp(lonelyScale * scoreScale * edgeScale * statusScale * crowdPenalty, 0.55, 2.25)
}

function reserveCashForCompetingSetups(
  account: BotAccount,
  candidate: MomentumCandidate,
  resolved: ResolvedSymbol,
  context: AllocationContext,
) {
  if (!isPaperTradingBase()) return 0
  const equity = Math.max(0, account.equity || account.cash)
  const { veryNear } = allocationPressure(candidate, resolved, context)
  if (veryNear.length === 0) return Math.max(0, equity * PAPER_MIN_CASH_RESERVE_PCT)
  const reservePerSetup = Math.max(MIN_NOTIONAL, equity * 0.11)
  return Math.min(equity * 0.48, veryNear.length * reservePerSetup)
}

function plannedRiskPct(plan: BotTradePlan, candidate: MomentumCandidate) {
  if (plan.trigger <= 0 || plan.stop <= 0 || plan.stop >= plan.trigger) return 0
  const stopRiskPct = (plan.trigger - plan.stop) / plan.trigger
  const spreadRiskPct = candidate.spreadPct > 0 ? (candidate.spreadPct / 100) * 2 : 0
  return Math.max(stopRiskPct, spreadRiskPct, 0.002)
}

function openPortfolioRiskDollars(positions: BotPosition[]) {
  return positions.reduce((total, position) => {
    const meta = tracked.get(normSymbol(position.symbol))
    if (!meta || position.currentPrice <= 0 || position.marketValue <= 0) return total
    const riskPct = Math.max(0, (position.currentPrice - meta.stop) / position.currentPrice)
    return total + position.marketValue * riskPct
  }, 0)
}

function positionBudgetDecision(
  account: BotAccount,
  resolved: ResolvedSymbol,
  availableBuyingPower: number,
  candidate: MomentumCandidate,
  plan: BotTradePlan,
  positions: BotPosition[],
  allocation: AllocationContext,
): BudgetDecision {
  const maxNotional = maxNotionalForExecution(resolved.assetClass)
  const minNotional = minNotionalForExecution()
  const equity = Math.max(0, account.equity || account.cash)
  const allocationScale = isPaperTradingBase() ? dynamicPaperSizingScale(candidate, resolved, allocation) : 1
  const cashBudget = equity * cfg().positionFraction * cfg().sizeMultiplier * allocationScale
  const riskPct = plannedRiskPct(plan, candidate)
  const riskDollars = equity * cfg().riskPerTradePct * cfg().sizeMultiplier * modeSizeScale(candidate)
  const riskSizedBudget = riskPct > 0 ? riskDollars / riskPct : 0
  const remainingPortfolioRisk = Math.max(0, equity * cfg().maxPortfolioRiskPct - openPortfolioRiskDollars(positions))
  const portfolioRiskBudget = riskPct > 0 ? remainingPortfolioRisk / riskPct : 0
  const reserveCash = reserveCashForCompetingSetups(account, candidate, resolved, allocation)
  const usableBuyingPower = Math.max(0, availableBuyingPower - reserveCash)
  const { veryNear } = allocationPressure(candidate, resolved, allocation)
  const equityCapPct = isPaperTradingBase()
    ? veryNear.length === 0
      ? PAPER_MAX_STRONG_POSITION_PCT
      : PAPER_MAX_CROWDED_POSITION_PCT
    : 1
  const equityCap = equity > 0 ? equity * equityCapPct : maxNotional
  const brokerBuyingPower =
    resolved.venue === 'binance'
      ? Math.max(0, account.cash)
      : isPaperTradingBase()
      ? Math.max(0, account.cash)
      : resolved.assetClass === 'crypto'
        ? Math.max(0, account.nonMarginableBuyingPower || account.cash)
        : Math.max(0, account.buyingPower || account.cash)
  const buyingPower = Math.min(Math.max(0, usableBuyingPower), brokerBuyingPower)
  const parts = (
    isPaperTradingBase()
      ? [
          { key: veryNear.length === 0 ? 'opportunity-sized allocation' : 'reserved-cash allocation', amount: cashBudget },
          { key: 'risk-sized cap', amount: riskSizedBudget },
          { key: 'portfolio risk budget', amount: portfolioRiskBudget },
          { key: resolved.venue === 'binance' ? 'Binance equity cap' : 'paper equity cap', amount: equityCap },
          { key: 'per-position cap', amount: maxNotional },
          {
            key:
              resolved.venue === 'binance'
                ? reserveCash > 0
                  ? `Binance USDT left after ${botPrice(reserveCash)} reserve`
                  : 'Binance USDT left'
                : reserveCash > 0
                  ? `paper cash left after ${botPrice(reserveCash)} reserve`
                  : 'paper cash left',
            amount: buyingPower,
          },
        ]
      : [
          { key: 'cash allocation', amount: cashBudget },
          { key: 'per-trade risk', amount: riskSizedBudget },
          { key: 'portfolio risk budget', amount: portfolioRiskBudget },
          { key: 'per-position cap', amount: maxNotional },
          { key: resolved.venue === 'binance' ? 'Binance USDT buying power' : resolved.assetClass === 'crypto' ? 'crypto buying power' : 'broker buying power', amount: buyingPower },
        ]
  ).sort((a, b) => a.amount - b.amount)
  const limit = parts[0]
  const amount = Math.max(0, limit.amount)
  const desiredLimits = [cashBudget, equityCap, maxNotional]
  if (riskSizedBudget > 0) desiredLimits.push(riskSizedBudget)
  if (portfolioRiskBudget > 0) desiredLimits.push(portfolioRiskBudget)
  else desiredLimits.push(0)
  const desiredAmount = Math.max(0, Math.min(...desiredLimits))
  const capRiskScale = stockCapitalizationRiskScale(candidate)
  const capRiskNote =
    resolved.assetClass === 'stock' && capRiskScale < 1
      ? `; ${stockCapBand(candidate)} risk size ${Math.round(capRiskScale * 100)}%`
      : ''
  const reason =
    amount < minNotional
      ? `${limit.key} blocks new ${resolved.assetClass} entry (${botPrice(amount)} budget; risk ${Math.round(riskPct * 10_000) / 100}%)${capRiskNote}`
      : `${limit.key} sized entry at ${botPrice(amount)}${reserveCash > 0 ? `; reserve ${botPrice(reserveCash)} for ${veryNear.length} near setup(s)` : ''}${capRiskNote}`
  return { amount, desiredAmount, reserveCash, reason }
}

function shouldFreeCashForOpportunity(candidate: MomentumCandidate, decision: BudgetDecision, buyableIndex: number) {
  if (!isPaperTradingBase()) return false
  if (buyableIndex > 0) return false
  if (decision.desiredAmount < MIN_NOTIONAL) return false
  const technical = technicalContext(candidate)
  const strong =
    candidate.status === 'CHECK NOW' ||
    candidate.score >= 82 ||
    technical.edgeScore >= 84 ||
    (candidate.assetClass === 'crypto' && (candidate.volumePulse ?? 0) >= 2)
  if (!strong) return false
  return decision.amount < MIN_NOTIONAL || decision.amount < decision.desiredAmount * 0.55
}

function profitR(position: BotPosition, meta: TrackedEntry | undefined) {
  if (!meta || meta.initialRisk <= 0) return 0
  return (position.currentPrice - meta.entry) / meta.initialRisk
}

function trimCandidateForCash(
  position: BotPosition,
  incoming: MomentumCandidate,
  candidateMap: Map<string, MomentumCandidate>,
  stockMarketOpen: boolean,
) {
  const normalized = normSymbol(position.symbol)
  if (isPendingExit(normalized) || position.qty <= 0 || position.currentPrice <= 0 || position.marketValue <= MIN_NOTIONAL * 1.4) {
    return null
  }
  if (position.assetClass === 'stock' && !stockMarketOpen) return null
  if (position.unrealizedPl <= 0 || position.unrealizedPlPct < PROFIT_TRIM_MIN_PCT) return null

  const meta = tracked.get(normalized)
  const heldCandidate = candidateMap.get(normalized)
  const heldRank = heldCandidate ? entryRank(heldCandidate) : 0
  const incomingRank = entryRank(incoming)
  const r = profitR(position, meta)
  const targetTagged = Boolean(meta?.target1Hit) || (meta !== undefined && position.currentPrice >= meta.target1)
  const incomingClearlyBetter = incomingRank >= heldRank + 10
  if (!targetTagged && r < 0.65 && !incomingClearlyBetter) return null

  const trimFraction = targetTagged ? 0.4 : r >= 1 ? 0.32 : 0.22
  const maxTrimNotional = Math.max(0, position.marketValue - MIN_NOTIONAL)
  const trimNotional = Math.min(maxTrimNotional, position.marketValue * trimFraction)
  if (trimNotional < PROFIT_TRIM_MIN_NOTIONAL) return null
  return {
    position,
    trimNotional,
    rankSpread: incomingRank - heldRank,
    targetTagged,
    profitR: r,
  }
}

async function trimProfitsForOpportunity({
  incoming,
  positions,
  candidateMap,
  stockMarketOpen,
  neededCash,
}: {
  incoming: MomentumCandidate
  positions: BotPosition[]
  candidateMap: Map<string, MomentumCandidate>
  stockMarketOpen: boolean
  neededCash: number
}) {
  if (neededCash < PROFIT_TRIM_MIN_NOTIONAL) return false
  const trims = positions
    .map((position) => trimCandidateForCash(position, incoming, candidateMap, stockMarketOpen))
    .filter((trim): trim is NonNullable<ReturnType<typeof trimCandidateForCash>> => trim !== null)
    .sort((a, b) => {
      if (a.targetTagged !== b.targetTagged) return a.targetTagged ? -1 : 1
      return b.rankSpread - a.rankSpread || b.profitR - a.profitR
    })

  let requested = 0
  for (const trim of trims) {
    if (requested >= neededCash) break
    const notional = Math.min(trim.trimNotional, (neededCash - requested) * 1.15)
    if (notional < PROFIT_TRIM_MIN_NOTIONAL) continue
    const qty = notional / trim.position.currentPrice
    const reason = `profit trim to fund stronger ${botDisplaySymbol(incoming)} setup`
    try {
      const submitted = await submitPartialClose(trim.position, qty, reason)
      if (submitted) {
        requested += notional
        pushLog(
          'info',
          trim.position.symbol,
          `Trimming about ${botPrice(notional)} of profit-side exposure so ${botDisplaySymbol(incoming)} can size up on the next tick`,
        )
      }
    } catch (error) {
      pushLog('error', trim.position.symbol, `Profit trim failed: ${message(error)}`)
    }
  }
  return requested > 0
}

function pushTickStatus(
  shortlist: MomentumCandidate[],
  buyable: MomentumCandidate[],
  positions: BotPosition[],
  stockMarketOpen: boolean,
) {
  if (botState.draining) {
    pushStatusLog(
      '-',
      positions.length > 0
        ? `Wind-down active: managing ${positions.length} open position(s); new buys are paused`
        : 'Wind-down active: waiting for open orders to settle; new buys are paused',
    )
    return
  }

  const macroPause = macroBlackoutReason()
  if (macroPause) {
    pushStatusLog('-', macroPause)
    return
  }

  if (shortlist.length === 0) {
    pushStatusLog('-', 'Scanned: no shortlist rows yet; waiting for cleaner market data')
    return
  }

  const dailyPause = hardDailyRiskPauseReason()
  if (dailyPause) {
    pushStatusLog('-', dailyPause)
    return
  }

  if (!hasOpenPositionCapacity(positions)) {
    const top = positions[0]
    pushStatusLog(
      top?.displaySymbol ?? '-',
      `Holding ${positions.length}/${cfg().maxPositions} live bot slot(s); waiting for a close before adding more diversity`,
    )
    return
  }

  const held = new Set(positions.map((position) => normSymbol(position.symbol)))
  const botReady = shortlist.filter(
    (candidate) =>
      isBotCandidate(candidate, stockMarketOpen) &&
      !held.has(normSymbol(resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate))),
  )
  if (buyable.length > 0) {
    const top = buyable[0]
    const symbol = botDisplaySymbol(top)
    pushStatusLog(
      symbol,
      `Triggered ${buyable.length} setup(s); waiting on execution gates: open slot, venue cash/buying power, tradability, duplicate-position check, then order accept/fill`,
    )
    return
  }

  if (botReady.length > 0) {
    const top = [...botReady].sort((a, b) => b.score - a.score)[0]
    const trigger = botTriggerPrice(top)
    const symbol = botDisplaySymbol(top)
    pushStatusLog(
      symbol,
      `Armed ${botReady.length} setup(s); ${symbol} score ${top.score} is waiting for ${botPrice(trigger)}`,
    )
    return
  }

  const top = [...shortlist].sort((a, b) => b.score - a.score)[0]
  const symbol = botDisplaySymbol(top)
  pushStatusLog(
    symbol,
    `Scanned ${shortlist.length} row(s), holding ${positions.length}; top ${symbol} blocked: ${botBlockReason(top, stockMarketOpen)}`,
  )
}

function isArmed(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  return (
    isBotCandidate(candidate, stockMarketOpen) &&
    botTriggerPrice(candidate) !== null &&
    candidate.price < (botTriggerPrice(candidate) as number)
  )
}

function isTriggered(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  const trigger = botTriggerPrice(candidate)
  return isBotCandidate(candidate, stockMarketOpen) && trigger !== null && candidate.price >= trigger
}

function passesEntryGate(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  const resolved = resolveTradableSymbol(candidate)
  const plan = botTradePlan(candidate)
  if (!resolved || !plan) return false
  return (
    isTriggered(candidate, stockMarketOpen) &&
    (candidate.aboveVwap || isTurboCryptoProbe(candidate) || isReversionCandidate(candidate)) &&
    botAutoBlocker(candidate, plan) === null &&
    entryConfirmationReady(candidate, resolved, plan)
  )
}

// Snapshot of everything the bot is weighing this tick: what it holds, what is
// triggered/armed, and why the rest is blocked. Surfaced in the UI so you can
// see what it is "looking at and thinking about" in real time.
function buildBotWatch(
  shortlist: MomentumCandidate[],
  heldPositionBySymbol: Map<string, BotPosition>,
  openOrderBySymbol: Map<string, BotOrder>,
  stockMarketOpen: boolean,
  slotsAvailable: number,
): BotWatchEntry[] {
  const stateRank: Record<BotWatchEntry['state'], number> = { holding: 0, triggered: 1, armed: 2, blocked: 3, cooldown: 4 }
  const rows = shortlist
    .map((candidate): BotWatchEntry => {
      const trigger = botTriggerPrice(candidate)
      const plan = botTradePlan(candidate)
      const technical = technicalContext(candidate, plan)
      const resolved = resolveTradableSymbol(candidate)
      const displaySymbol = resolved?.symbol ?? candidate.displaySymbol
      let state: BotWatchEntry['state']
      let note: string
      let waitingFor: string
      let nextCheck: string
      const normalized = normSymbol(resolved?.symbol ?? alpacaSymbolFor(candidate))
      const openOrder = openOrderBySymbol.get(normalized)
      const cooldown = activeNoFillCooldown(normalized)
      const tradeCooldown = activeTradeCooldown(normalized)
      const dailyPause = hardDailyRiskPauseReason()
      const heldPosition = heldPositionBySymbol.get(normalized)
      const heldMeta = tracked.get(normalized)
      const reversion = isReversionCandidate(candidate)
      if (heldPosition) {
        state = 'holding'
        waitingFor = 'Managing open position'
        nextCheck = `Live P/L ${botPrice(heldPosition.unrealizedPl)} (${heldPosition.unrealizedPlPct.toFixed(2)}%); watching stop, first target, and second target.`
        note = 'holding - managing stop and targets'
      } else if (openOrder) {
        state = 'triggered'
        waitingFor = `${openOrder.symbol} order to fill`
        nextCheck = `${executionLabel(openOrder.venue)} order is ${orderStatus(openOrder) || 'open'} and ${formatAgeMs(orderAgeMs(openOrder))} old; bot cancels and retries after ${Math.round(PENDING_TTL_MS / 1000)}s if still unfilled.`
        note = `open ${executionLabel(openOrder.venue)} order ${orderStatus(openOrder) || 'open'} - waiting for fill`
      } else if (dailyPause) {
        state = 'cooldown'
        waitingFor = 'Daily risk warning'
        nextCheck = dailyPause
        note = nextCheck
      } else if (tradeCooldown) {
        state = 'cooldown'
        waitingFor = 'Trade cooldown'
        nextCheck = cooldownSummary(tradeCooldown)
        note = nextCheck
      } else if (cooldown) {
        state = 'cooldown'
        waitingFor = 'Broker fill cooldown'
        nextCheck = noFillCooldownSummary(cooldown)
        note = nextCheck
      } else if ((isTriggered(candidate, stockMarketOpen) || isArmed(candidate, stockMarketOpen)) && slotsAvailable <= 0) {
        state = 'blocked'
        waitingFor = 'Open bot slot'
        nextCheck = isPaperTradingBase()
          ? 'Paper mode is cash-driven; this row will be considered when cash and entry gates line up.'
          : `Already holding ${cfg().maxPositions}/${cfg().maxPositions} live-guarded positions; bot will add another symbol after one closes.`
        note = nextCheck
      } else if (isTriggered(candidate, stockMarketOpen)) {
        state = 'triggered'
        waitingFor = reversion ? 'VWAP reclaim execution checks' : 'Execution checks'
        nextCheck =
          isPaperTradingBase()
            ? 'Checking venue cash left, tradability, no duplicate holding, then order accept/fill.'
            : 'Checking open slot, cash/buying power, tradability, no duplicate holding, then order accept/fill.'
        note = reversion
          ? `reversion reclaim triggered at ${botPrice(candidate.price)} - waiting on execution checks`
          : `triggered at ${botPrice(candidate.price)} - waiting on execution checks`
      } else if (isArmed(candidate, stockMarketOpen)) {
        state = 'armed'
        waitingFor = reversion ? `VWAP reclaim trigger ${botPrice(trigger)}` : `Price to reach ${botPrice(trigger)}`
        nextCheck = reversion
          ? `Current price is ${botPrice(candidate.price)}; this is a mean-reversion setup, so below-VWAP is expected until reclaim.`
          : `Current price is ${botPrice(candidate.price)}; bot re-checks this trigger on the next tick.`
        note = reversion ? `reversion armed - waiting for reclaim ${botPrice(trigger)}` : `armed - waiting for ${botPrice(trigger)}`
      } else {
        state = 'blocked'
        waitingFor = 'Blocked gate to clear'
        nextCheck = botBlockReason(candidate, stockMarketOpen)
        note = nextCheck
      }
      const watchPlan =
        state === 'holding' && heldPosition && heldMeta
          ? {
              buy: heldPosition.avgEntry || heldPosition.currentPrice || candidate.price,
              stop: heldMeta.stop,
              target1: heldMeta.target1,
              target2: heldMeta.target2,
            }
          : state === 'triggered' && plan
            ? {
                buy: plan.trigger,
                stop: plan.stop,
                target1: plan.target1,
                target2: plan.target2,
              }
            : null
      return {
        symbol: displaySymbol,
        assetClass: candidate.assetClass,
        strategy: candidate.strategy ?? 'momentum',
        score: candidate.score,
        scoreFloor: entryScoreFloor(candidate),
        status: candidate.status,
        price: candidate.price,
        trigger,
        state,
        note,
        waitingFor,
        nextCheck,
        tradePlan: watchPlan,
        technical,
        holding: heldPosition
          ? {
              qty: heldPosition.qty,
              marketValue: heldPosition.marketValue,
              unrealizedPl: heldPosition.unrealizedPl,
              unrealizedPlPct: heldPosition.unrealizedPlPct,
            }
          : null,
      }
    })
    .sort((a, b) => stateRank[a.state] - stateRank[b.state] || b.score - a.score)
  const hasPrimaryRow = rows.some((row) => row.state === 'holding' || row.state === 'triggered' || row.state === 'armed')
  return rows
    .filter((row) => !hasPrimaryRow || row.state !== 'cooldown')
    .slice(0, 12)
}

function writeDecisionAudit(rows: BotWatchEntry[], stockMarketOpen: boolean, slotsAvailable: number) {
  const now = Date.now()
  const recordedAt = new Date(now).toISOString()
  for (const row of rows) {
    const key = `${botMode}:${row.assetClass}:${normSymbol(row.symbol)}`
    const signature = JSON.stringify({
      state: row.state,
      status: row.status,
      score: row.score,
      scoreFloor: row.scoreFloor,
      price: row.price,
      trigger: row.trigger,
      note: row.note,
      waitingFor: row.waitingFor,
      nextCheck: row.nextCheck,
      plan: row.tradePlan,
      holding: row.holding,
    })
    const cached = decisionAuditCache.get(key)
    if (cached && cached.signature === signature && now - cached.lastWrittenAt < DECISION_AUDIT_HEARTBEAT_MS) continue

    const record = {
      schemaVersion: 1,
      recordedAt,
      mode: botMode,
      modeLabel: cfg().label,
      stockMarketOpen,
      slotsAvailable,
      symbol: row.symbol,
      assetClass: row.assetClass,
      strategy: row.strategy,
      score: row.score,
      scoreFloor: row.scoreFloor,
      status: row.status,
      state: row.state,
      price: row.price,
      trigger: row.trigger,
      note: row.note,
      waitingFor: row.waitingFor,
      nextCheck: row.nextCheck,
      tradePlan: row.tradePlan,
      technical: row.technical,
      holding: row.holding,
    }
    appendFileSync(DECISION_AUDIT_FILE, `${JSON.stringify(record)}\n`, 'utf8')
    decisionAuditCache.set(key, { signature, lastWrittenAt: now })
  }
}

function withBotMode<T>(mode: BotMode, fn: () => T): T {
  const previous = botMode
  botMode = mode
  try {
    return fn()
  } finally {
    botMode = previous
  }
}

function triggeredWithoutConfirmation(candidate: MomentumCandidate, stockMarketOpen: boolean) {
  const resolved = resolveTradableSymbol(candidate)
  const plan = botTradePlan(candidate)
  if (!resolved || !plan) return false
  return (
    isTriggered(candidate, stockMarketOpen) &&
    (candidate.aboveVwap || isTurboCryptoProbe(candidate)) &&
    botAutoBlocker(candidate, plan) === null
  )
}

function buildModeComparisons(
  shortlist: MomentumCandidate[],
  positions: BotPosition[],
  openOrders: BotOrder[],
  stockMarketOpen: boolean,
): BotModeComparison[] {
  const heldOrPending = new Set<string>(positions.map((position) => normSymbol(position.symbol)))
  for (const order of openOrders) heldOrPending.add(normSymbol(order.symbol))
  for (const key of pendingEntries.keys()) heldOrPending.add(key)

  return (['safe', 'active', 'turbo'] as const).map((mode) =>
    withBotMode(mode, () => {
      const modeConfig = cfg()
      const rows = shortlist
        .map((candidate) => {
          const resolved = resolveTradableSymbol(candidate)
          const normalized = normSymbol(resolved?.symbol ?? alpacaSymbolFor(candidate))
          const plan = botTradePlan(candidate)
          const technical = technicalContext(candidate, plan)
          const holding = heldOrPending.has(normalized)
          const ready = !holding && triggeredWithoutConfirmation(candidate, stockMarketOpen)
          const armed = !holding && !ready && isArmed(candidate, stockMarketOpen)
          const state: BotModeComparisonTopState = holding ? 'holding' : ready ? 'ready' : armed ? 'armed' : 'blocked'
          const reason = holding
            ? 'already held or pending in the execution bot'
            : ready
              ? 'would enter after confirmation hold'
              : armed
                ? `armed near ${botPrice(botTriggerPrice(candidate))}`
                : botBlockReason(candidate, stockMarketOpen)
          return {
            candidate,
            state,
            reason,
            technical,
            rank: entryRank(candidate),
          }
        })
        .sort((a, b) => {
          const stateRank: Record<BotModeComparisonTopState, number> = { ready: 0, armed: 1, blocked: 2, holding: 3 }
          return stateRank[a.state] - stateRank[b.state] || b.rank - a.rank
        })

      const top = rows[0]
      return {
        mode,
        label: modeConfig.label,
        riskLabel: modeConfig.riskLabel,
        minScore: modeConfig.minScore,
        maxPositions: isPaperTradingBase() ? 0 : modeConfig.maxPositions,
        sizeMultiplier: modeConfig.sizeMultiplier,
        ready: rows.filter((row) => row.state === 'ready').length,
        armed: rows.filter((row) => row.state === 'armed').length,
        blocked: rows.filter((row) => row.state === 'blocked').length,
        top: top
          ? {
              symbol: resolveTradableSymbol(top.candidate)?.symbol ?? top.candidate.displaySymbol,
              assetClass: top.candidate.assetClass,
              score: top.candidate.score,
              price: top.candidate.price,
              state: top.state,
              reason: top.reason,
              technical: top.technical,
            }
          : null,
        diagnostics: diagnoseMode(mode),
      }
    }),
  )
}

// Full-universe discovery can legitimately take longer than the 10-second risk
// loop when a market-data source is slow. Refresh it in the background and keep
// the last clean snapshot in service so broker reconciliation, exits, account
// refreshes, and already-observed confirmations never wait on discovery I/O.
function scheduleMomentumSnapshotRefresh() {
  if (snapshotRefreshInFlight) return
  const now = Date.now()
  if (now - snapshotRefreshAttemptAt < SNAPSHOT_TTL_MS) return
  snapshotRefreshAttemptAt = now
  snapshotRefreshInFlight = buildMomentumSnapshot(new Date(), { includeCrypto: false })
    .then((snapshot) => {
      cachedSnapshot = snapshot
      cachedSnapshotAt = Date.now()
    })
    .catch((error) => {
      pushStatusLog('-', `Signal discovery refresh failed: ${message(error)}; keeping the last clean snapshot`)
    })
    .finally(() => {
      snapshotRefreshAttemptAt = Date.now()
      snapshotRefreshInFlight = null
    })
}

function scheduleBotCryptoRefresh() {
  if (botCryptoRefreshInFlight) return
  const refreshMode = botMode
  const modeChanged = cachedBotCryptoMode !== refreshMode
  const now = Date.now()
  if (!modeChanged && now - botCryptoRefreshAttemptAt < SNAPSHOT_TTL_MS) return
  botCryptoRefreshAttemptAt = now
  const mode = BOT_MODES[refreshMode]
  const baseAllowlist = botCryptoUniverse()
  botCryptoRefreshInFlight = buildScoredCryptoCandidates({
    baseAllowlist,
    minQuoteVolume: mode.cryptoMinQuoteVolume,
    minChangePct: mode.relaxStatusGate ? -1 : 0,
    limit: mode.cryptoLimit,
  })
    .then((candidates) => {
      if (botMode !== refreshMode) return
      cachedBotCrypto = candidates
      cachedBotCryptoMode = refreshMode
      cachedBotCryptoAt = Date.now()
    })
    .catch((error) => {
      pushStatusLog('-', `Crypto discovery refresh failed: ${message(error)}; keeping the last clean universe`)
    })
    .finally(() => {
      botCryptoRefreshAttemptAt = Date.now()
      botCryptoRefreshInFlight = null
    })
}

// ---- the tick -------------------------------------------------------------
async function tick() {
  if (!botState.running) return
  if (tickRunning) {
    const now = Date.now()
    if (now - lastOverlapLogAt > 60_000) {
      lastOverlapLogAt = now
      serverLog('tick', '-', 'previous tick still running; skipping this interval to avoid overlap')
    }
    return
  }
  const configBlock = configurationBlocker()
  if (configBlock) {
    botState.lastError = configBlock
    return
  }
  const liveBlock = liveTradingBlocker()
  if (liveBlock) {
    botState.lastError = liveBlock
    pushStatusLog('-', liveBlock)
    botState.lastTickAt = new Date().toISOString()
    return
  }
  const backoff = alpacaBackoffReason()
  if (backoff) {
    botState.lastError = backoff
    pushStatusLog('-', backoff)
    botState.lastTickAt = new Date().toISOString()
    return
  }

  tickRunning = true
  try {
    // Need the live Alpaca asset set before scoping Alpaca crypto. Binance mode
    // scans Binance directly and does not use Alpaca's crypto asset list. Skipped
    // entirely when crypto is disabled (stocks-only).
    if (cryptoEnabled() && !cryptoOnBinance()) await loadCryptoAssets()

    const snapshotExpired = !cachedSnapshot || Date.now() - cachedSnapshotAt > SNAPSHOT_TTL_MS
    if (snapshotExpired) {
      // The execution bot builds its own Alpaca/Binance-scoped crypto universe.
      // Keep both discovery paths off the critical risk-management loop.
      scheduleMomentumSnapshotRefresh()
    }
    const botCryptoExpired = Date.now() - cachedBotCryptoAt > SNAPSHOT_TTL_MS
    if (cryptoEnabled() && (botCryptoExpired || cachedBotCryptoMode !== botMode)) {
      // Turbo is an execution lab, so keep mildly red tradable majors visible
      // instead of making BTC/ETH disappear when their 24h move dips below 0%.
      scheduleBotCryptoRefresh()
    } else if (!cryptoEnabled()) {
      cachedBotCrypto = []
      cachedBotCryptoAt = 0
      cachedBotCryptoMode = null
    }

    // Stocks-only by default: the bot acts purely on Alpaca stock setups. When
    // BOT_ENABLE_CRYPTO is set it also folds in the executable crypto universe.
    const stockShortlist = (cachedSnapshot?.shortlist ?? []).filter((candidate) => candidate.assetClass === 'stock')
    const observedStocks = selectBotObservationCandidates(cachedSnapshot?.candidates ?? [], 'stock')
    const tradableCrypto = cryptoEnabled()
      ? cachedBotCrypto.filter((candidate) =>
          // Turbo is intentionally paper-churny: it can probe verified crypto
          // even when the strict VWAP gate is empty. Safe/active stay on real WATCH /
          // CHECK NOW setups.
          cfg().relaxStatusGate
            ? candidate.dataQuality === 'VERIFIED' && candidate.price > 0
            : candidate.status === 'WATCH' || candidate.status === 'CHECK NOW',
        )
      : []
    const observedCrypto = cryptoEnabled() ? selectBotObservationCandidates(cachedBotCrypto, 'crypto') : []
    const refreshPool = [
      ...new Map(
        [...stockShortlist, ...observedStocks, ...tradableCrypto, ...observedCrypto].map((candidate) => [
          `${candidate.assetClass}:${candidate.ticker}`,
          candidate,
        ]),
      ).values(),
    ]
    let shortlist = mergeStickyReversionWatches(refreshPool)
    if (shortlist.length > 0) {
      try {
        // refreshMomentumCandidates intentionally caps one request at 12 rows.
        // Refresh each asset class independently so a busy stock pre-market can
        // never crowd every crypto candidate out of the 10-second live loop.
        const [refreshedStocks, refreshedCrypto] = await Promise.all([
          refreshMomentumCandidates(shortlist.filter((candidate) => candidate.assetClass === 'stock')),
          refreshMomentumCandidates(shortlist.filter((candidate) => candidate.assetClass === 'crypto')),
        ])
        shortlist = [...refreshedStocks, ...refreshedCrypto]
      } catch {
        // keep last clean shortlist if the live refresh fails
      }
    }
    rememberStickyReversionWatches(shortlist)

    const candidateMap = new Map(
      [...(cachedSnapshot?.candidates ?? []), ...cachedBotCrypto, ...shortlist].map((candidate) => [
        normSymbol(resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate)),
        candidate,
      ]),
    )
    // "Tradable now" includes pre-market and after-hours (extended-hours limit
    // orders), not just 09:30-16:00 RTH — so the bot can act on pre-market movers.
    const stockMarketOpen = isStockTradableNow()
    stockSessionOpenNow = stockMarketOpen // stocks tradable now; drives stocks-first ranking

    // 1) Reconcile submitted orders against broker state. Alpaca fills are
    // asynchronous; Binance market fills are confirmed synchronously and show up
    // here as bot-tracked synthetic positions.
    const [positions, recentOrders, rawOpenOrders] = await Promise.all([
      fetchPositions(),
      fetchOrders().catch(() => [] as BotOrder[]),
      fetchOpenOrders().catch(() => [] as BotOrder[]),
    ])
    reconcilePendingEntries(positions, recentOrders)
    reconcilePendingExits(positions, recentOrders)
    const cleanedOpenOrders = await cancelStaleBotOpenOrders(rawOpenOrders)
    const openOrders = botState.draining ? await cancelOpenEntryOrdersForWindDown(cleanedOpenOrders) : cleanedOpenOrders
    const openOrderBySymbol = new Map(openOrders.map((order) => [normSymbol(order.symbol), order]))
    const openOrderSymbols = new Set(openOrderBySymbol.keys())

    // 2) Manage exits on whatever the selected brokers actually hold.
    for (const position of positions) {
      const normalized = normSymbol(position.symbol)
      if (isPendingExit(normalized) || openOrderSymbols.has(normalized)) continue
      const candidate = candidateMap.get(normalized)
      let meta = tracked.get(normalized)
      if (!meta && candidate) {
        const adoptedPlan = botTradePlan(candidate)
        if (adoptedPlan) {
          trackPositionFromPlan(normalized, position, candidate, adoptedPlan)
          recordAdoptedPositionHistory(position, normalized)
          meta = tracked.get(normalized)
          pushLog('info', position.symbol, `Adopted live position plan after restart (${adoptedPlan.mode})`)
        }
      }
      if (!meta) {
        // No live candidate for a held position (it dropped off the radar). Attach
        // a synthetic stop/target from the fill price so it is never left floating
        // without risk management.
        trackOrphanPosition(normalized, position)
        recordAdoptedPositionHistory(position, normalized)
        meta = tracked.get(normalized)
        if (meta) pushLog('info', position.symbol, `Managing off-radar position with a synthetic stop @ ${botPrice(meta.stop)}`)
      }
      if (meta && candidate && cfg().relaxStatusGate && meta.mode !== 'reversion') {
        const scalpPlan = botTradePlan(candidate, position.avgEntry || position.currentPrice)
        if (scalpPlan) {
          retuneTrackedPlan(meta, scalpPlan, position.currentPrice)
        }
      }
      const price = position.currentPrice

      let reason: string | null = null
      if (meta && price > 0) {
        updateExcursion(meta, price)
        applyAdaptiveRiskControls(position, meta, price, candidate)
        if (price <= meta.stop) reason = 'stop hit'
        else if (price >= meta.target2) reason = 'final target hit'
        else if (price >= meta.target1) {
          const entryMode = BOT_MODES[meta.botMode]
          if (entryMode.protectTarget1Runner && !meta.target1Hit) {
            meta.target1Hit = true
            const modeledCostPct = modeledRoundTripCostPct(meta.assetClass, meta.setup?.spreadPct ?? null, meta.venue)
            const netBreakeven = meta.entry * (1 + modeledCostPct / 100)
            meta.stop = roundBotPrice(
              Math.min(price * 0.999, Math.max(meta.stop, netBreakeven, meta.entry + meta.initialRisk * entryMode.target1TrailLockR)),
              price,
            )
            pushLog('info', position.symbol, `First target tagged; runner stop raised to ${botPrice(meta.stop)}`)
          } else if (!entryMode.protectTarget1Runner) {
            reason = 'first target hit'
          }
        }
        if (!reason) reason = timedExitReason(meta, price)
      }
      if (!reason && candidate) {
        if (candidate.status === 'DATA ERROR') reason = 'data quality block'
        if (!reason && meta) reason = activeModeDeRiskReason(candidate, position, meta, price)
        if (!reason && !candidate.aboveVwap && meta?.mode !== 'turbo-probe' && meta?.mode !== 'reversion') {
          // Only bail on a lost-VWAP thesis break when the trade is NOT in real
          // profit. A winning scalp that wicks under VWAP for a tick should ride
          // its trailing stop toward target instead of being dumped at ~breakeven
          // — that asymmetry (winners cut tiny, losers run to the full stop) was
          // the main reason turbo bled. Losing/flat probes still bail early.
          // Reversion is exempt entirely: being below VWAP IS the setup and VWAP
          // is its target, so it rides its own stop/target instead.
          const inProfit = meta ? price >= meta.entry * 1.003 : false
          if (!inProfit) reason = 'lost VWAP'
        }
      }

      if (reason) {
        if (position.assetClass === 'stock' && !stockMarketOpen) continue // can't market-exit a stock when closed
        try {
          await submitClose(position, reason)
        } catch (error) {
          pushLog('error', position.symbol, `Close failed: ${message(error)}`)
        }
      }
    }

    if (
      botState.draining &&
      positions.length === 0 &&
      openOrders.length === 0 &&
      pendingEntries.size === 0 &&
      pendingExits.size === 0
    ) {
      botState.running = false
      botState.draining = false
      botState.lastError = null
      pushLog('info', '-', 'Wind-down complete - no open positions, orders, or pending exits remain')
      serverLog('info', '-', 'wind-down complete')
      return
    }

    // 3) Open new positions for triggered, verified signals. CHECK NOW stays
    // strict for the watcher; the paper bot can probe normal/riskier WATCH rows
    // at the live price when any misses are explicitly allowed risk misses.
    const alpacaAccount = await fetchAccount()
    const binanceAccount = cryptoEnabled() && cryptoOnBinance() ? await fetchBinanceAccount() : null
    const displayAccount = combineAccounts(alpacaAccount, binanceAccount)
    let availableAlpacaBuyingPower = isPaperTradingBase()
      ? Math.max(0, alpacaAccount.cash)
      : Math.max(0, alpacaAccount.buyingPower || alpacaAccount.cash)
    let availableBinanceBuyingPower = binanceAccount ? Math.max(0, binanceAccount.cash) : availableAlpacaBuyingPower
    const heldOrPending = new Set<string>(positions.map((position) => normSymbol(position.symbol)))
    for (const symbol of openOrderSymbols) heldOrPending.add(symbol)
    for (const key of pendingEntries.keys()) {
      if (isPendingEntry(key)) heldOrPending.add(key)
    }

    const allocation = buildAllocationContext(shortlist, heldOrPending, stockMarketOpen)
    let slots = hardPositionLimit() - positions.length
    const buyable =
      botState.draining || slots <= 0
        ? []
        : shortlist
            .filter((candidate) => {
              if (!passesEntryGate(candidate, stockMarketOpen)) return false
              const resolved = resolveTradableSymbol(candidate)
              if (!resolved) return false
              const normalized = normSymbol(resolved.symbol)
              return !heldOrPending.has(normalized) && !activeNoFillCooldown(normalized)
            })
            .sort((a, b) => entryRank(b) - entryRank(a))
    pushTickStatus(shortlist, buyable, positions, stockMarketOpen)
    modeComparisons = buildModeComparisons(shortlist, positions, openOrders, stockMarketOpen)
    botWatch = buildBotWatch(
      shortlist,
      new Map(positions.map((position) => [normSymbol(position.symbol), position])),
      openOrderBySymbol,
      stockMarketOpen,
      slots,
    )
    writeDecisionAudit(botWatch, stockMarketOpen, slots)
    for (const candidate of shortlist) maybeNotifyDiscordSignal(candidate)
    // "Armed" = setups that pass every gate and are ready to act on but aren't
    // held/pending yet (in turbo these fire almost immediately). "Triggered" is
    // cumulative entries fired this session, incremented on each accepted buy
    // below — so the tiles reflect real activity instead of a transient 0.
    armedCount = botState.draining
      ? 0
      : shortlist.filter(
          (candidate) =>
            isBotCandidate(candidate, stockMarketOpen) &&
            !heldOrPending.has(normSymbol(resolveTradableSymbol(candidate)?.symbol ?? alpacaSymbolFor(candidate))),
        ).length
    const currentDiagnostics = diagnoseMode(botMode)
    maybeNotifyDiscordStatus({
      running: botState.running,
      mode: botMode,
      modeLabel: cfg().label,
      stockSessionTradable: stockMarketOpen,
      equity: displayAccount.equity,
      cash: displayAccount.cash,
      positions: positions.map((position) => ({
        symbol: position.displaySymbol,
        unrealizedPl: position.unrealizedPl,
        unrealizedPlPct: position.unrealizedPlPct,
      })),
      watch: botWatch.map((row) => ({
        symbol: row.symbol,
        status: row.status,
        state: row.state,
        note: row.note,
      })),
      armed: armedCount,
      triggered: triggeredCount,
      closedTrades: currentDiagnostics.closedTrades,
      realizedPl: currentDiagnostics.realizedPl,
      netRealizedPl: currentDiagnostics.netRealizedPl,
      lastError: botState.lastError,
    })

    for (const [buyableIndex, candidate] of buyable.entries()) {
      if (slots <= 0) break
      const plan = botTradePlan(candidate)
      if (!plan) {
        pushStatusLog(botDisplaySymbol(candidate), 'No valid bot stop/target plan - skipped')
        continue
      }
      const resolved = resolveTradableSymbol(candidate)
      if (!resolved) {
        pushStatusLog(botDisplaySymbol(candidate), `${tradabilityBlocker(candidate) ?? 'Not tradable'} - skipped`)
        continue
      }
      if (resolved.assetClass === 'stock' && !stockMarketOpen) continue
      const normalized = normSymbol(resolved.symbol)
      if (heldOrPending.has(normalized)) continue
      const cooldown = activeNoFillCooldown(normalized)
      if (cooldown) {
        pushStatusLog(resolved.symbol, noFillCooldownSummary(cooldown))
        continue
      }

      const entryAccount = resolved.venue === 'binance' && binanceAccount ? binanceAccount : alpacaAccount
      const availableBuyingPower =
        resolved.venue === 'binance' ? availableBinanceBuyingPower : availableAlpacaBuyingPower
      const samePoolPositions = positions.filter((position) => position.venue === resolved.venue)
      const budgetDecision = positionBudgetDecision(entryAccount, resolved, availableBuyingPower, candidate, plan, positions, allocation)
      const budget = budgetDecision.amount
      if (shouldFreeCashForOpportunity(candidate, budgetDecision, buyableIndex)) {
        const neededCash = Math.max(MIN_NOTIONAL, budgetDecision.desiredAmount - budget)
        const trimRequested = await trimProfitsForOpportunity({
          incoming: candidate,
          positions: samePoolPositions,
          candidateMap,
          stockMarketOpen,
          neededCash,
        })
        if (trimRequested) {
          pushLog(
            'info',
            resolved.symbol,
            `Waiting one tick for profit trim cash before sizing ${botDisplaySymbol(candidate)} closer to ${botPrice(budgetDecision.desiredAmount)}`,
          )
          continue
        }
      }
      if (budget < minNotionalForExecution()) {
        pushLog('skip', resolved.symbol, budgetDecision.reason)
        continue
      }

      try {
        const actualBudget = await submitBuy(candidate, resolved, budget, plan)
        if (actualBudget > 0) {
          resetEntryConfirmation(resolved)
          heldOrPending.add(normalized)
          if (resolved.venue === 'binance') {
            availableBinanceBuyingPower = Math.max(0, availableBinanceBuyingPower - actualBudget)
          } else {
            availableAlpacaBuyingPower = Math.max(0, availableAlpacaBuyingPower - actualBudget)
          }
          slots -= 1
          triggeredCount += 1
        }
      } catch (error) {
        const text = message(error)
        if (/client_order_id|already exists|422/i.test(text)) {
          pushLog('skip', resolved.symbol, 'Already ordered today — skipped duplicate')
        } else if (/not fractionable|rejected|403/i.test(text)) {
          setNoFillCooldown(resolved.symbol, `${executionLabel(resolved.venue)} rejected buy: ${text}`, REJECTED_COOLDOWN_MS)
          pushLog(
            'error',
            resolved.symbol,
            `Buy failed on ${executionLabel(resolved.venue)}: ${text}; cooling down this symbol for ${Math.round(REJECTED_COOLDOWN_MS / 60_000)}m`,
          )
        } else {
          pushLog('error', resolved.symbol, `Buy failed on ${executionLabel(resolved.venue)}: ${text}`)
        }
      }
    }

    serverLog(
      'tick',
      '-',
      `${botMode}${nightCryptoActive() ? ' night-crypto' : ''}${botState.draining ? ' wind-down' : ''} | crypto ${cryptoVenue()} | positions ${positions.length} ${isPaperTradingBase() ? 'cash/risk-driven' : `/ ${liveMaxPositions()} max`} | armed ${armedCount} | triggered ${triggeredCount} | buyable ${buyable.length} | shortlist ${shortlist.length} | cash ${botPrice(displayAccount.cash)}`,
    )
    botState.lastError = null
  } catch (error) {
    botState.lastError = message(error)
    pushLog('error', '-', `Tick failed: ${message(error)}`)
  } finally {
    tickRunning = false
    botState.lastTickAt = new Date().toISOString()
  }
}

// ---- public control surface ----------------------------------------------
export function startBot(mode?: BotMode) {
  if (mode) setBotMode(mode)
  botState.draining = false
  const configBlock = configurationBlocker()
  if (configBlock) {
    botState.running = false
    botState.draining = false
    botState.lastError = configBlock
    pushLog('error', '-', configBlock)
    return
  }
  const liveBlock = liveTradingBlocker()
  if (liveBlock) {
    botState.running = false
    botState.draining = false
    botState.lastError = liveBlock
    pushLog('error', '-', liveBlock)
    return
  }
  if (!botState.running) {
    botState.running = true
    botState.startedAt = new Date().toISOString()
    pushLog(
      'info',
      '-',
      `Bot started - ${cfg().label}, floors ${entryFloorLabel()}, ${cfg().sizeMultiplier}x sizing, ${positionCapacityLabel()}, ${cryptoEnabled() ? `crypto on ${cryptoVenueLabel()}` : cryptoVenueLabel()}`,
    )
    serverLog(
      'info',
      '-',
      `started: ${cfg().label}, crypto=${cryptoEnabled() ? cryptoVenue() : 'off'}, floors ${entryFloorLabel()}, ${cfg().sizeMultiplier}x, ${positionCapacityLabel()}`,
    )
  }
  ensureBotLoop()
}

export function getBotMode(): BotMode {
  return botMode
}

export function setBotMode(mode: BotMode) {
  if (mode !== 'safe' && mode !== 'active' && mode !== 'turbo') return
  if (botMode === mode) return
  botMode = mode
  cachedBotCryptoMode = null // force the next tick to rescan the new universe
  pushLog(
    'info',
    '-',
    `Mode set to ${cfg().label}; floors ${entryFloorLabel()}; ${cryptoEnabled() ? `crypto on ${cryptoVenueLabel()}` : cryptoVenueLabel()} (${cfg().sizeMultiplier}x sizing, ${positionCapacityLabel()})`,
  )
}

export function stopBot() {
  if (botState.running) {
    botState.draining = false
    botState.running = false
    pushLog('info', '-', 'Bot stopped')
    serverLog('info', '-', 'stopped')
  }
}

export async function liquidateAndStopBot() {
  botState.draining = false
  botState.running = false
  botState.lastError = null
  pushLog('error', '-', 'Immediate stop requested - canceling open bot buys and selling all open bot positions')
  serverLog('info', '-', 'immediate stop liquidation requested')

  try {
    clearReadCaches()
    const positions = await readPositionsFromBroker()
    if (positions.length === 0) {
      const openOrders = await readOpenOrdersFromAlpaca().catch(() => [] as BotOrder[])
      await cancelOpenEntryOrdersForImmediateStop(openOrders)
      pushLog('info', '-', 'Immediate stop found no open bot positions; canceled open bot buys only')
      return
    }

    try {
      await submitCloseAll(positions, 'manual immediate stop liquidation')
    } catch (error) {
      pushLog('error', '-', `Close-all failed, falling back to per-position liquidation: ${message(error)}`)
      const openOrders = await readOpenOrdersFromAlpaca().catch(() => [] as BotOrder[])
      await cancelOpenEntryOrdersForImmediateStop(openOrders)
      for (const position of positions) {
        const normalized = normSymbol(position.symbol)
        if (isPendingExit(normalized)) {
          pushLog('info', position.symbol, 'Immediate stop sees a close already pending; not sending a duplicate sell')
          continue
        }
        try {
          await submitClose(position, 'manual immediate stop liquidation')
        } catch (closeError) {
          pushLog('error', position.symbol, `Immediate liquidation sell failed: ${message(closeError)}`)
        }
      }
    }

    clearReadCaches()
    const [afterPositions, afterOrders] = await Promise.all([
      readPositionsFromBroker().catch(() => [] as BotPosition[]),
      readOrdersFromAlpaca().catch(() => [] as BotOrder[]),
    ])
    reconcilePendingExits(afterPositions, afterOrders)
  } catch (error) {
    pushLog('error', '-', `Immediate stop could not read/sell positions: ${message(error)}`)
  }
}

export function windDownBot() {
  if (!botState.running) return
  if (botState.draining) return
  botState.draining = true
  pushLog('info', '-', 'Wind-down requested - new buys paused, exits still managed')
  serverLog('info', '-', 'wind-down requested')
}

export function resetBot() {
  tracked.clear()
  pendingEntries.clear()
  pendingExits.clear()
  noFillCooldowns.clear()
  tradeCooldowns.clear()
  entryConfirmations.clear()
  stickyReversionWatches.clear()
  decisionAuditCache.clear()
  botState.draining = false
  log.length = 0
  // Full wipe: clear the persisted trade journal / stats / daily data too, so the
  // bot starts from a clean slate (e.g. when moving to a fresh paper account).
  history.length = 0
  setupMemory.clear()
  // Also clear the account-value curve so the equity chart starts fresh on reset.
  equitySeries.length = 0
  lastEquitySampleAt = 0
  botWatch = []
  modeComparisons = []
  armedCount = 0
  triggeredCount = 0
  botState.lastError = null
  botState.startedAt = botState.running ? new Date().toISOString() : null
  persistHistory()
  persistSetupMemory()
  persistEquitySeries(true)
  // NOTE: the append-only paper-bot-trades.csv dataset is intentionally preserved.
  pushLog('info', '-', 'Full reset — trade journal, stats, equity curve, and daily data cleared')
}

// ---- Binance-watched fast crypto exits ------------------------------------
// The 10s bot tick can be slow for crypto, so a stop or final target
// can blow well past before the bot reacts (this is part of what bled the account
// overnight). We WATCH open crypto positions on Binance's ~1s public market stream
// (no auth) and trigger the exit on the position's own venue the instant Binance
// shows the stop or final target breached. Everything else (trailing, lost-VWAP,
// time stops, entries) still runs on the normal tick.
const BINANCE_PRICE_STALE_MS = 9_000
const FAST_EXIT_INTERVAL_MS = 2_500
type BinancePrice = { price: number; at: number }
const binancePrices = new Map<string, BinancePrice>() // keyed by base, e.g. "BTC"
let binanceWs: WebSocket | null = null
let binanceStreamKey = ''
let binanceReconnectAt = 0

// "BTC/USD" / "BTCUSD" / "BTCUSDT" -> "BTC"
function binanceBaseFromSymbol(symbol: string): string | null {
  const m = symbol.toUpperCase().match(/^([A-Z0-9]+?)\/?USD[T]?$/)
  return m ? m[1] : null
}

function heldCryptoBases(): string[] {
  const bases = new Set<string>()
  for (const [, meta] of tracked) {
    if (meta.assetClass !== 'crypto') continue
    const base = binanceBaseFromSymbol(meta.displaySymbol)
    if (base) bases.add(base)
  }
  return [...bases]
}

// (Re)connect the Binance stream to exactly the set of crypto bases the bot
// currently holds. Tears down when nothing is held; reconnects (throttled) on
// drop or when the held set changes.
function ensureBinanceFeed() {
  const runtimeGlobal = globalThis as PaperBotRuntimeGlobal
  const bases = heldCryptoBases()
  const key = bases.slice().sort().join(',')
  if (bases.length === 0) {
    if (binanceWs) {
      try { binanceWs.close() } catch { /* ignore */ }
      binanceWs = null
      binanceStreamKey = ''
    }
    return
  }
  if (binanceWs && key === binanceStreamKey && binanceWs.readyState === 1 /* OPEN */) return
  if (binanceWs && key === binanceStreamKey && binanceWs.readyState === 0 /* CONNECTING */) return
  if (Date.now() < binanceReconnectAt) return
  if (binanceWs) {
    try { binanceWs.close() } catch { /* ignore */ }
    binanceWs = null
  }
  const streams = bases.map((b) => `${b.toLowerCase()}usdt@miniTicker`).join('/')
  try {
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    binanceWs = ws
    binanceStreamKey = key
    runtimeGlobal.__paperBotBinanceWs = ws
    ws.addEventListener('open', () => {
      serverLog('info', '-', `Binance fast-exit feed watching ${bases.join(', ')} (real-time stop/target on live crypto)`)
    })
    ws.addEventListener('message', (ev: { data?: unknown }) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : ''
        if (!raw) return
        const d = (JSON.parse(raw) as { data?: { s?: string; c?: string } }).data
        if (!d?.s || d.c == null) return
        const base = String(d.s).replace(/USDT$/, '')
        const price = Number(d.c)
        if (base && Number.isFinite(price) && price > 0) binancePrices.set(base, { price, at: Date.now() })
      } catch { /* ignore malformed frame */ }
    })
    ws.addEventListener('close', () => {
      if (binanceWs === ws) {
        binanceWs = null
        binanceStreamKey = ''
        binanceReconnectAt = Date.now() + 5_000
      }
    })
    ws.addEventListener('error', () => {
      try { ws.close() } catch { /* ignore */ }
      binanceReconnectAt = Date.now() + 5_000
    })
  } catch {
    binanceReconnectAt = Date.now() + 10_000
  }
}

function freshBinancePrice(base: string): number | null {
  const p = binancePrices.get(base)
  if (!p || Date.now() - p.at > BINANCE_PRICE_STALE_MS) return null
  return p.price
}

// Runs every few seconds between the slow Alpaca ticks. Closes a crypto position
// the moment Binance shows its stop or final target breached. Only hard exits —
// the main tick still owns trailing stops, lost-VWAP, time stops, and entries.
async function fastCryptoExitCheck() {
  if (!botState.running) return
  if (!cryptoEnabled()) return // stocks-only: no Binance fast-exit feed or calls
  try {
    ensureBinanceFeed()
  } catch { /* feed errors must never break the loop */ }
  const positions = positionsCache.value
  if (!positions || positions.length === 0) return
  for (const position of positions) {
    if (position.assetClass !== 'crypto') continue
    const normalized = normSymbol(position.symbol)
    if (isPendingExit(normalized)) continue
    const meta = tracked.get(normalized)
    if (!meta) continue
    const base = binanceBaseFromSymbol(position.symbol)
    if (!base) continue
    const price = freshBinancePrice(base)
    if (price === null) continue
    let reason: string | null = null
    if (price <= meta.stop) reason = 'stop hit (binance)'
    else if (price >= meta.target2) reason = 'final target hit (binance)'
    if (!reason) continue
    try {
      await submitClose(position, reason)
      serverLog('sell', position.symbol, `${reason} @ ${price} — fast Binance-watched exit`)
    } catch (error) {
      pushLog('error', position.symbol, `Fast Binance exit failed: ${message(error)}`)
    }
  }
}

// Keep the server alive through a stray *unhandled rejection* (e.g. a transient
// Alpaca/Binance/network blip that escapes a catch) instead of letting it crash
// the whole dev server and stop the bot. The bot re-reads broker state every
// tick, so log-and-continue is safe here. Genuinely fatal uncaughtExceptions
// are deliberately NOT swallowed — those should crash so the dev:forever supervisor
// restarts a clean process (and PAPER_BOT_AUTOSTART re-arms it). Installed once.
// (process is typed as a minimal browser shim in this tsconfig; cast for `.on`.)
type ProcessRejectionHook = { on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown }
let crashGuardsInstalled = false
function installProcessCrashGuards() {
  const runtimeGlobal = globalThis as PaperBotRuntimeGlobal
  if (crashGuardsInstalled || runtimeGlobal.__paperBotCrashGuardsInstalled) {
    crashGuardsInstalled = true
    return
  }
  const proc = process as unknown as ProcessRejectionHook | undefined
  if (!proc || typeof proc.on !== 'function') return
  crashGuardsInstalled = true
  runtimeGlobal.__paperBotCrashGuardsInstalled = true
  proc.on('unhandledRejection', (reason) => {
    serverLog('error', '-', `unhandledRejection (kept server alive): ${reason instanceof Error ? reason.message : String(reason)}`)
  })
}

// Resume trading automatically after any (re)start when PAPER_BOT_AUTOSTART names a
// mode. Without this the bot resets to stopped on every server boot, so an
// overnight crash/restart left it idle until someone clicked Start. Runs after the
// loop is marked started so startBot()'s ensureBotLoop() call is a no-op.
function maybeAutostart() {
  if (botState.running) return
  const mode = envValue('PAPER_BOT_AUTOSTART')?.trim().toLowerCase()
  if (mode === 'safe' || mode === 'active' || mode === 'turbo') {
    if (!isPaperTradingBase() && envValue('ALLOW_LIVE_AUTOSTART') !== LIVE_TRADING_ACK) {
      serverLog('info', '-', `live autostart blocked; set ALLOW_LIVE_AUTOSTART=${LIVE_TRADING_ACK} only after manual live smoke tests`)
      return
    }
    serverLog('info', '-', `auto-starting in ${mode} mode (PAPER_BOT_AUTOSTART) — bot resumes itself after a restart`)
    startBot(mode)
  }
}

export function ensureBotLoop() {
  const runtimeGlobal = globalThis as PaperBotRuntimeGlobal
  installProcessCrashGuards()
  if (loopStarted && loopHandle !== null) return
  if (runtimeGlobal.__paperBotLoopHandle) {
    clearInterval(runtimeGlobal.__paperBotLoopHandle)
  }
  loopStarted = true
  serverLog('tick', '-', `loop started, evaluating every ${Math.round(TICK_MS / 1000)}s (Binance fast crypto exits every ${Math.round(FAST_EXIT_INTERVAL_MS / 1000)}s)`)
  loopHandle = setInterval(() => {
    void tick()
  }, TICK_MS)
  runtimeGlobal.__paperBotLoopHandle = loopHandle
  // Fast Binance-watched crypto exit checker between the slow Alpaca ticks.
  if (runtimeGlobal.__paperBotFastHandle) clearInterval(runtimeGlobal.__paperBotFastHandle)
  fastHandle = setInterval(() => {
    void fastCryptoExitCheck()
  }, FAST_EXIT_INTERVAL_MS)
  runtimeGlobal.__paperBotFastHandle = fastHandle
  maybeAutostart()
}

export async function getBotState(): Promise<BotStateResponse> {
  stockSessionOpenNow = computedStockMarketStatus(new Date()) === 'OPEN' // keep night-mode flag fresh for readers between ticks
  const base = {
    running: botState.running,
    draining: botState.draining,
    startedAt: botState.startedAt,
    lastTickAt: botState.lastTickAt,
    tradingBase: tradingBaseUrl(),
    armed: armedCount,
    triggered: triggeredCount,
    mode: botMode,
    modeLabel: cfg().label,
    minScore: cfg().minScore,
    reversionMinScore: REVERSION_MIN_SCORE,
    nightMode: nightCryptoActive(),
    cryptoFloor: nightCryptoActive() ? Math.min(cfg().minScore, NIGHT_CRYPTO_MIN_SCORE) : cfg().minScore,
    riskLabel: cfg().riskLabel,
    maxPositions: reportedMaxPositions(),
    sizeMultiplier: cfg().sizeMultiplier,
    riskPause: hardDailyRiskPauseReason() ?? macroBlackoutReason(),
    diagnostics: diagnoseMode(botMode),
    setupMemory: sortedSetupMemory(),
    macroEvents: upcomingMacroBlackouts(),
    watch: botWatch,
    comparisons: modeComparisons,
    cryptoVenue: cryptoVenue(),
    cryptoVenueLabel: cryptoVenueLabel(),
  }

  const configBlock = configurationBlocker()
  if (configBlock) {
    return {
      ok: true,
      configured: false,
      ...base,
      lastError: `${configBlock} Add the required keys to .env.local and restart the server.`,
      account: null,
      positions: [],
      orders: [],
      log: log.slice(0, 40),
      history: history.slice(0, 200),
      stats: historyStats(),
      equitySeries: equitySeries.slice(-240),
    }
  }

  const liveBlock = liveTradingBlocker()
  if (liveBlock) {
    return {
      ok: true,
      configured: true,
      ...base,
      running: false,
      lastError: liveBlock,
      account: null,
      positions: [],
      orders: [],
      log: log.slice(0, 40),
      history: history.slice(0, 200),
      stats: historyStats(),
      equitySeries: equitySeries.slice(-240),
    }
  }

  try {
    let accountError: string | null = null
    const [account, positions, orders] = await Promise.all([
      fetchDisplayAccount().catch((error) => {
        accountError = `Account read failed: ${message(error)}`
        return null
      }),
      fetchPositions().catch(() => [] as BotPosition[]),
      fetchOrders().catch(() => [] as BotOrder[]),
    ])
    reconcilePendingEntries(positions, orders)
    reconcilePendingExits(positions, orders)
    recordEquityPoint(account)
    return {
      ok: true,
      configured: true,
      ...base,
      lastError: botState.lastError ?? accountError,
      account,
      positions,
      orders,
      log: log.slice(0, 40),
      history: history.slice(0, 200),
      stats: historyStats(),
      equitySeries: equitySeries.slice(-240),
    }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
