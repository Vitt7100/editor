import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { parseImageSize } from '../lib/floorplan-import/image-size'
import type { ExtractedFloorplan } from '../lib/floorplan-import/schema'
import { overlayExtracted } from './overlay-coords'

const outDir = process.argv[2]
if (!outDir) throw new Error('Usage: bun render-overlay.ts <outDir> <imageFileName> [extractFile]')

const imageName = process.argv[3]
if (!imageName)
  throw new Error('Usage: bun render-overlay.ts <outDir> <imageFileName> [extractFile]')
const extractName = process.argv[4] ?? 'extract.json'
const extracted = JSON.parse(readFileSync(join(outDir, extractName), 'utf8')) as ExtractedFloorplan
const imagePath = join(outDir, imageName)
const bytes = readFileSync(imagePath)
const imageSize = parseImageSize(bytes)
if (!imageSize) throw new Error('Could not parse image size')

function overlaySvg(plan: ExtractedFloorplan, size: { width: number; height: number }): string {
  const remapped = overlayExtracted(plan, size)
  const px = (x: number, y: number): [number, number] => [x, y]
  const rooms = remapped.rooms
    .map((room, index) => {
      const points = room.polygon.map(([x, y]) => px(x, y).join(',')).join(' ')
      const label = px(room.polygon[0]?.[0] ?? 0, room.polygon[0]?.[1] ?? 0)
      const name = room.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      return `<polygon points="${points}" fill="rgba(37,99,235,0.22)" stroke="#1d4ed8" stroke-width="4" /><text x="${label[0] + 8}" y="${label[1] + 28}" fill="#1e3a8a" font-size="32" font-family="Arial, sans-serif">${index + 1}:${name}</text>`
    })
    .join('')
  const doors = remapped.doors
    .map((door) => {
      const [x, y] = px(door.at[0], door.at[1])
      return `<circle cx="${x}" cy="${y}" r="16" fill="#16a34a" stroke="#14532d" stroke-width="3" />`
    })
    .join('')
  const openings = (remapped.openings ?? [])
    .map((opening) => {
      const [x, y] = px(opening.at[0], opening.at[1])
      return `<circle cx="${x}" cy="${y}" r="16" fill="#eab308" stroke="#854d0e" stroke-width="3" />`
    })
    .join('')
  const windows = remapped.windows
    .map((window) => {
      const [x, y] = px(window.at[0], window.at[1])
      return `<rect x="${x - 18}" y="${y - 18}" width="36" height="36" fill="#7c3aed" stroke="#4c1d95" stroke-width="3" />`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">${rooms}${doors}${openings}${windows}</svg>`
}

const svg = overlaySvg(extracted, imageSize)
writeFileSync(join(outDir, 'overlay.svg'), svg)
await sharp(bytes)
  .composite([{ input: Buffer.from(svg), blend: 'over' }])
  .png()
  .toFile(join(outDir, 'overlay.png'))
console.log(`wrote ${join(outDir, 'overlay.png')}`)
