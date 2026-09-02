/**
 * Транспорт. Игрок ничего не пишет в состояние сам — он просит мастера,
 * мастер проверяет право и рассылает результат участникам.
 *
 * Внутри обработчика `this.socketdata.userId` — это id того, кто вызвал.
 * Значение проставляет принимающая сторона, подделать его из полезной
 * нагрузки нельзя, поэтому на него можно опираться при проверке прав.
 */
import { MODULE_ID, readState, mutate, defaultRingtone } from "./store.mjs";
import * as M from "./model.mjs";
import * as Img from "./images.mjs";
import { getFilePicker } from "./foundry-compat.mjs";

export const UPDATE_HOOK = "nightCityAgentUpdate";

let socket = null;

export function registerSocket() {
  socket = globalThis.socketlib.registerModule(MODULE_ID);
  socket.register("send", gmSend);
  socket.register("sendImage", gmSendImage);
  socket.register("setBook", gmSetBook);
  socket.register("markRead", gmMarkRead);
  socket.register("setRingtone", gmSetRingtone);
  socket.register("deliver", clientDeliver);
  socket.register("refresh", clientRefresh);
  return socket;
}

export function getSocket() {
  return socket;
}

const MAX_TEXT = 2000;

/** Кому рассылать обновление: обе стороны переписки и все мастера. */
function audienceFor(state, ...numbers) {
  const ids = new Set();
  for (const num of numbers) {
    const owner = state.devices[num]?.owner;
    if (owner) ids.add(owner);
  }
  for (const user of game.users) if (user.isGM && user.active) ids.add(user.id);
  return [...ids].filter(id => game.users.get(id)?.active);
}

/* ------------------------------------------------- обработчики на мастере */

async function gmSend({ from, to, text }) {
  const callerId = this.socketdata.userId;
  const caller = game.users.get(callerId);
  const clean = String(text ?? "").trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error("Пустое сообщение");

  const state = readState();
  const sender = state.devices[from];
  if (!sender) throw new Error(`Устройство ${from} не найдено`);
  if (!state.devices[to]) throw new Error(`Номер ${to} не отвечает`);
  if (!caller?.isGM && sender.owner !== callerId) throw new Error("Это не ваше устройство");

  const msg = await mutate(s => M.pushMessage(s, from, to, clean));

  const fresh = readState();
  const ringtone = fresh.devices[to]?.ringtone || defaultRingtone();
  socket.executeForUsers("deliver", audienceFor(fresh, from, to), { from, to, msg, ringtone });
  return msg;
}

/**
 * Картинка от игрока. Пишет её на диск мастер — у игрока такого права нет.
 *
 * В Foundry «загружать файлы» по умолчанию может ассистент и выше,
 * «просматривать файлы» — доверенный и выше. Обычный игрок не может ни того,
 * ни другого, и раздавать эти права всем ради одной кнопки — плохой размен:
 * вместе с ней открывается весь файловый раздел сервера.
 *
 * Поэтому игрок присылает содержимое, а мастер проверяет и кладёт файл в папку
 * мира. Проверяем именно здесь: тип и размер приходят из чужого браузера, и
 * верить им на слово нельзя.
 */
async function gmSendImage({ from, to, image, text }) {
  const callerId = this.socketdata.userId;
  const caller = game.users.get(callerId);

  const state = readState();
  const sender = state.devices[from];
  if (!sender) throw new Error(`Устройство ${from} не найдено`);
  if (!state.devices[to]) throw new Error(`Номер ${to} не отвечает`);
  if (!caller?.isGM && sender.owner !== callerId) throw new Error("Это не ваше устройство");

  const issue = Img.imageIssue(image);
  if (issue) throw new Error(issue);

  const folder = Img.imageFolder(game.world.id);
  const name = Img.imageFileName(from, Img.parseDataUrl(image).type);
  const path = await storeImage(folder, name, image);

  const clean = String(text ?? "").trim().slice(0, MAX_TEXT);
  const msg = await mutate(s => M.pushMessage(s, from, to, clean, Date.now(), { img: path }));

  const fresh = readState();
  const ringtone = fresh.devices[to]?.ringtone || defaultRingtone();
  socket.executeForUsers("deliver", audienceFor(fresh, from, to), { from, to, msg, ringtone });
  return msg;
}

/**
 * Кладёт картинку в папку мира и возвращает путь, по которому её увидят все.
 *
 * Папку создаём молча: Foundry отвечает ошибкой, если она уже есть, и это не
 * повод прерывать отправку.
 *
 * @param {String} folder - куда класть
 * @param {String} name - имя файла
 * @param {String} image - data-URL
 * @returns {Promise<String>} - путь к файлу
 */
