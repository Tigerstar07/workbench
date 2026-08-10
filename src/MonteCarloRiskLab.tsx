import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Compass,
  Database,
  GitFork,
  History,
  Info,
  Layers3,
  LineChart,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import type {
  CandidateOutcome,
  ExperimentProgress,
  OutcomeAggregate,
  ResearchExperimentConfig,
  ResearchExperimentResult,
  ResearchExperimentSummary,
  SearchDepth,
} from './researchExperimentEngine'
import type {
  ChartPoint,
  ForecastAction,
  ForecastDirection,
  ForecastVote,
  PipelineResult,
  PublicRepoInfluence,
  TradeLedgerEntry,
} from './stockPredictionLabCore'
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LastPriceAnimationMode,
  LineSeries,
  LineStyle,
  createChart,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts'
import './MonteCarloRiskLab.css'

type MonteCarloRiskLabProps = {
  onBack: () => void
}

type JobResponse = {
  id: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: ExperimentProgress
  error?: string
  result?: ResearchExperimentResult | null
}

const TICKERS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'TSLA']
const DEPTH_OPTIONS: Array<{ value: SearchDepth; label: string; detail: string }> = [
  { value: 'quick', label: 'Quick', detail: '24 specs' },
  { value: 'standard', label: 'Standard', detail: '48 specs' },
  { value: 'deep', label: 'Deep', detail: '80 specs' },
]
const MODEL_STARTING_CAPITAL = 10_000
const RESEARCH_CHART_RANGES = [
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 183 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'ALL', days: null },
] as const

type ResearchChartMetric = 'account' | 'pnl'
type ResearchChartRange = (typeof RESEARCH_CHART_RANGES)[number]['key']

function pct(value: number, digits = 1) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

function points(value: number, digits = 1) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)} pts`
}

function money(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function signedMoney(value: number, digits = 0) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${money(value, digits)}`
}

function ratio(value: number) {
  return `${(value * 100).toFixed(0)}%`
}

