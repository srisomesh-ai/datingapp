// Prepares a profile photo in the browser: square crop, a tiny blurred preview,
// and grid tiles. Only tiles the viewer has earned are ever downloaded by others.

const FULL = 900;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
}

const toJpeg = (canvas, quality = 0.85) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** @returns {Promise<{form: FormData, previewUrl: string}>} */
export async function preparePhoto(file, grid = 3) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  const full = canvasOf(FULL);
  full.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, FULL, FULL);

  const blur = canvasOf(12);
  blur.getContext('2d').drawImage(full, 0, 0, 12, 12);

  const form = new FormData();
  form.append('full', await toJpeg(full), 'full.jpg');
  form.append('blur', await toJpeg(blur, 0.6), 'blur.jpg');

  const t = FULL / grid;
  for (let i = 0; i < grid * grid; i++) {
    const tile = canvasOf(t);
    tile.getContext('2d').drawImage(full, (i % grid) * t, Math.floor(i / grid) * t, t, t, 0, 0, t, t);
    form.append(`tile${i}`, await toJpeg(tile), `tile${i}.jpg`);
  }
  URL.revokeObjectURL(img.src);
  return { form, previewUrl: full.toDataURL('image/jpeg', 0.7) };
}
