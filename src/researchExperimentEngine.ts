import {
  DEFAULT_PIPELINE_PARAMS,
  runStockPredictionPipelineOnHistoricalBars,
  type HistoricalBarInput,
  type PipelineParams,
  type PipelineResult,
} from './stockPredictionLabCore'

export type SearchDepth = 'quick' | 'standard' | 'deep'

export const RESEARCH_RESULT_SCHEMA_VERSION = 4

export type ResearchExperimentConfig = {
  ticker: string
  years: 3 | 5 | 8
  depth: SearchDepth
}

export type HistoricalResearchDataset = {
  ticker: string
  benchmark: string
  provider: string
  feed: string
  fetchedAt: string
  target: HistoricalBarInput[]
  benchmarkBars: HistoricalBarInput[]
}

export type CandidateOutcome = {
  rank: number
  params: Pick<PipelineParams, 'cusumThreshold' | 'horizon' | 'profitTake' | 'stopLoss' | 'metaThreshold'>
  score: number
  strategyPct: number
  benchmarkPct: number
  alphaPct: number
  sharpe: number
  hacT: number
  maxDrawdownPct: number
  trades: number
  hitRate: number
  foldBeatRate: number
  pbo: number
  dsr: number
  costDragPct: number
  passed: boolean
}

export type OutcomeAggregate = {
  label: 'Best' | 'Average' | 'Worst'
  strategyPct: number
  benchmarkPct: number
  alphaPct: number
  maxDrawdownPct: number
  trades: number
  hitRate: number
}

export type ResearchExperimentResult = {
  schemaVersion: number
  returnUnit: 'compounded-account-percent'
  equityTiming: 'realized-on-exit'
  id: string
  config: ResearchExperimentConfig
  startedAt: string
  completedAt: string
  durationMs: number
  dataset: {
    provider: string
    feed: string
    ticker: string
    benchmark: string
    startDate: string
    endDate: string
    observations: number
    fetchedAt: string
  }
  split: {
    discoveryEnd: string
    validationEnd: string
    finalTestStart: string
  }
  candidatesTested: number
  finalistsTested: number
  selected: CandidateOutcome
  aggregates: OutcomeAggregate[]
  finalists: CandidateOutcome[]
  finalResult: PipelineResult
  finalPassed: boolean
  conclusion: string
}

export type ResearchExperimentSummary = {
  schemaVersion: number
  id: string
  ticker: string
  completedAt: string
  depth: SearchDepth
  years: number
  candidatesTested: number
  strategyPct: number
  benchmarkPct: number
  alphaPct: number
  passed: boolean
}

export type ExperimentProgress = {
  stage: 'loading-data' | 'discovery' | 'validation' | 'final-test' | 'saving'
  completed: number
  total: number
  message: string
}

const DEPTH_BUDGET: Record<SearchDepth, number> = {
  quick: 24,
  standard: 48,
  deep: 80,
}

const CUSUM_VALUES = [0.8, 1, 1.2, 1.4, 1.6]
const HORIZONS = [5, 8, 12, 18, 25, 32]
const PROFIT_TARGETS = [1, 1.4, 1.8, 2.2, 2.6]
const STOP_LOSSES = [0.8, 1, 1.2, 1.5]
const META_THRESHOLDS = [0.5, 0.54, 0.58, 0.62, 0.66]

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function candidateKey(params: CandidateOutcome['params']) {
  return [params.cusumThreshold, params.horizon, params.profitTake, params.stopLoss, params.metaThreshold].join('|')
}

export function buildCandidateGrid(depth: SearchDepth): CandidateOutcome['params'][] {
  const all: CandidateOutcome['params'][] = []
  for (const cusumThreshold of CUSUM_VALUES) {
    for (const horizon of HORIZONS) {
      for (const profitTake of PROFIT_TARGETS) {
        for (const stopLoss of STOP_LOSSES) {
          for (const metaThreshold of META_THRESHOLDS) {
            all.push({ cusumThreshold, horizon, profitTake, stopLoss, metaThreshold })
          }
        }
      }
    }
  }
  const baseline: CandidateOutcome['params'] = {
    cusumThreshold: DEFAULT_PIPELINE_PARAMS.cusumThreshold,
    horizon: DEFAULT_PIPELINE_PARAMS.horizon,
    profitTake: DEFAULT_PIPELINE_PARAMS.profitTake,
    stopLoss: DEFAULT_PIPELINE_PARAMS.stopLoss,
    metaThreshold: DEFAULT_PIPELINE_PARAMS.metaThreshold,
  }
  const ordered = all
    .filter((candidate) => candidateKey(candidate) !== candidateKey(baseline))
    .sort((left, right) => stableHash(candidateKey(left)) - stableHash(candidateKey(right)))
  return [baseline, ...ordered].slice(0, DEPTH_BUDGET[depth])
}

