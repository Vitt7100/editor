import type { NextRequest } from 'next/server'
import {
  BAD_MIME_MESSAGE,
  HEIGHT_RANGE_MESSAGE,
  NO_FILE_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNCONFIGURED_USER_MESSAGE,
} from '@/lib/floorplan-import/import-copy'
import { createImportJob, publicImportJob } from '@/lib/floorplan-import/jobs'
import { runFloorplanImport } from '@/lib/floorplan-import/run-import'
import { DEFAULT_WALL_HEIGHT, parseWallHeight } from '@/lib/floorplan-import/schema'
import { getConfiguredVisionProvider, UNCONFIGURED_ADMIN_LOG } from '@/lib/floorplan-import/vision'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const provider = getConfiguredVisionProvider()
  return sceneApiJson(request, {
    visionConfigured: provider !== null,
    provider,
  })
}

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  if (!getConfiguredVisionProvider()) {
    console.error(UNCONFIGURED_ADMIN_LOG)
    return sceneApiJson(
      request,
      {
        error: 'vision_unconfigured',
        message: UNCONFIGURED_USER_MESSAGE,
      },
      { status: 503 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return sceneApiJson(
      request,
      {
        error: 'file_required',
        message: NO_FILE_MESSAGE,
      },
      { status: 400 },
    )
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return sceneApiJson(
      request,
      { error: 'file_required', message: NO_FILE_MESSAGE },
      { status: 400 },
    )
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return sceneApiJson(
      request,
      {
        error: 'too_large',
        message: TOO_LARGE_MESSAGE,
      },
      { status: 413 },
    )
  }

  const mimeType = resolveMimeType(file)
  if (!ALLOWED_MIME.has(mimeType)) {
    return sceneApiJson(
      request,
      {
        error: 'bad_mime',
        message: BAD_MIME_MESSAGE,
      },
      { status: 400 },
    )
  }

  const wallHeight = readWallHeight(form.get('wallHeight'))
  if (wallHeight === null) {
    return sceneApiJson(
      request,
      {
        error: 'invalid_height',
        message: HEIGHT_RANGE_MESSAGE,
      },
      { status: 400 },
    )
  }

  const name = readName(form.get('name'), file.name)
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
  const job = createImportJob({ name, wallHeight, mimeType, base64 })
  void runFloorplanImport(job.id)

  return sceneApiJson(request, publicImportJob(job), { status: 202 })
}

function resolveMimeType(file: File): string {
  if (ALLOWED_MIME.has(file.type)) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  return file.type
}

function readName(value: FormDataEntryValue | null, filename: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200)
  const stem = filename.replace(/\.[^.]+$/, '').trim()
  return stem || 'Apartment from plan'
}

function readWallHeight(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_WALL_HEIGHT
  return parseWallHeight(value)
}
