import {
  detectImageCoordinateSpace,
  extractMaxAbs,
  extractPoints,
  isImagePixelBox,
  type PlanContentBox,
  pointInPolygon,
  polygonArea,
  scaleExtractedToImage,
} from './geometry'
import { type ImageSize, parseImageSize } from './image-size'
import { UNCONFIGURED_USER_MESSAGE } from './import-copy'
import {
  type ExtractedFloorplan,
  extractedFloorplanSchema,
  extractedOpeningSchema,
  extractedWindowSchema,
  type RoomKind,
  roomKinds,
} from './schema'

export class VisionUnavailableError extends Error {
  constructor(message = UNCONFIGURED_USER_MESSAGE) {
    super(message)
    this.name = 'VisionUnavailableError'
  }
}

export class VisionResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VisionResponseError'
  }
}

export type VisionProvider = 'openrouter' | 'anthropic' | 'openai'

export type VisionImage = {
  mimeType: string
  base64: string
  width?: number
  height?: number
}

export const UNCONFIGURED_MESSAGE = UNCONFIGURED_USER_MESSAGE

/** Server logs only — never send this string to the browser. */
export const UNCONFIGURED_ADMIN_LOG =
  'Set OPENROUTER_API_KEY in .env.local, then restart the editor.'

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4.1'
const DEFAULT_OPENROUTER_CLEAN_MODEL = 'openai/gpt-image-1'
const DEFAULT_OPENAI_MODEL = 'gpt-4.1'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

/** Owner-proven walls-only clean. Keep this short — the image model follows it in one shot. */
export const CLEAN_WALLS_PROMPT =
  'Очисти этот план квартиры, оставив только внутренние и наружные стены.\nClean this apartment floor plan, leaving only interior and exterior walls.'

export function getConfiguredVisionProvider(): VisionProvider | null {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.OPENAI_API_KEY) return 'openai'
  return null
}

export type FloorplanExtractDebug = {
  provider: VisionProvider
  model: string
  cleanModel?: string
  observation: string
  raw: string
  extracted: ExtractedFloorplan
  cleaned?: VisionImage
}

export async function extractFloorplanFromImage(image: VisionImage): Promise<ExtractedFloorplan> {
  return (await extractFloorplanDebug(image)).extracted
}

export async function extractFloorplanDebug(image: VisionImage): Promise<FloorplanExtractDebug> {
  const provider = getConfiguredVisionProvider()
  if (!provider) {
    console.error(UNCONFIGURED_ADMIN_LOG)
    throw new VisionUnavailableError(UNCONFIGURED_MESSAGE)
  }

  const originalSize =
    image.width && image.height ? { width: image.width, height: image.height } : undefined

  let cleaned: VisionImage | undefined
  if (provider === 'openrouter') {
    try {
      cleaned = await cleanWallsImage(image)
    } catch {
      cleaned = undefined
    }
  }

  const traceImage = cleaned ?? image
  const traceSize =
    traceImage.width && traceImage.height
      ? { width: traceImage.width, height: traceImage.height }
      : originalSize

  let raw = await runVisionPass(
    provider,
    traceImage,
    traceSize,
    traceSystemPrompt(traceSize),
    traceUserPrompt(traceSize),
  )
  let extracted = parseVisionJson(raw)
  if (traceSize && needsPixelRetry(extracted, traceSize)) {
    try {
      raw = await runVisionPass(
        provider,
        traceImage,
        traceSize,
        traceSystemPrompt(traceSize),
        pixelRetryUserPrompt(traceSize, extracted),
      )
      extracted = parseVisionJson(raw)
    } catch {
      // Keep the first trace.
    }
  }
  if (cleaned && originalSize && traceSize) {
    extracted = scaleExtractedToImage(extracted, traceSize, originalSize)
  }

  let observation = '{}'
  if (originalSize) {
    try {
      observation = await runVisionPass(
        provider,
        image,
        originalSize,
        labelSystemPrompt(originalSize),
        labelUserPrompt(originalSize),
      )
      extracted = attachRoomLabels(extracted, observation)
    } catch {
      observation = '{}'
    }
  }

  return {
    provider,
    model: visionModelFor(provider),
    cleanModel: cleaned ? cleanModelFor() : undefined,
    observation,
    raw,
    extracted,
    cleaned,
  }
}

