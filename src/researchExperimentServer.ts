import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadAlpacaHistoricalDataset } from './researchDataIngestion'
import {
  RESEARCH_RESULT_SCHEMA_VERSION,
  runResearchExperiment,
  summarizeExperiment,
  type ExperimentProgress,
  type HistoricalResearchDataset,
  type ResearchExperimentConfig,
  type ResearchExperimentResult,
  type ResearchExperimentSummary,
} from './researchExperimentEngine'

type JobState = {
  id: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: ExperimentProgress
  error: string
  result: ResearchExperimentResult | null
}

const DATA_ROOT = path.join(process.cwd(), '.quant-research')
const DATASET_ROOT = path.join(DATA_ROOT, 'datasets')
const RUN_ROOT = path.join(DATA_ROOT, 'runs')
const INDEX_PATH = path.join(DATA_ROOT, 'index.json')
const DATASET_MAX_AGE_MS = 12 * 60 * 60 * 1000
const jobs = new Map<string, JobState>()

async function ensureDirectories() {
  await Promise.all([
    mkdir(DATASET_ROOT, { recursive: true }),
    mkdir(RUN_ROOT, { recursive: true }),
  ])
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, JSON.stringify(value), 'utf8')
  await rename(tempPath, filePath)
}

async function loadDataset(config: ResearchExperimentConfig): Promise<HistoricalResearchDataset> {
  await ensureDirectories()
  const cachePath = path.join(DATASET_ROOT, `${config.ticker}-${config.years}y.json`)
  const cached = await readJson<HistoricalResearchDataset>(cachePath)
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < DATASET_MAX_AGE_MS) return cached
  const dataset = await loadAlpacaHistoricalDataset(config.ticker, config.years)
  await writeJsonAtomic(cachePath, dataset)
  return dataset
}

async function persistResult(result: ResearchExperimentResult) {
  await ensureDirectories()
  await writeJsonAtomic(path.join(RUN_ROOT, `${result.id}.json`), result)
  const current = await readJson<ResearchExperimentSummary[]>(INDEX_PATH) ?? []
  const next = [summarizeExperiment(result), ...current.filter((item) => item.id !== result.id)].slice(0, 30)
  await writeJsonAtomic(INDEX_PATH, next)
}

export function startResearchExperiment(config: ResearchExperimentConfig) {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const job: JobState = {
    id,
    status: 'queued',
    progress: {
      stage: 'loading-data',
      completed: 0,
      total: 1,
      message: `Loading adjusted ${config.years}-year history for ${config.ticker} and SPY`,
    },
    error: '',
    result: null,
  }
  jobs.set(id, job)

  setImmediate(async () => {
    job.status = 'running'
    try {
      const dataset = await loadDataset(config)
      job.result = await runResearchExperiment(id, config, dataset, startedAt, (progress) => {
        job.progress = progress
      })
      job.progress = { stage: 'saving', completed: 0, total: 1, message: 'Saving dataset and experiment results' }
      await persistResult(job.result)
      job.progress = { stage: 'saving', completed: 1, total: 1, message: 'Experiment saved' }
      job.status = 'complete'
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Research experiment failed.'
    }
  })

  return job
}

export function getResearchJob(id: string) {
  return jobs.get(id) ?? null
}

export async function listResearchExperiments() {
  await ensureDirectories()
  const items = await readJson<ResearchExperimentSummary[]>(INDEX_PATH) ?? []
  return items.filter((item) => item.schemaVersion === RESEARCH_RESULT_SCHEMA_VERSION)
}

export async function loadResearchExperiment(id: string) {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return null
  const active = jobs.get(id)
  if (active?.result) return active.result
  await ensureDirectories()
  const result = await readJson<ResearchExperimentResult>(path.join(RUN_ROOT, `${id}.json`))
  return result?.schemaVersion === RESEARCH_RESULT_SCHEMA_VERSION ? result : null
}
