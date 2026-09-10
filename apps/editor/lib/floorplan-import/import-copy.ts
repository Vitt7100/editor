/** User-facing import copy. Do not put API keys or schema dumps here. */

export const UNCONFIGURED_USER_MESSAGE =
  'Import isn’t available right now. Ask your admin to enable plan reading, then try again.'

export const UNCONFIGURED_ADMIN_LOG =
  'Set OPENROUTER_API_KEY in .env.local, then restart the editor.'

export const NO_FILE_MESSAGE = 'Choose a floor-plan image first.'

export const TOO_LARGE_MESSAGE =
  'That image is over 12 MB. Export a smaller JPEG, PNG, WebP, or GIF and try again.'

export const BAD_MIME_MESSAGE = 'Upload a JPEG, PNG, WebP, or GIF of the floor-plan drawing.'

export const BAD_IMAGE_MESSAGE =
  'Could not read that file as an image. Upload a JPEG, PNG, WebP, or GIF of the floor-plan drawing.'

export const NETWORK_LOST_MESSAGE = 'We lost connection to this import. Please try again.'

export const IMPORT_TIMEOUT_MESSAGE = 'This import timed out. Upload the plan again.'

export const VISION_FAIL_MESSAGE =
  'We couldn’t read this drawing. Use a clearer top-down plan, or try again in a minute.'

export const HEIGHT_RANGE_MESSAGE = 'Ceiling height must be between 2.0 and 4.5 metres.'

export const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued…',
  reading: 'Reading the drawing…',
  'reading-drawing': 'Reading labels and dimensions…',
  'building-scene': 'Building walls…',
  saving: 'Saving the scene…',
  done: 'Done',
  failed: 'Failed',
}

export const IMPORT_ERROR_COPY: Record<string, string> = {
  vision_unconfigured: UNCONFIGURED_USER_MESSAGE,
  too_large: TOO_LARGE_MESSAGE,
  file_required: NO_FILE_MESSAGE,
  bad_mime: BAD_MIME_MESSAGE,
  invalid_height: HEIGHT_RANGE_MESSAGE,
  not_found: IMPORT_TIMEOUT_MESSAGE,
}

export function userMessageForImportError(error?: string, message?: string): string {
  if (error && IMPORT_ERROR_COPY[error]) return IMPORT_ERROR_COPY[error]
  if (message && message !== 'invalid_request') return message
  return 'Import failed. Please try again.'
}
