import { carryForwardReversionSignal, classifyCatalyst, stockCapBand } from './momentumCore.ts'
import {
  adaptiveProfitStop,
  alpacaCryptoExecutionBlocker,
  botModePolicy,
  capStockPlanRisk,
  costAwareEntryBlocker,
  cryptoNetEdgeBlocker,
  dailyRiskReasonFor,
  entryScoreFloor,
  isCooldownActive,
  macroBlackoutReason,
  monetaryDailyRiskReasonFor,
  modeledRoundTripCostPct,
  newYorkMinutesNow,
  positionCountLimitFor,
  rebaseTradePlanForEntry,
  retunePlanForFill,
  selectBotObservationCandidates,
  stockAutoBlocker,
  stockCapitalizationRiskScale,
} from './paperBotCore.ts'
import { applySignalStability, resetSignalStability } from './signalStability.ts'
import type { MomentumCandidate } from './momentumCore.ts'

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
  console.log(`[PASS] ${message}`)
}

console.log('Running deterministic gates verification tests...')

// 1. Catalyst Classifier Tests
const cat1 = classifyCatalyst('FDA approval granted for new drug')
assert(cat1.score === 12, 'FDA approval headlines should score +12')
assert(cat1.tags.includes('FDA Approval'), 'FDA Approval tag should be set')
assert(cat1.quality === 'positive', 'FDA Approval quality should be positive')

const cat2 = classifyCatalyst('FDA approval delayed until further review')
assert(cat2.score === 0, 'FDA approval delayed headlines should NOT get positive FDA points')
assert(cat2.quality === 'none', 'FDA approval delayed quality should be none')

const cat3 = classifyCatalyst('Company announces public offering of common stock')
assert(cat3.score === -12, 'Public offering headlines should score -12')
assert(cat3.tags.includes('Dilution/Offering'), 'Dilution/Offering tag should be set')
assert(cat3.quality === 'negative', 'Dilution/Offering quality should be negative')

// 2. Timezone-independent newYorkMinutesNow Tests
// June is Daylight Savings (EDT, UTC-4)
const edtDate = new Date('2026-06-16T13:45:00Z') // 13:45 UTC -> 09:45 EDT
const edtMins = newYorkMinutesNow(edtDate)
assert(edtMins === 585, `09:45 EDT should be 585 minutes, got ${edtMins}`)

// December is Standard Time (EST, UTC-5)
const estDate = new Date('2026-12-16T14:45:00Z') // 14:45 UTC -> 09:45 EST
const estMins = newYorkMinutesNow(estDate)
assert(estMins === 585, `09:45 EST should be 585 minutes, got ${estMins}`)

// 3. stockAutoBlocker time-gates
// We mock candidate
const mockCandidate: MomentumCandidate = {
  assetClass: 'stock',
  ticker: 'AAPL',
  displaySymbol: 'AAPL',
  company: 'Apple Inc.',
  exchange: 'NASDAQ',
  exchangeDisplay: 'NASDAQ',
  sector: 'Technology',
  price: 150.0,
  changePct: 10.0,
  secondaryMovePct: null,
  secondaryMoveLabel: 'session',
  oneHourMovePct: 2.0,
  fifteenMinuteMovePct: 1.0,
  vwapExtensionPct: 0.5,
  rangePositionPct: 90.0,
  volume: 5_000_000,
  quoteVolume: null,
  averageVolume: 4_000_000,
  relativeVolume: 1.25,
  volumePulse: 1.1,
  recentQuoteVolume: null,
  trades: null,
  marketCap: 2_000_000_000_000,
  sharesOutstanding: 15_000_000_000,
  catalyst: '',
  catalystPublisher: null,
  catalystAgeMinutes: null,
  newsUrl: null,
  highOfDay: 151.0,
  distanceFromHighPct: 0.66,
  vwap: 149.0,
  aboveVwap: true,
  spreadPct: 0.1,
  quoteTimestamp: new Date().toISOString(),
  quoteAgeMinutes: 0,
  marketStatus: 'OPEN',
  marketStatusLabel: 'Open',
  dataQuality: 'VERIFIED',
  dataError: null,
  primarySource: 'Yahoo',
  secondarySource: 'CNBC',
  secondaryPrice: 150.0,
  priceDiffPct: 0,
  validationNotes: [],
  score: 95,
  confidence: 0.95,
  status: 'CHECK NOW',
  signal: {
    action: 'BUY',
    label: 'BUY TRIGGER',
    thesis: '',
    entryTrigger: 150.5,
    entryZoneLow: 150.0,
    entryZoneHigh: 151.0,
    stopLoss: 148.0,
    targetOne: 153.0,
    targetTwo: 155.0,
    invalidation: '',
    sellPlan: '',
    riskReward: 2.0,
  },
  reasons: [],
  blockers: [],
  tradingViewUrl: '',
  sourceUrl: '',
  sourceLabel: 'Yahoo',
  updatedAt: new Date().toISOString(),
  catalystScore: 0,
  catalystTags: [],
  catalystQuality: 'none',
  premarketHigh: 148.0,
  premarketVolume: 500_000,
  premarketDollarVolume: 74_000_000,
  openingRangeHigh: 149.5,
  openingRangeLow: 147.0,
  orbBreakoutConfirmed: true,
  estimatedFreeFloat: 12_000_000_000,
  floatTurnover: 0.0004,
  shortInterestPct: 1.2,
  latestBarVolume: 50_000,
  averageRecentBarVolume: 30_000,
}