function scoreResult(result: PipelineResult) {
  const tradesPenalty = result.metrics.trades < 15 ? 36 : result.metrics.trades < 30 ? 14 : 0
  return (
    result.comparison.alphaPct +
    result.comparison.foldBeatRate * 8 +
    Math.min(8, Math.max(-8, result.metrics.hacT * 2)) +
    result.metrics.dsr * 6 -
    result.metrics.maxDrawdownPct * 0.25 -
    result.metrics.pbo * 12 -
    tradesPenalty
  )
}

function toOutcome(result: PipelineResult, params: CandidateOutcome['params']): CandidateOutcome {
  const passed = result.comparison.statisticallyCredible
  return {
    rank: 0,
    params,
    score: scoreResult(result),
    strategyPct: result.comparison.strategyNetPct,
    benchmarkPct: result.comparison.benchmarkPct,
    alphaPct: result.comparison.alphaPct,
    sharpe: result.metrics.sharpe,
    hacT: result.metrics.hacT,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    trades: result.metrics.trades,
    hitRate: result.metrics.hitRate,
    foldBeatRate: result.comparison.foldBeatRate,
    pbo: result.metrics.pbo,
    dsr: result.metrics.dsr,
    costDragPct: result.comparison.costDragPct,
    passed,
  }
}

