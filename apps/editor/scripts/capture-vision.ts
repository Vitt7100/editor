import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { parseImageSize } from '../lib/floorplan-import/image-size'
import { detectPlanContentBoxFromBytes } from '../lib/floorplan-import/plan-content'
import type { ExtractedFloorplan } from '../lib/floorplan-import/schema'
import { extractFloorplanDebug } from '../lib/floorplan-import/vision'
import { extractMaxAbs, overlayExtracted } from './overlay-coords'

function loadEnv(filePath: string) {
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function mimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function overlaySvg(
  extracted: ExtractedFloorplan,
  imageSize: { width: number; height: number },
  contentBox?: { minX: number; minY: number; maxX: number; maxY: number } | null,
): string {
  const plan = overlayExtracted(extracted, imageSize, contentBox)
  const px = (x: number, y: number): [number, number] => [x, y]
  const rooms = plan.rooms
    .map((room, index) => {
      const points = room.polygon.map(([x, y]) => px(x, y).join(',')).join(' ')
      const label = px(room.polygon[0]?.[0] ?? 0, room.polygon[0]?.[1] ?? 0)
      return `<polygon points="${points}" fill="rgba(37,99,235,0.18)" stroke="#2563eb" stroke-width="3" /><text x="${label[0]}" y="${label[1]}" fill="#1d4ed8" font-size="28" font-family="sans-serif">${index + 1}:${escapeXml(room.name)}</text>`
    })
    .join('')
  const doors = plan.doors
    .map((door) => {
      const [x, y] = px(door.at[0], door.at[1])
      return `<circle cx="${x}" cy="${y}" r="14" fill="#16a34a" stroke="#14532d" stroke-width="3" />`
    })
    .join('')
  const openings = (plan.openings ?? [])
    .map((opening) => {
      const [x, y] = px(opening.at[0], opening.at[1])
      return `<circle cx="${x}" cy="${y}" r="14" fill="#eab308" stroke="#854d0e" stroke-width="3" />`
    })
    .join('')
  const windows = plan.windows
    .map((window) => {
      const [x, y] = px(window.at[0], window.at[1])
      return `<rect x="${x - 16}" y="${y - 16}" width="32" height="32" fill="#7c3aed" stroke="#4c1d95" stroke-width="3" />`
    })
    .join('')
  return `${rooms}${doors}${openings}${windows}`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

loadEnv(`${import.meta.dir}/../../../.env.local`)

const imagePath = process.argv[2]
const outDir = process.argv[3]
if (!imagePath || !outDir) {
  throw new Error('Usage: bun capture-vision.ts <image> <outDir>')
}

mkdirSync(outDir, { recursive: true })
const bytes = readFileSync(imagePath)
const imageSize = parseImageSize(bytes)
if (!imageSize) throw new Error('Could not parse image size')

const debug = await extractFloorplanDebug({
  mimeType: mimeFromPath(imagePath),
  base64: bytes.toString('base64'),
  width: imageSize.width,
  height: imageSize.height,
})

const contentBox = detectPlanContentBoxFromBytes(bytes)

const relativeSrc = `./${basename(imagePath)}`
writeFileSync(join(outDir, basename(imagePath)), bytes)
writeFileSync(join(outDir, 'observation.json'), debug.observation)
writeFileSync(join(outDir, 'extract.raw.txt'), debug.raw)
writeFileSync(join(outDir, 'extract.json'), `${JSON.stringify(debug.extracted, null, 2)}\n`)
writeFileSync(
  join(outDir, 'overlay.html'),
  `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>floorplan overlay</title>
<style>
  body { margin: 0; background: #111; }
  .wrap { position: relative; display: inline-block; }
  img { display: block; max-width: 100vw; height: auto; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<div class="wrap">
  <img src="${relativeSrc}" width="${imageSize.width}" height="${imageSize.height}" />
  <svg viewBox="0 0 ${imageSize.width} ${imageSize.height}" preserveAspectRatio="none">${overlaySvg(debug.extracted, imageSize, contentBox)}</svg>
</div>
</body>
</html>
`,
)

console.log(
  JSON.stringify({
    image: basename(imagePath),
    imageSize,
    contentBox,
    provider: debug.provider,
    model: debug.model,
    rooms: debug.extracted.rooms.length,
    doors: debug.extracted.doors.length,
    openings: debug.extracted.openings?.length ?? 0,
    windows: debug.extracted.windows.length,
    maxAbs: Number(extractMaxAbs(debug.extracted).toFixed(4)),
    overlayMaxAbs: Number(
      extractMaxAbs(overlayExtracted(debug.extracted, imageSize, contentBox)).toFixed(4),
    ),
    outDir,
  }),
)
