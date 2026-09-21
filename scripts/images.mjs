/**
 * Картинки в переписке Агента.
 *
 * Здесь два слоя, и разделены они не для красоты. Верхний — чистые проверки:
 * что за строка пришла вместо картинки, какого она типа, сколько весит, как
 * назвать файл. Они не знают ни про Foundry, ни про браузер, и потому
 * проверяются тестами. Нижний — сжатие в холсте: это можно только в браузере,
 * и туда тесты не ходят.
 *
 * Почему картинку принимает мастер, а не отправитель. В Foundry право
 * «загружать файлы» по умолчанию есть у ассистента и выше, а «просматривать
 * файлы» — у доверенного и выше. У обычного игрока нет ни того, ни другого:
 * он не может ни выбрать файл в обозревателе, ни положить его на сервер. Ждать,
 * что мастер раздаст эти права всем, — значит переложить на него настройку
 * ради одной кнопки, да ещё и открыть игрокам весь файловый раздел.
 *
 * Поэтому картинка едет тем же путём, что и всё остальное в этом модуле:
 * игрок просит мастера, мастер проверяет право и делает. Предел размера
 * сокет-сообщения у Foundry — 100 МБ, так что дорога свободна; и всё же
 * отправитель сжимает картинку заранее, чтобы не копить в мире мегабайты
 * и не гонять их по сети целиком.
 */

/** Что принимаем. Ничего экзотического: эти форматы покажет любой браузер. */
export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Расширение файла по типу. */
const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};

/** Потолок на одну картинку после сжатия. */
export const MAX_BYTES = 4 * 1024 * 1024;

/** Наибольшая сторона после сжатия: на экране агента больше не нужно. */
export const MAX_SIDE = 1600;

/**
 * Разбирает data-URL, ничего не декодируя целиком.
 *
 * @param {String} url - строка вида "data:image/png;base64,...."
 * @returns {Object|null} - {type, base64} или null, если это не data-URL
 */
export function parseDataUrl(url) {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(
    String(url ?? "")
  );
  if (!match) return null;
  return { type: match[1].toLowerCase(), base64: match[2] };
}

/**
 * Сколько байт в base64-строке. Считаем по длине, а не декодированием:
 * картинка может быть в мегабайты, и раскладывать её в память ради размера
 * незачем.
 *
 * @param {String} base64 - тело data-URL
 * @returns {Number}
 */
