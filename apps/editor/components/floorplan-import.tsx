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

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued…',
  reading: 'Reading the drawing…',
  'reading-drawing': 'Reading labels and dimensions…',
  'building-scene': 'Building walls…',
  saving: 'Saving the scene…',
  done: 'Done',
  failed: 'Failed',
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
      setError(null)
      setJob(null)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }, [file, name, wallHeight])

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/imports/${job.id}`)
      const payload = (await response.json()) as ImportJobResponse
      if (!response.ok) {
        setError(payload.error ?? 'Lost the import job')
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
    }, 1000)
    return () => window.clearInterval(timer)
  }, [job, router])

  const waiting = Boolean(job && job.status !== 'done' && job.status !== 'error')

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
          JPEG or PNG of an apartment drawing. We build a 3D apartment with the
          drawing on the floor.
        </p>
      </div>

      {vision && !vision.visionConfigured && (
        <p className="mb-4 rounded-lg border border-amber-500/50 bg-amber-100 px-3 py-2 text-amber-950 text-sm">
          Add <code className="font-mono">OPENROUTER_API_KEY</code> to{' '}
          <code className="font-mono">.env.local</code> and restart the editor.
        </p>
      )}

      <button
        className={cn(
          'flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-10 text-sm transition-colors',
          dragOver
            ? 'border-foreground bg-accent/40'
            : 'border-border/70 bg-accent/10 hover:bg-accent/20',
        )}
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
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Ceiling height (m)</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            max={4.5}
            min={2}
            onChange={(event) => setWallHeight(event.target.value)}
            step={0.1}
            type="number"
            value={wallHeight}
          />
        </label>
      </div>

      {error && <p className="mt-3 text-destructive text-sm">{error}</p>}
      {waiting && (
        <p className="mt-3 text-muted-foreground text-sm">
          {STAGE_LABELS[job?.stage ?? ''] ?? job?.stage}
        </p>
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
          disabled={busy || waiting || !file}
          onClick={() => void startImport()}
          type="button"
        >
          {waiting ? 'Building 3D…' : busy ? 'Uploading…' : 'Build 3D'}
        </button>
        {file && (
          <button
            className="text-muted-foreground text-sm underline"
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
