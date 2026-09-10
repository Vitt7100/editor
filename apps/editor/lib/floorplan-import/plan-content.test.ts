import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectPlanContentBox, detectPlanContentBoxFromBytes } from './plan-content'

test('detectPlanContentBox finds a dark rectangle on a white page', () => {
  const width = 100
  const height = 80
  const data = new Uint8Array(width * height * 3).fill(255)
  const paint = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 3
        data[i] = 20
        data[i + 1] = 20
        data[i + 2] = 20
      }
    }
  }
  paint(20, 10, 21, 60)
  paint(70, 10, 71, 60)
  paint(20, 10, 71, 11)
  paint(20, 59, 71, 60)
  const box = detectPlanContentBox(data, width, height, 3)
  expect(box).not.toBeNull()
  expect(box?.minX).toBe(20)
  expect(box?.maxX).toBe(71)
  expect(box?.minY).toBe(10)
  expect(box?.maxY).toBe(60)
})

test('detectPlanContentBox ignores a thin dark spike outside the plan', () => {
  const width = 80
  const height = 80
  const data = new Uint8Array(width * height * 3).fill(255)
  for (let y = 8; y <= 50; y++) {
    for (let x = 10; x <= 50; x++) {
      if (x === 10 || x === 50 || y === 8 || y === 50) {
        const i = (y * width + x) * 3
        data[i] = 10
        data[i + 1] = 10
        data[i + 2] = 10
      }
    }
  }
  data[(70 * width + 40) * 3] = 10
  data[(70 * width + 40) * 3 + 1] = 10
  data[(70 * width + 40) * 3 + 2] = 10
  const box = detectPlanContentBox(data, width, height, 3)
  expect(box).not.toBeNull()
  expect(box?.maxY).toBeLessThan(70)
  expect(box?.maxY).toBe(50)
})

test('detectPlanContentBoxFromBytes finds the failing-001 drawing, not the page margin', () => {
  const bytes = readFileSync(join(import.meta.dir, 'fixtures/failing-001-px2/failing-001.jpg'))
  const meta = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures/failing-001-px2/meta.json'), 'utf8'),
  ) as { contentBox: { minX: number; minY: number; maxX: number; maxY: number } }
  expect(detectPlanContentBoxFromBytes(bytes)).toEqual(meta.contentBox)
})