export function base64Bytes(base64) {
  const text = String(base64 ?? "");
  if (!text) return 0;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

/**
 * Что не так с присланной картинкой. Возвращает строку с причиной или null.
 *
 * Проверяет мастер, у себя, до записи на диск: отправитель — это чужой
 * браузер, и верить его словам о типе и размере нельзя.
 *
 * @param {String} url - data-URL
 * @param {Number} maxBytes - потолок размера
 * @returns {String|null}
 */
export function imageIssue(url, maxBytes = MAX_BYTES) {
  const parsed = parseDataUrl(url);
  if (!parsed) return "Это не картинка";
  if (!ALLOWED_TYPES.includes(parsed.type)) return `Формат ${parsed.type} не принимается`;
  const bytes = base64Bytes(parsed.base64);
  if (bytes === 0) return "Пустой файл";
  if (bytes > maxBytes) {
    return `Картинка тяжелее ${Math.round(maxBytes / 1024 / 1024)} МБ`;
  }
  return null;
}

/**
 * Имя файла для картинки.
 *
 * Имя, которое дал отправитель, не используем вовсе: в нём бывает что угодно,
 * вплоть до путей с «..». Собираем своё — из номера отправителя, времени и
 * случайного хвоста, чтобы два человека не записали файл друг поверх друга в
 * одну и ту же секунду.
 *
 * @param {String} from - номер отправителя
 * @param {String} type - MIME-тип
 * @param {Number} now - время
 * @param {Function} rng - источник случайности, для повторяемости в тестах
 * @returns {String}
 */
export function imageFileName(from, type, now = Date.now(), rng = Math.random) {
  const safe = String(from ?? "").replace(/[^0-9a-zA-Z-]/g, "") || "unknown";
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tail = Math.floor(rng() * 1e6).toString(36).padStart(4, "0");
  return `${safe}_${stamp}_${tail}.${EXTENSIONS[type] ?? "png"}`;
}

/**
 * Куда мастер складывает присланное.
 *
 * Внутри мира, а не в общий раздел данных: картинки принадлежат этой игре,
 * и вместе с миром они и переезжают, и удаляются.
 *
 * @param {String} worldId - идентификатор мира
 * @returns {String}
 */
export function imageFolder(worldId) {
  return `worlds/${worldId}/night-city-agent`;
}

/* ------------------------------------------------------------- браузерное */

/**
 * Сжимает выбранный файл до разумного размера и возвращает data-URL.
 *
 * Отправляем не оригинал: снимок с телефона — это пять мегабайт, которые
 * незачем ни гонять по сети, ни хранить в мире. Ужимаем до `MAX_SIDE` по
 * большей стороне и, если всё ещё тяжело, снижаем качество.
 *
 * Гиф не трогаем: пережать его холстом — значит потерять анимацию, а это
 * ровно то, ради чего гиф и посылают. Если он не влезает в потолок, честно
 * говорим об этом, а не отправляем первый кадр.
 *
 * @param {File} file - выбранный файл
 * @param {Object} limits - {maxSide, maxBytes}
 * @returns {Promise<String>} - data-URL
 */
export async function shrinkImage(file, { maxSide = MAX_SIDE, maxBytes = MAX_BYTES, outputType = null } = {}) {
  const original = await readAsDataUrl(file);
  if (file.type === "image/gif") {
    const issue = imageIssue(original, maxBytes);
    if (issue) throw new Error(`${issue}. Анимацию сжать нельзя — уменьшите файл сами.`);
    return original;
  }

  const bitmap = await loadBitmap(original);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  // Прозрачность бывает нужна — например, скан документа с вырезанным фоном,
  // — поэтому png остаётся png. Всё остальное уходит в webp: он заметно легче
  // при том же виде.
  const type = outputType === 'image/webp' ? 'image/webp' : file.type === "image/png" ? "image/png" : "image/webp";
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL(type, quality);
    if (base64Bytes(parseDataUrl(url)?.base64) <= maxBytes) return url;
    if (type === "image/png") break; // png качеству не поддаётся
  }
  throw new Error("Картинка слишком тяжёлая даже после сжатия");
}

/** Читает файл в data-URL. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Файл не читается"));
    reader.readAsDataURL(file);
  });
}

/** Готовит картинку к рисованию в холсте. */
function loadBitmap(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Файл не похож на картинку"));
    img.src = dataUrl;
  });
}

/**
 * Превращает data-URL в файл — таким его принимает загрузчик Foundry.
 *
 * @param {String} url - data-URL
 * @param {String} name - имя файла
 * @returns {File}
 */
export function dataUrlToFile(url, name) {
  const parsed = parseDataUrl(url);
  if (!parsed) throw new Error("Это не картинка");
  const binary = atob(parsed.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: parsed.type });
}

/**
 * Находит картинки, на которые больше никто не ссылается.
 *
 * Удалить их модуль не может, и это не лень: в Foundry 12 сервер принимает от
 * клиента ровно три файловые команды — `browseFiles`, `createDirectory` и
 * `configurePath`. Команды удаления нет вовсе, ни у обозревателя файлов, ни в
 * http-маршрутах. Поэтому здесь честный список: мастер видит, какие файлы
 * осиротели и где они лежат, и убирает их сам — из проводника или по ssh.
 *
 * Сверяем по всем перепискам сразу: одну и ту же картинку могли переслать в
 * несколько тредов, и «удалить вместе с устройством» было бы неверно.
 *
 * @param {Set<String>} used - пути, на которые ещё есть ссылки
 * @param {String} worldId - идентификатор мира
 * @param {Object} picker - класс обозревателя файлов Foundry
 * @returns {Promise<Object>} - {folder, orphans: [...], kept: Number}
 */
export async function findOrphanImages(used, worldId, picker) {
  const folder = imageFolder(worldId);
  let listing;
  try {
    listing = await picker.browse("data", folder);
  } catch (err) {
    // Папки нет — значит, и картинок ещё не присылали.
    return { folder, orphans: [], kept: 0 };
  }

  const files = listing?.files ?? [];
  const orphans = files.filter(path => !used.has(path));
  return { folder, orphans, kept: files.length - orphans.length };
}
