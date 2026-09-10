import {
  detectImageCoordinateSpace,
  extractMaxAbs,
  normalizeFloorplanCoords,
  toImagePixels,
} from '../lib/floorplan-import/geometry'
import type { ExtractedFloorplan } from '../lib/floorplan-import/schema'

export { extractMaxAbs, normalizeFloorplanCoords }

export function overlayPoint(
  x: number,
  y: number,
  imageSize: { width: number; height: number },
  maxAbs: number,
): [number, number] {
  const space = detectImageCoordinateSpace(
    [
      [maxAbs, 0],
      [0, maxAbs],
    ],
    imageSize.width,
    imageSize.height,
  )
  return toImagePixels([x, y], imageSize.width, imageSize.height, space)
}

export function overlayExtracted(
  extracted: ExtractedFloorplan,
  imageSize: { width: number; height: number },
  contentBox?: { minX: number; minY: number; maxX: number; maxY: number } | null,
): ExtractedFloorplan {
  return normalizeFloorplanCoords(extracted, imageSize, { contentBox }).extracted
}
