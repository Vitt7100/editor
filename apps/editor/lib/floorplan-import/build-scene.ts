import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  BuildingNode,
  DoorNode,
  GuideNode,
  LevelNode,
  SiteNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import {
  clampDoorLocalX,
  cleanPolygon,
  detectImageCoordinateSpace,
  distance2,
  extractPoints,
  median,
  normalizeFloorplanCoords,
  type PlanContentBox,
  polygonArea,
  polygonBounds,
  projectPointToSegment,
  scalePoint,
  snapPoint,
  translatePoint,
  undirectedEdgeKey,
  weldVertices,
} from './geometry'
import type { ImageSize } from './image-size'
import {
  BALCONY_WALL_THICKNESS,
  DEFAULT_DOOR_HEIGHT,
  DEFAULT_DOOR_WIDTH,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_SILL,
  DEFAULT_WINDOW_WIDTH,
  EXTERIOR_WALL_THICKNESS,
  type ExtractedDimension,
  type ExtractedFloorplan,
  type ExtractedRoom,
  FALLBACK_PLAN_WIDTH_M,
  INTERIOR_WALL_THICKNESS,
  MAX_DOOR_WIDTH_M,
  MAX_OPENING_WIDTH_M,
  MAX_WINDOW_WIDTH_M,
  MIN_ABSOLUTE_ROOM_AREA,
  MIN_WALL_LENGTH,
  OPENING_MATCH_DISTANCE,
  ROOM_COLORS,
  type RoomKind,
  sanitizeMetreWidth,
  VERTEX_WELD_TOLERANCE,
  type Vec2,
} from './schema'

export type BuildSceneOptions = {
  wallHeight?: number
  guide?: { url: string; name?: string } | null
  imageSize?: ImageSize | null
  contentBox?: PlanContentBox | null
}

export type BuiltFloorplanScene = {
  graph: SceneGraph
  walls: number
  rooms: number
  doors: number
  windows: number
  warnings: string[]
  confidence: number
}

type UniqueWall = {
  start: Vec2
  end: Vec2
  thickness: number
  occupancy: number
  kinds: Set<RoomKind>
}

type WallRecord = {
  id: string
  start: Vec2
  end: Vec2
  childIds: string[]
  occupancy: number
  kinds: Set<RoomKind>
}