function formatDate(value: string) {
  if (!value) return 'not run yet'
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

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

function scrollToPanel(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function useExperimentLab() {
  const [history, setHistory] = useState<ResearchExperimentSummary[]>([])
  const [experiment, setExperiment] = useState<ResearchExperimentResult | null>(null)
  const [job, setJob] = useState<JobResponse | null>(null)
  const [error, setError] = useState('')

  const fetchHistory = useCallback(async () => {
    const response = await fetch('/api/research/experiments')
    if (!response.ok) throw new Error(`History returned ${response.status}`)
    return await response.json() as ResearchExperimentSummary[]
  }, [])

  const loadHistory = useCallback(async () => {
    const next = await fetchHistory()
    setHistory(next)
    return next
  }, [fetchHistory])

  useEffect(() => {
    let cancelled = false
    void fetchHistory()
      .then(async (items) => {
        if (cancelled || experiment || items.length === 0) return
        setHistory(items)
        const response = await fetch(`/api/research/experiments?id=${encodeURIComponent(items[0].id)}`)
        if (!response.ok) return
        const payload = (await response.json()) as JobResponse
        if (!cancelled && payload.result) setExperiment(payload.result)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load experiment history.')
      })
    return () => {
      cancelled = true
    }
  }, [experiment, fetchHistory])

  useEffect(() => {
    const jobId = job?.id
    const jobStatus = job?.status
    if (!jobId || (jobStatus !== 'queued' && jobStatus !== 'running')) return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch(`/api/research/experiments?id=${encodeURIComponent(jobId)}`)
        if (!response.ok) throw new Error(`Experiment job returned ${response.status}`)
        const next = (await response.json()) as JobResponse
        if (cancelled) return
        setJob(next)
        if (next.status === 'complete' && next.result) {
          setExperiment(next.result)
          setError('')
          void loadHistory()
        }
        if (next.status === 'failed') setError(next.error || 'Research experiment failed.')
      } catch (pollError) {
        if (!cancelled) setError(pollError instanceof Error ? pollError.message : 'Experiment polling failed.')
      }
    }
    const interval = window.setInterval(() => void poll(), 600)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [job?.id, job?.status, loadHistory])

  const start = async (config: ResearchExperimentConfig) => {
    setError('')
    setJob(null)
    const response = await fetch('/api/research/experiments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    })
    const payload = (await response.json()) as JobResponse | { error?: string }
    if (!response.ok) throw new Error('error' in payload && payload.error ? payload.error : `Experiment returned ${response.status}`)
    setJob(payload as JobResponse)
  }

  return { history, experiment, job, error, setError, setExperiment, start }
}

export function MonteCarloRiskLab({ onBack }: MonteCarloRiskLabProps) {
  const [config, setConfig] = useState<ResearchExperimentConfig>({ ticker: 'SPY', years: 5, depth: 'standard' })
  const lab = useExperimentLab()
  const running = lab.job?.status === 'queued' || lab.job?.status === 'running'
  const final = lab.experiment?.finalResult ?? null

  const startRun = async () => {
    try {
      await lab.start(config)
      scrollToPanel('research-results')
    } catch (startError) {
      lab.setError(startError instanceof Error ? startError.message : 'Could not start experiment.')
    }
  }

  return (
    <article className="spl-app-shell spl-focused-shell" aria-label="Quant research machine">
      <ResearchSidebar onBack={onBack} />
      <div className="spl-product-main">
        <header className="spl-product-header spl-focused-header">
          <div className="spl-product-title">
            <strong>Quant Research Machine</strong>
            <span>Run historical searches, score outperformance, and save every experiment.</span>
          </div>
          <div className="spl-header-context spl-focused-context">
            <span><Clock3 size={14} /> {lab.experiment ? `Last run ${formatDate(lab.experiment.completedAt)}` : 'Ready for a run'}</span>
            <span className={`spl-live-state ${running ? '' : 'online'}`}>{running ? 'Running' : 'Idle'}</span>
          </div>
        </header>

        <main className="spl-lab spl-focused-lab">
          {lab.error && <div className="spl-fetch-error">{lab.error}</div>}
          <VerdictPanel experiment={lab.experiment} running={running} />

          <section className="spl-machine-grid spl-forecast-grid" id="research-run">
            <RunSetupPanel config={config} running={running} onChange={setConfig} onRun={startRun} />
            <ForecastDecisionPanel result={final} />
            <ProgressPanel job={lab.job} running={running} experiment={lab.experiment} />
          </section>

          <section className="spl-results-grid spl-dashboard-results" id="research-results">
            <div className="spl-panel spl-primary-chart">
              <div className="spl-panel-head">
                <div>
                  <h2><LineChart size={17} /> Modeled account value: strategy vs SPY</h2>
                  <span>{final ? `${final.dataset.startDate} to ${final.dataset.endDate} - $10,000 modeled start` : 'No final test yet'}</span>
                </div>
                {lab.experiment && (
                  <span className={`spl-panel-chip ${lab.experiment.finalPassed ? 'candidate' : 'not-usable'}`}>
                    {lab.experiment.finalPassed ? 'candidate only' : 'not usable'}
                  </span>
                )}
              </div>
              {final ? <ResearchPerformanceChart result={final} /> : <EmptyChart />}
              <div className="spl-chart-foot">
                <span>{final ? `strategy ${money(accountEnd(final.equity))}` : 'press Run research search'}</span>
                <span>{final ? `SPY ${money(accountEnd(final.benchmark))}` : 'deterministic parameter sweep'}</span>
                <span>{final ? `alpha ${signedMoney(alphaDollars(final))}` : 'stored locally after run'}</span>
              </div>
            </div>
            <ModelEnsemblePanel result={final} />
          </section>

          {lab.experiment && (
            <>
              <section className="spl-analysis-grid">
                <StrategyAnatomy result={lab.experiment.finalResult} />
                <CredibilityPanel result={lab.experiment.finalResult} finalPassed={lab.experiment.finalPassed} />
              </section>
              <section className="spl-analysis-grid">
                <OutcomeCards aggregates={lab.experiment.aggregates} />
                <NextStepPanel experiment={lab.experiment} />
              </section>
              <section className="spl-analysis-grid">
                <RepoInfluencePanel influences={lab.experiment.finalResult.dashboard.repoInfluences} />
                <Scorecard experiment={lab.experiment} />
              </section>
              <section className="spl-analysis-grid spl-evidence-grid">
                <TradeLedgerPanel result={lab.experiment.finalResult} />
                <AlphaAttributionPanel result={lab.experiment.finalResult} />
              </section>
              <FinalistTable finalists={lab.experiment.finalists} />
            </>
          )}

          <HistoryPanel history={lab.history} activeId={lab.experiment?.id ?? ''} onOpen={lab.setExperiment} />
          <MethodDrawer experiment={lab.experiment} />
        </main>
      </div>
    </article>
  )
}

function ResearchSidebar({ onBack }: { onBack: () => void }) {
  const items = [
    { id: 'research-run', label: 'Run Search', detail: 'Start experiment', icon: Play },
    { id: 'research-results', label: 'Results', detail: 'Final test', icon: BarChart3 },
    { id: 'research-history', label: 'History', detail: 'Saved runs', icon: History },
  ]
  return (
    <aside className="spl-sidebar spl-focused-sidebar">
      <button type="button" className="spl-brand" onClick={onBack}><Layers3 size={25} /><span>QuantLab</span></button>
      <button type="button" className="spl-sidebar-home" onClick={onBack}><ArrowLeft size={17} /> Back to portfolio</button>
      <p>Research workflow</p>
      <nav aria-label="Research workflow">
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <button type="button" key={item.id} className={index === 0 ? 'active' : ''} onClick={() => scrollToPanel(item.id)}>
              <i>{index + 1}</i><Icon size={16} /><span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          )
        })}
      </nav>
      <div className="spl-sidebar-note">
        <ShieldCheck size={16} />
        <span>Final test is not reused for tuning.</span>
      </div>
    </aside>
  )
}

function VerdictPanel({ experiment, running }: { experiment: ResearchExperimentResult | null; running: boolean }) {
  if (running) {
    return (
      <section className="spl-verdict running">
        <div className="spl-verdict-copy">
          <span><Loader2 size={18} className="spl-spin" /></span>
          <div><small>Research run active</small><h1>The machine is testing parameter sets</h1><p>It is ranking candidates server-side, so the browser should stay responsive.</p></div>
        </div>
      </section>
    )
  }

  if (!experiment) {
    return (
      <section className="spl-verdict neutral-verdict">
        <div className="spl-verdict-copy">
          <span><Target size={18} /></span>
          <div><small>Ready</small><h1>Run a real historical market test</h1><p>Pick the dataset, press one button, and the local server will search specs, rank them, and save the result.</p></div>
        </div>
      </section>
    )
  }

  const final = experiment.finalResult
  const forecast = final.dashboard.forecast
  const alpha = final.comparison.alphaPct
  const directionIcon =
    forecast.direction === 'bullish' ? <TrendingUp size={18} /> : forecast.direction === 'bearish' ? <TrendingDown size={18} /> : <Compass size={18} />
  const candidateText =
    forecast.direction === 'neutral'
      ? `The ensemble is not separated enough for a directional call. Holdout alpha is ${points(alpha)} and this remains research-only.`
      : `${forecast.direction === 'bullish' ? 'Upside' : 'Downside'} forecast for ${forecast.horizonDays} trading days: ${pct(forecast.expectedMovePct)} expected move, ${ratio(forecast.confidence)} confidence.`
  return (
    <section className={`spl-verdict ${forecast.direction} ${experiment.finalPassed ? 'credible-outperformance' : 'underperformed'}`}>
      <div className="spl-verdict-copy">
        <span>{directionIcon}</span>
        <div>
          <small>Current prediction</small>
          <h1>{final.params.ticker} {directionLabel(forecast.direction)} {forecast.horizonDays}d forecast</h1>
          <p>{candidateText}</p>
        </div>
      </div>
      <div className="spl-verdict-metrics">
        <div><span>Current</span><strong>{money(forecast.currentPrice, 2)}</strong></div>
        <div><span>Expected</span><strong>{money(forecast.expectedPrice, 2)}</strong></div>
        <div className={forecast.expectedMovePct >= 0 ? 'good' : 'bad'}><span>Move</span><strong>{pct(forecast.expectedMovePct, 2)}</strong></div>
        <div><span>Action</span><strong>{actionLabel(forecast.action)}</strong></div>
      </div>
    </section>
  )
}

