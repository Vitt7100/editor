import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { readGuideImage } from '@/lib/floorplan-import/guide-store'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight, withSceneApiHeaders } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const SCENE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type RouteParams = { params: Promise<{ id: string }> }

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  if (!SCENE_ID.test(id) || id.length > 64) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const guide = readGuideImage(id)
  if (!guide) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const body = Uint8Array.from(guide.bytes)
  return withSceneApiHeaders(
    request,
    new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': guide.mimeType,
        'Cache-Control': 'private, max-age=3600',
      },
    }),
  )
}
