import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSceneFromFloorplan } from './build-scene'
import { polygonArea } from './geometry'
import type { ExtractedFloorplan } from './schema'
import { parseVisionJson } from './vision'

const twoRooms: ExtractedFloorplan = {
  rooms: [
    {
      name: 'Living',
      kind: 'living',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 5],
        [0, 5],
      ],
      labeledAreaSqM: 20,
    },
    {
      name: 'Bedroom',
      kind: 'bedroom',
      polygon: [
        [4, 0],
        [8, 0],
        [8, 5],
        [4, 5],
      ],
      labeledAreaSqM: 20,
    },
  ],
  doors: [{ at: [4, 1.2], width: 0.9, hingesSide: 'left', swingDirection: 'inward' }],
  openings: [],
  windows: [{ at: [2, 0], width: 1.2 }],
  dimensions: [],
  confidence: 0.9,
}

test('shared wall between two rooms is created once as an interior wall', () => {
  const built = buildSceneFromFloorplan(twoRooms)
  const walls = Object.values(built.graph.nodes).filter((node) => node.type === 'wall')
  const interior = walls.filter((wall) => wall.type === 'wall' && wall.thickness === 0.12)
  const exterior = walls.filter((wall) => wall.type === 'wall' && wall.thickness === 0.3)

  expect(built.rooms).toBe(2)
  expect(interior).toHaveLength(1)
  expect(exterior.length).toBeGreaterThanOrEqual(6)
  expect(built.doors).toBe(1)
  expect(built.windows).toBe(1)
})

test('labeled areas scale polygons to match m²', () => {
  const oversized: ExtractedFloorplan = {
    ...twoRooms,
    rooms: twoRooms.rooms.map((room) => ({
      ...room,
      polygon: room.polygon.map(([x, z]) => [x * 2, z * 2] as [number, number]),
    })),
  }
  const built = buildSceneFromFloorplan(oversized)
  const zones = Object.values(built.graph.nodes).filter((node) => node.type === 'zone')
  expect(zones).toHaveLength(2)
  for (const zone of zones) {
    if (zone.type !== 'zone') continue
    expect(polygonArea(zone.polygon)).toBeCloseTo(20, 0)
  }
})

test('balcony rooms skip ceilings and use thinner perimeter walls', () => {
  const plan: ExtractedFloorplan = {
    rooms: [
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        labeledAreaSqM: 16,
      },
      {
        name: 'Balcony',
        kind: 'balcony',
        polygon: [
          [1, 4],
          [2, 4],
          [2, 4.8],
          [1, 4.8],
        ],
        labeledAreaSqM: 0.8,
      },
    ],
    doors: [],
    openings: [],
    windows: [],
    dimensions: [],
    confidence: 0.7,
  }
  const built = buildSceneFromFloorplan(plan)
  const ceilings = Object.values(built.graph.nodes).filter((node) => node.type === 'ceiling')
  const slabs = Object.values(built.graph.nodes).filter((node) => node.type === 'slab')
  const balconyWalls = Object.values(built.graph.nodes).filter(
    (node) => node.type === 'wall' && node.thickness === 0.08,
  )
  expect(ceilings).toHaveLength(0)
  expect(slabs).toHaveLength(0)
  expect(balconyWalls.length).toBeGreaterThan(0)
})

test('guide overlay is parented to the level when a url is provided', () => {
  const built = buildSceneFromFloorplan(twoRooms, {
    guide: { url: 'data:image/png;base64,aaaa', name: 'Plan' },
  })
  const guides = Object.values(built.graph.nodes).filter((node) => node.type === 'guide')
  expect(guides).toHaveLength(1)
  expect(guides[0]?.parentId).toBeTruthy()
})

test('pixel coordinates align the guide to the full image, not the room bbox', () => {
  const plan: ExtractedFloorplan = {
    rooms: [
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [100, 100],
          [300, 100],
          [300, 300],
          [100, 300],
        ],
        labeledAreaSqM: 16,
      },
    ],
    doors: [],
    openings: [],
    windows: [],
    dimensions: [],
    confidence: 0.8,
  }
  const built = buildSceneFromFloorplan(plan, {
    imageSize: { width: 1000, height: 500 },
    guide: { url: '/api/scenes/abc/guide', name: 'Plan' },
  })
  const guide = Object.values(built.graph.nodes).find((node) => node.type === 'guide')
  expect(guide?.type).toBe('guide')
  if (guide?.type !== 'guide') return
  expect(guide.position[0]).toBeCloseTo(0, 5)
  expect(guide.position[2]).toBeCloseTo(0, 5)
  expect(guide.scale).toBeCloseTo(2, 5)
})