// Test stockAutoBlocker in opening 15m (09:35 EDT / 13:35 UTC)
const mockDateOpen = new Date('2026-06-16T13:35:00Z') // 09:35 EDT
const blockReasonOpen = stockAutoBlocker(mockCandidate, mockDateOpen)
assert(blockReasonOpen === 'opening 15m spread volatility', `Should block during opening 15m, got: ${blockReasonOpen}`)

// Test stockAutoBlocker outside opening 15m (09:50 EDT / 13:50 UTC)
const mockDateNormal = new Date('2026-06-16T13:50:00Z') // 09:50 EDT
const blockReasonNormal = stockAutoBlocker(mockCandidate, mockDateNormal)
assert(blockReasonNormal === null, `Should NOT block outside opening 15m, got: ${blockReasonNormal}`)

const weakPulseStock: MomentumCandidate = { ...mockCandidate, volumePulse: 0.71, distanceFromHighPct: 1.9 }
assert(
  stockAutoBlocker(weakPulseStock, mockDateNormal)?.includes('stock 5m volume pulse') === true,
  'Active stock auto-entry should reject weak live 5m pulse unless the setup is exceptional',
)

const exceptionalPinnedStock: MomentumCandidate = {
  ...mockCandidate,
  price: 150.6,
  volumePulse: 0.47,
  distanceFromHighPct: 0,
  sessionVolume: { cumulative: 5_000_000, expectedProgress: 0.05, timeAdjustedRelativeVolume: 120 },
  microPullback: {
    state: 'READY',
    label: 'Micro pullback ready',
    score: 30,
    trigger: 150.5,
    stop: 148.8,
    pullbackLow: 149,
    pullbackHigh: 150.3,
    pullbackCandles: 2,
    pullbackDepthPct: 35,
    ema9: 149.5,
    ema20: 149,
    atr: 0.8,
    supportDistancePct: 0.2,
    resistanceDistancePct: 1.2,
    notes: [],
  },
}
assert(
  stockAutoBlocker(exceptionalPinnedStock, mockDateNormal) === null,
  'A weak-pulse stock pinned at high with extreme time-adjusted volume can remain tradable',
)

const moderatePulseNoStructure: MomentumCandidate = {
  ...mockCandidate,
  volumePulse: 0.92,
  distanceFromHighPct: 2.4,
  openingRangeHigh: 153,
  latestBarVolume: 30_000,
  averageRecentBarVolume: 30_000,
  microPullback: undefined,
}
assert(
  stockAutoBlocker(moderatePulseNoStructure, mockDateNormal)?.includes('without ORB/VWAP reclaim confirmation') === true,
  'Active stock auto-entry should still reject moderate 5m pulse without ORB or VWAP-reclaim structure',
)

