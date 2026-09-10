import { expect, test } from 'bun:test'
import { userMessageForImportError, VISION_FAIL_MESSAGE } from './import-copy'
import { formatImportError } from './import-errors'
import { VisionResponseError } from './vision'

test('API error codes map to user strings, not invalid_request', () => {
  expect(userMessageForImportError('file_required')).toBe('Choose a floor-plan image first.')
  expect(userMessageForImportError('too_large')).toContain('12 MB')
  expect(userMessageForImportError('bad_mime')).toContain('WebP')
  expect(userMessageForImportError('vision_unconfigured')).toContain('Ask your admin')
  expect(userMessageForImportError('vision_unconfigured')).not.toContain('OPENROUTER')
  expect(userMessageForImportError('invalid_request')).toBe('Import failed. Please try again.')
})

test('vision failures never surface schema dumps', () => {
  const dumped = new VisionResponseError('Vision JSON failed validation: rooms.0.polygon')
  expect(formatImportError(dumped)).toBe(VISION_FAIL_MESSAGE)
  expect(formatImportError(dumped)).not.toContain('polygon')
})
