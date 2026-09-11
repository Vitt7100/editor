import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractedFloorplan } from './schema'
import {
  applyUnderstandToExtract,
  attachOuterWall,
  attachRoomLabels,
  CLEAN_WALLS_PROMPT,
  floorplanVisionPrompts,
  measureRoomHints,
  nearestOpenRouterAspectRatio,
  needsClean,
  needsPixelRetry,
  parseOuterWallJson,
  parseUnderstandJson,
  pixelRetryUserPrompt,
  sanitizeExtracted,
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

test('prompts follow understand → optional clean → measure', () => {
  const prompts = floorplanVisionPrompts(FAILING_IMAGE)
  expect(prompts.clean).toBe(CLEAN_WALLS_PROMPT)
  expect(prompts.clean).toContain('Очисти этот план квартиры')
  expect(prompts.clean).toContain('walls, windows, and doors')
  expect(prompts.clean.length).toBeLessThan(300)
  expect(prompts.understandSystem).toContain('hasFurniture')
  expect(prompts.understandSystem).toContain('hasPrintedAreas')
  expect(prompts.understandSystem).toContain('Do not invent')
  expect(prompts.understandSystem).toContain('areaSqM only')
  expect(prompts.understandSystem).toContain('Omit a field')
  expect(prompts.understandSystem).toContain('Bathroom fixtures')
  expect(prompts.understandUser).toContain('furniture/clutter')
  expect(prompts.understandUser).not.toContain('API')
  expect(prompts.measureSystem).toContain('1920')
  expect(prompts.measureSystem).toContain('niche')
  expect(prompts.measureSystem).toContain('not drawn')
  expect(prompts.measureSystem).toContain('must not overlap')
  expect(prompts.measureSystem).toContain('outer shell')
  expect(prompts.measureSystem).toContain('Do not invent labeledAreaSqM')
  expect(prompts.measureSystem).not.toContain('Mentally erase')
  expect(prompts.measureUser).toContain('Trace room polygons')
  expect(prompts.observeSystem).toBe(prompts.understandSystem)
  expect(prompts.traceSystem).toBe(prompts.measureSystem)
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
      rooms: [
        { name: 'Hallway', kind: 'hallway', number: '1', areaSqM: 3.9, labelAt: [1030, 760] },
      ],
      doors: pixels.doors,
    }),
  )
  const hallway = next.rooms.find((room) => room.kind === 'hallway')
  expect(hallway?.name).toBe('Hallway')
  expect(hallway?.roomNumber).toBe('1')
  expect(hallway?.labeledAreaSqM).toBe(3.9)
  expect(next.doors).toHaveLength(pixels.doors.length)
})

test('needsClean is true only when furniture or clutter is present', () => {
  expect(needsClean({ hasFurniture: false, hasClutter: false })).toBe(false)
  expect(needsClean({ hasFurniture: true, hasClutter: false })).toBe(true)
  expect(needsClean({ hasFurniture: false, hasClutter: true })).toBe(true)
})

test('parseUnderstandJson accepts the understand payload', () => {
  const understood = parseUnderstandJson(
    JSON.stringify({
      rooms: [{ name: 'Hallway', kind: 'hallway', areaSqM: 3.9, labelAt: [1030, 760] }],
      hasFurniture: true,
      hasClutter: false,
      hasPrintedAreas: true,
      hasPrintedDimensions: false,
    }),
  )
  expect(understood?.hasFurniture).toBe(true)
  expect(understood?.hasPrintedAreas).toBe(true)
  expect(understood?.rooms[0]?.areaSqM).toBe(3.9)
})

test('printed areas attach to rooms; invented tracer areas are dropped', () => {
  const unlabeled: ExtractedFloorplan = {
    ...pixels,
    rooms: pixels.rooms.map((room) => ({
      ...room,
      name: 'Room',
      labeledAreaSqM: 99,
      roomNumber: undefined,
    })),
    dimensions: [{ start: [0, 0], end: [10, 0], lengthM: 8 }],
  }
  const understood = parseUnderstandJson(
    JSON.stringify({
      rooms: [
        { name: 'Hallway', kind: 'hallway', number: '1', areaSqM: 3.9, labelAt: [1030, 760] },
      ],
      hasFurniture: false,
      hasClutter: false,
      hasPrintedAreas: true,
      hasPrintedDimensions: false,
      totalAreaSqM: 40,
    }),
  )
  expect(understood).not.toBeNull()
  const next = applyUnderstandToExtract(unlabeled, understood!)
  const hallway = next.rooms.find((room) => room.kind === 'hallway')
  const living = next.rooms.find((room) => room.kind === 'living')
  expect(hallway?.labeledAreaSqM).toBe(3.9)
  expect(living?.labeledAreaSqM).toBeUndefined()
  expect(next.dimensions).toEqual([])
  expect(next.totalAreaSqM).toBe(40)
})

