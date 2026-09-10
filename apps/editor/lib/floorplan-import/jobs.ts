export type ImportJobStatus = 'queued' | 'running' | 'done' | 'error'

export type ImportJob = {
  id: string
  status: ImportJobStatus
  stage: string
  createdAt: number
  name: string
  wallHeight: number
  mimeType: string
  base64?: string
  sceneId?: string
  editorUrl?: string
  warnings: string[]
  confidence?: number
  rooms?: number
  walls?: number
  doors?: number
  error?: string
}

const jobs = new Map<string, ImportJob>()
const MAX_AGE_MS = 30 * 60 * 1000

export function createImportJob(input: {
  name: string
  wallHeight: number
  mimeType: string
  base64: string
}): ImportJob {
  pruneJobs()
  const job: ImportJob = {
    id: crypto.randomUUID(),
    status: 'queued',
    stage: 'queued',
    createdAt: Date.now(),
    name: input.name,
    wallHeight: input.wallHeight,
    mimeType: input.mimeType,
    base64: input.base64,
    warnings: [],
  }
  jobs.set(job.id, job)
  return job
}

export function getImportJob(id: string): ImportJob | undefined {
  pruneJobs()
  return jobs.get(id)
}

export function updateImportJob(id: string, patch: Partial<ImportJob>): ImportJob | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  Object.assign(job, patch)
  return job
}

export function publicImportJob(job: ImportJob) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    name: job.name,
    sceneId: job.sceneId,
    editorUrl: job.editorUrl,
    warnings: job.warnings,
    confidence: job.confidence,
    rooms: job.rooms,
    walls: job.walls,
    doors: job.doors,
    error: job.error,
  }
}

function pruneJobs(): void {
  const cutoff = Date.now() - MAX_AGE_MS
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id)
  }
}
