import type { PlanContentBox } from './geometry'

const DARK_LUMA = 80

function maxValue(values: Float64Array): number {
  let max = 0
  for (const value of values) {
    if (value > max) max = value
  }
  return max
}

function firstIndex(values: Float64Array, minimum: number): number {
  for (let i = 0; i < values.length; i++) {
    if (values[i]! >= minimum) return i
  }
  return 0
}

function lastIndex(values: Float64Array, minimum: number): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i]! >= minimum) return i
  }
  return values.length - 1
}

/**
 * Bounding box of the drawn plan on a padded raster (thick dark ink, not the
 * paper margin or a thin door-swing arc).
 */
export function detectPlanContentBox(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): PlanContentBox | null {
  if (width < 8 || height < 8 || channels < 1) return null
  const col = new Float64Array(width)
  const row = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const r = data[i] ?? 0
      const g = channels > 1 ? (data[i + 1] ?? r) : r
      const b = channels > 2 ? (data[i + 2] ?? r) : r
      if ((r + g + b) / 3 < DARK_LUMA) {
        col[x]! += 1
        row[y]! += 1
      }
    }
  }
  const minCol = Math.max(8, maxValue(col) * 0.04)
  const minRow = Math.max(8, maxValue(row) * 0.04)
  const box: PlanContentBox = {
    minX: firstIndex(col, minCol),
    maxX: lastIndex(col, minCol),
    minY: firstIndex(row, minRow),
    maxY: lastIndex(row, minRow),
  }
  if (box.maxX - box.minX < width * 0.15 || box.maxY - box.minY < height * 0.15) return null
  return box
}