/** True when JSON is not already in full-image pixels (0..1, ~1000-square, or metres). */
export function needsPixelRetry(extracted: ExtractedFloorplan, size: ImageSize): boolean {
  const points = extractPoints(extracted)
  if (points.length === 0) return false
  return detectImageCoordinateSpace(points, size.width, size.height) !== 'pixels'
}

/** @deprecated Use needsPixelRetry — ~1000-square and 0..1 are both unsuccessful traces. */
export function usesWrongPixelGrid(extracted: ExtractedFloorplan, size: ImageSize): boolean {
  return needsPixelRetry(extracted, size)
}

export function attachOuterWall(
  extracted: ExtractedFloorplan,
  landmarkRaw: string,
  size: ImageSize,
): ExtractedFloorplan {
  const box = parseOuterWallJson(landmarkRaw, size)
  if (!box) return extracted
  return {
    ...extracted,
    planBounds: { min: [box.minX, box.minY], max: [box.maxX, box.maxY] },
  }
}

function visionModelFor(provider: VisionProvider): string {
  if (provider === 'anthropic') return process.env.FLOORPLAN_VISION_MODEL ?? DEFAULT_ANTHROPIC_MODEL
  if (provider === 'openai') return process.env.FLOORPLAN_VISION_MODEL ?? DEFAULT_OPENAI_MODEL
  return process.env.FLOORPLAN_VISION_MODEL ?? DEFAULT_OPENROUTER_MODEL
}

function cleanModelFor(): string {
  return process.env.FLOORPLAN_CLEAN_MODEL ?? DEFAULT_OPENROUTER_CLEAN_MODEL
}

export function parseVisionJson(raw: string): ExtractedFloorplan {
  const text = stripFences(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new VisionResponseError('Vision model did not return JSON')
  }
  const result = extractedFloorplanSchema.safeParse(parsed)
  if (!result.success) {
    throw new VisionResponseError(`Vision JSON failed validation: ${result.error.message}`)
  }
  return result.data
}

