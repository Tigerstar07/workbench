import {
  DEFAULT_PIPELINE_PARAMS,
  assertNoTemporalLeakage,
  buildPurgedEmbargoedSplits,
  buildTripleBarrierLabels,
  generateCusumEvents,
  generatePrototypeBars,
  runRobustnessSimulation,
  runStockPredictionPipeline,
  runStockPredictionPipelineOnHistoricalBars,
} from './stockPredictionLabCore.ts'
import { runResearchExperiment, type HistoricalResearchDataset } from './researchExperimentEngine.ts'

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
  console.log(`[PASS] ${message}`)
}

console.log('Running stock prediction research lab tests...')

const params = {
  ...DEFAULT_PIPELINE_PARAMS,
  days: 620,
  regime: 'balanced' as const,
  seed: 91,
  cusumThreshold: 1.1,
}

const bars = generatePrototypeBars(params)
assert(bars.length === params.days, 'prototype EOD ingestion should create the requested number of bars')
assert(bars.every((bar) => Number.isFinite(bar.close) && bar.close > 0), 'all generated closes should be positive finite prices')

const eventDays = generateCusumEvents(bars, params.cusumThreshold)
assert(eventDays.length > 40, 'CUSUM filter should produce enough volatility-scaled events for validation')
assert(eventDays.every((day, index, days) => index === 0 || day > days[index - 1]), 'CUSUM events should be chronological')

const labels = buildTripleBarrierLabels(params, bars, eventDays)
assert(labels.length === eventDays.length, 'triple-barrier labels should map one-to-one to CUSUM events')
assert(labels.every((event) => event.endIndex > event.dayIndex), 'each label horizon should end after the event timestamp')
assert(labels.some((event) => event.label === 1), 'labels should include profit-barrier outcomes')
assert(labels.some((event) => event.label === -1), 'labels should include stop-barrier outcomes')

const splits = buildPurgedEmbargoedSplits(labels, params)
assert(splits.length >= 3, 'purged validation should build at least three usable folds')
assert(splits.every((split) => split.train.length > 0 && split.test.length > 0), 'each split should contain train and test groups')

const audits = assertNoTemporalLeakage(labels, splits, params)
assert(audits.every((audit) => audit.passed), 'purge, embargo, and disjoint-group leakage assertions should pass')

const result = runStockPredictionPipeline(params)
assert(result.metrics.events === result.events.length, 'metrics should report the actual event count')
assert(result.metrics.trades > 0, 'meta-label loop should produce at least one filtered trade')
assert(Number.isFinite(result.metrics.psr), 'PSR should be finite')
assert(Number.isFinite(result.metrics.maxDrawdownR), 'max drawdown should be finite')
assert(Number.isFinite(result.metrics.maxDrawdownPct), 'percent max drawdown should be finite')
assert(result.equity.length > 5, 'strategy equity curve should contain chartable points')
assert(result.benchmark.length > 5, 'benchmark curve should contain chartable points')
assert(Number.isFinite(result.comparison.alphaPct), 'strategy-versus-market alpha should be finite')
assert(
  Math.abs(result.comparison.alphaPct - (result.comparison.strategyNetPct - result.comparison.benchmarkPct)) < 1e-9,
  'alpha should equal net strategy return minus benchmark return',
)
assert(
  Math.abs((result.equity[result.equity.length - 1]?.y ?? 0) - result.comparison.strategyNetPct) < 1e-9,
  'strategy net return should equal the compounded account equity curve, not raw R-units',
)
assert(result.tradeLedger.length === result.metrics.trades, 'trade ledger should expose one row per filtered trade')
assert(
  result.tradeLedger.every((trade) => trade.entryIndex < trade.exitIndex),
  'each ledger row should retain a distinct entry and later exit index',
)
for (const fold of new Set(result.tradeLedger.map((trade) => trade.fold))) {
  const rows = result.tradeLedger
    .filter((trade) => trade.fold === fold)
    .sort((left, right) => left.entryIndex - right.entryIndex)
  assert(
    rows.every((trade, index) => index === 0 || trade.entryIndex > rows[index - 1].exitIndex),
    `fold ${fold} should not compound into overlapping same-symbol trades`,
  )
}
const equityByIndex = new Map(result.equity.map((point) => [point.x, point.y]))
assert(
  result.tradeLedger.every((trade) => equityByIndex.has(trade.entryIndex) && equityByIndex.has(trade.exitIndex)),
  'strategy equity should chart both the flat entry point and realized exit point for every trade',
)
assert(
  result.tradeLedger.every((trade) => Math.abs(trade.accountPnlPct - trade.pnlR * result.params.riskPerTradePct) < 1e-9),
  'each trade should convert pnlR into real account percent using riskPerTradePct',
)
assert(
  result.tradeLedger.every((trade) => Number.isFinite(trade.benchmarkPct) && Number.isFinite(trade.alphaContributionPct)),
  'trade ledger should include benchmark and alpha contribution per trade',
)
assert(result.attribution.topAlphaTrades.length <= 5, 'alpha attribution should expose the top alpha trades')
assert(result.attribution.worstTrades.length <= 5, 'alpha attribution should expose the worst trades')
assert(
  Number.isFinite(result.metrics.timeInMarketPct) &&
    result.metrics.timeInMarketPct >= 0 &&
    result.metrics.timeInMarketPct <= 100,
  'time-in-market exposure should be a finite percentage',
)
assert(
  Math.abs(result.metrics.timeInMarketPct + result.metrics.cashTimePct - 100) < 1e-9,
  'cash time should complement time in market',
)
assert(result.metrics.averageHoldingDays > 0, 'average holding days should be reported from entry and exit indexes')
assert(result.metrics.maxSimultaneousTrades <= 1, 'same-symbol portfolio simulation should never hold overlapping positions')
assert(
  result.metrics.longExposurePct + result.metrics.shortExposurePct <= result.metrics.timeInMarketPct + 1e-9,
  'long and short exposure should not exceed total time in market',
)
assert(result.metrics.skippedOverlapEvents >= 0, 'overlap skip count should be reported')
assert(result.comparison.costDragPct >= 0, 'comparison should report non-negative modeled trading-cost drag')
assert(result.dashboard.forecast.votes.length >= 4, 'dashboard forecast should expose multiple model votes')
assert(
  result.dashboard.forecast.bullProbability >= 0 &&
    result.dashboard.forecast.bullProbability <= 1 &&
    result.dashboard.forecast.bearProbability >= 0 &&
    result.dashboard.forecast.bearProbability <= 1,
  'dashboard forecast probabilities should be normalized',
)
assert(
  result.dashboard.forecast.rangeLowPrice <= result.dashboard.forecast.expectedPrice &&
    result.dashboard.forecast.rangeHighPrice >= result.dashboard.forecast.expectedPrice,
  'dashboard forecast range should bracket the expected price',
)
assert(
  result.dashboard.forecast.action === 'stand-aside' ||
    (result.dashboard.forecast.targetPrice !== null && result.dashboard.forecast.stopPrice !== null),
  'directional dashboard forecasts should expose target and stop prices',
)
assert(result.dashboard.repoInfluences.length >= 4, 'dashboard should disclose the public quant repo influences')
assert(
  result.dashboard.repoInfluences.some((repo) => repo.id === 'mlfinlab' && repo.caveat.includes('no MlFinLab code')),
  'dashboard should disclose methodology-only use for non-permissive MlFinLab',
)
assert(result.intake.sources.length >= 7, 'research intake should expose the institutional source registry')
assert(
  result.intake.questions.some((item) => item.question.includes('net liquidity')),
  'daily research questions should include liquidity context',
)
assert(
  result.intake.signals.some((signal) => signal.name.includes('Order Flow')),
  'signal queue should prioritize order-flow imbalance without faking it',
)
assert(
  result.intake.gates.some((gate) => gate.gate.includes('Survivor-bias') && gate.status === 'fail'),
  'validation gates should explicitly flag missing survivor-bias-free data',
)

