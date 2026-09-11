import {
  detectImageCoordinateSpace,
  extractMaxAbs,
  extractPoints,
  isImagePixelBox,
  type PlanContentBox,
} from './geometry'
import type { ImageSize } from './image-size'
import { UNCONFIGURED_USER_MESSAGE } from './import-copy'
import { type ExtractedFloorplan, extractedFloorplanSchema } from './schema'

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
const DEFAULT_OPENAI_MODEL = 'gpt-4.1'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

export function getConfiguredVisionProvider(): VisionProvider | null {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.OPENAI_API_KEY) return 'openai'
  return null
}

export type FloorplanExtractDebug = {
  provider: VisionProvider
  model: string
  observation: string
  raw: string
  extracted: ExtractedFloorplan
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

  const size =
    image.width && image.height ? { width: image.width, height: image.height } : undefined
  let observation = '{}'
  try {
    observation = await runVisionPass(
      provider,
      image,
      size,
      observeSystemPrompt(size),
      observeUserPrompt(size),
    )
  } catch {
    observation = '{}'
  }
  let raw = await runVisionPass(
    provider,
    image,
    size,
    traceSystemPrompt(size),
    traceUserPrompt(size, observation),
  )
  let extracted = parseVisionJson(raw)
  if (size && needsPixelRetry(extracted, size)) {
    try {
      raw = await runVisionPass(
        provider,
        image,
        size,
        traceSystemPrompt(size),
        pixelRetryUserPrompt(size, extracted, observation),
      )
      const retried = parseVisionJson(raw)
      extracted = retried
    } catch {
      // Keep the first trace.
    }
    if (needsPixelRetry(extracted, size)) {
      try {
        const landmarkRaw = await runVisionPass(
          provider,
          image,
          size,
          landmarkSystemPrompt(size),
          landmarkUserPrompt(size),
        )
        extracted = attachOuterWall(extracted, landmarkRaw, size)
      } catch {
        // Last-resort register in overlay/build-scene may still remap unit1000.
      }
    }
  }
  return {
    provider,
    model: visionModelFor(provider),
    observation,
    raw,
    extracted,
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
    return `The image is ${size.width}×${size.height} pixels (NOT a square). Every coordinate is a PIXEL on that full raster: x=0 is the left edge, x=${size.width} is the right edge, y=0 is the top edge, y=${size.height} is the bottom edge. Do not use 0..1 fractions. Do not use metres. Do not use a 0..1000 square. Empty paper margin counts: a wall drawn in the middle of the page has middle pixel values, not 0 and not 1000.`
  }
  return 'Coordinates are pixels of the full image, origin top-left. x right, y down. Do not use 0..1 fractions. Do not use a 0..1000 square.'
}

function observeSystemPrompt(size?: ImageSize): string {
  return `You read a floor-plan drawing. Return ONLY JSON. Do not invent marks that are not printed or drawn.

${pixelRule(size)}
Origin is the TOP-LEFT of the FULL image. x right, y down.

First understand everything on the page. Then mentally clear furniture so later tracing can follow walls only.

Schema:
{
  "outerWall": { "min": [x, y], "max": [x, y] },
  "rooms": [{
    "name": "string",
    "number": "string",
    "areaSqM": number,
    "labelAt": [x, y]
  }],
  "labels": [{ "text": "string", "at": [x, y] }],
  "areas": [{ "text": "string", "sqM": number, "at": [x, y] }],
  "lengths": [{ "text": "string", "lengthM": number, "start": [x, y], "end": [x, y] }],
  "furniture": [{ "kind": "string", "at": [x, y] }],
  "notes": "string"
}

Rules:
- Copy text as written (any language). Do not translate.
- All coordinates are pixels of the FULL ${size ? `${size.width}×${size.height}` : ''} image, including margin.
- outerWall is the axis-aligned outer face of the gray/black building outline (include a drawn balcony; exclude a door swing into empty paper).
- rooms: one entry per enclosed space. labelAt is the printed number/name/area mark inside that room (true pixels). areaSqM only from a printed area (convert to m²). If a room has no printed area, omit areaSqM.
- furniture includes beds, sofas, tables, kitchen units, toilets, baths, closets, stairs — not rooms. These must be ignored when tracing walls later.
- lengths.lengthM is a printed wall/opening dimension converted to metres.
- If a field is absent on the drawing, use an empty array.`
}

function observeUserPrompt(size?: ImageSize): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  return `${sizeLine}Read the whole drawing. List rooms (names, numbers, printed areas), labels, dimensions, and furniture. Give every position in full-image pixels. Do not trace wall polygons yet.`
}