export function parseOuterWallJson(raw: string, size: ImageSize): PlanContentBox | null {
  const text = stripFences(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const source = record.outerWall ?? record.planBounds ?? record
  if (!source || typeof source !== 'object') return null
  const boxRecord = source as Record<string, unknown>
  const min = asPair(boxRecord.min)
  const max = asPair(boxRecord.max)
  if (!min || !max) return null
  const box: PlanContentBox = {
    minX: Math.min(min[0], max[0]),
    maxX: Math.max(min[0], max[0]),
    minY: Math.min(min[1], max[1]),
    maxY: Math.max(min[1], max[1]),
  }
  return isImagePixelBox(box, size.width, size.height) ? box : null
}

function asPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const x = Number(value[0])
  const y = Number(value[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

function pixelRule(size?: ImageSize): string {
  if (size) {
    return `The image is ${size.width}×${size.height} pixels. Coordinates are full-image pixels — not 0..1, not a 0..1000 square.`
  }
  return 'Coordinates are pixels of the full image, origin top-left. Not 0..1, not a 0..1000 square.'
}

function labelSystemPrompt(size?: ImageSize): string {
  return `Read labels and drawn openings on this floor-plan drawing. Return ONLY JSON.
${pixelRule(size)}

Schema:
{
  "rooms": [{ "name": "string", "kind": "living"|"bedroom"|"bathroom"|"kitchen"|"hallway"|"entry"|"balcony"|"storage"|"other", "number": "string", "areaSqM": number, "labelAt": [x, y] }],
  "doors": [{ "at": [x, y], "width": number, "openingKind": "door", "hingesSide": "left"|"right", "swingDirection": "inward"|"outward" }],
  "openings": [{ "at": [x, y], "width": number, "openingKind": "opening" }],
  "windows": [{ "at": [x, y], "width": number }]
}

Copy text as written. Do not invent doors, openings, or windows.`
}

function labelUserPrompt(size?: ImageSize): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  return `${sizeLine}Read room names, numbers, printed areas, and any drawn doors/windows. Full-image pixels. Do not trace wall polygons.`
}

function traceSystemPrompt(size?: ImageSize): string {
  return `You trace a walls-only floor plan into JSON. Return ONLY JSON.
${pixelRule(size)} Origin top-left, x right, y down.

Schema:
{
  "rooms": [{ "name": "string", "kind": "living"|"bedroom"|"bathroom"|"kitchen"|"hallway"|"entry"|"balcony"|"storage"|"other", "polygon": [[x, y], ...], "labeledAreaSqM": number, "roomNumber": "string" }],
  "doors": [],
  "openings": [],
  "windows": [],
  "dimensions": [],
  "planBounds": { "min": [x, y], "max": [x, y] },
  "confidence": number,
  "notes": "string"
}

Follow inner wall faces, including every niche and jog. Do not simplify extra corners into an L or T box. Do not add doors that are not drawn.`
}

function traceUserPrompt(size?: ImageSize): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  return `${sizeLine}Trace room polygons from this walls-only plan. Inner faces, every niche/jog. Full-image pixels. Return ONLY JSON.`
}

export function pixelRetryUserPrompt(size: ImageSize, previous: ExtractedFloorplan): string {
  const maxAbs = extractMaxAbs(previous)
  return `Scan size ${size.width}×${size.height}. Previous JSON used the wrong coordinate space (max abs ${maxAbs.toFixed(1)}). Redo in full-image pixels. Forbidden: 0..1; a 0..1000 square; metres. Follow inner faces including niches. Do not add doors that are not drawn. Return ONLY JSON.`
}

export function floorplanVisionPrompts(size?: ImageSize): {
  clean: string
  observeSystem: string
  observeUser: string
  traceSystem: string
  traceUser: string
} {
  return {
    clean: CLEAN_WALLS_PROMPT,
    observeSystem: labelSystemPrompt(size),
    observeUser: labelUserPrompt(size),
    traceSystem: traceSystemPrompt(size),
    traceUser: traceUserPrompt(size),
  }
}

const KIND_SET = new Set<string>(roomKinds)

export function attachRoomLabels(extracted: ExtractedFloorplan, raw: string): ExtractedFloorplan {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return extracted
  }
  if (!parsed || typeof parsed !== 'object') return extracted
  const record = parsed as Record<string, unknown>
  const labels = Array.isArray(record.rooms) ? record.rooms : []
  const rooms = extracted.rooms.map((room) => ({ ...room }))
  for (const label of labels) {
    if (!label || typeof label !== 'object') continue
    const row = label as Record<string, unknown>
    const at = asPair(row.labelAt)
    if (!at) continue
    let bestIndex: number | null = null
    let bestArea = Number.POSITIVE_INFINITY
    rooms.forEach((room, index) => {
      if (!pointInPolygon(at, room.polygon)) return
      const area = polygonArea(room.polygon)
      if (area < bestArea) {
        bestIndex = index
        bestArea = area
      }
    })
    if (bestIndex == null) continue
    const room = rooms[bestIndex]!
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : room.name
    const kind = typeof row.kind === 'string' && KIND_SET.has(row.kind) ? (row.kind as RoomKind) : room.kind
    const number =
      typeof row.number === 'string' && row.number.trim() ? row.number.trim() : room.roomNumber
    const areaSqM = typeof row.areaSqM === 'number' && row.areaSqM > 0 ? row.areaSqM : room.labeledAreaSqM
    rooms[bestIndex] = {
      ...room,
      name,
      kind,
      roomNumber: number,
      labeledAreaSqM: areaSqM,
    }
  }

  const doors = Array.isArray(record.doors)
    ? record.doors.flatMap((entry) => {
        const result = extractedOpeningSchema.safeParse(entry)
        return result.success ? [result.data] : []
      })
    : extracted.doors
  const openings = Array.isArray(record.openings)
    ? record.openings.flatMap((entry) => {
        const result = extractedOpeningSchema.safeParse(entry)
        return result.success ? [result.data] : []
      })
    : extracted.openings
  const windows = Array.isArray(record.windows)
    ? record.windows.flatMap((entry) => {
        const result = extractedWindowSchema.safeParse(entry)
        return result.success ? [result.data] : []
      })
    : extracted.windows

  return { ...extracted, rooms, doors, openings, windows }
}