const robustness = runRobustnessSimulation(params, 12)
assert(robustness.runs === 12, 'robustness suite should execute the requested number of market seeds')
assert(robustness.alphas.length === 12, 'robustness suite should retain one alpha outcome per seed')
assert(robustness.p05AlphaPct <= robustness.p95AlphaPct, 'robustness percentile range should be ordered')

const historicalTarget = bars.map((bar) => ({ date: bar.date, close: bar.close, volume: bar.volume }))
const historicalBenchmark = generatePrototypeBars({ ...params, ticker: 'SPY', seed: 17 }).map((bar) => ({
  date: bar.date,
  close: bar.close,
  volume: bar.volume,
}))
const historicalResult = runStockPredictionPipelineOnHistoricalBars(
  { ticker: 'SPY', horizon: 12, metaThreshold: 0.54 },
  historicalTarget,
  historicalBenchmark,
  { provider: 'unit-test historical fixture', benchmark: 'SPY' },
  Math.floor(historicalTarget.length * 0.8),
)
assert(historicalResult.dataset.kind === 'historical', 'historical pipeline should mark non-synthetic datasets')
assert(historicalResult.dataset.benchmark === 'SPY', 'historical pipeline should retain benchmark identity')
assert(historicalResult.benchmark.length > 3, 'historical final-test benchmark curve should be chartable')
assert(Number.isFinite(historicalResult.comparison.alphaPct), 'historical final-test alpha should be finite')

const experimentDataset: HistoricalResearchDataset = {
  ticker: 'SPY',
  benchmark: 'SPY',
  provider: 'unit-test historical fixture',
  feed: 'fixture',
  fetchedAt: new Date().toISOString(),
  target: historicalTarget,
  benchmarkBars: historicalBenchmark,
}
const experiment = await runResearchExperiment(
  'unit-test-run',
  { ticker: 'SPY', years: 3, depth: 'quick' },
  experimentDataset,
  new Date().toISOString(),
  () => undefined,
)
assert(experiment.candidatesTested === 24, 'research experiment should test the configured quick-search candidate count')
assert(experiment.schemaVersion === 4, 'research experiment should invalidate stale equity-timing schemas')
assert(experiment.equityTiming === 'realized-on-exit', 'research experiment should declare exit-realized equity timing')
assert(experiment.finalists.length > 0, 'research experiment should retain ranked finalists')
assert(experiment.aggregates.length === 3, 'research experiment should report best, average, and worst validation outcomes')
assert(experiment.finalResult.dataset.kind === 'historical', 'research experiment final test should use historical bars')
assert(
  !experiment.finalPassed ||
    (
      experiment.finalResult.comparison.alphaPct > 0 &&
      experiment.finalResult.metrics.trades >= 30 &&
      experiment.finalResult.metrics.hacT > 2 &&
      experiment.finalResult.metrics.pbo <= 0.05 &&
      experiment.finalResult.metrics.dsr >= 0.7 &&
      experiment.finalResult.comparison.foldBeatRate >= 0.6 &&
      experiment.finalResult.audits.every((audit) => audit.passed)
    ),
  'research experiment should only pass the strict credibility gate',
)

console.log('All stock prediction research lab tests passed successfully!')
