'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BAD_MIME_MESSAGE,
  HEIGHT_RANGE_MESSAGE,
  NETWORK_LOST_MESSAGE,
  NO_FILE_MESSAGE,
  STAGE_LABELS,
  TOO_LARGE_MESSAGE,
  UNCONFIGURED_USER_MESSAGE,
  userMessageForImportError,
} from '@/lib/floorplan-import/import-copy'
import { DEFAULT_WALL_HEIGHT, parseWallHeight } from '@/lib/floorplan-import/schema'
import { cn } from '@/lib/utils'

type VisionStatus = {
  visionConfigured: boolean
  provider: 'openrouter' | 'anthropic' | 'openai' | null
}

type ImportJobResponse = {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  stage: string
  name?: string
  sceneId?: string
  editorUrl?: string
  warnings?: string[]
  confidence?: number
  rooms?: number
  walls?: number
  doors?: number
  error?: string
  message?: string
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function fileLooksLikeImage(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true
  return /\.(jpe?g|png|webp|gif)$/i.test(file.name)
}

function clientFileError(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE_MESSAGE
  if (!fileLooksLikeImage(file)) return BAD_MIME_MESSAGE
  return null
}

function successSummary(job: ImportJobResponse): string {
  const rooms = job.rooms ?? 0
  const walls = job.walls ?? 0
  const doors = typeof job.doors === 'number' && job.doors > 0 ? `, ${job.doors} doors` : ''
  return `Built: ${rooms} rooms, ${walls} walls${doors}.`
}

export function FloorplanImport({
  compact = false,
  initialVision,
}: {
  compact?: boolean
  initialVision?: VisionStatus
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [wallHeight, setWallHeight] = useState(String(DEFAULT_WALL_HEIGHT))
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<ImportJobResponse | null>(null)
  const [vision, setVision] = useState<VisionStatus | null>(initialVision ?? null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/imports')
      .then(async (response) => {
        const payload = (await response.json()) as VisionStatus
        if (!cancelled) setVision(payload)
      })
      .catch(() => {
        if (!cancelled) setVision({ visionConfigured: false, provider: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const chooseFile = useCallback(
    (next: File | undefined) => {
      if (!next) return
      const problem = clientFileError(next)
      setJob(null)
      if (problem) {
        setError(problem)
        setFile(null)
        return
      }
      setError(null)
      setFile(next)
      if (!name) setName(next.name.replace(/\.[^.]+$/, ''))
    },
    [name],
  )

  const startImport = useCallback(async () => {
    if (!file) {
      setError(NO_FILE_MESSAGE)
      return
    }
    if (vision && !vision.visionConfigured) {
      setError(UNCONFIGURED_USER_MESSAGE)
      return
    }
    if (parseWallHeight(wallHeight) === null) {
      setError(HEIGHT_RANGE_MESSAGE)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      if (name.trim()) body.set('name', name.trim())
      body.set('wallHeight', wallHeight)
      const response = await fetch('/api/imports', { method: 'POST', body })
      const payload = (await response.json()) as ImportJobResponse
      if (!response.ok) {
        setError(userMessageForImportError(payload.error, payload.message))
        return
      }
      setJob(payload)
    } catch {
      setError(NETWORK_LOST_MESSAGE)
    } finally {
      setBusy(false)
    }
  }, [file, name, wallHeight, vision])

  const tryAgain = useCallback(() => {
    setJob(null)
    setError(null)
    void startImport()
  }, [startImport])

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/imports/${job.id}`)
        const payload = (await response.json()) as ImportJobResponse
        if (!response.ok) {
          setError(userMessageForImportError(payload.error, payload.message))
          setJob(null)
          return
        }
        setJob(payload)
        if (payload.status === 'done' && payload.editorUrl) {
          router.push(payload.editorUrl)
        }
        if (payload.status === 'error') {
          setError(payload.error ?? 'Import failed. Please try again.')
        }
      } catch {
        setError(NETWORK_LOST_MESSAGE)
        setJob(null)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [job, router])

  const waiting = Boolean(job && job.status !== 'done' && job.status !== 'error')
  const stageLabel = STAGE_LABELS[job?.stage ?? ''] ?? job?.stage
  const visionMissing = vision !== null && !vision.visionConfigured
  const warnings = (job?.warnings ?? []).filter(Boolean)

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/60 bg-background p-6 shadow-sm',
        compact && 'p-4',
      )}
    >
      <div className="mb-4">
        <h2 className="font-semibold text-lg">Upload a floor plan</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          JPEG, PNG, WebP, or GIF of an apartment drawing. We build a 3D scene with the plan on the
          floor.
        </p>
      </div>

      {visionMissing && (
        <p className="mb-4 rounded-lg border border-amber-500/50 bg-amber-100 px-3 py-2 text-amber-950 text-sm">
          {UNCONFIGURED_USER_MESSAGE}
        </p>
      )}

      <button
        className={cn(
          'flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-10 text-sm transition-colors',
          dragOver
            ? 'border-foreground bg-accent/40'
            : 'border-border/70 bg-accent/10 hover:bg-accent/20',
          waiting && 'pointer-events-none opacity-70',
        )}
        disabled={waiting}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          chooseFile(event.dataTransfer.files[0])
        }}
        type="button"
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Floor plan preview"
            className="max-h-64 rounded-md object-contain"
            src={previewUrl}
          />
        ) : (
          <span className="text-muted-foreground">
            Drop a drawing here, or click to choose a file
          </span>
        )}
      </button>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
        className="hidden"
        onChange={(event) => chooseFile(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Scene name</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            disabled={waiting}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Ceiling height</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            disabled={waiting}
            max={4.5}
            min={2}
            onChange={(event) => setWallHeight(event.target.value)}
            step={0.1}
            type="number"
            value={wallHeight}
          />
          <span className="mt-1 block text-muted-foreground text-xs">2.0–4.5 m</span>
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {waiting && (
        <div className="mt-3 flex items-start gap-2 text-muted-foreground text-sm">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <div>
            <p>{stageLabel}</p>
            <p>Usually under a minute.</p>
          </div>
        </div>
      )}
      {job?.status === 'done' && (
        <div className="mt-3 text-sm">
          <p>{successSummary(job)}</p>
          {warnings.map((warning) => (
            <p className="mt-1 text-muted-foreground" key={warning}>
              {warning}
            </p>
          ))}
          {job.editorUrl && (
            <p className="mt-2">
              Opening the scene…{' '}
              <a className="underline" href={job.editorUrl}>
                Open it
              </a>
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          className="rounded-md border border-border bg-accent px-4 py-2 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
          disabled={busy || waiting || !file || visionMissing}
          onClick={() => void startImport()}
          type="button"
        >
          {waiting ? 'Building 3D…' : busy ? 'Uploading…' : 'Build 3D'}
        </button>
        {error && file && !waiting && (
          <button
            className="text-muted-foreground text-sm underline"
            onClick={() => tryAgain()}
            type="button"
          >
            Try again
          </button>
        )}
        {file && (
          <button
            className="text-muted-foreground text-sm underline disabled:opacity-50"
            disabled={waiting}
            onClick={() => {
              setFile(null)
              setJob(null)
              setError(null)
            }}
            type="button"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