export function buildSceneFromFloorplan(
  extracted: ExtractedFloorplan,
  options: BuildSceneOptions = {},
): BuiltFloorplanScene {
  const warnings: string[] = []
  const wallHeight = options.wallHeight ?? DEFAULT_WALL_HEIGHT
  const imageSize = options.imageSize ?? null
  const normalized = imageSize
    ? normalizeFloorplanCoords(extracted, imageSize, { contentBox: options.contentBox })
    : {
        extracted,
        space: detectImageCoordinateSpace(extractPoints(extracted)),
        maxAbs: 0,
      }
  const plan = normalized.extracted
  const source = normalized.space
  const inPixels = source !== 'metres'

  const {
    rooms: preparedRooms,
    transform,
    imageRect,
  } = prepareRooms(
    plan.rooms,
    plan.dimensions ?? [],
    warnings,
    imageSize && inPixels ? imageSize : null,
    inPixels ? 'pixels' : 'metres',
    plan.totalAreaSqM ?? undefined,
  )
  if (preparedRooms.length === 0) {
    throw new Error('No usable rooms in the floor plan')
  }

  const passages = [
    ...plan.doors.map((door) => ({
      ...door,
      openingKind: door.openingKind ?? ('door' as const),
    })),
    ...(plan.openings ?? []).map((opening) => ({
      ...opening,
      openingKind: opening.openingKind ?? ('opening' as const),
    })),
  ].map((passage) => ({
    ...passage,
    at: applyTransform(passage.at, transform),
  }))
  const windows = plan.windows.map((window) => ({
    ...window,
    at: applyTransform(window.at, transform),
    width: window.width,
  }))

  const uniqueWalls = collectUniqueWalls(preparedRooms)
  const bounds = polygonBounds(preparedRooms.flatMap((room) => room.polygon))

  const nodes: Record<AnyNodeId, AnyNode> = {}
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ level: 0, height: wallHeight })
  const site = SiteNode.parse({
    children: [building.id],
    polygon: {
      type: 'polygon',
      points: sitePolygon(bounds),
    },
  })

  const siteId = site.id as AnyNodeId
  const buildingId = building.id as AnyNodeId
  const levelId = level.id as AnyNodeId
  const levelChildren: string[] = []

  nodes[siteId] = { ...site, parentId: null } as AnyNode
  nodes[buildingId] = { ...(building as AnyNode), parentId: siteId, children: [levelId] }

  const wallRecords: WallRecord[] = []

  for (const wall of uniqueWalls) {
    const parsed = WallNode.parse({
      start: wall.start,
      end: wall.end,
      thickness: wall.thickness,
      height: wallHeight,
      name: wall.occupancy > 1 ? 'Interior wall' : 'Exterior wall',
      frontSide: wall.occupancy > 1 ? 'interior' : 'unknown',
      backSide: wall.occupancy > 1 ? 'interior' : 'exterior',
      metadata: { source: 'floorplan-import' },
    })
    const linked = { ...(parsed as AnyNode), parentId: levelId }
    nodes[parsed.id as AnyNodeId] = linked
    levelChildren.push(parsed.id)
    wallRecords.push({
      id: parsed.id,
      start: wall.start,
      end: wall.end,
      childIds: [],
      occupancy: wall.occupancy,
      kinds: wall.kinds,
    })
  }

  let doorsAdded = 0
  for (const passage of passages) {
    if (placeDoor(passage, wallRecords, nodes, warnings)) doorsAdded++
  }

  let windowsAdded = 0
  for (const window of windows) {
    const match = nearestWall(window.at, wallRecords)
    if (!match) {
      warnings.push(`Window at ${fmt(window.at)} could not be placed on a wall`)
      continue
    }
    const width = sanitizeMetreWidth(window.width, MAX_WINDOW_WIDTH_M) ?? DEFAULT_WINDOW_WIDTH
    const wallLength = distance2(match.wall.start, match.wall.end)
    if (wallLength + 1e-6 < width) {
      warnings.push(`Window skipped: wall ${match.wall.id} is shorter than ${width} m`)
      continue
    }
    const localX = clampDoorLocalX(wallLength, width, match.t)
    const parsed = WindowNode.parse({
      wallId: match.wall.id,
      parentId: match.wall.id,
      position: [localX, DEFAULT_WINDOW_SILL + DEFAULT_WINDOW_HEIGHT / 2, 0],
      width,
      height: DEFAULT_WINDOW_HEIGHT,
      metadata: { source: 'floorplan-import' },
    })
    nodes[parsed.id as AnyNodeId] = parsed as AnyNode
    match.wall.childIds.push(parsed.id)
    windowsAdded++
  }

  for (const wall of wallRecords) {
    if (wall.childIds.length === 0) continue
    const existing = nodes[wall.id as AnyNodeId]
    if (existing?.type !== 'wall') continue
    nodes[wall.id as AnyNodeId] = {
      ...existing,
      children: wall.childIds,
    } as AnyNode
  }

  for (const room of preparedRooms) {
    const isBalcony = room.kind === 'balcony'
    const zone = ZoneNode.parse({
      name: room.name,
      polygon: room.polygon,
      color: ROOM_COLORS[room.kind],
      spaceRole: 'room',
      roomNumber: room.roomNumber ?? '',
      enclosureStatus: isBalcony ? 'open' : 'enclosed',
      ceilingHeight: wallHeight,
      metadata: {
        source: 'floorplan-import',
        kind: room.kind,
        labeledAreaSqM: room.labeledAreaSqM,
      },
    })
    nodes[zone.id as AnyNodeId] = { ...(zone as AnyNode), parentId: levelId }
    levelChildren.push(zone.id)
  }

  if (options.guide?.url) {
    const guideRect = imageRect ?? bounds
    const guide = GuideNode.parse({
      name: options.guide.name ?? 'Floor plan',
      url: options.guide.url,
      position: [guideRect.centerX, 0.02, guideRect.centerZ],
      rotation: [0, 0, 0],
      scale: Math.max(guideRect.width, 1) / 10,
      opacity: 70,
      metadata: { source: 'floorplan-import' },
    })
    nodes[guide.id as AnyNodeId] = { ...(guide as AnyNode), parentId: levelId }
    levelChildren.push(guide.id)
  }

  nodes[levelId] = {
    ...(level as AnyNode),
    parentId: buildingId,
    children: levelChildren,
  }

  if (extracted.notes) warnings.push(extracted.notes)

  return {
    graph: {
      nodes,
      rootNodeIds: [siteId],
      collections: {},
    },
    walls: uniqueWalls.length,
    rooms: preparedRooms.length,
    doors: doorsAdded,
    windows: windowsAdded,
    warnings: warnings.filter(Boolean),
    confidence: extracted.confidence,
  }
}

type PreparedRoom = ExtractedRoom & { polygon: Vec2[] }

type PlanTransform = {
  scale: number
  dx: number
  dz: number
}

function applyTransform(point: Vec2, transform: PlanTransform): Vec2 {
  return snapPoint(
    translatePoint(scalePoint(point, transform.scale, [0, 0]), transform.dx, transform.dz),
    0.01,
  )
}