function RunSetupPanel({
  config,
  running,
  onChange,
  onRun,
}: {
  config: ResearchExperimentConfig
  running: boolean
  onChange: (config: ResearchExperimentConfig) => void
  onRun: () => void
}) {
  return (
    <div className="spl-panel spl-run-panel">
      <div className="spl-panel-head">
        <div>
          <h2><Play size={17} /> Research run</h2>
          <span>One button starts a deterministic search, not a random reroll</span>
        </div>
        <button type="button" className="spl-icon-button" disabled={running} onClick={() => onChange({ ticker: 'SPY', years: 5, depth: 'standard' })} title="Reset run setup"><RotateCcw size={14} /></button>
      </div>
      <div className="spl-run-fields">
        <label className="spl-field">
          <span>Target asset</span>
          <select value={config.ticker} disabled={running} onChange={(event) => onChange({ ...config, ticker: event.target.value })}>
            {TICKERS.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}
          </select>
        </label>
        <label className="spl-field">
          <span>Historical window</span>
          <select value={config.years} disabled={running} onChange={(event) => onChange({ ...config, years: Number(event.target.value) as 3 | 5 | 8 })}>
            <option value={3}>3 years</option>
            <option value={5}>5 years</option>
            <option value={8}>8 years</option>
          </select>
        </label>
        <label className="spl-field">
          <span>Search depth</span>
          <select value={config.depth} disabled={running} onChange={(event) => onChange({ ...config, depth: event.target.value as SearchDepth })}>
            {DEPTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} - {option.detail}</option>)}
          </select>
        </label>
      </div>
      <button type="button" className="spl-run-button" disabled={running} onClick={onRun}>
        {running ? <Loader2 size={15} className="spl-spin" /> : <Play size={15} />}
        {running ? 'Research run active' : 'Run research search'}
      </button>
      <p className="spl-run-note">The final 20% of history is held back until the selected specification is chosen.</p>
    </div>
  )
}