const moderatePulseOrbStock: MomentumCandidate = {
  ...mockCandidate,
  price: 150.6,
  highOfDay: 151,
  distanceFromHighPct: 0.27,
  volumePulse: 0.92,
  sessionVolume: { cumulative: 5_000_000, expectedProgress: 0.35, timeAdjustedRelativeVolume: 2.4 },
  latestBarVolume: 90_000,
  averageRecentBarVolume: 30_000,
  openingRangeHigh: 150.2,
  microPullback: { ...exceptionalPinnedStock.microPullback!, state: 'EXTENDED', label: 'Extended - ORB path' },
}
assert(
  stockAutoBlocker(moderatePulseOrbStock, mockDateNormal) === null,
  'A moderate-pulse stock with confirmed ORB structure can bypass the micro-pullback wait',
)

const moderatePulseVwapReclaim: MomentumCandidate = {
  ...mockCandidate,
  volumePulse: 0.9,
  distanceFromHighPct: 6.2,
  vwap: 149.2,
  price: 150,
  vwapExtensionPct: 0.54,
  rangePositionPct: 68,
  oneHourMovePct: 1.1,
  fifteenMinuteMovePct: 0.25,
  sessionVolume: { cumulative: 4_000_000, expectedProgress: 0.4, timeAdjustedRelativeVolume: 2.1 },
  openingRangeHigh: 155,
  microPullback: { ...exceptionalPinnedStock.microPullback!, state: 'FORMING', label: 'Forming - reclaim path' },
}
assert(
  stockAutoBlocker(moderatePulseVwapReclaim, mockDateNormal) === null,
  'A moderate-pulse VWAP reclaim with strong time-adjusted volume can bypass the pullback wait',
)

// 4. Reversion auto-blocker: a large-cap VWAP-reclaim candidate is BELOW VWAP and
// far from the high by design, so the momentum-only gates (micro pullback, near-
// high rVol, fading tape) must NOT block it, but the volatile-open guard stays.
const reversionCandidate: MomentumCandidate = {
  ...mockCandidate,
  ticker: 'PLTR',
  displaySymbol: 'PLTR',
  company: 'Palantir Technologies',
  strategy: 'reversion',
  price: 140,
  vwap: 143, // ~2.1% stretched below VWAP
  vwapExtensionPct: -2.1,
  aboveVwap: false,
  highOfDay: 147,
  distanceFromHighPct: 4.8, // far from high, would trip momentum gates
  changePct: -2.0,
  fifteenMinuteMovePct: 0.1, // turning back up (reclaim)
  intradayRsi: 33,
  intradayLow: 139,
}

const revBlockNormal = stockAutoBlocker(reversionCandidate, mockDateNormal)
assert(revBlockNormal === null, `Reversion should pass momentum auto-blockers outside the open, got: ${revBlockNormal}`)

const revBlockOpen = stockAutoBlocker(reversionCandidate, mockDateOpen)
assert(
  revBlockOpen === 'opening 15m spread volatility',
  `Reversion should still avoid the volatile open, got: ${revBlockOpen}`,
)

const previousReversionWatch: MomentumCandidate = {
  ...reversionCandidate,
  price: 23.5,
  vwap: 23.85,
  aboveVwap: false,
  score: 74,
  confidence: 0.74,
  status: 'WATCH',
  signal: {
    ...reversionCandidate.signal,
    action: 'WAIT',
    label: 'WAIT FOR RECLAIM',
    entryTrigger: 23.54,
    entryZoneLow: 23.47,
    entryZoneHigh: 23.59,
    stopLoss: 23.07,
    targetOne: 23.85,
    targetTwo: 23.95,
    riskReward: 1.8,
  },
}
const refreshedAfterReclaim: MomentumCandidate = {
  ...previousReversionWatch,
  price: 23.56,
  aboveVwap: true,
  score: 0,
  confidence: 0,
  status: 'IGNORE',
  blockers: ['price is no longer below VWAP'],
}
const carriedReversion = carryForwardReversionSignal(refreshedAfterReclaim, previousReversionWatch)
assert(
  carriedReversion.status === 'CHECK NOW' && carriedReversion.signal.entryTrigger === 23.54,
  'A reversion row that reaches its locked reclaim trigger should not vanish as soon as it is no longer below VWAP',
)
assert(carriedReversion.score === 74, 'A carried reversion reclaim should preserve its original setup score for bot entry gates')

const fatalReversionRefresh: MomentumCandidate = {
  ...refreshedAfterReclaim,
  blockers: ['negative catalyst: Offering'],
}
assert(
  carryForwardReversionSignal(fatalReversionRefresh, previousReversionWatch).status === 'IGNORE',
  'A reversion row with a fatal refreshed blocker should not be carried forward',
)

