// image.js — client-side photo downscaling before upload (avatars, chat photos).
//
// Re-encoding always happens, even for small JPEGs: it strips EXIF metadata (phone photos
// carry GPS coordinates) and keeps uploads well under the chat-images bucket's 5 MB limit.
// Nothing here touches the DOM at import time, so the data layer stays importable in Node.

/**
 * @param {Blob} file            the picked image
 * @param {{max?: number, quality?: number}} [options]  longest side in px, JPEG quality 0–1
 * @returns {Promise<Blob>}      image/jpeg, aspect ratio kept, never upscaled
 */
export async function resizeImage(file, { max = 1600, quality = 0.85 } = {}) {
  if (!file || !/^image\//.test(file.type || 'image/')) {
    throw new Error('Valitse kuvatiedosto.');
  }
  const source = await decode(file);
  try {
    const scale = Math.min(1, max / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // JPEG has no alpha channel: without a background, transparent PNG areas turn black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source.image, 0, 0, width, height);
    return await toJpeg(canvas, quality);
  } finally {
    source.release();
  }
}

// createImageBitmap honours EXIF orientation and decodes off the main thread; Safari < 17
// and some HEIC photos only work through an <img>, so that is the fallback.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch {
      // fall through to <img> decoding below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Kuvaa ei voitu avata. Kokeile JPEG- tai PNG-kuvaa.'));
      el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Kuvan käsittely epäonnistui.'))),
      'image/jpeg',
      quality,
    );
  });
}
