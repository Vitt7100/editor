import { expect, test } from 'bun:test'
import { PNG } from 'pngjs'
import { parseImageSize } from './image-size'
import {
  prepareWorkingImage,
  resizeRgba,
  TARGET_WORKING_LONG_SIDE,
  workingImageSize,
} from './upscale-image'

test('workingImageSize upscales small scans to ~1500 on the long side', () => {
  expect(workingImageSize({ width: 473, height: 334 })).toEqual({
    width: TARGET_WORKING_LONG_SIDE,
    height: Math.round((334 * TARGET_WORKING_LONG_SIDE) / 473),
  })
  expect(workingImageSize({ width: 334, height: 473 })).toEqual({
    width: Math.round((334 * TARGET_WORKING_LONG_SIDE) / 473),
    height: TARGET_WORKING_LONG_SIDE,
  })
})

test('workingImageSize leaves scans at or above 1200px alone', () => {
  expect(workingImageSize({ width: 1200, height: 800 })).toEqual({ width: 1200, height: 800 })
  expect(workingImageSize({ width: 1920, height: 1280 })).toEqual({ width: 1920, height: 1280 })
})

test('lanczos resize keeps corner colors on a 2×2 raster', () => {
  const src = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
  const dst = resizeRgba(src, 2, 2, 4, 4)
  expect(dst.length).toBe(4 * 4 * 4)
  expect(dst[0]).toBeGreaterThan(200)
  expect(dst[1]).toBeLessThan(40)
  const br = (3 * 4 + 3) * 4
  expect(dst[br]).toBeGreaterThan(200)
  expect(dst[br + 1]).toBeGreaterThan(200)
  expect(dst[br + 2]).toBeGreaterThan(200)
})

test('prepareWorkingImage upscales a tiny PNG and records the original size', () => {
  const png = new PNG({ width: 8, height: 6 })
  png.data.fill(255)
  const bytes = PNG.sync.write(png)
  const prepared = prepareWorkingImage({
    mimeType: 'image/png',
    base64: bytes.toString('base64'),
    width: 8,
    height: 6,
  })
  expect(prepared.upscaled).toBe(true)
  expect(prepared.originalSize).toEqual({ width: 8, height: 6 })
  expect(prepared.size).toEqual(workingImageSize({ width: 8, height: 6 }))
  expect(prepared.image.width).toBe(prepared.size?.width)
  expect(prepared.image.height).toBe(prepared.size?.height)
  expect(parseImageSize(Buffer.from(prepared.image.base64, 'base64'))).toEqual(prepared.size!)
})
