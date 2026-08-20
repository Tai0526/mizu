/**
 * Photos are the reason a family tree stops being a spreadsheet, so uploading
 * one has to be effortless — including from a phone, where "one photo" means
 * four megabytes straight off the camera.
 *
 * Every image is centre-cropped square and downscaled before it goes anywhere.
 * That keeps the cards uniform, keeps local-mode inside the browser's storage
 * quota, and keeps the tree quick to draw when a hundred faces are on screen.
 */

const MAX_EDGE = 512
const QUALITY = 0.82

export async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.')
  }

  const bitmap = await loadBitmap(file)
  const edge = Math.min(bitmap.width, bitmap.height)
  const size = Math.min(edge, MAX_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')

  ctx.imageSmoothingQuality = 'high'
  // Centre crop: take the largest square from the middle of the original.
  ctx.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    size,
    size,
  )

  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close()
  return canvas.toDataURL('image/jpeg', QUALITY)
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      // Safari has historically refused some formats here; fall through.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Rough byte size of a data URL, for warning before the quota bites. */
export const dataUrlBytes = (dataUrl: string): number =>
  Math.round((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 0.75)
