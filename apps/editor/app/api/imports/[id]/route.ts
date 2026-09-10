import type { NextRequest } from 'next/server'
import { IMPORT_TIMEOUT_MESSAGE } from '@/lib/floorplan-import/import-copy'
import { getImportJob, publicImportJob } from '@/lib/floorplan-import/jobs'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const job = getImportJob(id)
  if (!job) {
    return sceneApiJson(
      request,
      { error: 'not_found', message: IMPORT_TIMEOUT_MESSAGE },
      { status: 404 },
    )
  }
  return sceneApiJson(request, publicImportJob(job))
}
