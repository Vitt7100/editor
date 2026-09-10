import { expect, test } from 'bun:test'
import { parseWallHeight } from './schema'

test('parseWallHeight accepts 2.0–4.5 and rejects the rest', () => {
  expect(parseWallHeight('2')).toBe(2)
  expect(parseWallHeight('2.7')).toBe(2.7)
  expect(parseWallHeight('4.5')).toBe(4.5)
  expect(parseWallHeight('1.9')).toBeNull()
  expect(parseWallHeight('4.6')).toBeNull()
  expect(parseWallHeight('')).toBeNull()
  expect(parseWallHeight('tall')).toBeNull()
})