resetSignalStability()
const radarReversionBuy: MomentumCandidate = {
  ...previousReversionWatch,
  ticker: 'RVR',
  displaySymbol: 'RVR',
  price: 23.56,
  aboveVwap: false,
  status: 'CHECK NOW',
  signal: {
    ...previousReversionWatch.signal,
    action: 'BUY',
    label: 'RECLAIM BUY',
  },
}
const firstReversionGate = applySignalStability([radarReversionBuy], new Date('2026-06-16T13:50:00Z'))[0]
const secondReversionGate = applySignalStability([radarReversionBuy], new Date('2026-06-16T13:50:10Z'))[0]
const thirdReversionGate = applySignalStability([radarReversionBuy], new Date('2026-06-16T13:50:20Z'))[0]
assert(
  firstReversionGate.status === 'WATCH' &&
    secondReversionGate.status === 'WATCH' &&
    thirdReversionGate.status === 'CHECK NOW',
  'Stock radar buy confirmation should require three observations and a 20-second hold',
)
const slippedReversionGate = applySignalStability(
  [
    {
      ...radarReversionBuy,
      price: 23.5,
      status: 'WATCH',
      signal: { ...radarReversionBuy.signal, action: 'WAIT', label: 'WAIT FOR RECLAIM' },
    },
  ],
  new Date('2026-06-16T13:50:25Z'),
)[0]
assert(
  slippedReversionGate.status === 'WATCH' &&
    slippedReversionGate.signal.action === 'WAIT' &&
    slippedReversionGate.signalPhase?.label === 'Confirmed · waiting',
  'Radar should demote a confirmed buy back to WAIT when price slips below the live reclaim trigger',
)

resetSignalStability()
const wideSpreadRawBuy: MomentumCandidate = {
  ...radarReversionBuy,
  ticker: 'WIDE',
  displaySymbol: 'WIDE',
  spreadPct: 1.2,
}
const wideFirst = applySignalStability([wideSpreadRawBuy], new Date('2026-06-16T13:51:00Z'))[0]
const wideSecond = applySignalStability([wideSpreadRawBuy], new Date('2026-06-16T13:51:05Z'))[0]
assert(
  wideFirst.status === 'WATCH' &&
    wideSecond.status === 'WATCH' &&
    wideSecond.signalPhase?.detail.includes('spread') === true,
  'Radar buy confirmation should hold back a raw buy trigger when execution spread is too wide',
)
resetSignalStability()

const noBboRawBuy: MomentumCandidate = {
  ...radarReversionBuy,
  ticker: 'NOBBO',
  displaySymbol: 'NOBBO',
  spreadPct: 0,
  spreadAvailable: false,
}
const noBboFirst = applySignalStability([noBboRawBuy], new Date('2026-06-16T13:52:00Z'))[0]
const noBboSecond = applySignalStability([noBboRawBuy], new Date('2026-06-16T13:52:10Z'))[0]
const noBboThird = applySignalStability([noBboRawBuy], new Date('2026-06-16T13:52:20Z'))[0]
assert(
  noBboFirst.status === 'WATCH' && noBboSecond.status === 'WATCH' && noBboThird.status === 'WATCH',
  'A missing bid/ask must never be rewarded as a zero-spread confirmed entry',
)
assert(
  stockAutoBlocker(noBboRawBuy, mockDateNormal)?.includes('bid/ask unavailable') === true,
  'The execution bot should independently reject a stock with no live bid/ask',
)
resetSignalStability()

const haltedRawBuy: MomentumCandidate = {
  ...radarReversionBuy,
  ticker: 'HALT',
  displaySymbol: 'HALT',
  tradingHalted: true,
  tradingHaltReason: 'Trading Halt',
}
assert(
  stockAutoBlocker(haltedRawBuy, mockDateNormal)?.includes('trading halted') === true,
  'The execution bot should reject a stock while a live halt status is active',
)
const haltedFirst = applySignalStability([haltedRawBuy], new Date('2026-06-16T13:53:00Z'))[0]
const haltedSecond = applySignalStability([haltedRawBuy], new Date('2026-06-16T13:53:10Z'))[0]
const haltedThird = applySignalStability([haltedRawBuy], new Date('2026-06-16T13:53:20Z'))[0]
assert(
  haltedFirst.status === 'WATCH' && haltedSecond.status === 'WATCH' && haltedThird.status === 'WATCH',
  'A halted stock must never progress to a confirmed radar entry',
)
resetSignalStability()

