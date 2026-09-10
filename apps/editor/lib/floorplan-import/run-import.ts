import { generateSlug } from '@pascal-app/mcp/storage'
import { getSceneOperations } from '@/lib/scene-store-server'
import { buildSceneFromFloorplan } from './build-scene'
import type { PlanContentBox } from './geometry'
import { writeGuideImage } from './guide-store'
import { parseImageSize } from './image-size'
import { IMPORT_TIMEOUT_MESSAGE } from './import-copy'
import { BAD_IMAGE_MESSAGE, formatImportError } from './import-errors'
import { updateImportJob } from './jobs'
import { detectPlanContentBox } from './plan-content'
import { extractFloorplanFromImage } from './vision'

export async function runFloorplanImport(jobId: string): Promise<void> {
  const current = updateImportJob(jobId, { status: 'running', stage: 'reading' })
  if (!current?.base64) {
    updateImportJob(jobId, { status: 'error', stage: 'failed', error: IMPORT_TIMEOUT_MESSAGE })
    return
  }

  try {
    updateImportJob(jobId, { stage: 'reading-drawing' })
    const bytes = Buffer.from(current.base64, 'base64')
    const imageSize = parseImageSize(bytes)
    if (!imageSize) {
      updateImportJob(jobId, {
        status: 'error',
        stage: 'failed',
        error: BAD_IMAGE_MESSAGE,
        base64: undefined,
      })
      return
    }
    const extracted = await extractFloorplanFromImage({
      mimeType: current.mimeType,
      base64: current.base64,
      width: imageSize.width,
      height: imageSize.height,
    })
    const contentBox = await detectContentBoxFromBytes(bytes)

    updateImportJob(jobId, { stage: 'building-scene' })
    const sceneId = generateSlug()
    writeGuideImage(sceneId, current.mimeType, bytes)
    const built = buildSceneFromFloorplan(extracted, {
      wallHeight: current.wallHeight,
      imageSize,
      contentBox,
      guide: {
        url: `/api/scenes/${sceneId}/guide`,
        name: current.name,
      },
    })

    updateImportJob(jobId, { stage: 'saving' })
    const operations = await getSceneOperations()
    const meta = await operations.saveScene({
      id: sceneId,
      name: current.name,
      graph: built.graph,
      saveMode: 'draft',
    })

    updateImportJob(jobId, {
      status: 'done',
      stage: 'done',
      sceneId: meta.id,
      editorUrl: `/scene/${meta.id}`,
      warnings: built.warnings,
      confidence: built.confidence,
      rooms: built.rooms,
      walls: built.walls,
      doors: extracted.doors.length,
      base64: undefined,
    })
  } catch (error) {
    const message = formatImportError(error)
    updateImportJob(jobId, {
      status: 'error',
      stage: 'failed',
      error: message,
      base64: undefined,
    })
  }
}

async function detectContentBoxFromBytes(bytes: Buffer): Promise<PlanContentBox | null> {
  try {
    const mod = await import('sharp')
    const sharp = mod.default
    const raster = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    return detectPlanContentBox(
      raster.data,
      raster.info.width,
      raster.info.height,
      raster.info.channels,
    )
  } catch {
    return null
  }
}