test('printed area text is not used as a room name', () => {
  const unlabeled: ExtractedFloorplan = {
    ...pixels,
    rooms: pixels.rooms.map((room) => ({ ...room, name: '12.5 м²' })),
  }
  const next = attachRoomLabels(
    unlabeled,
    JSON.stringify({
      rooms: [{ name: '19.4 m2', kind: 'living', labelAt: [700, 500] }],
    }),
  )
  const living = next.rooms.find((room) => room.kind === 'living')
  expect(living?.name).toBe('Living')
  expect(living?.labeledAreaSqM).toBe(19.4)
  expect(next.rooms.find((room) => room.kind === 'hallway')?.name).toBe('Hallway')
})

test('pixel-like opening widths are dropped; metre widths are kept', () => {
  const next = sanitizeExtracted({
    ...pixels,
    doors: [
      { at: [743, 129], width: 0.9 },
      { at: [952, 560], width: 48 },
    ],
    windows: [{ at: [464, 450], width: 86 }],
  })
  expect(next.doors[0]?.width).toBe(0.9)
  expect(next.doors[1]?.width).toBeUndefined()
  expect(next.windows[0]?.width).toBeUndefined()
})

test('printed length dimensions bind onto the extract', () => {
  const next = applyUnderstandToExtract(pixels, {
    rooms: [],
    doors: [],
    openings: [],
    windows: [],
    dimensions: [{ start: [464, 129], end: [1402, 129], lengthM: 8.4 }],
    hasFurniture: false,
    hasClutter: false,
    hasPrintedAreas: false,
    hasPrintedDimensions: true,
  })
  expect(next.dimensions).toEqual([{ start: [464, 129], end: [1402, 129], lengthM: 8.4 }])
})

test('parseUnderstandJson keeps payload when optional fields are null', () => {
  const understood = parseUnderstandJson(
    JSON.stringify({
      rooms: [
        {
          name: 'Hallway',
          kind: 'hallway',
          number: null,
          areaSqM: null,
          labelAt: [1030, 760],
        },
      ],
      doors: [{ at: [743, 129], width: null, openingKind: 'door' }],
      openings: null,
      windows: [{ at: [464, 450], width: null }],
      dimensions: null,
      totalAreaSqM: null,
      hasFurniture: false,
      hasClutter: false,
      hasPrintedAreas: true,
      hasPrintedDimensions: false,
      notes: null,
    }),
  )
  expect(understood).not.toBeNull()
  expect(understood?.rooms).toHaveLength(1)
  expect(understood?.rooms[0]?.name).toBe('Hallway')
  expect(understood?.rooms[0]?.areaSqM).toBeUndefined()
  expect(understood?.doors).toHaveLength(1)
  expect(understood?.doors[0]?.width).toBeUndefined()
  expect(understood?.hasFurniture).toBe(false)
  expect(understood?.totalAreaSqM).toBeUndefined()
})

test('nearestOpenRouterAspectRatio uses the allowed enum, never raw WxH', () => {
  expect(nearestOpenRouterAspectRatio(473, 334)).toBe('3:2')
  expect(nearestOpenRouterAspectRatio(1920, 1280)).toBe('3:2')
  expect(nearestOpenRouterAspectRatio(1000, 1000)).toBe('1:1')
  expect(nearestOpenRouterAspectRatio(1920, 1080)).toBe('16:9')
  expect(nearestOpenRouterAspectRatio(1080, 1920)).toBe('9:16')
  expect(nearestOpenRouterAspectRatio(800, 1000)).toBe('4:5')
  expect(nearestOpenRouterAspectRatio(2000, 1000)).toBe('2:1')
  expect(nearestOpenRouterAspectRatio(100, 200)).toBe('1:2')
  expect(nearestOpenRouterAspectRatio(1024, 768)).toBe('4:3')
  expect(nearestOpenRouterAspectRatio(768, 1024)).toBe('3:4')
  expect(nearestOpenRouterAspectRatio(0, 10)).toBe('1:1')
})

test('measure prompts pass understand room hints and forbid mega-rooms', () => {
  const understood = parseUnderstandJson(
    JSON.stringify({
      rooms: [
        { name: 'Hallway', kind: 'hallway', areaSqM: 3.9, labelAt: [1030, 760] },
        { name: 'Living', kind: 'living', areaSqM: 19.4, labelAt: [700, 500] },
      ],
    }),
  )
  expect(understood).not.toBeNull()
  const hints = measureRoomHints(understood)
  expect(hints).toContain('Emit exactly 2 polygons')
  expect(hints).toContain('Hallway@[1030, 760] 3.9')
  expect(hints).toContain('Living@[700, 500] 19.4')
  const prompts = floorplanVisionPrompts(FAILING_IMAGE, understood)
  expect(prompts.measureUser).toContain('Emit exactly 2 polygons')
  expect(prompts.measureUser).toContain('Hallway@[1030, 760]')
  expect(prompts.measureSystem).toContain('must not overlap')
})
