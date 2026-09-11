import { z } from 'zod'

export const roomKinds = [
  'living',
  'bedroom',
  'bathroom',
  'kitchen',
  'hallway',
  'entry',
  'balcony',
  'storage',
  'other',
] as const

export type RoomKind = (typeof roomKinds)[number]

export const vec2Schema = z.tuple([z.number(), z.number()])

export const extractedRoomSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(roomKinds).default('other'),
  polygon: z.array(vec2Schema).min(3),
  labeledAreaSqM: z.number().positive().optional(),
  roomNumber: z.string().optional(),
})

export const extractedOpeningSchema = z.object({
  at: vec2Schema,
  width: z.number().positive().nullish(),
  openingKind: z.enum(['door', 'opening']).nullish(),
  hingesSide: z.enum(['left', 'right']).nullish(),
  swingDirection: z.enum(['inward', 'outward']).nullish(),
})

export const extractedWindowSchema = z.object({
  at: vec2Schema,
  width: z.number().positive().nullish(),
})

export const extractedDimensionSchema = z.object({
  start: vec2Schema,
  end: vec2Schema,
  lengthM: z.number().positive(),
})

export const extractedFloorplanSchema = z.object({
  rooms: z.array(extractedRoomSchema).min(1),
  doors: z.array(extractedOpeningSchema).default([]),
  openings: z.array(extractedOpeningSchema).default([]),
  windows: z.array(extractedWindowSchema).default([]),
  dimensions: z.array(extractedDimensionSchema).default([]),
  totalAreaSqM: z.number().positive().nullish(),
  planBounds: z
    .object({
      min: vec2Schema,
      max: vec2Schema,
    })
    .nullish(),
  confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().nullish(),
})

export const floorplanUnderstandRoomSchema = z.object({
  name: z.string().nullish(),
  kind: z.enum(roomKinds).nullish(),
  number: z.string().nullish(),
  areaSqM: z.number().positive().nullish(),
  labelAt: vec2Schema.nullish(),
})

/** Step 1 (UNDERSTAND) — labels, openings, clutter, printed measures. No polygons. */
export const floorplanUnderstandSchema = z.object({
  rooms: z.array(floorplanUnderstandRoomSchema).default([]),
  doors: z.array(extractedOpeningSchema).default([]),
  openings: z.array(extractedOpeningSchema).default([]),
  windows: z.array(extractedWindowSchema).default([]),
  dimensions: z.array(extractedDimensionSchema).default([]),
  totalAreaSqM: z.number().positive().nullish(),
  hasFurniture: z.boolean().nullish().default(false),
  hasClutter: z.boolean().nullish().default(false),
  hasPrintedAreas: z.boolean().nullish().default(false),
  hasPrintedDimensions: z.boolean().nullish().default(false),
  notes: z.string().nullish(),
})

export type ExtractedFloorplan = z.infer<typeof extractedFloorplanSchema>
export type ExtractedRoom = z.infer<typeof extractedRoomSchema>
export type ExtractedDimension = z.infer<typeof extractedDimensionSchema>
export type FloorplanUnderstand = z.infer<typeof floorplanUnderstandSchema>
export type Vec2 = z.infer<typeof vec2Schema>

export const DEFAULT_WALL_HEIGHT = 2.7
export const MIN_WALL_HEIGHT = 2
export const MAX_WALL_HEIGHT = 4.5

/** Returns null when missing or outside 2.0–4.5. Callers must not silently clamp. */
export function parseWallHeight(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'number' ? String(value) : String(value).trim()
  if (text === '') return null
  const parsed = Number.parseFloat(text)
  if (!Number.isFinite(parsed) || parsed < MIN_WALL_HEIGHT || parsed > MAX_WALL_HEIGHT) return null
  return parsed
}

export const EXTERIOR_WALL_THICKNESS = 0.3
export const INTERIOR_WALL_THICKNESS = 0.12
export const BALCONY_WALL_THICKNESS = 0.08
export const DEFAULT_DOOR_WIDTH = 0.9
export const DEFAULT_DOOR_HEIGHT = 2.1
export const DEFAULT_WINDOW_WIDTH = 1.2
export const DEFAULT_WINDOW_HEIGHT = 1.4
export const DEFAULT_WINDOW_SILL = 0.9
/** Typical apartment openings. Wider values are pixel-like, not metres. */
export const MAX_DOOR_WIDTH_M = 3
export const MAX_OPENING_WIDTH_M = 4
export const MAX_WINDOW_WIDTH_M = 4.5
export const SNAP_GRID = 0.05
export const MIN_WALL_LENGTH = 0.2
export const OPENING_MATCH_DISTANCE = 0.45
export const VERTEX_WELD_TOLERANCE = 0.08
export const MIN_ABSOLUTE_ROOM_AREA = 0.08
export const FALLBACK_PLAN_WIDTH_M = 10

export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  living: 'Living',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  kitchen: 'Kitchen',
  hallway: 'Hallway',
  entry: 'Entry',
  balcony: 'Balcony',
  storage: 'Storage',
  other: 'Room',
}

export const ROOM_COLORS: Record<RoomKind, string> = {
  living: '#60a5fa',
  bedroom: '#a78bfa',
  bathroom: '#67e8f9',
  kitchen: '#fbbf24',
  hallway: '#94a3b8',
  entry: '#cbd5e1',
  balcony: '#86efac',
  storage: '#d6d3d1',
  other: '#93c5fd',
}

/** Keep metre opening widths; drop pixel-like values so callers use defaults. */
export function sanitizeMetreWidth(
  width: number | null | undefined,
  maxM: number,
): number | undefined {
  if (width == null || !Number.isFinite(width) || width <= 0) return undefined
  if (width > maxM) return undefined
  return width
}

const AREA_WITH_UNIT = /^(\d+(?:[.,]\d+)?)\s*(?:m²|м²|кв\.?\s*м|sq\.?\s*m|m2|м2)$/iu
const AREA_DECIMAL = /^(\d+[.,]\d+)$/

/** True when a "name" is only a printed area (e.g. "12.5 м²"), not a room title. */
export function isPrintedAreaLabel(value: string): boolean {
  const trimmed = value.trim()
  return AREA_WITH_UNIT.test(trimmed) || AREA_DECIMAL.test(trimmed)
}

export function parsePrintedAreaLabel(value: string): number | undefined {
  const trimmed = value.trim()
  const match = trimmed.match(AREA_WITH_UNIT) ?? trimmed.match(AREA_DECIMAL)
  if (!match?.[1]) return undefined
  const parsed = Number(match[1].replace(',', '.'))
  return parsed > 0 && parsed < 1000 ? parsed : undefined
}
