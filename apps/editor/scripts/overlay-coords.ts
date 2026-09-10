import type { ExtractedFloorplan } from '../lib/floorplan-import/schema'

export function overlayPoint(
  x: number,
  y: number,
  imageSize: { width: number; height: number },
  maxAbs: number,
): [number, number] {
  if (maxAbs <= 1.5) return [x * imageSize.width, y * imageSize.height]
  return [x, y]
}

export function extractMaxAbs(extracted: ExtractedFloorplan): number {
  let max = 0
  for (const room of extracted.rooms) {
    for (const [x, y] of room.polygon) {
      max = Math.max(max, Math.abs(x), Math.abs(y))
    }
  }
  return max
}
