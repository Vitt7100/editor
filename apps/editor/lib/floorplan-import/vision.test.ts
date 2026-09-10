import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractedFloorplan } from './schema'
import { attachOuterWall, parseOuterWallJson, usesWrongPixelGrid } from './vision'

const FAILING_IMAGE = { width: 1920, height: 1280 }
const px2 = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/failing-001-px2/extract.json'), 'utf8'),
) as ExtractedFloorplan

test('failing-001-px2 still looks like the wrong pixel grid', () => {
  expect(usesWrongPixelGrid(px2, FAILING_IMAGE)).toBe(true)
})

test('parseOuterWallJson accepts full-image pixels and rejects a ~1000-square', () => {
  expect(
    parseOuterWallJson(
      '{"outerWall":{"min":[420,16],"max":[1447,1131]}}',
      FAILING_IMAGE,
    ),
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
