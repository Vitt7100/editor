import { expect, test } from 'bun:test'
import { detectImageCoordinateSpace } from './geometry'

test('apartment-scale metres are not classified as image pixels', () => {
  expect(detectImageCoordinateSpace([[0, 0], [12, 9]], 1920, 1280)).toBe('metres')
  expect(detectImageCoordinateSpace([[0.1, 0.2], [0.4, 0.6]], 1920, 1280)).toBe('normalized')
  expect(detectImageCoordinateSpace([[120, 80], [900, 700]], 1920, 1280)).toBe('pixels')
})
