import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectImageCoordinateSpace,
  extractMaxAbs,
  normalizeFloorplanCoords,
  toImagePixels,
  UNIT1000_CANVAS,
} from './geometry'
import type { ExtractedFloorplan } from './schema'

const FAILING_IMAGE = { width: 1920, height: 1280 }
const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/unit1000-1920x1280.json'), 'utf8'),
) as ExtractedFloorplan

test('apartment-scale metres are not classified as image pixels', () => {
  expect(
    detectImageCoordinateSpace(
      [
        [0, 0],
        [12, 9],
      ],
      1920,
      1280,
    ),
  ).toBe('metres')
  expect(
    detectImageCoordinateSpace(
      [
        [0.1, 0.2],
        [0.4, 0.6],
      ],
      1920,
      1280,
    ),
  ).toBe('normalized')
  expect(
    detectImageCoordinateSpace(
      [
        [120, 80],
        [1500, 1100],
      ],
      1920,
      1280,
    ),
  ).toBe('pixels')
})

test('~1000-square vision coords on a 1920×1280 scan are unit1000, not pixels', () => {
  expect(extractMaxAbs(fixture)).toBe(985)
  expect(
    detectImageCoordinateSpace(
      fixture.rooms.flatMap((room) => room.polygon),
      FAILING_IMAGE.width,
      FAILING_IMAGE.height,
    ),
  ).toBe('unit1000')
})

test('a ~1000-square extract on a 1024px image stays pixels', () => {
  expect(
    detectImageCoordinateSpace(
      [
        [100, 80],
        [985, 700],
      ],
      1024,
      768,
    ),
  ).toBe('pixels')
})

test('normalizeFloorplanCoords remaps the failing-001 ~1000-square onto 1920×1280', () => {
  const rawXs = fixture.rooms.flatMap((room) => room.polygon.map((point) => point[0]))
  expect(Math.max(...rawXs)).toBe(985)

  const { extracted, space, maxAbs } = normalizeFloorplanCoords(fixture, FAILING_IMAGE)
  expect(space).toBe('unit1000')
  expect(maxAbs).toBe(985)

  const xs = extracted.rooms.flatMap((room) => room.polygon.map((point) => point[0]))
  const ys = extracted.rooms.flatMap((room) => room.polygon.map((point) => point[1]))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  expect(minX).toBeCloseTo((295 / UNIT1000_CANVAS) * 1920, 5)
  expect(maxX).toBeCloseTo((985 / UNIT1000_CANVAS) * 1920, 5)
  expect(minY).toBeCloseTo((10 / UNIT1000_CANVAS) * 1280, 5)
  expect(maxY).toBeCloseTo((755 / UNIT1000_CANVAS) * 1280, 5)

  // Before: geometry stuck on the left half (maxX=985). After: spans the raster.
  expect(maxX).toBeGreaterThan(1800)
  expect(minX).toBeGreaterThan(500)
  expect(maxX).toBeLessThanOrEqual(1920)
  expect(maxY).toBeLessThanOrEqual(1280)
  expect(extracted.doors).toHaveLength(1)
  expect(extracted.openings).toHaveLength(0)
  expect(extracted.windows).toHaveLength(1)
})

test('normalizeFloorplanCoords maps 0..1 onto W×H and leaves true pixels alone', () => {
  const normalized: ExtractedFloorplan = {
    rooms: [
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [0.1, 0.2],
          [0.4, 0.2],
          [0.4, 0.6],
          [0.1, 0.6],
        ],
      },
    ],
    doors: [],
    openings: [],
    windows: [],
    dimensions: [],
    confidence: 0.8,
  }
  const fromUnit = normalizeFloorplanCoords(normalized, FAILING_IMAGE)
  expect(fromUnit.space).toBe('normalized')
  expect(fromUnit.extracted.rooms[0]?.polygon[0]).toEqual([192, 256])

  const pixels: ExtractedFloorplan = {
    ...normalized,
    rooms: [
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [200, 160],
          [1500, 160],
          [1500, 1000],
          [200, 1000],
        ],
      },
    ],
  }
  const fromPixels = normalizeFloorplanCoords(pixels, FAILING_IMAGE)
  expect(fromPixels.space).toBe('pixels')
  expect(fromPixels.extracted.rooms[0]?.polygon).toEqual(pixels.rooms[0]?.polygon)
})

test('toImagePixels maps the unit1000 canvas, not maxAbs, onto W×H', () => {
  expect(toImagePixels([985, 755], 1920, 1280, 'unit1000')[0]).toBeCloseTo(
    (985 / UNIT1000_CANVAS) * 1920,
    5,
  )
  expect(toImagePixels([985, 755], 1920, 1280, 'unit1000')[1]).toBeCloseTo(
    (755 / UNIT1000_CANVAS) * 1280,
    5,
  )
})
