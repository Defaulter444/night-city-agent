/**
 * Мостики к тем частям Foundry, до которых из ES-модуля так просто не дотянуться.
 */

/**
 * FilePicker объявлен как `class FilePicker` в обычном скрипте Foundry
 * (client/ui/filepicker.js). Объявления `class` на верхнем уровне классического
 * скрипта живут в глобальной лексической области и свойством globalThis
 * НЕ становятся — поэтому обращаться нужно по голому имени.
 */
export function getFilePicker() {
  return foundry.applications?.apps?.FilePicker
    ?? (typeof FilePicker !== "undefined" ? FilePicker : null);
}

/** Может ли этот пользователь открыть обозреватель файлов. */
export function canBrowseFiles() {
  return Boolean(game.user?.can?.("FILES_BROWSE"));
}

/** Может ли этот пользователь загружать файлы на сервер. */
export function canUploadFiles() {
  return Boolean(game.user?.can?.("FILES_UPLOAD"));
}

/**
 * Открывает обозреватель файлов. Возвращает false, если это невозможно —
 * вызывающий сам решает, что сказать пользователю.
 */
export function browseFiles({ type = "audio", current = "", callback } = {}) {
  const Picker = getFilePicker();
  if (!Picker || !canBrowseFiles()) return false;
  new Picker({ type, current, callback }).render(true);
  return true;
}
