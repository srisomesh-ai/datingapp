// Prepares a profile photo in the browser: centre-cropped square JPEG.
const SIZE = 900;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

/** @returns {Promise<{form: FormData, previewUrl: string}>} */
export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  canvas
    .getContext('2d')
    .drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const form = new FormData();
  form.append('full', blob, 'photo.jpg');
  return { form, previewUrl: canvas.toDataURL('image/jpeg', 0.7) };
}
