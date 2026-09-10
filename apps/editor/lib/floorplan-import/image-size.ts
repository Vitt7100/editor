export type ImageSize = {
  width: number
  height: number
}

export function parseImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null
  return parsePng(bytes) ?? parseGif(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes)
}

function parsePng(bytes: Uint8Array): ImageSize | null {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  if (bytes.length < 24) return null
  const width = readU32(bytes, 16)
  const height = readU32(bytes, 20)
  return validSize(width, height)
}

function parseGif(bytes: Uint8Array): ImageSize | null {
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null
  if (bytes.length < 10) return null
  const width = bytes[6]! | (bytes[7]! << 8)
  const height = bytes[8]! | (bytes[9]! << 8)
  return validSize(width, height)
}

function parseJpeg(bytes: Uint8Array): ImageSize | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2) return null
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!
      return validSize(width, height)
    }
    offset += 2 + length
  }
  return null
}

function parseWebp(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null
  if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') return null
  const chunk = readFourCC(bytes, 12)
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
    return validSize(width, height)
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25) return null
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return validSize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null
    const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff
    const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff
    return validSize(width, height)
  }
  return null
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>>
    0
  )
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
}

function validSize(width: number, height: number): ImageSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < 1 || height < 1 || width > 30_000 || height > 30_000) return null
  return { width, height }
}