// 5. Cap-aware risk sizing: both small and large movers remain eligible, but a
// small/low-float stock must not receive the same risk budget as a liquid large cap.
assert(
  stockCapBand({ assetClass: 'stock', marketCap: 1_500_000_000 }) === 'micro-small',
  'A $1.5B stock should be classified as micro/small-cap',
)
assert(
  stockCapitalizationRiskScale({ assetClass: 'stock', marketCap: 1_500_000_000, estimatedFreeFloat: 80_000_000 }) === 0.65,
  'A small-cap stock should receive 65% of the normal risk budget',
)
assert(
  stockCapitalizationRiskScale({ assetClass: 'stock', marketCap: 120_000_000, estimatedFreeFloat: 80_000_000 }) === 0.5,
  'A micro-cap stock should receive 50% of the normal risk budget',
)
assert(
  stockCapitalizationRiskScale({ assetClass: 'stock', marketCap: 25_000_000_000, estimatedFreeFloat: 10_000_000 }) === 0.45,
  'A low-float stock should receive the strictest 45% risk budget even with a large market cap',
)
assert(
  stockCapitalizationRiskScale({ assetClass: 'stock', marketCap: 250_000_000_000, estimatedFreeFloat: 2_000_000_000 }) === 1,
  'A liquid large-cap stock should retain the normal risk budget',
)

// 6. Cost-aware entries: keep liquid trades available, reject spreads that made
// June 18's tiny gross winners net losers, and reject targets with no cost cushion.
const tightSpreadCandidate: MomentumCandidate = { ...mockCandidate, spreadPct: 0.35 }
assert(stockAutoBlocker(tightSpreadCandidate, mockDateNormal) === null, 'Active mode should still accept a liquid 0.35% stock spread')

const wideSpreadCandidate: MomentumCandidate = { ...mockCandidate, spreadPct: 0.65 }
assert(
  stockAutoBlocker(wideSpreadCandidate, mockDateNormal)?.includes('over auto cap 0.4%') === true,
  'Active mode should reject the 0.65% spread band that overwhelmed small winners',
)

const boundedPlan = capStockPlanRisk({ trigger: 100, stop: 96, target1: 104, target2: 108, mode: 'breakout' }, 'active')
assert(Math.abs(boundedPlan.stop - 97.5) < 1e-9, 'Active stock initial risk should be capped at 2.5%')
const alreadyTightPlan = capStockPlanRisk({ trigger: 100, stop: 98, target1: 104, target2: 108, mode: 'breakout' }, 'active')
assert(alreadyTightPlan.stop === 98, 'A structurally tighter stock stop should remain unchanged')

const modeledStockCost = modeledRoundTripCostPct('stock', 0.35)
assert(Math.abs(modeledStockCost - 0.41) < 1e-9, 'Stock cost model should include spread plus 3 bps slippage per leg')
const thinEdgePlan = { trigger: 150, stop: 147, target1: 150.75, target2: 153, mode: 'breakout' as const }
assert(
  costAwareEntryBlocker(tightSpreadCandidate, thinEdgePlan)?.includes('cannot clear modeled') === true,
  'A first target without a live-cost safety margin should be blocked',
)
const viableEdgePlan = { ...thinEdgePlan, target1: 153 }
assert(costAwareEntryBlocker(tightSpreadCandidate, viableEdgePlan) === null, 'A target with adequate cost-adjusted room should remain tradable')

// 6b. Crypto fee-first gate (safe/active only): a crypto entry is allowed only
// when the first realistic target clears the FULL modeled round-trip cost (taker
// fees on both legs + slippage + spread) with margin and still pays a net reward.
// Default mode is "active"; default crypto venue resolves to Alpaca, whose market
// orders pay the 0.25% taker fee per leg, so the model charges ~0.65% round trip
// on a tight 0.05% book (0.50% fee + 0.10% slippage + 0.05% spread).
const cryptoCandidate: MomentumCandidate = {
  ...mockCandidate,
  assetClass: 'crypto',
  ticker: 'BTC',
  displaySymbol: 'BTC/USD',
  spreadPct: 0.05,
}

