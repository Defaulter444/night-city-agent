import { imageIssue, parseDataUrl, base64Bytes } from './images.mjs';

export const MAX_DOCUMENT_IMAGES = 4;
export const MAX_DOCUMENT_IMAGE_BYTES = 8 * 1024 * 1024;

/** Images belong to the document: projection, backup and encryption use its access rules. */
export function documentImages(value = []) {
  if (!Array.isArray(value)) throw Error('Изображения должны быть списком');
  if (value.length > MAX_DOCUMENT_IMAGES) throw Error(`В файл можно добавить до ${MAX_DOCUMENT_IMAGES} изображений`);
  let total = 0;
  return value.map((image, index) => {
    if (typeof image?.src !== 'string') throw Error('Не удалось прочитать изображение');
    const issue = imageIssue(image.src);
    if (issue) throw Error(issue);
    const { base64 } = parseDataUrl(image.src);
    if (base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw Error('Повреждены данные изображения');
    total += base64Bytes(base64);
    if (total > MAX_DOCUMENT_IMAGE_BYTES) throw Error('Общий размер изображений в файле превышает 8 МБ');
    return { src: image.src, name: String(image.name ?? '').trim().slice(0, 160) || `Изображение ${index + 1}` };
  });
}
