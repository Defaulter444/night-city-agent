/** Optional Atlas links are identifiers only; they never translate map coordinates. */
export const ATLAS_MODULE_ID = 'night-city-2045-atlas';
export function atlasLocationId(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)
    || ['__proto__', 'prototype', 'constructor'].includes(value)) throw Error('Некорректная ссылка на место Atlas');
  return value;
}
export function atlasAPI() {
  const module = globalThis.game?.modules?.get(ATLAS_MODULE_ID);
  if (!module?.active || typeof module.api?.canOpen !== 'function' || typeof module.api?.openLocation !== 'function') return null;
  try { return module.api.canOpen() === true ? module.api : null; } catch { return null; }
}
export function canOpenAtlasLocation(value) {
  try { return Boolean(atlasLocationId(value) && atlasAPI()); } catch { return false; }
}
export async function openAtlasLocation(value) {
  const id = atlasLocationId(value), api = atlasAPI();
  if (!id || !api) throw Error('Atlas недоступен: проверьте модуль и доступ к карте.');
  return api.openLocation(id);
}