// A stock candidate is never touched by the crypto gate.
assert(
  cryptoNetEdgeBlocker(mockCandidate, { trigger: 150, stop: 147, target1: 153, target2: 156, mode: 'breakout' }) === null,
  'The crypto fee gate must ignore stock candidates',
)

// Thin target: +0.8% does not clear 2.6x the 0.45% modeled round-trip cost.
assert(
  cryptoNetEdgeBlocker(cryptoCandidate, { trigger: 100, stop: 98, target1: 100.8, target2: 102, mode: 'breakout' })?.includes(
    'crypto fee gate',
  ) === true,
  'Active mode should reject a crypto target whose move fees would eat',
)

// Wide spread inflates the round-trip cost so even a +2.4% target is blocked.
const wideSpreadCrypto: MomentumCandidate = { ...cryptoCandidate, spreadPct: 0.8 }
assert(
  cryptoNetEdgeBlocker(wideSpreadCrypto, { trigger: 100, stop: 98, target1: 102.4, target2: 104, mode: 'breakout' })?.includes(
    'round-trip cost',
  ) === true,
  'Active mode should reject a wide-spread crypto entry whose fees overwhelm the move',
)

// Net reward:risk floor: a wide-stop setup whose +1.8% target clears the fee-drag
// and absolute-floor gates but, on a 4% stop, nets only ~0.29R after the 0.65%
// round trip, far below the 0.7R minimum, so it is still blocked.
assert(
  cryptoNetEdgeBlocker(cryptoCandidate, { trigger: 100, stop: 96, target1: 101.8, target2: 104, mode: 'breakout' })?.includes(
    'R minimum',
  ) === true,
  'A crypto entry whose post-fee reward is a small fraction of its risk should be blocked',
)

// Viable: +3% target on a 2% stop nets ~2.55% after the 0.45% round trip, well
// clear of every threshold, so it stays tradable.
assert(
  cryptoNetEdgeBlocker(cryptoCandidate, { trigger: 100, stop: 98, target1: 103, target2: 106, mode: 'breakout' }) === null,
  'A crypto entry that stays net-positive after the full modeled round trip should remain tradable',
)

// 7. Profit trailing: breakeven covers modeled costs, ATR provides a volatility
// noise floor, and mature trends lock progressively more R without lowering stops.
const costLockedStop = adaptiveProfitStop({
  entry: 100,
  currentPrice: 103,
  peakPrice: 103.2,
  currentStop: 97.5,
  initialRisk: 2.5,
  atr: null,
  modeledCostPct: 0.41,
  breakevenAtR: 0.75,
  trailAfterR: 1.15,
  trailDistanceR: 0.7,
  atrTrailMultiple: 2.5,
})
assert(costLockedStop >= 100.41, 'Breakeven trailing should lock modeled round-trip costs, not merely the entry price')

const noAtrTrail = adaptiveProfitStop({
  entry: 100,
  currentPrice: 104,
  peakPrice: 105,
  currentStop: 100.2,
  initialRisk: 2,
  atr: null,
  modeledCostPct: 0.2,
  breakevenAtR: 0.75,
  trailAfterR: 1.15,
  trailDistanceR: 0.7,
  atrTrailMultiple: 2.5,
})
const atrTrail = adaptiveProfitStop({
  entry: 100,
  currentPrice: 104,
  peakPrice: 105,
  currentStop: 100.2,
  initialRisk: 2,
  atr: 0.8,
  modeledCostPct: 0.2,
  breakevenAtR: 0.75,
  trailAfterR: 1.15,
  trailDistanceR: 0.7,
  atrTrailMultiple: 2.5,
})
assert(atrTrail <= noAtrTrail && atrTrail >= 100.2, 'ATR should widen the trail for volatile names without ever lowering the existing stop')

const matureTrendStop = adaptiveProfitStop({
  entry: 100,
  currentPrice: 106.5,
  peakPrice: 107,
  currentStop: 100.2,
  initialRisk: 2,
  atr: 0.5,
  modeledCostPct: 0.2,
  breakevenAtR: 0.75,
  trailAfterR: 1.15,
  trailDistanceR: 0.7,
  atrTrailMultiple: 2.5,
})
assert(matureTrendStop >= 103, 'A 3R+ trend should lock at least 1.5R while leaving room below the live price')

