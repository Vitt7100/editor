import {
  IMPORT_TIMEOUT_MESSAGE,
  UNCONFIGURED_USER_MESSAGE,
  VISION_FAIL_MESSAGE,
} from './import-copy'
import { VisionResponseError, VisionUnavailableError } from './vision'

export { BAD_IMAGE_MESSAGE, TOO_LARGE_MESSAGE } from './import-copy'

export function formatImportError(error: unknown): string {
  if (error instanceof VisionUnavailableError) return UNCONFIGURED_USER_MESSAGE
  if (error instanceof VisionResponseError) return VISION_FAIL_MESSAGE
  if (error instanceof Error && error.message.trim()) {
    if (/Vision JSON failed validation|did not return JSON|vision failed/i.test(error.message)) {
      return VISION_FAIL_MESSAGE
    }
    if (/expired/i.test(error.message)) return IMPORT_TIMEOUT_MESSAGE
    if (
      /OPENROUTER_API_KEY|\.env\.local|FLOORPLAN_VISION_MODEL|FLOORPLAN_CLEAN_MODEL/i.test(
        error.message,
      )
    ) {
      return UNCONFIGURED_USER_MESSAGE
    }
    return error.message
  }
  return 'Import failed. Please try again.'
}
