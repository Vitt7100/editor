import type { ImageSize } from './image-size'
import { UNCONFIGURED_ADMIN_LOG, UNCONFIGURED_USER_MESSAGE } from './import-copy'
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
  if (size && usesWrongPixelGrid(extracted, size)) {
    raw = await runVisionPass(
      provider,
      image,
      size,
      traceSystemPrompt(size),
      `${traceUserPrompt(size, observation)}\n\nYour previous JSON used a ~1000-unit square instead of this ${size.width}×${size.height} pixel grid. Re-trace. x must run 0..${size.width}, y 0..${size.height}. A vertex on the right outer wall is near x=${size.width}, not x=1000.`,
    )
    extracted = parseVisionJson(raw)
  }
  return {
    provider,
    model: visionModelFor(provider),
    observation,
    raw,
    extracted,
  }
}

function usesWrongPixelGrid(extracted: ExtractedFloorplan, size: ImageSize): boolean {
  const xs = extracted.rooms.flatMap((room) => room.polygon.map((point) => point[0]))
  const ys = extracted.rooms.flatMap((room) => room.polygon.map((point) => point[1]))
  if (xs.length === 0) return false
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  if (maxX <= 1.5 && maxY <= 1.5) return false
  return maxX < size.width * 0.6
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

function pixelRule(size?: ImageSize): string {
  if (size) {
    return `The image is ${size.width}×${size.height} pixels (NOT a square). Every coordinate is a PIXEL on that full raster: x=0 is the left edge, x=${size.width} is the right edge, y=0 is the top edge, y=${size.height} is the bottom edge. Do not use 0..1 fractions. Do not use metres.`
  }
  return 'Coordinates are pixels of the full image, origin top-left. x right, y down. Do not use 0..1 fractions.'
}

function observeSystemPrompt(size?: ImageSize): string {
  return `You read a floor-plan drawing. Return ONLY JSON. Do not invent marks that are not printed or drawn.

${pixelRule(size)}
Origin is the TOP-LEFT of the FULL image. x right, y down.

Schema:
{
  "labels": [{ "text": "string", "at": [x, y] }],
  "areas": [{ "text": "string", "sqM": number, "at": [x, y] }],
  "lengths": [{ "text": "string", "lengthM": number, "start": [x, y], "end": [x, y] }],
  "furniture": [{ "kind": "string", "at": [x, y] }],
  "notes": "string"
}

Rules:
- Copy text as written (any language). Do not translate.
- Coordinate "at" values are pixels of the full image (not 0..1).
- areas.sqM is the printed area converted to square metres.
- lengths.lengthM is a printed wall/opening dimension converted to metres (mm→m, cm→m).
- Only include a length if both endpoints of that dimension are visible on the drawing.
- furniture includes beds, sofas, tables, kitchen units, toilets, baths, stairs — not rooms.
- If a field is absent on the drawing, use an empty array.`
}

function observeUserPrompt(size?: ImageSize): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  return `${sizeLine}List every printed label, area, and dimension, and every piece of furniture. Do not trace walls yet.`
}

function traceSystemPrompt(size?: ImageSize): string {
  return `You trace the STRUCTURAL floor plan into JSON. Return ONLY JSON.

${pixelRule(size)}
Origin is the TOP-LEFT of the FULL image, including margin. x right, y down.

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
  "confidence": number,
  "notes": "string"
}

Trace only what is drawn:
- Coordinates are pixels on the FULL image, including empty margin. A wall drawn in the middle of a ${size ? `${size.width}×${size.height}` : 'WxH'} page is near the middle pixel, not 0.
- Follow the ink. Room polygons are the inner face of the drawn wall lines, vertex by vertex, including every jog, niche, and thickness change.
- Do not replace a room with its axis-aligned bounding box. An L-shaped or irregular room stays L-shaped or irregular.
- Include every enclosed space whose walls are drawn, even if it has no number. Do not omit a wing of the apartment.
- Furniture, fixtures, and dimension arrows are not rooms and not walls.
- name/kind come from printed labels when present; otherwise a short generic name.
- labeledAreaSqM only if that room has a printed area.
- doors: a door leaf and/or swing arc is drawn. at = midpoint on the wall.
- openings: a gap through a wall with no door leaf and no swing. Do not turn this into a door.
- Do not add a door, opening, or window that is not drawn, even if a room would otherwise be unreachable.
- windows: only window symbols / glazed openings that are drawn.
- dimensions: copy printed linear sizes (already converted to metres) with endpoints in pixels.
- width of doors/windows/openings is metres.
- confidence 0..1.`
}

function traceUserPrompt(size?: ImageSize, observation?: string): string {
  const sizeLine = size ? `Scan size ${size.width}×${size.height}. ` : ''
  const observed = observation
    ? `\n\nText, areas, lengths, and furniture already read from this drawing:\n${observation}\nUse these as the source of labels and scale. Do not turn furniture into rooms. Do not add doors that were not listed or drawn.`
    : ''
  return `${sizeLine}Trace walls, rooms, doors, openings, and windows exactly as drawn. All coordinates are pixels on this ${size ? `${size.width}×${size.height}` : ''} image, not 0..1.${observed}`
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
