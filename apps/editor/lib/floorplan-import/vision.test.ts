import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractedFloorplan } from './schema'
import {
  attachOuterWall,
  attachRoomLabels,
  CLEAN_WALLS_PROMPT,
  floorplanVisionPrompts,
  needsPixelRetry,
  parseOuterWallJson,
  pixelRetryUserPrompt,
  usesWrongPixelGrid,
} from './vision'

const FAILING_IMAGE = { width: 1920, height: 1280 }
const px2 = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/failing-001-px2/extract.json'), 'utf8'),
) as ExtractedFloorplan
const pixels = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/failing-001-px2/extract-pixels.json'), 'utf8'),
) as ExtractedFloorplan

test('a ~1000-square extract is not a successful pixel trace', () => {
  expect(needsPixelRetry(px2, FAILING_IMAGE)).toBe(true)
  expect(usesWrongPixelGrid(px2, FAILING_IMAGE)).toBe(true)
})

test('0..1 fractions also need a pixel retry', () => {
  const normalized: ExtractedFloorplan = {
    ...px2,
    rooms: [
      {
        name: 'Living',
        kind: 'living',
        polygon: [
          [0.2, 0.1],
          [0.5, 0.1],
          [0.5, 0.6],
          [0.2, 0.6],
        ],
      },
    ],
    doors: [],
    windows: [],
    openings: [],
  }
  expect(needsPixelRetry(normalized, FAILING_IMAGE)).toBe(true)
})

test('failing-001 true-pixel extract does not need retry or register', () => {
  expect(needsPixelRetry(pixels, FAILING_IMAGE)).toBe(false)
  expect(usesWrongPixelGrid(pixels, FAILING_IMAGE)).toBe(false)
})

test('pixel retry prompt forbids the 0..1000 square and keeps the raster size', () => {
  const prompt = pixelRetryUserPrompt(FAILING_IMAGE, px2)
  expect(prompt).toContain('1920')
  expect(prompt).toContain('1280')
  expect(prompt).toContain('1000')
  expect(prompt).toContain('not drawn')
})

test('clean+trace prompts stay short and keep the owner walls-only clean', () => {
  const prompts = floorplanVisionPrompts(FAILING_IMAGE)
  expect(prompts.clean).toBe(CLEAN_WALLS_PROMPT)
  expect(prompts.clean).toContain('Очисти этот план квартиры')
  expect(prompts.clean).toContain('interior and exterior walls')
  expect(prompts.clean.length).toBeLessThan(300)
  expect(prompts.traceSystem).toContain('1920')
  expect(prompts.traceSystem).toContain('niche')
  expect(prompts.traceSystem).toContain('not drawn')
  expect(prompts.traceSystem).not.toContain('Mentally erase')
  expect(prompts.traceUser).toContain('walls-only')
  expect(prompts.observeSystem).toContain('labelAt')
  expect(prompts.observeUser).not.toContain('API')
})

test('parseOuterWallJson accepts full-image pixels and rejects a ~1000-square', () => {
  expect(
    parseOuterWallJson('{"outerWall":{"min":[420,16],"max":[1447,1131]}}', FAILING_IMAGE),
  ).toEqual({ minX: 420, minY: 16, maxX: 1447, maxY: 1131 })
  expect(
    parseOuterWallJson('{"outerWall":{"min":[295,10],"max":[985,755]}}', FAILING_IMAGE),
  ).toBeNull()
})

test('attachOuterWall stores the landmark and does not add doors', () => {
  const next = attachOuterWall(
    px2,
    '{"outerWall":{"min":[420,16],"max":[1447,1131]}}',
    FAILING_IMAGE,
  )
  expect(next.planBounds).toEqual({ min: [420, 16], max: [1447, 1131] })
  expect(next.doors).toHaveLength(px2.doors.length)
  expect(next.rooms).toEqual(px2.rooms)
})

test('attachRoomLabels copies names from the original onto cleaned polygons', () => {
  const unlabeled: ExtractedFloorplan = {
    ...pixels,
    rooms: pixels.rooms.map((room) => ({ ...room, name: 'Room', roomNumber: undefined })),
  }
  const next = attachRoomLabels(
    unlabeled,
    JSON.stringify({
      rooms: [{ name: 'Hallway', kind: 'hallway', number: '1', areaSqM: 3.9, labelAt: [1030, 760] }],
      doors: pixels.doors,
    }),
  )
  const hallway = next.rooms.find((room) => room.kind === 'hallway')
  expect(hallway?.name).toBe('Hallway')
  expect(hallway?.roomNumber).toBe('1')
  expect(next.doors).toHaveLength(pixels.doors.length)
})
