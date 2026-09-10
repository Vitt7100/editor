import fs from 'node:fs'
import path from 'node:path'
import { resolveDefaultDatabasePath } from '@pascal-app/mcp/storage'

export function writeGuideImage(sceneId: string, mimeType: string, bytes: Uint8Array): void {
  const directory = guideDirectory()
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(guideBinPath(sceneId), bytes)
  fs.writeFileSync(guideMimePath(sceneId), mimeType, 'utf8')
}

export function readGuideImage(sceneId: string): { mimeType: string; bytes: Buffer } | null {
  const binPath = guideBinPath(sceneId)
  const mimePath = guideMimePath(sceneId)
  if (!fs.existsSync(binPath) || !fs.existsSync(mimePath)) return null
  return {
    mimeType: fs.readFileSync(mimePath, 'utf8').trim() || 'image/jpeg',
    bytes: fs.readFileSync(binPath),
  }
}

function guideDirectory(): string {
  return path.join(path.dirname(resolveDefaultDatabasePath()), 'guides')
}

function guideBinPath(sceneId: string): string {
  return path.join(guideDirectory(), `${sceneId}.bin`)
}

function guideMimePath(sceneId: string): string {
  return path.join(guideDirectory(), `${sceneId}.mime`)
}
