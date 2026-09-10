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
  width: z.number().positive().optional(),
  openingKind: z.enum(['door', 'opening']).optional(),
  hingesSide: z.enum(['left', 'right']).optional(),
  swingDirection: z.enum(['inward', 'outward']).optional(),
})

export const extractedWindowSchema = z.object({
  at: vec2Schema,
  width: z.number().positive().optional(),
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
  planBounds: z
    .object({
      min: vec2Schema,
      max: vec2Schema,
    })
    .optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().optional(),
})

export type ExtractedFloorplan = z.infer<typeof extractedFloorplanSchema>
export type ExtractedRoom = z.infer<typeof extractedRoomSchema>
export type ExtractedDimension = z.infer<typeof extractedDimensionSchema>
export type Vec2 = z.infer<typeof vec2Schema>

export const DEFAULT_WALL_HEIGHT = 2.7
export const EXTERIOR_WALL_THICKNESS = 0.3
export const INTERIOR_WALL_THICKNESS = 0.12
export const BALCONY_WALL_THICKNESS = 0.08
export const DEFAULT_DOOR_WIDTH = 0.9
export const DEFAULT_DOOR_HEIGHT = 2.1
export const DEFAULT_WINDOW_WIDTH = 1.2
export const DEFAULT_WINDOW_HEIGHT = 1.4
export const DEFAULT_WINDOW_SILL = 0.9
export const SNAP_GRID = 0.05
export const MIN_WALL_LENGTH = 0.2
export const OPENING_MATCH_DISTANCE = 0.45
export const VERTEX_WELD_TOLERANCE = 0.08
export const MIN_ABSOLUTE_ROOM_AREA = 0.08
export const FALLBACK_PLAN_WIDTH_M = 10

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
