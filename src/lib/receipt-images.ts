export const IMAGE_LIMITS = {
  bytes: 20 * 1024 * 1024,
  pixels: 24_000_000,
  side: 10000,
  ocrSide: 2600,
};
export interface CropRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** Normalized selection to source pixels; reject empty/outside selections before drawing. */
export function cropPixels(rect: CropRectangle, width: number, height: number) {
  if (
    ![rect.left, rect.top, rect.width, rect.height, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    rect.left < 0 ||
    rect.top < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.left + rect.width > 1.000001 ||
    rect.top + rect.height > 1.000001
  )
    throw new Error('Choose a crop inside the photo');
  const left = Math.floor(rect.left * width),
    top = Math.floor(rect.top * height);
  const right = Math.min(width, Math.ceil((rect.left + rect.width) * width));
  const bottom = Math.min(height, Math.ceil((rect.top + rect.height) * height));
  if (right - left < 8 || bottom - top < 8)
    throw new Error('Select a larger area (at least 8 × 8 pixels)');
  return { left, top, width: right - left, height: bottom - top };
}
/** Keep receipt/date pixels unchanged: white padding can disrupt recognition on grey paper.
 * Amount-only recognition uses its separately tested 20px margin. Neither path upscales. */
export async function cropImage(
  image: Blob,
  selection: CropRectangle,
  border: 0 | 20 = 0,
): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  try {
    const rect = cropPixels(selection, bitmap.width, bitmap.height);
    canvas.width = rect.width + border * 2;
    canvas.height = rect.height + border * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      bitmap,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      border,
      border,
      rect.width,
      rect.height,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not crop photo'))),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
/** Read encoded headers before allocating a decoded bitmap, rejecting oversized images early. */
export function imageDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
  mime: string;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    mime = '';
  if (
    bytes.length >= 24 &&
    bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
    mime = 'image/png';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i++] !== 255) continue;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > bytes.length) break;
      const len = view.getUint16(i);
      if (len < 2 || i + len > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        len >= 7
      ) {
        height = view.getUint16(i + 3);
        width = view.getUint16(i + 5);
        break;
      }
      i += len;
    }
  }
  if (!mime || !width || !height)
    throw new Error(
      'Choose a readable JPEG or PNG image. Other formats and PDFs are not supported.',
    );
  if (
    width > IMAGE_LIMITS.side ||
    height > IMAGE_LIMITS.side ||
    width * height > IMAGE_LIMITS.pixels
  )
    throw new Error(
      'Image exceeds 24 megapixels or 10,000 pixels per side. Resize it before selecting.',
    );
  return { width, height, mime };
}
export async function prepareImage(file: Blob, turns = 0): Promise<Blob> {
  if (file.size > IMAGE_LIMITS.bytes)
    throw new Error('Image exceeds 20 MB. Choose a smaller image.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = imageDimensions(bytes);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: meta.mime }), {
    imageOrientation: 'from-image',
  });
  const canvas = document.createElement('canvas');
  try {
    if (bitmap.width * bitmap.height > IMAGE_LIMITS.pixels)
      throw new Error('Decoded image exceeds 24 megapixels');
    const rotate = ((turns % 4) + 4) % 4,
      scale = Math.min(1, IMAGE_LIMITS.ocrSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)),
      h = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = rotate % 2 ? h : w;
    canvas.height = rotate % 2 ? w : h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotate * Math.PI) / 2);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not prepare the image'))),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
    bytes.fill(0);
  }
}
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth,
    h = video.videoHeight;
  if (!w || !h) throw new Error('The camera is not ready. Wait for the live preview.');
  if (w * h > IMAGE_LIMITS.pixels)
    throw new Error('Camera frame exceeds 24 megapixels. Choose a lower camera resolution.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Capture unavailable');
    ctx.drawImage(video, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/png'),
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
export function cameraError(e: unknown) {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was denied. You can allow access yourself in Windows/app permissions, or choose an image instead.';
  if (name === 'NotFoundError') return 'No camera found. Connect a camera or choose an image.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The camera is busy or unavailable. Close other camera apps, retry, or choose an image.';
  return 'Could not start the camera. Retry with another device or choose an image.';
}