test('normalized 0-1 coordinates map onto the image so the guide keeps the image aspect', () => {
  const plan: ExtractedFloorplan = {
    rooms: [
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [0.1, 0.2],
          [0.3, 0.2],
          [0.3, 0.6],
          [0.1, 0.6],
        ],
        labeledAreaSqM: 16,
      },
    ],
    doors: [],
    openings: [],
    windows: [],
    dimensions: [],
    confidence: 0.8,
  }
  const built = buildSceneFromFloorplan(plan, {
    imageSize: { width: 1000, height: 500 },
    guide: { url: '/api/scenes/abc/guide', name: 'Plan' },
  })
  const guide = Object.values(built.graph.nodes).find((node) => node.type === 'guide')
  expect(guide?.type).toBe('guide')
  if (guide?.type !== 'guide') return
  expect(guide.scale).toBeCloseTo(2, 5)
  const zone = Object.values(built.graph.nodes).find((node) => node.type === 'zone')
  expect(zone?.type).toBe('zone')
  if (zone?.type !== 'zone') return
  expect(polygonArea(zone.polygon)).toBeCloseTo(16, 0)
})

test('a drawn opening is not turned into a door leaf', () => {
  const plan: ExtractedFloorplan = {
    ...twoRooms,
    doors: [],
    openings: [{ at: [4, 1.2], width: 0.9 }],
    windows: [],
  }
  const built = buildSceneFromFloorplan(plan)
  const doors = Object.values(built.graph.nodes).filter((node) => node.type === 'door')
  expect(doors).toHaveLength(1)
  expect(doors[0]).toMatchObject({ type: 'door', openingKind: 'opening' })
})

test('windows are placed where the extract put them', () => {
  const plan: ExtractedFloorplan = {
    rooms: [
      {
        name: 'Hall',
        kind: 'hallway',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 3],
          [0, 3],
        ],
        labeledAreaSqM: 6,
      },
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [2, 0],
          [6, 0],
          [6, 3],
          [2, 3],
        ],
        labeledAreaSqM: 12,
      },
    ],
    doors: [{ at: [2, 1.5], width: 0.9 }],
    openings: [],
    windows: [
      { at: [0, 1.5], width: 1.2 },
      { at: [6, 1.5], width: 1.2 },
    ],
    dimensions: [],
    confidence: 0.8,
  }
  const built = buildSceneFromFloorplan(plan)
  expect(built.windows).toBe(2)
})

test('rooms without a drawn door stay without a door', () => {
  const plan: ExtractedFloorplan = {
    rooms: [
      {
        name: 'Hall',
        kind: 'hallway',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 3],
          [0, 3],
        ],
        labeledAreaSqM: 6,
      },
      {
        name: 'Bedroom',
        kind: 'bedroom',
        polygon: [
          [2, 0],
          [6, 0],
          [6, 3],
          [2, 3],
        ],
        labeledAreaSqM: 12,
      },
    ],
    doors: [],
    openings: [],
    windows: [],
    dimensions: [],
    confidence: 0.7,
  }
  const built = buildSceneFromFloorplan(plan)
  expect(built.doors).toBe(0)
})

test('metre coordinates do not stretch the guide to the full image', () => {
  const built = buildSceneFromFloorplan(twoRooms, {
    imageSize: { width: 1920, height: 1280 },
    guide: { url: '/api/scenes/abc/guide', name: 'Plan' },
  })
  const guide = Object.values(built.graph.nodes).find((node) => node.type === 'guide')
  expect(guide?.type).toBe('guide')
  if (guide?.type !== 'guide') return
  expect(guide.scale).toBeCloseTo(0.8, 5)
})

test('~1000-square extract aligns walls with the full 1920×1280 guide, not the left half', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures/unit1000-1920x1280.json'), 'utf8'),
  ) as ExtractedFloorplan
  const built = buildSceneFromFloorplan(fixture, {
    imageSize: { width: 1920, height: 1280 },
    guide: { url: '/api/scenes/abc/guide', name: 'Plan' },
  })
  const guide = Object.values(built.graph.nodes).find((node) => node.type === 'guide')
  expect(guide?.type).toBe('guide')
  if (guide?.type !== 'guide') return
  const zones = Object.values(built.graph.nodes).filter((node) => node.type === 'zone')
  const xs = zones.flatMap((zone) =>
    zone.type === 'zone' ? zone.polygon.map((point) => point[0]) : [],
  )
  const maxX = Math.max(...xs)
  const guideHalfWidth = guide.scale * 5
  // Remapped right wall sits near the right edge of the guide (~0.97).
  // The old 0..1-only overlay left maxAbs=985 as pixels, ratio ≈ 0.03.
  expect(maxX / guideHalfWidth).toBeCloseTo(931.2 / 960, 1)
  expect(built.doors).toBe(1)
  expect(built.windows).toBe(1)
  const doorNodes = Object.values(built.graph.nodes).filter((node) => node.type === 'door')
  expect(doorNodes).toHaveLength(1)
  expect(doorNodes[0]).toMatchObject({ type: 'door', openingKind: 'door' })
})

test('parseVisionJson accepts fenced JSON', () => {
  const parsed = parseVisionJson(`\`\`\`json
${JSON.stringify(twoRooms)}
\`\`\``)
  expect(parsed.rooms).toHaveLength(2)
  expect(parsed.doors).toHaveLength(1)
})
