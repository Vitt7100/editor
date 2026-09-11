import { type ExtractedFloorplan, SNAP_GRID, type Vec2 } from './schema'

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

export function polygonCentroid(points: Vec2[]): Vec2 {
  if (points.length === 0) return [0, 0]
  const signed = signedPolygonArea(points)
  if (Math.abs(signed) < 1e-12) {
    const sx = points.reduce((sum, point) => sum + point[0], 0)
    const sy = points.reduce((sum, point) => sum + point[1], 0)
    return [sx / points.length, sy / points.length]
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    const cross = x1 * y2 - x2 * y1
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  const factor = 1 / (6 * signed)
  return [cx * factor, cy * factor]
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

export type ImageCoordinateSpace = 'metres' | 'pixels' | 'normalized' | 'unit1000'

/** Vision models often emit a 0..1000 square instead of image pixels. */
export const UNIT1000_CANVAS = 1000

export function extractPoints(extracted: ExtractedFloorplan): Vec2[] {
  const points: Vec2[] = []
  for (const room of extracted.rooms) points.push(...room.polygon)
  for (const door of extracted.doors) points.push(door.at)
  for (const opening of extracted.openings ?? []) points.push(opening.at)
  for (const window of extracted.windows) points.push(window.at)
  for (const dimension of extracted.dimensions ?? []) {
    points.push(dimension.start, dimension.end)
  }
  // planBounds is page metadata (often full-image pixels on a unit1000 extract).
  return points
}

export type PlanContentBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function extractBounds(extracted: ExtractedFloorplan): PlanContentBox | null {
  const points = extractPoints(extracted)
  if (points.length === 0) return null
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

/** True when `box` is on the image raster, not a ~1000-square or 0..1. */
export function isImagePixelBox(
  box: PlanContentBox | null | undefined,
  imageWidth: number,
  imageHeight: number,
): box is PlanContentBox {
  if (!box) return false
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  if (width < 8 || height < 8) return false
  if (box.minX < -imageWidth * 0.05 || box.minY < -imageHeight * 0.05) return false
  if (box.maxX > imageWidth * 1.05 || box.maxY > imageHeight * 1.05) return false
  const maxAbs = Math.max(
    Math.abs(box.minX),
    Math.abs(box.minY),
    Math.abs(box.maxX),
    Math.abs(box.maxY),
  )
  const maxSide = Math.max(imageWidth, imageHeight)
  if (maxAbs <= 1.5) return false
  if (maxAbs >= 700 && maxAbs <= 1100 && maxAbs < maxSide * 0.6) return false
  return width >= imageWidth * 0.25 && height >= imageHeight * 0.25
}

export function planBoundsToBox(
  planBounds: ExtractedFloorplan['planBounds'],
): PlanContentBox | null {
  if (!planBounds) return null
  return {
    minX: Math.min(planBounds.min[0], planBounds.max[0]),
    maxX: Math.max(planBounds.min[0], planBounds.max[0]),
    minY: Math.min(planBounds.min[1], planBounds.max[1]),
    maxY: Math.max(planBounds.min[1], planBounds.max[1]),
  }
}

/** Map the extract's own bbox onto `target` (axis-aligned). Does not add openings. */
export function registerExtractToBox(
  extracted: ExtractedFloorplan,
  target: PlanContentBox,
): ExtractedFloorplan {
  const source = extractBounds(extracted)
  if (!source) return extracted
  const sourceW = source.maxX - source.minX
  const sourceH = source.maxY - source.minY
  if (sourceW < 1e-6 || sourceH < 1e-6) return extracted
  const scaleX = (target.maxX - target.minX) / sourceW
  const scaleY = (target.maxY - target.minY) / sourceH
  const mapped = mapExtracted(extracted, ([x, y]) => [
    target.minX + (x - source.minX) * scaleX,
    target.minY + (y - source.minY) * scaleY,
  ])
  return {
    ...mapped,
    planBounds: {
      min: [target.minX, target.minY],
      max: [target.maxX, target.maxY],
    },
  }
}

export function extractMaxAbs(extracted: ExtractedFloorplan): number {
  return maxAbsCoord(extractPoints(extracted))
}

export function detectImageCoordinateSpace(
  points: Vec2[],
  imageWidth?: number,
  imageHeight?: number,
): ImageCoordinateSpace {
  const maxAbs = maxAbsCoord(points)
  if (maxAbs <= 1.5) return 'normalized'
  if (!imageWidth || !imageHeight) return maxAbs < 80 ? 'metres' : 'pixels'
  // Apartment-scale metres (typically < 80 m) must not be treated as pixels of a
  // 1000+ px scan — that leaves a tiny wall cluster floating on the full overlay.
  const minSide = Math.min(imageWidth, imageHeight)
  const maxSide = Math.max(imageWidth, imageHeight)
  if (maxAbs < 80 && maxAbs < minSide * 0.08) return 'metres'
  // ~1000-square on a larger raster (gpt-4.1 / Claude default). A 1024px scan
  // with maxAbs≈985 is already pixels — only remap when the image is clearly bigger.
  if (maxAbs >= 700 && maxAbs <= 1100 && maxAbs < maxSide * 0.6) return 'unit1000'
  if (maxAbs <= maxSide * 1.2) return 'pixels'
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
  if (space === 'unit1000') {
    return [(point[0] / UNIT1000_CANVAS) * imageWidth, (point[1] / UNIT1000_CANVAS) * imageHeight]
  }
  return point
}

export type NormalizedFloorplan = {
  extracted: ExtractedFloorplan
  space: ImageCoordinateSpace
  maxAbs: number
}

export type NormalizeFloorplanOptions = {
  /** Outer-wall box in full-image pixels (raster detect or vision landmark). */
  contentBox?: PlanContentBox | null
}

/**
 * Lift vision coordinates onto the image pixel grid.
 * Vision should already return full-image pixels. Registering a ~1000-square
 * onto a raster box is a last-resort fallback only — not a successful extract.
 */
export function normalizeFloorplanCoords(
  extracted: ExtractedFloorplan,
  imageSize: { width: number; height: number },
  options?: NormalizeFloorplanOptions,
): NormalizedFloorplan {
  const points = extractPoints(extracted)
  const maxAbs = maxAbsCoord(points)
  const space = detectImageCoordinateSpace(points, imageSize.width, imageSize.height)
  const target =
    (isImagePixelBox(planBoundsToBox(extracted.planBounds), imageSize.width, imageSize.height)
      ? planBoundsToBox(extracted.planBounds)
      : null) ??
    (isImagePixelBox(options?.contentBox, imageSize.width, imageSize.height)
      ? options.contentBox
      : null)
  const needsRegister = space === 'unit1000'
  if (target && needsRegister) {
    return {
      space: 'pixels',
      maxAbs,
      extracted: registerExtractToBox(extracted, target),
    }
  }
  if (space === 'metres' || space === 'pixels') {
    return { extracted, space, maxAbs }
  }
  const mapPoint = (point: Vec2): Vec2 =>
    toImagePixels(point, imageSize.width, imageSize.height, space)
  return {
    space,
    maxAbs,
    extracted: mapExtracted(extracted, mapPoint),
  }
}

function mapExtracted(
  extracted: ExtractedFloorplan,
  mapPoint: (point: Vec2) => Vec2,
): ExtractedFloorplan {
  return {
    ...extracted,
    rooms: extracted.rooms.map((room) => ({
      ...room,
      polygon: room.polygon.map(mapPoint),
    })),
    doors: extracted.doors.map((door) => ({ ...door, at: mapPoint(door.at) })),
    openings: (extracted.openings ?? []).map((opening) => ({
      ...opening,
      at: mapPoint(opening.at),
    })),
    windows: extracted.windows.map((window) => ({
      ...window,
      at: mapPoint(window.at),
    })),
    dimensions: (extracted.dimensions ?? []).map((dimension) => ({
      ...dimension,
      start: mapPoint(dimension.start),
      end: mapPoint(dimension.end),
    })),
    planBounds: extracted.planBounds
      ? { min: mapPoint(extracted.planBounds.min), max: mapPoint(extracted.planBounds.max) }
      : extracted.planBounds,
  }
}

/** Map extract coordinates from a cleaned raster onto the original image size. */
export function scaleExtractedToImage(
  extracted: ExtractedFloorplan,
  fromSize: { width: number; height: number },
  toSize: { width: number; height: number },
): ExtractedFloorplan {
  if (fromSize.width === toSize.width && fromSize.height === toSize.height) return extracted
  if (fromSize.width < 1 || fromSize.height < 1) return extracted
  const scaleX = toSize.width / fromSize.width
  const scaleY = toSize.height / fromSize.height
  return mapExtracted(extracted, ([x, y]) => [x * scaleX, y * scaleY])
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0]
    const yi = polygon[i]![1]
    const xj = polygon[j]![0]
    const yj = polygon[j]![1]
    const crosses = yi > y !== yj > y
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
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