function prepareRooms(
  rooms: ExtractedRoom[],
  dimensions: ExtractedDimension[],
  warnings: string[],
  imageSize: ImageSize | null,
  space: 'metres' | 'pixels',
  totalAreaSqM?: number,
): {
  rooms: PreparedRoom[]
  transform: PlanTransform
  imageRect: ReturnType<typeof polygonBounds> | null
} {
  const cleaned: PreparedRoom[] = []
  for (const room of rooms) {
    const polygon = cleanPolygon(room.polygon, space === 'metres' ? 0.05 : 0.01)
    if (polygon.length < 3) {
      warnings.push(`Room "${room.name}" dropped: not enough unique vertices`)
      continue
    }
    cleaned.push({ ...room, polygon })
  }
  if (cleaned.length === 0) {
    return {
      rooms: [],
      transform: { scale: 1, dx: 0, dz: 0 },
      imageRect: null,
    }
  }

  const measured = resolveScale(cleaned, dimensions, space, totalAreaSqM)
  const scale = Math.abs(measured - 1) < 0.02 ? 1 : measured
  const scaled = cleaned.map((room) => ({
    ...room,
    polygon: room.polygon.map((point) => scalePoint(point, scale, [0, 0])),
  }))

  const kept: PreparedRoom[] = []
  for (const room of scaled) {
    const area = polygonArea(room.polygon)
    if (area < MIN_ABSOLUTE_ROOM_AREA) {
      warnings.push(`Room "${room.name}" dropped: ${area.toFixed(2)} m² is degenerate`)
      continue
    }
    kept.push(room)
  }
  const usable = kept.length > 0 ? kept : scaled

  const weldedPolys = weldVertices(
    usable.map((room) => room.polygon),
    VERTEX_WELD_TOLERANCE,
  )
  const welded = usable.map((room, index) => ({
    ...room,
    polygon: cleanPolygon(weldedPolys[index] ?? room.polygon, 0.01),
  }))

  const imageRectSource = imageSize
    ? polygonBounds([
        [0, 0],
        [imageSize.width, 0],
        [imageSize.width, imageSize.height],
        [0, imageSize.height],
      ])
    : null

  const centerBounds = imageRectSource
    ? {
        ...imageRectSource,
        minX: imageRectSource.minX * scale,
        maxX: imageRectSource.maxX * scale,
        minZ: imageRectSource.minZ * scale,
        maxZ: imageRectSource.maxZ * scale,
        width: imageRectSource.width * scale,
        depth: imageRectSource.depth * scale,
        centerX: imageRectSource.centerX * scale,
        centerZ: imageRectSource.centerZ * scale,
      }
    : polygonBounds(welded.flatMap((room) => room.polygon))

  const transform: PlanTransform = {
    scale,
    dx: -centerBounds.centerX,
    dz: -centerBounds.centerZ,
  }

  const roomsOut = welded.map((room) => ({
    ...room,
    polygon: room.polygon.map((point) =>
      snapPoint(translatePoint(point, transform.dx, transform.dz), 0.01),
    ),
  }))

  const imageRect = imageRectSource
    ? {
        minX: centerBounds.minX + transform.dx,
        maxX: centerBounds.maxX + transform.dx,
        minZ: centerBounds.minZ + transform.dz,
        maxZ: centerBounds.maxZ + transform.dz,
        width: centerBounds.width,
        depth: centerBounds.depth,
        centerX: 0,
        centerZ: 0,
      }
    : null

  return { rooms: roomsOut, transform, imageRect }
}

function resolveScale(
  rooms: PreparedRoom[],
  dimensions: ExtractedDimension[],
  source: 'metres' | 'pixels',
  totalAreaSqM?: number,
): number {
  const ratios = [
    ...scaleRatiosFromAreas(rooms),
    ...scaleRatiosFromDimensions(dimensions),
    ...scaleRatiosFromTotalArea(rooms, totalAreaSqM),
  ]
  if (ratios.length > 0) return median(ratios)
  if (source === 'metres') return 1
  const bounds = polygonBounds(rooms.flatMap((room) => room.polygon))
  const longest = Math.max(bounds.width, bounds.depth)
  if (longest < 1e-6) return 1
  return FALLBACK_PLAN_WIDTH_M / longest
}

function scaleRatiosFromTotalArea(rooms: PreparedRoom[], totalAreaSqM?: number): number[] {
  if (!totalAreaSqM || totalAreaSqM <= 0) return []
  const area = rooms.reduce((sum, room) => sum + polygonArea(room.polygon), 0)
  if (area < 0.05) return []
  return [Math.sqrt(totalAreaSqM / area)]
}

function scaleRatiosFromAreas(rooms: PreparedRoom[]): number[] {
  const ratios: number[] = []
  for (const room of rooms) {
    if (!room.labeledAreaSqM) continue
    const area = polygonArea(room.polygon)
    if (area < 0.05) continue
    ratios.push(Math.sqrt(room.labeledAreaSqM / area))
  }
  return ratios
}

