import { SNAP_GRID, type Vec2 } from './schema'

export function snapCoord(value: number, grid = SNAP_GRID): number {
  return Math.round(value / grid) * grid
}

export function snapPoint(point: Vec2, grid = SNAP_GRID): Vec2 {
  return [snapCoord(point[0], grid), snapCoord(point[1], grid)]
}

export function distance2(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return Math.sqrt(dx * dx + dz * dz)
}

export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) / 2
}

export function signedPolygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

export function ensureCcw(points: Vec2[]): Vec2[] {
  return signedPolygonArea(points) < 0 ? [...points].reverse() : points
}

export function cleanPolygon(points: Vec2[], grid = SNAP_GRID): Vec2[] {
  const snapped = points.map((point) => snapPoint(point, grid))
  const deduped: Vec2[] = []
  for (const point of snapped) {
    const prev = deduped[deduped.length - 1]
    if (!prev || distance2(prev, point) > 1e-6) {
      deduped.push(point)
    }
  }
  if (deduped.length > 1 && distance2(deduped[0]!, deduped[deduped.length - 1]!) <= 1e-6) {
    deduped.pop()
  }
  return ensureCcw(deduped)
}

export function polygonBounds(points: Vec2[]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
  centerX: number
  centerZ: number
} {
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  }
}

export function translatePoint(point: Vec2, dx: number, dz: number): Vec2 {
  return [point[0] + dx, point[1] + dz]
}

export function scalePoint(point: Vec2, factor: number, origin: Vec2): Vec2 {
  return [origin[0] + (point[0] - origin[0]) * factor, origin[1] + (point[1] - origin[1]) * factor]
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

export function orderPoints(a: Vec2, b: Vec2): [Vec2, Vec2] {
  if (a[0] < b[0] - 1e-9) return [a, b]
  if (a[0] > b[0] + 1e-9) return [b, a]
  if (a[1] <= b[1]) return [a, b]
  return [b, a]
}

export function undirectedEdgeKey(a: Vec2, b: Vec2): string {
  const [start, end] = orderPoints(a, b)
  return `${start[0].toFixed(2)},${start[1].toFixed(2)}|${end[0].toFixed(2)},${end[1].toFixed(2)}`
}

export function projectPointToSegment(
  point: Vec2,
  start: Vec2,
  end: Vec2,
): { t: number; distance: number; point: Vec2 } {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-12) {
    return { t: 0, distance: distance2(point, start), point: start }
  }
  const rawT = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq
  const t = Math.max(0, Math.min(1, rawT))
  const projected: Vec2 = [start[0] + dx * t, start[1] + dz * t]
  return { t, distance: distance2(point, projected), point: projected }
}

export function clampDoorLocalX(wallLength: number, width: number, t: number): number {
  const half = width / 2
  if (wallLength <= width) return wallLength / 2
  return Math.max(half, Math.min(wallLength - half, t * wallLength))
}

export function maxAbsCoord(points: Vec2[]): number {
  let max = 0
  for (const point of points) {
    max = Math.max(max, Math.abs(point[0]), Math.abs(point[1]))
  }
  return max
}

export type ImageCoordinateSpace = 'metres' | 'pixels' | 'normalized'

export function detectImageCoordinateSpace(
  points: Vec2[],
  imageWidth?: number,
  imageHeight?: number,
): ImageCoordinateSpace {
  const maxAbs = maxAbsCoord(points)
  if (!imageWidth || !imageHeight) return 'metres'
  if (maxAbs <= 1.5) return 'normalized'
  // Apartment-scale metres (typically < 80 m) must not be treated as pixels of a
  // 1000+ px scan — that leaves a tiny wall cluster floating on the full overlay.
  const minSide = Math.min(imageWidth, imageHeight)
  if (maxAbs < 80 && maxAbs < minSide * 0.08) return 'metres'
  if (maxAbs <= Math.max(imageWidth, imageHeight) * 1.2) return 'pixels'
  return 'metres'
}

/** Map model coordinates onto the image pixel grid so walls share space with the overlay. */
export function toImagePixels(
  point: Vec2,
  imageWidth: number,
  imageHeight: number,
  space: ImageCoordinateSpace,
): Vec2 {
  if (space === 'normalized') {
    return [point[0] * imageWidth, point[1] * imageHeight]
  }
  return point
}

/** Collapse nearby vertices so shared room corners become identical. */
export function weldVertices(polygons: Vec2[][], tolerance: number): Vec2[][] {
  const canonical: Vec2[] = []
  const weld = (point: Vec2): Vec2 => {
    for (const existing of canonical) {
      if (distance2(point, existing) <= tolerance) return existing
    }
    canonical.push(point)
    return point
  }
  return polygons.map((polygon) => polygon.map(weld))
}
