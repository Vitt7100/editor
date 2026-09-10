import { expect, test } from 'bun:test'
import { parseImageSize } from './image-size'

test('parseImageSize reads a 1x1 PNG', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  expect(parseImageSize(png)).toEqual({ width: 1, height: 1 })
})
