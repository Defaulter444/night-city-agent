/**
 * Транспорт. Игрок ничего не пишет в состояние сам — он просит мастера,
 * мастер проверяет право и рассылает результат участникам.
 *
 * Внутри обработчика `this.socketdata.userId` — это id того, кто вызвал.
 * Значение проставляет принимающая сторона, подделать его из полезной
 * нагрузки нельзя, поэтому на него можно опираться при проверке прав.
 */
import { MODULE_ID, readState, mutate, defaultRingtone, stateForUser, acceptProjection, protectedStorage, initializeStorage } from "./store.mjs";
import { PrivateSocket } from './private-socket.mjs';
import { runDocumentOperation } from './documents-service.mjs';
import { handleWealth, handleTransfer } from "./wealth.mjs";
import * as M from "./model.mjs";
import * as Img from "./images.mjs";
import { getFilePicker } from "./foundry-compat.mjs";
import { runConferenceOperation } from './conferences-service.mjs';
import { runNoteOperation } from './notes.mjs';
import { npcIncoming, incomingLabel } from './incoming.mjs';
import { conferenceKey } from './conferences-model.mjs';
import { createMailing } from './mailing-model.mjs';
import { applyOSOperation } from './os-model.mjs';
import { canReadDocument } from './documents-model.mjs';

export const UPDATE_HOOK = "nightCityAgentUpdate";

let socket = null;

// socketlib replaces thrown remote errors with generic English text. Preserve
// expected ledger failures so the player's window can explain the rejection.
async function ledgerResult(task) {
  try { return { ok: true, value: await task() }; }
  catch (error) { return { ok: false, message: error?.message || "Не удалось выполнить операцию со счётом" }; }
}

