'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_WALL_HEIGHT } from '@/lib/floorplan-import/schema'
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

const STAGE_PROGRESS: Record<string, { label: string; percent: number }> = {
  queued: { label: 'Queued…', percent: 8 },
  reading: { label: 'Opening the drawing…', percent: 18 },
  'reading-drawing': { label: 'Reading labels and walls…', percent: 48 },
  'building-scene': { label: 'Building walls…', percent: 78 },
  saving: { label: 'Saving the scene…', percent: 92 },
  done: { label: 'Done', percent: 100 },
  failed: { label: 'Failed', percent: 100 },
}

function fileLooksLikeImage(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true
  return /\.(jpe?g|png|webp|gif)$/i.test(file.name)
}

function clientFileError(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'That image is over 12 MB. Export a smaller JPEG or PNG and try again.'
  }
  if (!fileLooksLikeImage(file)) {
    return 'Upload a JPEG or PNG of the floor-plan drawing.'
  }
  return null
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
      setError('Choose a floor-plan image first.')
      return
    }
    if (vision && !vision.visionConfigured) {
      setError(
        'Set OPENROUTER_API_KEY in .env.local and restart the editor. Live vision is not available until that key is present.',
      )
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
        setError(payload.message ?? payload.error ?? `Import failed (${response.status})`)
        return
      }
      setJob(payload)
    } catch {
      setError('Could not reach the import API. Is the editor running?')
    } finally {
      setBusy(false)
    }
  }, [file, name, wallHeight, vision])

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/imports/${job.id}`)
        const payload = (await response.json()) as ImportJobResponse
        if (!response.ok) {
          setError(
            payload.message ??
              (payload.error === 'not_found'
                ? 'Import expired. Upload the drawing again.'
                : 'Lost the import job. Upload the drawing again.'),
          )
          setJob(null)
          return
        }
        setJob(payload)
        if (payload.status === 'done' && payload.editorUrl) {
          router.push(payload.editorUrl)
        }
        if (payload.status === 'error') {
          setError(payload.error ?? 'Import failed')
        }
      } catch {
        setError('Lost the connection while building 3D. Upload the drawing again.')
        setJob(null)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [job, router])

  const waiting = Boolean(job && job.status !== 'done' && job.status !== 'error')
  const stage = STAGE_PROGRESS[job?.stage ?? ''] ?? {
    label: job?.stage ?? '',
    percent: waiting ? 30 : 0,
  }
  const visionMissing = vision !== null && !vision.visionConfigured

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
          JPEG or PNG of an apartment drawing. We build a 3D apartment with the drawing on the
          floor.
        </p>
      </div>

      {visionMissing && (
        <p className="mb-4 rounded-lg border border-amber-500/50 bg-amber-100 px-3 py-2 text-amber-950 text-sm">
          Vision is off. Add <code className="font-mono">OPENROUTER_API_KEY</code> to{' '}
          <code className="font-mono">.env.local</code> and restart the editor. Optional:{' '}
          <code className="font-mono">FLOORPLAN_VISION_MODEL</code> (default{' '}
          <code className="font-mono">openai/gpt-4.1</code>).
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
          <span className="mb-1 block text-muted-foreground">Ceiling height (m)</span>
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
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {waiting && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-accent">
            <div
              className="h-full bg-foreground/80 transition-[width] duration-500"
              style={{ width: `${stage.percent}%` }}
            />
          </div>
          <p className="mt-2 text-muted-foreground text-sm">{stage.label}</p>
        </div>
      )}
      {job?.status === 'done' && job.editorUrl && (
        <p className="mt-3 text-sm">
          Scene ready.{' '}
          <a className="underline" href={job.editorUrl}>
            Open it
          </a>
        </p>
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
        {file && (
          <button
            className="text-muted-foreground text-sm underline"
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
