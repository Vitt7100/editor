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
  type ExtractedRoom,
  extractedFloorplanSchema,
  type FloorplanUnderstand,
  floorplanUnderstandSchema,
  isPrintedAreaLabel,
  MAX_DOOR_WIDTH_M,
  MAX_OPENING_WIDTH_M,
  MAX_WINDOW_WIDTH_M,
  parsePrintedAreaLabel,
  ROOM_KIND_LABELS,
  type RoomKind,
  roomKinds,
  sanitizeMetreWidth,
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
const DEFAULT_OPENROUTER_CLEAN_MODEL = 'openai/gpt-image-2.5-flare'
const DEFAULT_OPENAI_MODEL = 'gpt-4.1'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

/** Conditional clean only. Keep this short — the image model follows it in one shot. */
export const CLEAN_WALLS_PROMPT =
  'Очисти этот план квартиры, оставив только стены, окна и двери.\nClean this apartment floor plan, leaving only walls, windows, and doors.'

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
  needsClean?: boolean
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

  // 1) UNDERSTAND — one vision pass on the original drawing.
  //    Rooms, openings, labels, clutter, printed measures. No polygons yet.
  let observation = '{}'
  let understood: FloorplanUnderstand | null = null
  try {
    observation = await runVisionPass(
      provider,
      image,
      originalSize,
      understandSystemPrompt(originalSize),
      understandUserPrompt(originalSize),
    )
    understood = parseUnderstandJson(observation)
  } catch {
    observation = '{}'
    understood = null
  }

  // 2) CLEAN (conditional) — only if furniture/clutter is present.
  //    Skip when the plan is already walls + doors + windows.
  const shouldClean = Boolean(understood && needsClean(understood) && provider === 'openrouter')
  let cleaned: VisionImage | undefined
  if (shouldClean) {
    try {
      cleaned = await cleanWallsImage(image)
    } catch {
      cleaned = undefined
    }
  }

  // 3) MEASURE → JSON — trace geometry, then bind printed areas/dimensions.
  //    If none were printed, leave those fields empty (scale from proportions later).
  const traceImage = cleaned ?? image
  const traceSize =
    traceImage.width && traceImage.height
      ? { width: traceImage.width, height: traceImage.height }
      : originalSize

  let raw = await runVisionPass(
    provider,
    traceImage,
    traceSize,
    measureSystemPrompt(traceSize),
    measureUserPrompt(traceSize),
  )
  let extracted = parseVisionJson(raw)
  if (traceSize && needsPixelRetry(extracted, traceSize)) {
    try {
      raw = await runVisionPass(
        provider,
        traceImage,
        traceSize,
        measureSystemPrompt(traceSize),
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

  extracted = understood
    ? applyUnderstandToExtract(extracted, understood)
    : sanitizeExtracted(extracted)

  return {
    provider,
    model: visionModelFor(provider),
    cleanModel: cleaned ? cleanModelFor() : undefined,
    observation,
    raw,
    extracted,
    cleaned,
    needsClean: shouldClean,
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

function understandSystemPrompt(size?: ImageSize): string {
  return `Read this floor-plan drawing. Return ONLY JSON. Do not trace wall polygons.
${pixelRule(size)}

Schema:
{
  "rooms": [{ "name": "string", "kind": "living"|"bedroom"|"bathroom"|"kitchen"|"hallway"|"entry"|"balcony"|"storage"|"other", "number": "string", "areaSqM": number, "labelAt": [x, y] }],
  "doors": [{ "at": [x, y], "width": number, "openingKind": "door", "hingesSide": "left"|"right", "swingDirection": "inward"|"outward" }],
  "openings": [{ "at": [x, y], "width": number, "openingKind": "opening" }],
  "windows": [{ "at": [x, y], "width": number }],
  "dimensions": [{ "start": [x, y], "end": [x, y], "lengthM": number }],
  "totalAreaSqM": number,
  "hasFurniture": boolean,
  "hasClutter": boolean,
  "hasPrintedAreas": boolean,
  "hasPrintedDimensions": boolean
}

Rules:
- Copy labels as written. Room name is the room title, never a printed area (12.5 м² goes in areaSqM only).
- areaSqM, totalAreaSqM, and dimensions.lengthM only when that number is printed on the drawing. Do not invent or estimate.
- Opening width is metres (typical door 0.7–1.2, window 0.9–2.0). Never pixel widths.
- hasFurniture / hasClutter: true only when the drawing shows furniture or other non-structural junk. A walls+doors+windows plan is false/false.
- Do not invent doors, openings, windows, or dimensions.`
}

function understandUserPrompt(size?: ImageSize): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  return `${sizeLine}Understand this floor plan: rooms, walls, doors/windows, labels, furniture/clutter, printed dimensions or areas. Full-image pixels. Return ONLY JSON.`
}

function measureSystemPrompt(size?: ImageSize): string {
  return `You trace a floor plan into JSON. Return ONLY JSON.
${pixelRule(size)} Origin top-left, x right, y down.

Schema:
{
  "rooms": [{ "name": "string", "kind": "living"|"bedroom"|"bathroom"|"kitchen"|"hallway"|"entry"|"balcony"|"storage"|"other", "polygon": [[x, y], ...], "roomNumber": "string" }],
  "doors": [],
  "openings": [],
  "windows": [],
  "dimensions": [],
  "planBounds": { "min": [x, y], "max": [x, y] },
  "confidence": number,
  "notes": "string"
}

Follow inner wall faces, including every niche and jog. Do not simplify extra corners into an L or T box. Do not add doors that are not drawn. Do not invent labeledAreaSqM or dimensions. Opening width is metres, never pixels. Room name is the title, never a printed area.`
}

function measureUserPrompt(size?: ImageSize): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  return `${sizeLine}Trace room polygons. Inner faces, every niche/jog. Full-image pixels. Return ONLY JSON.`
}

export function pixelRetryUserPrompt(size: ImageSize, previous: ExtractedFloorplan): string {
  const maxAbs = extractMaxAbs(previous)
  return `Scan size ${size.width}×${size.height}. Previous JSON used the wrong coordinate space (max abs ${maxAbs.toFixed(1)}). Redo in full-image pixels. Forbidden: 0..1; a 0..1000 square; metres. Follow inner faces including niches. Do not add doors that are not drawn. Do not invent labeledAreaSqM. Opening width is metres, never pixels. Return ONLY JSON.`
}

export function floorplanVisionPrompts(size?: ImageSize): {
  understandSystem: string
  understandUser: string
  clean: string
  measureSystem: string
  measureUser: string
  observeSystem: string
  observeUser: string
  traceSystem: string
  traceUser: string
} {
  const understandSystem = understandSystemPrompt(size)
  const understandUser = understandUserPrompt(size)
  const measureSystem = measureSystemPrompt(size)
  const measureUser = measureUserPrompt(size)
  return {
    understandSystem,
    understandUser,
    clean: CLEAN_WALLS_PROMPT,
    measureSystem,
    measureUser,
    observeSystem: understandSystem,
    observeUser: understandUser,
    traceSystem: measureSystem,
    traceUser: measureUser,
  }
}

const KIND_SET = new Set<string>(roomKinds)

export function needsClean(understood: { hasFurniture?: boolean; hasClutter?: boolean }): boolean {
  return Boolean(understood.hasFurniture || understood.hasClutter)
}

export function parseUnderstandJson(raw: string): FloorplanUnderstand | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return null
  }
  const result = floorplanUnderstandSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export function attachRoomLabels(extracted: ExtractedFloorplan, raw: string): ExtractedFloorplan {
  const understood = parseUnderstandJson(raw)
  if (!understood) return sanitizeExtracted(extracted)
  return applyUnderstandToExtract(extracted, understood)
}

export function applyUnderstandToExtract(
  extracted: ExtractedFloorplan,
  understood: FloorplanUnderstand,
): ExtractedFloorplan {
  const rooms = extracted.rooms.map((room) => ({
    ...room,
    labeledAreaSqM: undefined as number | undefined,
  }))

  for (const label of understood.rooms) {
    const at = label.labelAt
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
    const kind = label.kind && KIND_SET.has(label.kind) ? (label.kind as RoomKind) : room.kind
    const printedFromName = label.name ? parsePrintedAreaLabel(label.name) : undefined
    const number =
      typeof label.number === 'string' && label.number.trim()
        ? label.number.trim()
        : room.roomNumber
    rooms[bestIndex] = {
      ...room,
      name: roomDisplayName(label.name, kind, room.name),
      kind,
      roomNumber: number,
      labeledAreaSqM: label.areaSqM && label.areaSqM > 0 ? label.areaSqM : printedFromName,
    }
  }

  const doors =
    understood.doors.length > 0
      ? understood.doors.map((door) => sanitizeOpening(door, MAX_DOOR_WIDTH_M))
      : extracted.doors.map((door) => sanitizeOpening(door, MAX_DOOR_WIDTH_M))
  const openings =
    understood.openings.length > 0
      ? understood.openings.map((opening) => sanitizeOpening(opening, MAX_OPENING_WIDTH_M))
      : extracted.openings.map((opening) => sanitizeOpening(opening, MAX_OPENING_WIDTH_M))
  const windows =
    understood.windows.length > 0
      ? understood.windows.map((window) => sanitizeWindow(window))
      : extracted.windows.map((window) => sanitizeWindow(window))

  return {
    ...extracted,
    rooms: rooms.map(sanitizeRoomName),
    doors,
    openings,
    windows,
    dimensions: understood.dimensions,
    totalAreaSqM: understood.totalAreaSqM,
  }
}

export function sanitizeExtracted(extracted: ExtractedFloorplan): ExtractedFloorplan {
  return {
    ...extracted,
    rooms: extracted.rooms.map(sanitizeRoomName),
    doors: extracted.doors.map((door) => sanitizeOpening(door, MAX_DOOR_WIDTH_M)),
    openings: extracted.openings.map((opening) => sanitizeOpening(opening, MAX_OPENING_WIDTH_M)),
    windows: extracted.windows.map((window) => sanitizeWindow(window)),
  }
}

function roomDisplayName(name: string | undefined, kind: RoomKind, fallback: string): string {
  const trimmed = name?.trim() ?? ''
  if (trimmed && !isPrintedAreaLabel(trimmed)) return trimmed
  if (fallback && !isPrintedAreaLabel(fallback)) return fallback
  return ROOM_KIND_LABELS[kind]
}

function sanitizeRoomName(room: ExtractedRoom): ExtractedRoom {
  const printed = parsePrintedAreaLabel(room.name)
  return {
    ...room,
    name: isPrintedAreaLabel(room.name) ? ROOM_KIND_LABELS[room.kind] : room.name,
    labeledAreaSqM: room.labeledAreaSqM ?? printed,
  }
}

function sanitizeOpening<T extends { width?: number }>(opening: T, maxM: number): T {
  return { ...opening, width: sanitizeMetreWidth(opening.width, maxM) }
}

function sanitizeWindow<T extends { width?: number }>(window: T): T {
  return { ...window, width: sanitizeMetreWidth(window.width, MAX_WINDOW_WIDTH_M) }
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
