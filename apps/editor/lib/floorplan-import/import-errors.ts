import { VisionResponseError, VisionUnavailableError } from './vision'

export const MISSING_KEY_MESSAGE =
  'Set OPENROUTER_API_KEY in .env.local and restart the editor. Live vision is not available in this environment until that key is present.'

export const BAD_IMAGE_MESSAGE =
  'Could not read that file as an image. Upload a JPEG or PNG of the floor-plan drawing.'

export const TOO_LARGE_MESSAGE =
  'That image is over 12 MB. Export a smaller JPEG or PNG and try again.'

export function formatImportError(error: unknown): string {
  if (error instanceof VisionUnavailableError) return MISSING_KEY_MESSAGE
  if (error instanceof VisionResponseError) {
    const raw = error.message
    if (/\(401\)|\(403\)/.test(raw)) {
      return 'Vision API rejected the key. Check OPENROUTER_API_KEY in .env.local and restart the editor.'
    }
    if (raw.includes('did not return JSON')) {
      return 'The vision model did not return a floor plan. Try a clearer JPEG/PNG scan, or set FLOORPLAN_VISION_MODEL.'
    }
    if (raw.includes('failed validation')) {
      return 'The vision model returned an unusable floor plan. Try a clearer, complete scan of the drawing.'
    }
    return 'Could not read this drawing. Check the vision API, then upload a JPEG or PNG scan.'
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Import failed'
}