// 8. Paper research keeps monetary and per-symbol cooldown protection without
// biasing the sample with arbitrary position/trade-count ceilings.
assert(isCooldownActive({ until: 2_000 }, 1_000), 'A recorded trade cooldown should remain active before its expiry')
assert(!isCooldownActive({ until: 2_000 }, 2_000), 'A trade cooldown should release exactly at its expiry')
assert(
  dailyRiskReasonFor({ wins: 0, losses: 5, realizedPl: -10 }, 5, 1_000, 'active')?.includes('0W / 5L') === true,
  'Active mode should trip its no-win daily circuit breaker after five losses',
)
assert(
  dailyRiskReasonFor({ wins: 2, losses: 2, realizedPl: -10 }, 1, 1_000, 'active') === null,
  'Normal mixed paper results should not stop further trading',
)
assert(
  positionCountLimitFor(true, 6) === Number.MAX_SAFE_INTEGER,
  'Paper research should have no concurrent-position count ceiling',
)
assert(positionCountLimitFor(false, 6) === 6, 'Live trading should keep its configured position ceiling')
assert(
  monetaryDailyRiskReasonFor({ realizedPl: -29 }, 1_000, 'active') === null,
  'Active paper research should continue above its daily dollar-loss breaker',
)
assert(
  monetaryDailyRiskReasonFor({ realizedPl: -31 }, 1_000, 'active')?.includes('daily loss warning') === true,
  'Active paper research should stop when its daily dollar-loss breaker is exceeded',
)

// 8b. Macro-event blackout: new entries pause in a window around scheduled US
// data prints. FOMC 2026-06-17 announces 14:00 ET = 18:00 UTC (EDT); default
// window is T-2min to T+10min. NFP is the first Friday 08:30 ET (2026-06-05 ->
// 12:30 UTC), proving the DST-correct ET->UTC conversion and computed schedule.
assert(
  macroBlackoutReason(new Date('2026-06-17T18:05:00Z'))?.includes('FOMC') === true,
  'Five minutes after an FOMC decision should be inside the blackout window',
)
assert(
  macroBlackoutReason(new Date('2026-06-17T17:59:00Z'))?.includes('macro blackout') === true,
  'One minute before an FOMC decision should already be blacked out',
)
assert(
  macroBlackoutReason(new Date('2026-06-17T16:00:00Z')) === null,
  'Two hours before the print is well outside the blackout window',
)
assert(
  macroBlackoutReason(new Date('2026-06-17T18:30:00Z')) === null,
  'Thirty minutes after the print is past the T+10min window',
)
assert(
  macroBlackoutReason(new Date('2026-06-05T12:33:00Z'))?.includes('Nonfarm payrolls') === true,
  'The computed first-Friday 08:30 ET NFP window should black out (DST-correct)',
)

// 9. Both production paper modes protect a target-one runner. Safe remains
// stricter on entry/risk; Active increases opportunity without disabling guards.
const safePolicy = botModePolicy('safe')
const activePolicy = botModePolicy('active')
assert(safePolicy.protectTarget1Runner, 'Safe mode should trail a protected runner after target one')
assert(safePolicy.target1TrailLockR > 0, 'Safe target-one protection should lock a positive R floor')
assert(activePolicy.protectTarget1Runner, 'Active mode should trail a protected runner after target one')
assert(activePolicy.stockSpreadCapPct === 0.4, 'Active mode should retain its tested 0.40% stock spread cap')
assert(activePolicy.stockMaxInitialRiskPct === 0.025, 'Active mode should retain its tested 2.5% stock risk cap')
assert(activePolicy.riskPerTradePct === 0.01, 'Active mode should risk at most 1% of equity per trade before sizing reductions')
assert(activePolicy.maxPositions === 6, 'Active should retain its configured six-position live cap')
assert(
  activePolicy.entryConfirmHolds >= 3 && activePolicy.entryConfirmDwellMs >= 20_000,
  'Active mode should require three confirmations and at least 20 seconds of dwell',
)