function rankOutcomes(outcomes: CandidateOutcome[]) {
  return outcomes
    .sort((left, right) => right.score - left.score)
    .map((outcome, index) => ({ ...outcome, rank: index + 1 }))
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function aggregate(label: OutcomeAggregate['label'], outcome: CandidateOutcome): OutcomeAggregate {
  return {
    label,
    strategyPct: outcome.strategyPct,
    benchmarkPct: outcome.benchmarkPct,
    alphaPct: outcome.alphaPct,
    maxDrawdownPct: outcome.maxDrawdownPct,
    trades: outcome.trades,
    hitRate: outcome.hitRate,
  }
}

function averageAggregate(outcomes: CandidateOutcome[]): OutcomeAggregate {
  return {
    label: 'Average',
    strategyPct: mean(outcomes.map((outcome) => outcome.strategyPct)),
    benchmarkPct: mean(outcomes.map((outcome) => outcome.benchmarkPct)),
    alphaPct: mean(outcomes.map((outcome) => outcome.alphaPct)),
    maxDrawdownPct: mean(outcomes.map((outcome) => outcome.maxDrawdownPct)),
    trades: Math.round(mean(outcomes.map((outcome) => outcome.trades))),
    hitRate: mean(outcomes.map((outcome) => outcome.hitRate)),
  }
}

function yieldToServer() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export async function runResearchExperiment(
  id: string,
  config: ResearchExperimentConfig,
  dataset: HistoricalResearchDataset,
  startedAt: string,
  onProgress: (progress: ExperimentProgress) => void,
): Promise<ResearchExperimentResult> {
  const startedMs = Date.now()
  const rows = dataset.target.length
  if (rows < 500) throw new Error(`Only ${rows} aligned daily observations were returned; at least 500 are required.`)
  const discoveryEnd = Math.floor(rows * 0.6)
  const validationEnd = Math.floor(rows * 0.8)
  const discoveryTarget = dataset.target.slice(0, discoveryEnd)
  const discoveryBenchmark = dataset.benchmarkBars.slice(0, discoveryEnd)
  const validationTarget = dataset.target.slice(0, validationEnd)
  const validationBenchmark = dataset.benchmarkBars.slice(0, validationEnd)
  const candidates = buildCandidateGrid(config.depth)
  const discoveryOutcomes: CandidateOutcome[] = []

  for (let index = 0; index < candidates.length; index++) {
    onProgress({
      stage: 'discovery',
      completed: index,
      total: candidates.length,
      message: `Testing parameter set ${index + 1} of ${candidates.length} on discovery data`,
    })
    const params = candidates[index]
    const result = runStockPredictionPipelineOnHistoricalBars(
      { ticker: config.ticker, ...params },
      discoveryTarget,
      discoveryBenchmark,
      { provider: dataset.provider, benchmark: dataset.benchmark },
    )
    discoveryOutcomes.push(toOutcome(result, params))
    if (index % 2 === 1) await yieldToServer()
  }

  const rankedDiscovery = rankOutcomes(discoveryOutcomes)
  const finalistCount = Math.min(12, Math.max(6, Math.round(candidates.length / 6)))
  const finalists = rankedDiscovery.slice(0, finalistCount)
  const validationOutcomes: CandidateOutcome[] = []

  for (let index = 0; index < finalists.length; index++) {
    onProgress({
      stage: 'validation',
      completed: index,
      total: finalists.length,
      message: `Validating finalist ${index + 1} of ${finalists.length} out of sample`,
    })
    const params = finalists[index].params
    const result = runStockPredictionPipelineOnHistoricalBars(
      { ticker: config.ticker, ...params },
      validationTarget,
      validationBenchmark,
      { provider: dataset.provider, benchmark: dataset.benchmark },
      discoveryEnd,
    )
    validationOutcomes.push(toOutcome(result, params))
    await yieldToServer()
  }

  const rankedValidation = rankOutcomes(validationOutcomes)
  const selected = rankedValidation[0]
  if (!selected) throw new Error('No parameter set produced enough validation events.')
  onProgress({
    stage: 'final-test',
    completed: 0,
    total: 1,
    message: 'Running the selected specification once on untouched final-test data',
  })
  await yieldToServer()
  const finalResult = runStockPredictionPipelineOnHistoricalBars(
    { ticker: config.ticker, ...selected.params },
    dataset.target,
    dataset.benchmarkBars,
    { provider: dataset.provider, benchmark: dataset.benchmark },
    validationEnd,
  )
  const finalPassed = finalResult.comparison.statisticallyCredible
  const byAlpha = [...rankedValidation].sort((left, right) => right.alphaPct - left.alphaPct)
  const best = byAlpha[0]
  const worst = byAlpha[byAlpha.length - 1]
  const completedAt = new Date().toISOString()

  return {
    schemaVersion: RESEARCH_RESULT_SCHEMA_VERSION,
    returnUnit: 'compounded-account-percent',
    equityTiming: 'realized-on-exit',
    id,
    config,
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    dataset: {
      provider: dataset.provider,
      feed: dataset.feed,
      ticker: dataset.ticker,
      benchmark: dataset.benchmark,
      startDate: dataset.target[0]?.date ?? '',
      endDate: dataset.target[rows - 1]?.date ?? '',
      observations: rows,
      fetchedAt: dataset.fetchedAt,
    },
    split: {
      discoveryEnd: dataset.target[Math.max(0, discoveryEnd - 1)]?.date ?? '',
      validationEnd: dataset.target[Math.max(0, validationEnd - 1)]?.date ?? '',
      finalTestStart: dataset.target[validationEnd]?.date ?? '',
    },
    candidatesTested: candidates.length,
    finalistsTested: rankedValidation.length,
    selected,
    aggregates: [aggregate('Best', best), averageAggregate(rankedValidation), aggregate('Worst', worst)],
    finalists: rankedValidation,
    finalResult,
    finalPassed,
    conclusion: finalPassed
      ? 'The selected specification cleared the strict credibility gate on the untouched final period. Treat it as a research candidate, not a deployment decision.'
      : 'The search did not clear the strict credibility gate on untouched data. Keep the result, inspect the failed criteria, then change the hypothesis or data before rerunning.',
  }
}

export function summarizeExperiment(result: ResearchExperimentResult): ResearchExperimentSummary {
  return {
    schemaVersion: result.schemaVersion,
    id: result.id,
    ticker: result.config.ticker,
    completedAt: result.completedAt,
    depth: result.config.depth,
    years: result.config.years,
    candidatesTested: result.candidatesTested,
    strategyPct: result.finalResult.comparison.strategyNetPct,
    benchmarkPct: result.finalResult.comparison.benchmarkPct,
    alphaPct: result.finalResult.comparison.alphaPct,
    passed: result.finalPassed,
  }
}
