import { PNG } from 'pngjs'
import { type ImageSize, parseImageSize } from './image-size'
import { decodePlanRaster } from './plan-content'

type EncodedImage = {
  mimeType: string
  base64: string
  width?: number
  height?: number
}

/** Upscale when the long side is below this. Live 473×334 traces were unusable. */
export const MIN_WORKING_LONG_SIDE = 1200
export const TARGET_WORKING_LONG_SIDE = 1500
const LANCZOS_A = 3

export function workingImageSize(size: ImageSize): ImageSize {
  const long = Math.max(size.width, size.height)
  if (long >= MIN_WORKING_LONG_SIDE) return size
  const scale = TARGET_WORKING_LONG_SIDE / long
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

export function prepareWorkingImage(image: EncodedImage): {
  image: EncodedImage
  size?: ImageSize
  originalSize?: ImageSize
  upscaled: boolean
} {
  const bytes = Buffer.from(image.base64, 'base64')
  const originalSize =
    image.width && image.height
      ? { width: image.width, height: image.height }
      : parseImageSize(bytes)
  if (!originalSize) {
    return { image, upscaled: false }
  }
  const target = workingImageSize(originalSize)
  if (target.width === originalSize.width && target.height === originalSize.height) {
    return {
      image: { ...image, width: originalSize.width, height: originalSize.height },
      size: originalSize,
      originalSize,
      upscaled: false,
    }
  }
  const upscaled = upscaleVisionImage(image, target)
  if (!upscaled) {
    return {
      image: { ...image, width: originalSize.width, height: originalSize.height },
      size: originalSize,
      originalSize,
      upscaled: false,
    }
  }
  return {
    image: upscaled,
    size: { width: upscaled.width ?? target.width, height: upscaled.height ?? target.height },
    originalSize,
    upscaled: true,
  }
}

export function upscaleVisionImage(image: EncodedImage, target: ImageSize): EncodedImage | null {
  if (target.width < 1 || target.height < 1) return null
  const raster = decodePlanRaster(Buffer.from(image.base64, 'base64'))
  if (!raster) return null
  const resized = resizeRgba(
    raster.data,
    raster.width,
    raster.height,
    target.width,
    target.height,
    raster.channels,
  )
  const png = new PNG({ width: target.width, height: target.height })
  png.data.set(resized)
  const bytes = PNG.sync.write(png)
  return {
    mimeType: 'image/png',
    base64: bytes.toString('base64'),
    width: target.width,
    height: target.height,
  }
}

export function resizeRgba(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  channels = 4,
  a = LANCZOS_A,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * channels)
  if (srcW < 1 || srcH < 1 || dstW < 1 || dstH < 1) return dst
  const scaleX = srcW / dstW
  const scaleY = srcH / dstH
  for (let y = 0; y < dstH; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5
    const y0 = Math.floor(srcY) - a + 1
    const y1 = Math.floor(srcY) + a
    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5
      const x0 = Math.floor(srcX) - a + 1
      const x1 = Math.floor(srcX) + a
      let wSum = 0
      const acc = [0, 0, 0, 0]
      for (let sy = y0; sy <= y1; sy++) {
        const wy = lanczosKernel(srcY - sy, a)
        if (wy === 0) continue
        const cy = clampIndex(sy, srcH)
        for (let sx = x0; sx <= x1; sx++) {
          const w = wy * lanczosKernel(srcX - sx, a)
          if (w === 0) continue
          const cx = clampIndex(sx, srcW)
          const i = (cy * srcW + cx) * channels
          for (let c = 0; c < channels; c++) {
            acc[c] = (acc[c] ?? 0) + (src[i + c] ?? 0) * w
          }
          wSum += w
        }
      }
      const o = (y * dstW + x) * channels
      const inv = wSum === 0 ? 0 : 1 / wSum
      for (let c = 0; c < channels; c++) {
        dst[o + c] = clampByte((acc[c] ?? 0) * inv)
      }
    }
  }
  return dst
}

function sinc(x: number): number {
  if (x === 0) return 1
  const pix = Math.PI * x
  return Math.sin(pix) / pix
}

function lanczosKernel(x: number, a: number): number {
  const abs = Math.abs(x)
  if (abs >= a) return 0
  return sinc(x) * sinc(x / a)
}

function clampIndex(value: number, length: number): number {
  if (value < 0) return 0
  if (value >= length) return length - 1
  return value
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}