async function storeImage(folder, name, image) {
  const Picker = getFilePicker();
  if (!Picker) throw new Error("Загрузчик файлов недоступен");

  try {
    await Picker.createDirectory("data", folder);
  } catch (err) {
    // Уже существует — это нормально.
  }

  const file = Img.dataUrlToFile(image, name);
  // notify: false — своё сообщение мы покажем сами, а мастеру незачем видеть
  // «файл загружен» на каждую картинку, присланную игроками.
  const result = await Picker.upload("data", folder, file, {}, { notify: false });
  const path = result?.path;
  if (!path) throw new Error("Картинку не удалось сохранить на сервере");
  return path;
}

async function gmSetBook({ myNum, other, name }) {
  const callerId = this.socketdata.userId;
  const caller = game.users.get(callerId);
  const state = readState();
  if (!state.devices[myNum]) throw new Error(`Устройство ${myNum} не найдено`);
  if (!caller?.isGM && state.devices[myNum].owner !== callerId) throw new Error("Это не ваше устройство");

  await mutate(s => M.setBookName(s, myNum, other, name));
  socket.executeForUsers("refresh", audienceFor(readState(), myNum));
}

/** Игрок меняет рингтон своего устройства — мастер для этого не нужен. */
async function gmSetRingtone({ myNum, path }) {
  const callerId = this.socketdata.userId;
  const caller = game.users.get(callerId);
  const state = readState();
  if (!state.devices[myNum]) throw new Error(`Устройство ${myNum} не найдено`);
  if (!caller?.isGM && state.devices[myNum].owner !== callerId) throw new Error("Это не ваше устройство");

  await mutate(s => { s.devices[myNum].ringtone = String(path ?? "").trim(); });
  socket.executeForUsers("refresh", audienceFor(readState(), myNum));
}

async function gmMarkRead({ myNum, other }) {
  const callerId = this.socketdata.userId;
  const caller = game.users.get(callerId);
  const state = readState();
  if (!state.devices[myNum]) return;
  if (!caller?.isGM && state.devices[myNum].owner !== callerId) return;

  await mutate(s => M.markRead(s, myNum, other));
  socket.executeForUsers("refresh", audienceFor(readState(), myNum));
}

/* ------------------------------------------------- обработчики на клиентах */

async function clientDeliver({ from, to, ringtone }) {
  const state = readState();
  const mine = state.devices[to]?.owner === game.user.id;

  if (mine) {
    const { isThreadOpen } = await import("./presence.mjs");

    if (isThreadOpen(to, from)) {
      // Игрок уже смотрит на эту переписку — звонить незачем,
      // сообщение сразу считается прочитанным.
      markRead(to, from).catch(() => {});
    } else {
      const { startRing, ringKey } = await import("./ringtone.mjs");
      startRing(ringKey(to, from), ringtone);
      ui.notifications.info(`Агент: входящее на ${to}`);
    }
  }
  Hooks.callAll(UPDATE_HOOK);
}

function clientRefresh() {
  Hooks.callAll(UPDATE_HOOK);
}

/* --------------------------------------------------------- вызовы клиента */

function requireGM() {
  if (!game.users.activeGM) throw new Error("Нет сигнала: мастер не в игре");
}

export async function sendMessage(from, to, text) {
  requireGM();
  return socket.executeAsGM("send", { from, to, text });
}

/**
 * Отправить картинку. Содержимое едет строкой data-URL: предел
 * сокет-сообщения у Foundry — 100 МБ, а отправитель сжимает картинку заранее.
 *
 * @param {String} from - свой номер
 * @param {String} to - номер собеседника
 * @param {String} image - data-URL
 * @param {String} text - подпись, если есть
 */
export async function sendImage(from, to, image, text = "") {
  requireGM();
  return socket.executeAsGM("sendImage", { from, to, image, text });
}
export async function setBook(myNum, other, name) {
  requireGM();
  return socket.executeAsGM("setBook", { myNum, other, name });
}

export async function markRead(myNum, other) {
  requireGM();
  return socket.executeAsGM("markRead", { myNum, other });
}

export async function setRingtone(myNum, path) {
  requireGM();
  return socket.executeAsGM("setRingtone", { myNum, path });
}

/** Мастер меняет список устройств локально и просит всех перечитать. */
export async function broadcastRefresh() {
  const state = readState();
  const ids = game.users.filter(u => u.active).map(u => u.id);
  socket.executeForUsers("refresh", ids, {});
  Hooks.callAll(UPDATE_HOOK);
  return state;
}