// 10. Active opportunity capture: a fully confirmed scanner signal gets the
// scanner's 84-point floor, while the riskier WATCH path keeps its 90-point bar.
const confirmedActiveCandidate: MomentumCandidate = { ...mockCandidate, score: 85, status: 'CHECK NOW' }
const watchActiveCandidate: MomentumCandidate = {
  ...mockCandidate,
  ticker: 'MSFT',
  displaySymbol: 'MSFT',
  score: 85,
  status: 'WATCH',
  signal: { ...mockCandidate.signal, action: 'WAIT' },
}
assert(entryScoreFloor(confirmedActiveCandidate) === 84, 'Active should accept fully confirmed CHECK NOW setups from score 84')
assert(entryScoreFloor(watchActiveCandidate) === 90, 'Active should retain the 90-point floor for WATCH probes')

const nearMissCandidate: MomentumCandidate = {
  ...mockCandidate,
  ticker: 'NVDA',
  displaySymbol: 'NVDA',
  score: 80,
  status: 'IGNORE',
  blockers: ['micro pullback still forming'],
  signal: { ...mockCandidate.signal, action: 'AVOID' },
}
const lowQualityCandidate: MomentumCandidate = {
  ...mockCandidate,
  ticker: 'LOWQ',
  displaySymbol: 'LOWQ',
  score: 60,
  status: 'IGNORE',
  blockers: ['move below 6%'],
  signal: { ...mockCandidate.signal, action: 'AVOID' },
}
const observationPool = selectBotObservationCandidates([nearMissCandidate, lowQualityCandidate], 'stock')
assert(
  observationPool.some((candidate) => candidate.ticker === 'NVDA') &&
    !observationPool.some((candidate) => candidate.ticker === 'LOWQ'),
  'The 10-second observation pool should retain high-scoring near misses without admitting weak rows',
)

// 11. Execution-venue validation: Binance can generate the signal, but an
// Alpaca crypto order must independently pass Alpaca BBO freshness, spread, and
// cross-venue divergence before sizing or submission.
const quoteNow = Date.parse('2026-07-22T10:00:00Z')
const cleanExecutionQuote = {
  symbol: 'BTC/USD',
  bid: 99.95,
  bidSize: 2,
  ask: 100.05,
  askSize: 2,
  mid: 100,
  spreadBps: 10,
  timestamp: '2026-07-22T09:59:55Z',
  receivedAt: '2026-07-22T10:00:00Z',
}
assert(
  alpacaCryptoExecutionBlocker({ price: 100 }, cleanExecutionQuote, quoteNow) === null,
  'A fresh, tight Alpaca crypto quote aligned with the signal should pass execution preflight',
)
assert(
  alpacaCryptoExecutionBlocker(
    { price: 100 },
    { ...cleanExecutionQuote, timestamp: '2026-07-22T09:58:00Z' },
    quoteNow,
  )?.includes('stale') === true,
  'A stale Alpaca crypto quote must block order submission',
)
assert(
  alpacaCryptoExecutionBlocker({ price: 100 }, { ...cleanExecutionQuote, spreadBps: 50 }, quoteNow)?.includes('spread') === true,
  'A wide Alpaca crypto execution spread must block order submission',
)
assert(
  alpacaCryptoExecutionBlocker(
    { price: 100 },
    { ...cleanExecutionQuote, bid: 100.95, ask: 101.05, mid: 101 },
    quoteNow,
  )?.includes('diverges') === true,
  'A materially divergent Alpaca crypto price must block a Binance-derived signal',
)

const rebasedCryptoPlan = rebaseTradePlanForEntry(
  { trigger: 100, stop: 98, target1: 103, target2: 106, mode: 'breakout' },
  101,
)
assert(
  rebasedCryptoPlan.trigger === 101 && rebasedCryptoPlan.stop < 101 && rebasedCryptoPlan.target1 > 101,
  'Execution sizing and exits should rebase to the actual Alpaca ask while preserving valid risk structure',
)
const adverseCryptoFill = retunePlanForFill(
  { trigger: 100, stop: 98, target1: 103, target2: 106, mode: 'breakout' },
  101,
  'active',
  'crypto',
)
assert(
  adverseCryptoFill.retuned && adverseCryptoFill.plan.trigger === 101,
  'Active crypto fills with adverse slippage should retune stops and targets from the real fill',
)

console.log('All verification tests passed successfully!')