function scaleRatiosFromDimensions(dimensions: ExtractedDimension[]): number[] {
  const ratios: number[] = []
  for (const dimension of dimensions) {
    const drawn = distance2(dimension.start, dimension.end)
    if (drawn < 1e-6) continue
    ratios.push(dimension.lengthM / drawn)
  }
  return ratios
}

function collectUniqueWalls(rooms: PreparedRoom[]): UniqueWall[] {
  const byKey = new Map<string, UniqueWall>()
  for (const room of rooms) {
    for (let i = 0; i < room.polygon.length; i++) {
      const start = room.polygon[i]!
      const end = room.polygon[(i + 1) % room.polygon.length]!
      if (distance2(start, end) < MIN_WALL_LENGTH) continue
      const key = undirectedEdgeKey(start, end)
      const existing = byKey.get(key)
      if (existing) {
        existing.occupancy += 1
        existing.kinds.add(room.kind)
        continue
      }
      const [orderedStart, orderedEnd] =
        start[0] < end[0] || (start[0] === end[0] && start[1] <= end[1])
          ? [start, end]
          : [end, start]
      byKey.set(key, {
        start: orderedStart,
        end: orderedEnd,
        occupancy: 1,
        kinds: new Set([room.kind]),
        thickness: EXTERIOR_WALL_THICKNESS,
      })
    }
  }

  for (const wall of byKey.values()) {
    if (wall.occupancy > 1) {
      wall.thickness = INTERIOR_WALL_THICKNESS
    } else if (wall.kinds.size === 1 && wall.kinds.has('balcony')) {
      wall.thickness = BALCONY_WALL_THICKNESS
    } else {
      wall.thickness = EXTERIOR_WALL_THICKNESS
    }
  }

  return [...byKey.values()]
}

function sitePolygon(bounds: ReturnType<typeof polygonBounds>): Vec2[] {
  const pad = Math.max(4, Math.max(bounds.width, bounds.depth) * 0.4)
  return [
    [bounds.minX - pad, bounds.minZ - pad],
    [bounds.maxX + pad, bounds.minZ - pad],
    [bounds.maxX + pad, bounds.maxZ + pad],
    [bounds.minX - pad, bounds.maxZ + pad],
  ]
}

function nearestWall(point: Vec2, walls: WallRecord[]) {
  let best:
    | {
        wall: WallRecord
        t: number
        distance: number
      }
    | undefined
  for (const wall of walls) {
    const projected = projectPointToSegment(point, wall.start, wall.end)
    if (!best || projected.distance < best.distance) {
      best = { wall, t: projected.t, distance: projected.distance }
    }
  }
  if (!best || best.distance > OPENING_MATCH_DISTANCE) return null
  return best
}

function placeDoor(
  door: {
    at: Vec2
    width?: number
    openingKind?: 'door' | 'opening'
    hingesSide?: 'left' | 'right'
    swingDirection?: 'inward' | 'outward'
  },
  wallRecords: WallRecord[],
  nodes: Record<AnyNodeId, AnyNode>,
  warnings: string[],
): boolean {
  const match = nearestWall(door.at, wallRecords)
  if (!match) {
    warnings.push(`Door at ${fmt(door.at)} could not be placed on a wall`)
    return false
  }
  const maxWidth = door.openingKind === 'opening' ? MAX_OPENING_WIDTH_M : MAX_DOOR_WIDTH_M
  const width = sanitizeMetreWidth(door.width, maxWidth) ?? DEFAULT_DOOR_WIDTH
  const wallLength = distance2(match.wall.start, match.wall.end)
  if (wallLength + 1e-6 < width) {
    warnings.push(`Door skipped: wall ${match.wall.id} is shorter than ${width} m`)
    return false
  }
  const localX = clampDoorLocalX(wallLength, width, match.t)
  const isOpening = door.openingKind === 'opening'
  const parsed = DoorNode.parse({
    wallId: match.wall.id,
    parentId: match.wall.id,
    position: [localX, DEFAULT_DOOR_HEIGHT / 2, 0],
    width,
    height: DEFAULT_DOOR_HEIGHT,
    openingKind: isOpening ? 'opening' : 'door',
    handle: !isOpening,
    threshold: !isOpening,
    hingesSide: door.hingesSide ?? 'left',
    swingDirection: door.swingDirection ?? 'inward',
    metadata: { source: 'floorplan-import' },
  })
  nodes[parsed.id as AnyNodeId] = parsed as AnyNode
  match.wall.childIds.push(parsed.id)
  return true
}

function fmt(point: Vec2): string {
  return `[${point[0].toFixed(2)}, ${point[1].toFixed(2)}]`
}