export async function cleanWallsImage(image: VisionImage): Promise<VisionImage> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? ''
  const model = cleanModelFor()
  const dataUrl = `data:${image.mimeType};base64,${image.base64}`
  const requestBody: Record<string, unknown> = {
    model,
    prompt: CLEAN_WALLS_PROMPT,
    input_references: [{ type: 'image_url', image_url: { url: dataUrl } }],
    output_format: 'png',
  }
  if (image.width && image.height) {
    requestBody.size = `${image.width}x${image.height}`
  }
  let response = await postOpenRouterImage(apiKey, requestBody)
  if (!response.ok && image.width && image.height) {
    const retryBody: Record<string, unknown> = {
      model: requestBody.model,
      prompt: requestBody.prompt,
      input_references: requestBody.input_references,
      output_format: requestBody.output_format,
      aspect_ratio: aspectRatio(image.width, image.height),
    }
    response = await postOpenRouterImage(apiKey, retryBody)
  }
  if (!response.ok) {
    throw new VisionResponseError(await readHttpError('OpenRouter image', response))
  }
  const parsed = parseImageResponse(await response.json())
  const bytes = Buffer.from(parsed.base64, 'base64')
  const size = parseImageSize(bytes)
  return {
    mimeType: parsed.mimeType,
    base64: parsed.base64,
    width: size?.width,
    height: size?.height,
  }
}

async function postOpenRouterImage(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'http://localhost:3002',
      'X-Title': 'Pascal floorplan import',
    },
    body: JSON.stringify(body),
  })
}

function aspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height) || 1
  return `${width / divisor}:${height / divisor}`
}

function parseImageResponse(payload: unknown): { mimeType: string; base64: string } {
  if (!payload || typeof payload !== 'object') {
    throw new VisionResponseError('OpenRouter image returned no image')
  }
  const record = payload as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data[0] : undefined
  const source = data && typeof data === 'object' ? (data as Record<string, unknown>) : record
  const b64 = typeof source.b64_json === 'string' ? source.b64_json : null
  const url =
    typeof source.url === 'string'
      ? source.url
      : source.image_url && typeof source.image_url === 'object'
        ? String((source.image_url as Record<string, unknown>).url ?? '')
        : ''
  const fromUrl = url.startsWith('data:') ? url.slice(url.indexOf(',') + 1) : null
  const base64 = stripDataPrefix(b64 ?? fromUrl ?? '')
  if (!base64) throw new VisionResponseError('OpenRouter image returned no image')
  const mediaType =
    typeof source.media_type === 'string'
      ? source.media_type
      : url.startsWith('data:image/jpeg')
        ? 'image/jpeg'
        : 'image/png'
  return { mimeType: mediaType, base64 }
}

function stripDataPrefix(value: string): string {
  const comma = value.indexOf(',')
  if (value.startsWith('data:') && comma >= 0) return value.slice(comma + 1)
  return value
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

async function runVisionPass(
  provider: VisionProvider,
  image: VisionImage,
  size: ImageSize | undefined,
  system: string,
  user: string,
): Promise<string> {
  if (provider === 'anthropic') {
    return callAnthropic(image, system, user)
  }
  if (provider === 'openai') {
    return callChatCompletions({
      label: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: process.env.FLOORPLAN_VISION_MODEL ?? DEFAULT_OPENAI_MODEL,
      image,
      system,
      user,
    })
  }
  return callChatCompletions({
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    model: process.env.FLOORPLAN_VISION_MODEL ?? DEFAULT_OPENROUTER_MODEL,
    extraHeaders: {
      'HTTP-Referer': 'http://localhost:3002',
      'X-Title': 'Pascal floorplan import',
    },
    image,
    system,
    user,
  })
}

async function callChatCompletions(input: {
  label: string
  url: string
  apiKey: string
  model: string
  extraHeaders?: Record<string, string>
  image: VisionImage
  system: string
  user: string
}): Promise<string> {
  const response = await fetch(input.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      ...input.extraHeaders,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.system },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${input.image.mimeType};base64,${input.image.base64}`,
                detail: 'high',
              },
            },
            { type: 'text', text: input.user },
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new VisionResponseError(await readHttpError(input.label, response))
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new VisionResponseError(`${input.label} returned no text`)
  return text
}

async function callAnthropic(image: VisionImage, system: string, user: string): Promise<string> {
  const model = process.env.FLOORPLAN_VISION_MODEL ?? DEFAULT_ANTHROPIC_MODEL
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0,
      system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mimeType,
                data: image.base64,
              },
            },
            { type: 'text', text: user },
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new VisionResponseError(await readHttpError('Anthropic', response))
  }
  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const text = payload.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new VisionResponseError('Anthropic returned no text')
  return text
}

async function readHttpError(label: string, response: Response): Promise<string> {
  const body = await response.text()
  const snippet = body.slice(0, 400)
  return `${label} vision failed (${response.status}): ${snippet || response.statusText}`
}