export function registerSocket() {
  if (socket) return socket;
  socket = new PrivateSocket();
  socket.register('snapshot', function() { return stateForUser(this.socketdata.userId); });
  socket.register('osOperation', async function(data) {
    const user = game.users.get(this.socketdata.userId);
    let recipients=[];
    const result = await mutate(state => {
      if (data.op === 'fileMeta' && !canReadDocument(state,state.documents?.[data.id],user,user?.viewedScene)) throw Error('Файл недоступен');
      const previous=new Set(state.os?.calls?.[data.id]?.members??[]);
      const value=applyOSOperation(state,data,user);
      if (['callStart','callInvite'].includes(data.op)) recipients=state.os.calls[value].members.filter(n=>n!==data.number&&!previous.has(n));
      return value;
    });
    if (['callStart','callInvite'].includes(data.op)) {
      await Promise.allSettled(recipients.map(to=>deliverDirect(data.number,to,this.socketdata.userId)));
    }
    await broadcastRefresh(); return result;
  });
  socket.register('documentOperation', async function(data) {
    const result = await runDocumentOperation(data, this.socketdata.userId);
    if (['sendDocument', 'shareContact'].includes(data.op)) await deliverDirect(data.from, data.to, this.socketdata.userId);
    else if (!(data.op === 'organize' && typeof data.draft === 'string')) await broadcastRefresh();
    return result;
  });
  socket.register('noteOperation', function(data) { return runNoteOperation(data, this.socketdata.userId); });
  socket.register('conferenceOperation', async function(data) {
    const result = await runConferenceOperation(data, this.socketdata.userId);
    if (data.op === 'send') {
      const state = readState(), room = state.conferences[data.id];
      await notifyUsers('conferenceDeliver', audienceFor(state, ...room.members), { id: room.id, from: data.number, senderId: this.socketdata.userId });
    } else if (!['read', 'draft'].includes(data.op)) await broadcastRefresh();
    return result;
  });
  socket.register('conferenceDeliver', clientConferenceDeliver);
  socket.register('terminalPush', async function(id) {
    await refreshState();
    const { openWorkspace } = await import('./workspace-app.mjs');
    openWorkspace({ terminalId: id, tab: 'terminals' });
  });
  socket.register("send", gmSend);
  socket.register('sendMailing', gmSendMailing);
  socket.register("adjustWealth", function(data) { return ledgerResult(() => handleWealth(data, this.socketdata.userId)); });
  socket.register("transferWealth", function(data) { return ledgerResult(() => handleTransfer(data, this.socketdata.userId)); });
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

export async function osOperation(op,data={}) {
  requireGM(); const result=await socket.executeAsGM('osOperation',{...data,op}); await refreshState(); return result;
}

async function notifyUsers(name, ids, ...args) {
  // The durable mutation has succeeded. A disconnected receiver must not make
  // the sender retry a message or a money operation that already happened.
  await Promise.allSettled(ids.map(id => socket.executeForUsers(name, [id], ...args)));
}

const MAX_TEXT = 2000;

function requireDeviceOwner(state, num, callerId) {
  const device = state.devices[num];
  if (!device) throw new Error(`Устройство ${num} не найдено`);
  const caller = game.users.get(callerId);
  if (!caller || (!caller.isGM && device.owner !== callerId)) throw new Error("Это не ваше устройство");
  return device;
}

function requireMessageRoute(state, from, to, callerId) {
  requireDeviceOwner(state, from, callerId);
  if (!state.devices[to]) throw new Error(`Номер ${to} не отвечает`);
}

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
async function deliverDirect(from, to, senderId) {
  const fresh = readState(), ringtone = fresh.devices[to]?.ringtone || defaultRingtone();
  await notifyUsers('deliver', audienceFor(fresh, from, to), { from, to, ringtone, senderId });
}

/* ------------------------------------------------- обработчики на мастере */

async function gmSend({ from, to, text }) {
  const callerId = this.socketdata.userId;
  const clean = String(text ?? "").trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error("Пустое сообщение");

  const msg = await mutate(s => {
    requireMessageRoute(s, from, to, callerId);
    return M.pushMessage(s, from, to, clean);
  });

  await deliverDirect(from, to, callerId);
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
  requireMessageRoute(readState(), from, to, callerId);

  const issue = Img.imageIssue(image);
  if (issue) throw new Error(issue);

  const folder = Img.imageFolder(game.world.id);
  const name = Img.imageFileName(from, Img.parseDataUrl(image).type);
  const path = protectedStorage() ? image : await storeImage(folder, name, image);

  const clean = String(text ?? "").trim().slice(0, MAX_TEXT);
  const msg = await mutate(s => {
    // The GM may transfer or remove an Agent while its upload is running.
    requireMessageRoute(s, from, to, callerId);
    return M.pushMessage(s, from, to, clean, Date.now(), { img: path });
  });

  await deliverDirect(from, to, callerId);
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
  await mutate(s => {
    requireDeviceOwner(s, myNum, callerId);
    M.setBookName(s, myNum, other, name);
  });
  await notifyUsers("refresh", audienceFor(readState(), myNum));
}

/** Игрок меняет рингтон своего устройства — мастер для этого не нужен. */
async function gmSetRingtone({ myNum, path }) {
  const callerId = this.socketdata.userId;
  await mutate(s => {
    requireDeviceOwner(s, myNum, callerId).ringtone = String(path ?? "").trim();
  });
  await notifyUsers("refresh", audienceFor(readState(), myNum));
}

async function gmMarkRead({ myNum, other }) {
  const callerId = this.socketdata.userId;
  await mutate(s => {
    requireDeviceOwner(s, myNum, callerId);
    M.markRead(s, myNum, other);
  });
  await notifyUsers("refresh", audienceFor(readState(), myNum));
}

/* ------------------------------------------------- обработчики на клиентах */

async function clientDeliver({ from, to, ringtone, senderId }) {
  await refreshState();
  const state = readState();
  const mine = state.devices[to]?.owner === game.user.id;
  const npc = npcIncoming(state, game.users, game.user, senderId, from, [to]).length > 0;
  if (npc) ui.notifications.info(incomingLabel(state, from, to));

  if (mine || npc) {
    const { isThreadOpen } = await import("./presence.mjs");

    if (isThreadOpen(to, from)) {
      // Игрок уже смотрит на эту переписку — звонить незачем,
      // сообщение сразу считается прочитанным.
      markRead(to, from).catch(() => {});
    } else {
      const { startRing, ringKey } = await import("./ringtone.mjs");
      startRing(ringKey(to, from), ringtone);
      if (!npc) ui.notifications.info(`Агент: входящее на ${to}`);
    }
  }
  Hooks.callAll(UPDATE_HOOK);
}

async function gmSendMailing(data) {
  const callerId = this.socketdata.userId;
  const result = await mutate(state => createMailing(state, data, game.users.get(callerId)));
  if (!result.replayed) await Promise.allSettled(result.recipients.map(to => deliverDirect(data.from, to, callerId)));
  return result;
}

async function clientConferenceDeliver({ id, from, senderId }) {
  await refreshState();
  const state = readState(), room = state.conferences?.[id];
  if (!room) { Hooks.callAll(UPDATE_HOOK); return; }
  const npc = npcIncoming(state, game.users, game.user, senderId, from, room.members);
  const own = room.members.filter(n => n !== from && state.devices[n]?.owner === game.user.id);
  const recipients = [...new Set([...npc, ...own])];
  const { isConferenceOpen } = await import('./conference-presence.mjs');
  const { startRing, ringKey } = await import('./ringtone.mjs');
  if (game.user.id !== senderId && recipients.length) {
    const sender = state.devices[recipients[0]]?.book?.[from] || state.devices[from]?.label || from;
    if (npc.length || recipients.some(n => !isConferenceOpen(n, id))) ui.notifications.info(`Агент · ${room.title}: ${sender}${npc.length ? ` → НПС ${npc.map(n => state.devices[n]?.label || n).join(', ')}` : ''}`);
    for (const n of recipients) if (!isConferenceOpen(n, id)) startRing(ringKey(n, conferenceKey(id)), state.devices[n]?.ringtone || defaultRingtone());
  }
  Hooks.callAll(UPDATE_HOOK);
}

async function clientRefresh() {
  await refreshState();
  Hooks.callAll(UPDATE_HOOK);
}
export async function refreshState() {
  if (game.user.isGM) { if (protectedStorage()) await initializeStorage(); return; }
  if (!socket || !game.users.activeGM) return;
  acceptProjection(await socket.executeAsGM('snapshot'));
}
export async function documentOperation(op, data = {}) {
  requireGM();
  const result = await socket.executeAsGM('documentOperation', { op, ...data });
  await refreshState();
  return result;
}
export async function conferenceOperation(op, data = {}) {
  requireGM();
  const result = await socket.executeAsGM('conferenceOperation', { ...data, op });
  await refreshState(); return result;
}
export function noteOperation(op, data = {}) {
  requireGM(); return socket.executeAsGM('noteOperation', { ...data, op });
}

/* --------------------------------------------------------- вызовы клиента */

function requireGM() {
  if (!game.users.activeGM) throw new Error("Нет сигнала: мастер не в игре");
}

export async function sendMessage(from, to, text) {
  requireGM();
  return socket.executeAsGM("send", { from, to, text });
}

export async function sendMailing(from, recipients, text, operationId) {
  requireGM();
  const result = await socket.executeAsGM('sendMailing', { from, recipients, text, operationId });
  await refreshState();
  return result;
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
  await notifyUsers("refresh", ids, {});
  Hooks.callAll(UPDATE_HOOK);
  return state;
}