function traceSystemPrompt(size?: ImageSize): string {
  return `You trace the STRUCTURAL floor plan into JSON. Return ONLY JSON.

${pixelRule(size)}
Origin is the TOP-LEFT of the FULL image, including margin. x right, y down.

Mentally erase every piece of furniture, fixture, and text. Trace only the cleaned wall geometry.

Schema:
{
  "rooms": [{
    "name": "string",
    "kind": "living" | "bedroom" | "bathroom" | "kitchen" | "hallway" | "entry" | "balcony" | "storage" | "other",
    "polygon": [[x, y], ...],
    "labeledAreaSqM": number,
    "roomNumber": "string"
  }],
  "doors": [{
    "at": [x, y],
    "width": number,
    "openingKind": "door",
    "hingesSide": "left" | "right",
    "swingDirection": "inward" | "outward"
  }],
  "openings": [{ "at": [x, y], "width": number, "openingKind": "opening" }],
  "windows": [{ "at": [x, y], "width": number }],
  "dimensions": [{ "start": [x, y], "end": [x, y], "lengthM": number }],
  "planBounds": { "min": [x, y], "max": [x, y] },
  "confidence": number,
  "notes": "string"
}

Trace only what is drawn:
- Coordinates are pixels on the FULL image, including empty margin. A wall drawn in the middle of a ${size ? `${size.width}×${size.height}` : 'WxH'} page is near the middle pixel, not 0 and not ~300 on a fake 1000 canvas.
- Follow the ink. Room polygons are the inner face of the drawn wall lines, vertex by vertex, including every jog, niche, and thickness change.
- Each room polygon MUST contain that room's printed label pixel from the observation pass when one exists.
- If a room has a printed area, set labeledAreaSqM. If a room has no printed area, infer a plausible m² from its polygon vs rooms that do have printed areas (same drawing scale). Do not invent a second area for a room that already has a printed one.
- name/kind come from printed labels when present; otherwise a short generic name.
- Do not replace a room with its axis-aligned bounding box. An L-shaped or irregular room stays L-shaped or irregular.
- Include every enclosed space whose walls are drawn, even if it has no number. Do not omit a wing of the apartment.
- Furniture, fixtures, and dimension arrows are not rooms and not walls.
- doors: a door leaf and/or swing arc is drawn. at = midpoint on the wall.
- openings: a gap through a wall with no door leaf and no swing. Do not turn this into a door.
- Do not add a door, opening, or window that is not drawn, even if a room would otherwise be unreachable.
- windows: only window symbols / glazed openings that are drawn.
- planBounds: outer-wall AABB in the same full-image pixels as the polygons.
- dimensions: copy printed linear sizes (already converted to metres) with endpoints in pixels.
- width of doors/windows/openings is metres.
- confidence 0..1.`
}

function landmarkSystemPrompt(size: ImageSize): string {
  return `You locate the drawn building on a floor-plan scan. Return ONLY JSON. Do not list rooms, doors, windows, or furniture.

The image is ${size.width}×${size.height} pixels. Origin TOP-LEFT of the FULL image, including margin. x right, y down.

Schema:
{ "outerWall": { "min": [x, y], "max": [x, y] } }

Rules:
- min is the top-left of the OUTER wall, max is the bottom-right, in pixels of this ${size.width}×${size.height} raster.
- Ignore empty paper margin. Do not use a 0..1000 square. A right-hand outer wall is near x=${size.width} only if the ink is actually there; if the drawing sits in the middle of the page, say so with middle pixels.
- Include the balcony if it is drawn as part of the building. Exclude a door swing that sticks out into empty page if you can.
- Do not invent geometry.`
}

function landmarkUserPrompt(size: ImageSize): string {
  return `Scan size ${size.width}×${size.height}. Return only the axis-aligned outer-wall rectangle in full-image pixels.`
}

function traceUserPrompt(size?: ImageSize, observation?: string): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  const observed = observation
    ? `\n\nInventory already read from this drawing (labels and furniture in full-image pixels):\n${observation}\nMentally erase furniture. Trace wall inner faces only. Each room polygon must contain that room's labelAt when present. Do not add doors that were not listed or drawn. Coordinates must match those label pixels, not a 0..1000 square.`
    : ''
  return `${sizeLine}Trace walls, rooms, doors, openings, and windows exactly as drawn. All coordinates are pixels on this ${size ? `${size.width}×${size.height}` : ''} image — not 0..1, not a ~1000 square.${observed}`
}

export function pixelRetryUserPrompt(
  size: ImageSize,
  previous: ExtractedFloorplan,
  observation?: string,
): string {
  const maxAbs = extractMaxAbs(previous)
  const observed = observation
    ? `\n\nObservation (full-image pixels; polygons must contain these labelAt points):\n${observation}`
    : ''
  return `Scan size ${size.width}×${size.height}. Your previous JSON used the WRONG coordinate space (max abs ${maxAbs.toFixed(1)}). That is not full-image pixels.

Redo the trace. Every vertex is a pixel on this ${size.width}×${size.height} raster (origin top-left, including margin).
Forbidden: 0..1 fractions; a 0..1000 square (typical tell: x around 295..985 on a wider page); metres.
The white paper margin has no rooms. Gray outer walls are inset from the page edges — look at the ink.
Mentally erase furniture. Follow wall inner faces only.
Do not add doors, openings, or windows that are not drawn.
Return ONLY JSON with the same schema as before.${observed}`
}

export function floorplanVisionPrompts(
  size?: ImageSize,
  observation?: string,
): {
  observeSystem: string
  observeUser: string
  traceSystem: string
  traceUser: string
} {
  return {
    observeSystem: observeSystemPrompt(size),
    observeUser: observeUserPrompt(size),
    traceSystem: traceSystemPrompt(size),
    traceUser: traceUserPrompt(size, observation),
  }
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