function ProgressPanel({
  job,
  running,
  experiment,
}: {
  job: JobResponse | null
  running: boolean
  experiment: ResearchExperimentResult | null
}) {
  const progress = job?.progress
  const percent = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
  const final = experiment?.finalResult ?? null
  const useRows = experiment && final ? [
    {
      label: 'Found edge?',
      value: experiment.finalPassed ? 'Candidate only' : 'No',
      detail: experiment.finalPassed ? 'Cleared the strict final gate once.' : 'Do not use this spec.',
      tone: experiment.finalPassed ? 'good' : 'bad',
    },
    {
      label: 'Trade live?',
      value: 'No',
      detail: 'Needs confirmation runs and paper-bot tracking first.',
      tone: 'warn',
    },
    {
      label: 'Next test',
      value: experiment.finalPassed ? 'Confirm' : 'New thesis',
      detail: experiment.finalPassed ? 'Re-run on a different window before adding features.' : 'Change inputs or data source, then save a new run.',
      tone: 'neutral',
    },
  ] : []

  return (
    <div className="spl-panel spl-progress-panel">
      <div className="spl-panel-head">
        <div>
          <h2><Database size={17} /> Computer work</h2>
          <span>{running ? 'Discovery, validation, final test, then save' : 'What this run means'}</span>
        </div>
      </div>
      <div className="spl-progress-track"><span style={{ width: `${running ? Math.max(8, percent) : 0}%` }} /></div>
      {running ? (
        <div className="spl-progress-body">
          <strong>{progress?.message ?? 'Preparing experiment.'}</strong>
          <span>{progress ? `${progress.stage.replace('-', ' ')} - ${progress.completed}/${progress.total}` : 'Starting server-side search.'}</span>
        </div>
      ) : experiment && final ? (
        <div className="spl-use-result">
          <strong>{experiment.finalPassed ? 'Saved research candidate' : 'Saved rejected run'}</strong>
          <span>Run ID {experiment.id} - {experiment.candidatesTested} specs tested, {experiment.finalistsTested} finalists confirmed.</span>
          <div className="spl-use-rows">
            {useRows.map((row) => (
              <div key={row.label} className={row.tone}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <small>{row.detail}</small>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="spl-progress-body">
          <strong>No active run.</strong>
          <span>Press Run research search to begin.</span>
        </div>
      )}
    </div>
  )
}

function directionLabel(direction: ForecastDirection) {
  if (direction === 'bullish') return 'bullish'
  if (direction === 'bearish') return 'bearish'
  return 'neutral'
}

function actionLabel(action: ForecastAction) {
  if (action === 'watch-long') return 'Watch long'
  if (action === 'watch-short') return 'Watch short'
  if (action === 'wait-for-confirmation') return 'Wait'
  return 'Stand aside'
}

function priceLabel(value: number | null, digits = 2) {
  return value === null ? '--' : money(value, digits)
}

function voteIcon(vote: ForecastVote) {
  if (vote.family === 'meta-label') return <BrainCircuit size={15} />
  if (vote.family === 'trend') return <TrendingUp size={15} />
  if (vote.family === 'reversion') return <Activity size={15} />
  return <ShieldCheck size={15} />
}

function ForecastDecisionPanel({ result }: { result: PipelineResult | null }) {
  const forecast = result?.dashboard.forecast
  const quality = result?.dashboard
  const blockers = quality?.blockers ?? []

  if (!forecast || !quality) {
    return (
      <div className="spl-panel spl-forecast-panel empty">
        <div className="spl-panel-head">
          <div>
            <h2><Compass size={17} /> Forecast desk</h2>
            <span>No saved run loaded yet</span>
          </div>
        </div>
        <p className="spl-empty-copy">Run a research search to produce a directional forecast, confidence, target, stop, and model votes.</p>
      </div>
    )
  }

  return (
    <div className={`spl-panel spl-forecast-panel ${forecast.direction}`}>
      <div className="spl-panel-head">
        <div>
          <h2><Compass size={17} /> Forecast desk</h2>
          <span>As of {forecast.asOfDate}; {forecast.horizonDays} trading-day horizon</span>
        </div>
        <span className={`spl-panel-chip ${quality.qualityLabel === 'candidate-watch' ? 'candidate' : quality.qualityLabel === 'blocked' ? 'not-usable' : ''}`}>
          {quality.qualityLabel.replace('-', ' ')}
        </span>
      </div>
      <div className="spl-forecast-hero">
        <div>
          <span>Direction</span>
          <strong>{directionLabel(forecast.direction)}</strong>
          <small>{forecast.rationale}</small>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{ratio(forecast.confidence)}</strong>
          <small>Bull {ratio(forecast.bullProbability)} / bear {ratio(forecast.bearProbability)}</small>
        </div>
      </div>
      <div className="spl-forecast-grid-metrics">
        <div><span>Current</span><strong>{money(forecast.currentPrice, 2)}</strong></div>
        <div><span>Expected</span><strong>{money(forecast.expectedPrice, 2)}</strong></div>
        <div><span>Expected move</span><strong className={forecast.expectedMovePct >= 0 ? 'pos' : 'neg'}>{pct(forecast.expectedMovePct, 2)}</strong></div>
        <div><span>Target</span><strong>{priceLabel(forecast.targetPrice)}</strong></div>
        <div><span>Stop</span><strong>{priceLabel(forecast.stopPrice)}</strong></div>
        <div><span>Range</span><strong>{priceLabel(forecast.rangeLowPrice)} - {priceLabel(forecast.rangeHighPrice)}</strong></div>
      </div>
      {blockers.length > 0 && (
        <div className="spl-blocker-list">
          {blockers.slice(0, 3).map((blocker) => (
            <span key={blocker}><CheckCircle2 size={13} /> {blocker}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ModelEnsemblePanel({ result }: { result: PipelineResult | null }) {
  const forecast = result?.dashboard.forecast

  return (
    <div className="spl-panel spl-model-panel">
      <div className="spl-panel-head">
        <div>
          <h2><BrainCircuit size={17} /> Model ensemble</h2>
          <span>{forecast ? `${forecast.votes.length} votes behind the forecast` : 'No model votes yet'}</span>
        </div>
      </div>
      {!forecast ? (
        <p className="spl-empty-copy">The ensemble appears after a run finishes.</p>
      ) : (
        <>
          <div className="spl-model-balance">
            <div><span>Bull</span><strong>{ratio(forecast.bullProbability)}</strong></div>
            <div><span>Bear</span><strong>{ratio(forecast.bearProbability)}</strong></div>
          </div>
          <div className="spl-vote-list">
            {forecast.votes.map((vote) => (
              <div key={vote.id} className={vote.stance}>
                <i>{voteIcon(vote)}</i>
                <div>
                  <strong>{vote.model}</strong>
                  <span>{vote.evidence}</span>
                </div>
                <b>{directionLabel(vote.stance)}</b>
                <small>{pct(vote.forecastPct, 2)}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RepoInfluencePanel({ influences }: { influences: PublicRepoInfluence[] }) {
  return (
    <div className="spl-panel spl-repo-panel">
      <div className="spl-panel-head">
        <div>
          <h2><GitFork size={17} /> Public repo influence</h2>
          <span>Patterns researched and adapted into the local TypeScript dashboard</span>
        </div>
      </div>
      <div className="spl-repo-list">
        {influences.map((repo) => (
          <a key={repo.id} href={repo.url} target="_blank" rel="noreferrer">
            <span><strong>{repo.name}</strong><small>{repo.license} / {repo.role}</small></span>
            <p>{repo.adopted}</p>
            <em>{repo.caveat}</em>
          </a>
        ))}
      </div>
    </div>
  )
}

function Scorecard({ experiment }: { experiment: ResearchExperimentResult | null }) {
  const result = experiment?.finalResult ?? null
  const rows = result ? [
    ['Status', experiment?.finalPassed ? 'Candidate' : 'Rejected'],
    ['Strategy account', money(accountEnd(result.equity))],
    ['SPY buy-hold', money(accountEnd(result.benchmark))],
    ['Alpha dollars', signedMoney(alphaDollars(result))],
    ['Trades / hit rate', `${result.metrics.trades} / ${ratio(result.metrics.hitRate)}`],
    ['Live use', 'No'],
  ] : [
    ['Status', '--'],
    ['Strategy account', '--'],
    ['SPY buy-hold', '--'],
    ['Alpha dollars', '--'],
    ['Trades / hit rate', '--'],
    ['Live use', '--'],
  ]
  return (
    <div className="spl-panel spl-scorecard-panel">
      <div className="spl-panel-head"><h2><Trophy size={17} /> Holdout scorecard</h2></div>
      <div className="spl-scorecard">
        {rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
    </div>
  )
}

function decimal(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
}

function plainPct(value: number, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : 'n/a'
}

function featureSummary(trade: TradeLedgerEntry) {
  const features = trade.features
  return `m5 ${decimal(features.momentum5, 1)} / m20 ${decimal(features.momentum20, 1)} / vol ${decimal(features.volatility20, 1)} / vZ ${decimal(features.volumeZ, 1)} / trend ${decimal(features.marketTrend, 1)}`
}

function credibilityRows(result: PipelineResult) {
  const auditsPassed = result.audits.filter((audit) => audit.passed).length
  return [
    { label: 'Alpha', value: points(result.comparison.alphaPct), hurdle: '> 0 pts', passed: result.comparison.alphaPct > 0 },
    { label: 'Trades', value: String(result.metrics.trades), hurdle: '>= 30', passed: result.metrics.trades >= 30 },
    { label: 'HAC t-stat', value: decimal(result.metrics.hacT, 2), hurdle: '> 2.00', passed: result.metrics.hacT > 2 },
    { label: 'PBO', value: ratio(result.metrics.pbo), hurdle: '<= 5%', passed: result.metrics.pbo <= 0.05 },
    { label: 'DSR', value: decimal(result.metrics.dsr, 2), hurdle: '>= 0.70', passed: result.metrics.dsr >= 0.7 },
    { label: 'Fold beat rate', value: ratio(result.comparison.foldBeatRate), hurdle: '>= 60%', passed: result.comparison.foldBeatRate >= 0.6 },
    { label: 'Leakage audits', value: `${auditsPassed}/${result.audits.length}`, hurdle: 'all pass', passed: result.audits.every((audit) => audit.passed) },
  ]
}

function StrategyAnatomy({ result }: { result: PipelineResult }) {
  const featureNames = result.featureImportance.map((item) => item.key).join(', ')
  const rows = [
    ['CUSUM threshold', `${result.params.cusumThreshold}x volatility`],
    ['Holding horizon', `${result.params.horizon} trading days`],
    ['Risk per trade', `${result.params.riskPerTradePct}% of account per 1R`],
    ['Equity timing', 'P/L realized on exit, not entry'],
    ['Open-position rule', `max 1 ${result.params.ticker} trade; skipped ${result.metrics.skippedOverlapEvents} overlaps`],
    ['Time in market', `${plainPct(result.metrics.timeInMarketPct)} invested / ${plainPct(result.metrics.cashTimePct)} cash`],
    ['Avg hold / max open', `${decimal(result.metrics.averageHoldingDays, 1)} days / ${result.metrics.maxSimultaneousTrades}`],
    ['Long / short exposure', `${plainPct(result.metrics.longExposurePct)} / ${plainPct(result.metrics.shortExposurePct)}`],
    ['Profit target', `${result.params.profitTake}R`],
    ['Stop loss', `${result.params.stopLoss}R`],
    ['Meta threshold', `p >= ${result.params.metaThreshold.toFixed(2)}`],
    ['Features used', featureNames],
    ['Side logic', 'long/short from momentum, sentiment, market trend, volume, volatility, and fractional-diff score'],
    ['Exit logic', `profit target, stop loss, or timeout after ${result.params.horizon} days`],
  ]
  return (
    <div className="spl-panel spl-strategy-panel">
      <div className="spl-panel-head"><div><h2><Target size={17} /> Selected strategy anatomy</h2><span>The exact spec that reached the final holdout</span></div></div>
      <div className="spl-strategy-anatomy">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function CredibilityPanel({ result, finalPassed }: { result: PipelineResult; finalPassed: boolean }) {
  const gateRows = credibilityRows(result)
  const diagnostics = [
    { label: 'Strategy real return', value: pct(result.comparison.strategyNetPct), passed: result.comparison.strategyNetPct > 0 },
    { label: 'Benchmark return', value: pct(result.comparison.benchmarkPct), passed: true },
    { label: 'Trade Sharpe', value: decimal(result.metrics.sharpe, 2), passed: result.metrics.sharpe > 0 },
    { label: 'Portfolio Sharpe', value: decimal(result.metrics.portfolioSharpe, 2), passed: result.metrics.portfolioSharpe > 0 },
    { label: 'Max drawdown', value: pct(-result.metrics.maxDrawdownPct), passed: result.metrics.maxDrawdownPct <= 20 },
    { label: 'Cost drag', value: pct(-result.comparison.costDragPct), passed: result.comparison.costDragPct <= 5 },
    { label: 'Time in market', value: plainPct(result.metrics.timeInMarketPct), passed: result.metrics.timeInMarketPct > 0 },
    { label: 'Avg hold', value: `${decimal(result.metrics.averageHoldingDays, 1)}d`, passed: result.metrics.averageHoldingDays > 0 },
    { label: 'Max open', value: String(result.metrics.maxSimultaneousTrades), passed: result.metrics.maxSimultaneousTrades <= 1 },
  ]
  return (
    <div className="spl-panel spl-credibility-panel">
      <div className="spl-panel-head">
        <div>
          <h2><ShieldCheck size={17} /> Why this {finalPassed ? 'passed' : 'failed'}</h2>
          <span>Candidate status requires every strict gate to pass</span>
        </div>
        <span className={`spl-panel-chip ${finalPassed ? 'candidate' : 'not-usable'}`}>{finalPassed ? 'strict pass' : 'strict fail'}</span>
      </div>
      <div className="spl-credibility-grid">
        {gateRows.map((row) => (
          <div key={row.label} className={row.passed ? 'pass' : 'fail'}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <small>{row.passed ? 'passes' : 'fails'} {row.hurdle}</small>
          </div>
        ))}
      </div>
      <div className="spl-diagnostic-strip">
        {diagnostics.map((row) => (
          <div key={row.label} className={row.passed ? 'pass' : 'fail'}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function OutcomeCards({ aggregates }: { aggregates: OutcomeAggregate[] }) {
  return (
    <div className="spl-panel spl-outcome-panel">
      <div className="spl-panel-head"><div><h2><BarChart3 size={17} /> Validation outcomes</h2><span>Best, average, and worst finalist before the final test</span></div></div>
      <div className="spl-outcome-grid">
        {aggregates.map((item) => (
          <div key={item.label} className="spl-outcome-card">
            <span>{item.label}</span>
            <strong className={item.alphaPct >= 0 ? 'pos' : 'neg'}>{points(item.alphaPct)}</strong>
            <small>strategy {pct(item.strategyPct)} vs SPY {pct(item.benchmarkPct)}</small>
            <small>{item.trades} trades, {ratio(item.hitRate)} hit rate</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function NextStepPanel({ experiment }: { experiment: ResearchExperimentResult }) {
  const final = experiment.finalResult
  const items = experiment.finalPassed
    ? [
        'Call this a candidate, not a market-beating system.',
        'Run confirmation on another untouched window before adding any new features.',
        'Only after repeated confirmation, wire this spec into the paper bot with tiny size and compare live account value versus SPY.',
      ]
    : [
      'Do not use this spec or tune directly against this failed final test.',
      'Change the hypothesis or data source, then run a new saved experiment.',
      final.metrics.trades < 30 ? 'The final period had too few trades for proof; broaden event sampling or window length.' : 'Study the failed credibility rows to see which evidence broke first.',
    ]
  return (
    <div className="spl-panel spl-next-panel">
      <div className="spl-panel-head"><div><h2><Target size={17} /> How to utilize this</h2><span>{experiment.finalPassed ? 'Use it as a research lead' : 'Use it as a rejection record'}</span></div></div>
      <div className="spl-selected-spec">
        <span>Selected spec</span>
        <strong>{final.params.horizon}d hold / PT {final.params.profitTake}R / SL {final.params.stopLoss}R / p {'>='} {final.params.metaThreshold.toFixed(2)}</strong>
      </div>
      <ol>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </div>
  )
}

function TradeLedgerPanel({ result }: { result: PipelineResult }) {
  const ledger = result.tradeLedger ?? []
  const rows = ledger.slice(0, 30)
  return (
    <section className="spl-panel spl-trade-ledger-panel">
      <div className="spl-panel-head">
        <div><h2><Database size={17} /> Trade ledger</h2><span>{ledger.length} final-holdout trades; account P/L is booked on exit date</span></div>
      </div>
      {rows.length === 0 ? <p className="spl-empty-copy">No trades passed the meta threshold in this holdout.</p> : (
        <div className="spl-trade-ledger">
          <div>
            <span>Entry</span><span>Exit</span><span>Side</span><span>Entry px</span><span>Exit px</span><span>Prob</span><span>Reason</span><span>PnL R</span><span>Acct %</span><span>SPY %</span><span>Alpha</span><span>Features</span>
          </div>
          {rows.map((trade) => (
            <div key={`${trade.id}-${trade.entryDate}-${trade.exitDate}`}>
              <span>{trade.entryDate}</span>
              <span>{trade.exitDate}</span>
              <strong className={trade.side === 'long' ? 'pos' : 'neg'}>{trade.side}</strong>
              <span>{money(trade.entryPrice, 2)}</span>
              <span>{money(trade.exitPrice, 2)}</span>
              <span>{ratio(trade.signalProbability)}</span>
              <span>{trade.exitReason}</span>
              <strong className={trade.pnlR >= 0 ? 'pos' : 'neg'}>{decimal(trade.pnlR, 2)}R</strong>
              <span>{pct(trade.accountPnlPct, 2)}</span>
              <span>{pct(trade.benchmarkPct, 2)}</span>
              <strong className={trade.alphaContributionPct >= 0 ? 'pos' : 'neg'}>{points(trade.alphaContributionPct, 2)}</strong>
              <small>{featureSummary(trade)}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AlphaAttributionPanel({ result }: { result: PipelineResult }) {
  const attribution = result.attribution
  const top = attribution?.topAlphaTrades ?? []
  const worst = attribution?.worstTrades ?? []
  return (
    <section className="spl-panel spl-attribution-panel">
      <div className="spl-panel-head"><div><h2><BarChart3 size={17} /> Alpha attribution</h2><span>Checks whether outperformance is broad or concentrated</span></div></div>
      <div className="spl-attribution-metrics">
        <div><span>Top 1 share</span><strong>{ratio(attribution?.top1AlphaShare ?? 0)}</strong></div>
        <div><span>Top 3 share</span><strong>{ratio(attribution?.top3AlphaShare ?? 0)}</strong></div>
        <div><span>Long alpha</span><strong className={(attribution?.longAlphaPct ?? 0) >= 0 ? 'pos' : 'neg'}>{points(attribution?.longAlphaPct ?? 0, 2)}</strong></div>
        <div><span>Short alpha</span><strong className={(attribution?.shortAlphaPct ?? 0) >= 0 ? 'pos' : 'neg'}>{points(attribution?.shortAlphaPct ?? 0, 2)}</strong></div>
        <div><span>Alpha while invested</span><strong className={(attribution?.alphaWhileInvestedPct ?? 0) >= 0 ? 'pos' : 'neg'}>{points(attribution?.alphaWhileInvestedPct ?? 0, 2)}</strong></div>
        <div><span>Cash drag vs SPY</span><strong className={(attribution?.cashDragPct ?? 0) >= 0 ? 'pos' : 'neg'}>{points(attribution?.cashDragPct ?? 0, 2)}</strong></div>
        <div><span>Alpha while in cash</span><strong className={(attribution?.alphaWhileInCashPct ?? 0) >= 0 ? 'pos' : 'neg'}>{points(attribution?.alphaWhileInCashPct ?? 0, 2)}</strong></div>
      </div>
      {attribution?.concentrationWarning && <p className="spl-attribution-warning">{attribution.concentrationWarning}</p>}
      <div className="spl-attribution-columns">
        <div>
          <strong>Top alpha trades</strong>
          {top.length === 0 ? <span>No positive alpha trades.</span> : top.map((trade) => (
            <span key={`top-${trade.id}-${trade.entryDate}`}>{trade.entryDate} {trade.side} {points(trade.alphaContributionPct, 2)}</span>
          ))}
        </div>
        <div>
          <strong>Worst trades</strong>
          {worst.length === 0 ? <span>No ledger rows.</span> : worst.map((trade) => (
            <span key={`worst-${trade.id}-${trade.entryDate}`}>{trade.entryDate} {trade.side} {points(trade.alphaContributionPct, 2)}</span>
          ))}
        </div>
        <div>
          <strong>By regime</strong>
          {(attribution?.alphaByRegime ?? []).map((row) => (
            <span key={row.label}>{row.label}: {points(row.alphaPct, 2)} / {row.trades} trades</span>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalistTable({ finalists }: { finalists: CandidateOutcome[] }) {
  return (
    <section className="spl-panel spl-finalist-panel">
      <div className="spl-panel-head"><div><h2><ShieldCheck size={17} /> Ranked finalists</h2><span>Validation ranking before the untouched final period</span></div></div>
      <div className="spl-finalist-table">
        <div><span>#</span><span>Spec</span><span>Alpha</span><span>Strategy</span><span>SPY</span><span>Trades</span><span>Gate</span></div>
        {finalists.slice(0, 10).map((item) => (
          <div key={`${item.rank}-${item.params.horizon}-${item.params.metaThreshold}`}>
            <span>{item.rank}</span>
            <span>{item.params.horizon}d / PT {item.params.profitTake}R / SL {item.params.stopLoss}R / p {item.params.metaThreshold.toFixed(2)}</span>
            <strong className={item.alphaPct >= 0 ? 'pos' : 'neg'}>{points(item.alphaPct)}</strong>
            <span>{pct(item.strategyPct)}</span>
            <span>{pct(item.benchmarkPct)}</span>
            <span>{item.trades}</span>
            <span>{item.passed ? 'pass' : 'fail'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function HistoryPanel({
  history,
  activeId,
  onOpen,
}: {
  history: ResearchExperimentSummary[]
  activeId: string
  onOpen: (result: ResearchExperimentResult) => void
}) {
  const [loadingId, setLoadingId] = useState('')
  const open = async (id: string) => {
    setLoadingId(id)
    try {
      const response = await fetch(`/api/research/experiments?id=${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error(`Run returned ${response.status}`)
      const payload = (await response.json()) as JobResponse
      if (payload.result) onOpen(payload.result)
    } finally {
      setLoadingId('')
    }
  }
  return (
    <section className="spl-panel spl-history-panel" id="research-history">
      <div className="spl-panel-head"><div><h2><History size={17} /> Saved research runs</h2><span>Stored locally in .quant-research</span></div></div>
      {history.length === 0 ? <p className="spl-empty-copy">No saved runs yet.</p> : (
        <div className="spl-history-list">
          {history.map((item) => (
            <button type="button" key={item.id} className={item.id === activeId ? 'active' : ''} onClick={() => void open(item.id)}>
              <span><strong>{item.ticker}</strong><small>{formatDate(item.completedAt)} - {item.depth}, {item.candidatesTested} specs</small></span>
              <b className={item.alphaPct >= 0 ? 'pos' : 'neg'}>{loadingId === item.id ? 'Loading' : points(item.alphaPct)}</b>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function MethodDrawer({ experiment }: { experiment: ResearchExperimentResult | null }) {
  return (
    <details className="spl-methodology-drawer">
      <summary><Info size={17} /> Experiment method and stored data <ChevronRight size={16} /></summary>
      <div className="spl-method-grid">
        <div>
          <strong>Data source</strong>
          <span>{experiment ? `${experiment.dataset.provider} (${experiment.dataset.feed})` : 'Alpaca daily OHLCV after a run starts'}</span>
        </div>
        <div>
          <strong>Benchmark</strong>
          <span>{experiment ? experiment.dataset.benchmark : 'SPY'}</span>
        </div>
        <div>
          <strong>Split</strong>
          <span>{experiment ? `Discovery to ${experiment.split.discoveryEnd}, validation to ${experiment.split.validationEnd}, final from ${experiment.split.finalTestStart}` : '60% discovery, 20% validation, 20% untouched final test'}</span>
        </div>
        <div>
          <strong>Equity timing</strong>
          <span>{experiment?.equityTiming === 'realized-on-exit' ? 'Trade P/L is realized on exit date' : 'Realized on trade exit'}</span>
        </div>
        <div>
          <strong>Stored result</strong>
          <span>{experiment ? `${experiment.id} saved with ${experiment.dataset.observations} aligned bars` : 'Runs are saved after completion'}</span>
        </div>
      </div>
    </details>
  )
}

function EmptyChart() {
  return <div className="spl-empty-chart"><LineChart size={28} /><span>Run an experiment to draw the final strategy and benchmark curves.</span></div>
}

function lastPointValue(points: ChartPoint[]) {
  return points[points.length - 1]?.y ?? 0
}

function accountValueFromPct(valuePct: number) {
  return MODEL_STARTING_CAPITAL * (1 + valuePct / 100)
}

function accountEnd(points: ChartPoint[]) {
  return accountValueFromPct(lastPointValue(points))
}

function alphaDollars(result: PipelineResult) {
  return accountEnd(result.equity) - accountEnd(result.benchmark)
}

function timestampForPoint(result: PipelineResult, point: ChartPoint) {
  const index = Math.max(0, Math.min(result.bars.length - 1, Math.round(point.x)))
  const rawDate = result.bars[index]?.date
  const parsed = rawDate ? Date.parse(`${rawDate}T00:00:00Z`) : Number.NaN
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000) as UTCTimestamp
  return Math.floor(Date.UTC(2020, 0, 1) / 1000 + index * 86400) as UTCTimestamp
}

function chartValue(point: ChartPoint, metric: ResearchChartMetric) {
  return metric === 'account'
    ? accountValueFromPct(point.y)
    : MODEL_STARTING_CAPITAL * (point.y / 100)
}

function toAreaData(result: PipelineResult, points: ChartPoint[], metric: ResearchChartMetric): AreaData<UTCTimestamp>[] {
  const byTime = new Map<number, number>()
  for (const point of points) {
    byTime.set(timestampForPoint(result, point), chartValue(point, metric))
  }
  return Array.from(byTime.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
}

function toLineData(result: PipelineResult, points: ChartPoint[], metric: ResearchChartMetric): LineData<UTCTimestamp>[] {
  return toAreaData(result, points, metric)
}

function ResearchPerformanceChart({ result }: { result: PipelineResult }) {
  const [metric, setMetric] = useState<ResearchChartMetric>('account')
  const [range, setRange] = useState<ResearchChartRange>('all')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const strategySeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const benchmarkSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const strategyEnd = accountEnd(result.equity)
  const benchmarkEnd = accountEnd(result.benchmark)
  const strategyPnl = strategyEnd - MODEL_STARTING_CAPITAL
  const benchmarkPnl = benchmarkEnd - MODEL_STARTING_CAPITAL
  const strategyTrendUp = metric === 'account' ? strategyEnd >= benchmarkEnd : strategyPnl >= benchmarkPnl

  const chartData = useMemo(() => ({
    strategy: toAreaData(result, result.equity, metric),
    benchmark: toLineData(result, result.benchmark, metric),
  }), [metric, result])

  const applyRange = useCallback((key: ResearchChartRange) => {
    const chart = chartRef.current
    const activeData = chartData.strategy.length > 0 ? chartData.strategy : chartData.benchmark
    if (!chart || activeData.length === 0) return
    const scale = chart.timeScale()
    const preset = RESEARCH_CHART_RANGES.find((item) => item.key === key)
    if (!preset || preset.days === null) {
      scale.fitContent()
      return
    }
    const to = activeData[activeData.length - 1].time as number
    const earliest = activeData[0].time as number
    const from = Math.max(earliest, to - preset.days * 86400)
    if (from >= to) {
      scale.fitContent()
      return
    }
    scale.setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp })
  }, [chartData])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        attributionLogo: false,
        fontFamily: getComputedStyle(el).fontFamily,
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.14 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { width: 1, style: LineStyle.Dashed, labelVisible: true },
        horzLine: { width: 1, style: LineStyle.Dashed, labelVisible: true },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      localization: { priceFormatter: (value: number) => money(value, 0) },
    })
    const strategySeries = chart.addSeries(AreaSeries, {
      lineWidth: 3,
      lineColor: '#07966b',
      topColor: 'rgba(7,150,107,0.28)',
      bottomColor: 'rgba(7,150,107,0.02)',
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      lastPriceAnimation: LastPriceAnimationMode.Continuous,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    const benchmarkSeries = chart.addSeries(LineSeries, {
      color: '#8da5b2',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    chartRef.current = chart
    strategySeriesRef.current = strategySeries
    benchmarkSeriesRef.current = benchmarkSeries

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
      strategySeriesRef.current = null
      benchmarkSeriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    const chart = chartRef.current
    const strategySeries = strategySeriesRef.current
    const benchmarkSeries = benchmarkSeriesRef.current
    if (!el || !chart || !strategySeries || !benchmarkSeries) return
    const styles = getComputedStyle(el)
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    const text = token('--spl-ink', '#122632')
    const grid = token('--spl-paper-grid', 'rgba(89, 105, 117, 0.1)')
    const accent = token('--spl-paper-purple', '#7048f3')
    const trend = strategyTrendUp ? token('--spl-good', '#07966b') : token('--spl-bad', '#d84d4d')
    const benchmark = token('--spl-paper-benchmark', '#8da5b2')
    chart.applyOptions({
      layout: { textColor: colorWithAlpha(text, 0.58) },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: {
        vertLine: { color: colorWithAlpha(accent, 0.45), labelBackgroundColor: accent },
        horzLine: { color: colorWithAlpha(accent, 0.45), labelBackgroundColor: accent },
      },
      localization: {
        priceFormatter: (value: number) => metric === 'account' ? money(value, 0) : signedMoney(value, 0),
      },
    })
    strategySeries.applyOptions({
      lineColor: trend,
      topColor: colorWithAlpha(trend, 0.28),
      bottomColor: colorWithAlpha(trend, 0.02),
    })
    benchmarkSeries.applyOptions({ color: benchmark })
    strategySeries.setData(chartData.strategy)
    benchmarkSeries.setData(chartData.benchmark)
    applyRange(range)
  }, [applyRange, chartData, metric, range, strategyTrendUp])

  return (
    <div className="spl-paper-equity">
      <div className="spl-paper-equity-head">
        <div className="spl-paper-toggle" role="group" aria-label="Research chart metric">
          <button
            type="button"
            className={metric === 'account' ? 'active' : ''}
            aria-pressed={metric === 'account'}
            onClick={() => setMetric('account')}
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
        <span>
          {metric === 'account' ? (
            <>
              Strategy <b>{money(strategyEnd)}</b> · SPY <b>{money(benchmarkEnd)}</b> · Alpha{' '}
              <b className={alphaDollars(result) >= 0 ? 'pos' : 'neg'}>{signedMoney(alphaDollars(result))}</b>
            </>
          ) : (
            <>
              Strategy P/L <b className={strategyPnl >= 0 ? 'pos' : 'neg'}>{signedMoney(strategyPnl)}</b> · SPY P/L{' '}
              <b className={benchmarkPnl >= 0 ? 'pos' : 'neg'}>{signedMoney(benchmarkPnl)}</b>
            </>
          )}
        </span>
      </div>
      <div className="spl-paper-ranges" role="group" aria-label="Chart look-back window">
        {RESEARCH_CHART_RANGES.map((preset) => (
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
      <div
        className="spl-paper-equity-chart"
        ref={containerRef}
        role="img"
        aria-label={metric === 'account' ? 'Modeled account value versus SPY' : 'Modeled profit and loss versus SPY'}
      />
      <div className="spl-paper-legend">
        <span><i className="strategy" /> strategy model</span>
        <span><i className="benchmark" /> SPY buy-hold</span>
        <span>1R is modeled as 1% of account</span>
      </div>
    </div>
  )
}
