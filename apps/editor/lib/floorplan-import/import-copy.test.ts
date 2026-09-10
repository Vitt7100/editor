import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { userMessageForImportError, VISION_FAIL_MESSAGE } from './import-copy'
import { formatImportError } from './import-errors'
import { VisionResponseError } from './vision'

const SECRET_LEAK = /OPENROUTER_API_KEY|\.env\.local|FLOORPLAN_VISION_MODEL/

test('API error codes map to user strings, not invalid_request', () => {
  expect(userMessageForImportError('file_required')).toBe('Choose a floor-plan image first.')
  expect(userMessageForImportError('too_large')).toContain('12 MB')
  expect(userMessageForImportError('too_large')).toContain('WebP')
  expect(userMessageForImportError('bad_mime')).toContain('WebP')
  expect(userMessageForImportError('bad_mime')).toContain('GIF')
  expect(userMessageForImportError('vision_unconfigured')).toBe(
    'Import isn’t available right now. Ask your admin to enable plan reading, then try again.',
  )
  expect(userMessageForImportError('vision_unconfigured')).not.toMatch(SECRET_LEAK)
  expect(userMessageForImportError('invalid_request')).toBe('Import failed. Please try again.')
  expect(userMessageForImportError('not_found')).toBe(
    'This import timed out. Upload the plan again.',
  )
  expect(userMessageForImportError('not_found')).not.toContain('expired')
})

test('client-facing copy files never mention API keys or env files', () => {
  const copy = readFileSync(join(import.meta.dir, 'import-copy.ts'), 'utf8')
  const ui = readFileSync(join(import.meta.dir, '../../components/floorplan-import.tsx'), 'utf8')
  expect(copy).not.toMatch(SECRET_LEAK)
  expect(ui).not.toMatch(SECRET_LEAK)
})

test('vision failures never surface schema dumps', () => {
  const dumped = new VisionResponseError('Vision JSON failed validation: rooms.0.polygon')
  expect(formatImportError(dumped)).toBe(VISION_FAIL_MESSAGE)
  expect(formatImportError(dumped)).not.toContain('polygon')
})

test('formatImportError hides leaked key instructions', () => {
  expect(formatImportError(new Error('Set OPENROUTER_API_KEY in .env.local'))).toBe(
    'Import isn’t available right now. Ask your admin to enable plan reading, then try again.',
  )
})
