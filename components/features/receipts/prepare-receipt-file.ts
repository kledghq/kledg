/**
 * A receipt file ready to upload (docs/justificatifs-photo.md): a JPEG, PNG
 * or PDF that fits the limit is sent as it is; any other photo the browser
 * can decode (HEIC on an iPhone, a large JPEG) is redrawn on a canvas and
 * sent as a JPEG of 2000 pixels at most, lower quality until it fits. The
 * server checks the bytes again (lib/receipts/file-type.ts).
 */

import { RECEIPT_MAX_BYTES } from '@/lib/receipts/file-type'

const MAX_SIDE = 2000
const QUALITIES = [0.85, 0.7, 0.55, 0.4]

export async function prepareReceiptFile(file: File, maxBytes = RECEIPT_MAX_BYTES): Promise<File> {
  const type = file.type.toLowerCase()
  if ((type === 'image/jpeg' || type === 'image/png' || type === 'application/pdf') && file.size <= maxBytes) return file
  if (type === 'application/pdf') throw new Error(`PDF trop volumineux (${maxBytes / 1024 / 1024} Mo au plus) : envoyez une photo de la page.`)
  // A file whose type the browser does not know (some HEIC) is tried as an image; the server refuses what is not a receipt.
  if (typeof createImageBitmap !== 'function') return file
  let image: ImageBitmap
  try {
    image = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return file
  context.fillStyle = 'white'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const quality of QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= maxBytes) return new File([blob], `${file.name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' })
  }
  throw new Error('Photo trop volumineuse, même réduite : reprenez-la de plus loin.')
}
