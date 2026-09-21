/** Pure data operations. Existing devices/books/threads are never renumbered. */
import { normalize, threadKey, pushMessage } from './model.mjs';
import { carrierAccess } from './carriers.mjs';
import { documentImages } from './document-images.mjs';
import { canAccessConference, conferenceProjection } from './conferences-model.mjs';
import { projectOS } from './os-model.mjs';
export const clone = value => structuredClone(value);
export const uid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
export function ownDevice(state, number, user) {
  if (!state.devices[number] || (!user?.isGM && state.devices[number].owner !== user?.id)) throw Error('Это не ваше устройство');
  return state.devices[number];
}
export function terminalAllowed(terminal, user, sceneId) {
  return Boolean(terminal && (user?.isGM || (terminal.users ?? []).includes(user?.id)) &&
    (user?.isGM || terminal.portable || terminal.sceneId === sceneId));
}
export function canEditDocument(doc, user) {
  return Boolean(doc && user && (user.isGM || (user.id && doc.authorId === user.id)));
}
export function canReadDocument(state, doc, user, sceneId = '') {
  if (!doc) return false;
  if (canEditDocument(doc, user) || doc.readers?.includes(user?.id)) return true;
  if (doc.holders?.some(num => state.devices[num]?.owner === user?.id)) return true;
  if (carrierAccess(doc, user)) return true;
  if (Object.values(state.conferences ?? {}).some(room => canAccessConference(state, room, user) && room.messages.some(m => m.documentId === doc.id))) return true;
  return Object.values(state.terminals ?? {}).some(t => terminalAllowed(t, user, sceneId) &&
    t.entries?.some(entry => entry.documentId === doc.id && entry.published));
}
export function projectState(state, user, sceneId = '') {
  state = normalize(clone(state));
  if (user?.isGM) return state;
  const mine = new Set(Object.values(state.devices).filter(d => d.owner === user?.id).map(d => d.num));
  const out = { v: 1, devices: {}, threads: {}, read: {}, documents: {}, terminals: {}, organizer: {}, revision: state.revision ?? 0 };
  if (state.conferences) out.conferences = conferenceProjection(state, user);
  if (state.os) out.os = projectOS(state, user);
  // Only routing metadata is public. NPC device labels and other books stay with the GM.
  for (const [num, dev] of Object.entries(state.devices)) out.devices[num] = mine.has(num) ? clone(dev) : { num, owner: dev.owner };
  for (const [key, messages] of Object.entries(state.threads)) {
    if (!key.split('|').some(num => mine.has(num))) continue;
    out.threads[key] = messages.map(msg => { const copy = clone(msg); delete copy.o; return copy; });
  }
  for (const [key, value] of Object.entries(state.read)) if (mine.has(key.split('|')[0])) out.read[key] = value;
  for (const num of mine) if (state.organizer?.[num]) out.organizer[num] = clone(state.organizer[num]);
  for (const doc of Object.values(state.documents ?? {})) if (canReadDocument(state, doc, user, sceneId)) {
    out.documents[doc.id] = { id: doc.id, title: doc.title, body: doc.body, source: doc.source, createdAt: doc.createdAt, canEdit: canEditDocument(doc, user) };
    if (doc.images?.length) out.documents[doc.id].images = clone(doc.images);
  }
  for (const t of Object.values(state.terminals ?? {})) if (terminalAllowed(t, user, sceneId)) {
    out.terminals[t.id] = { id: t.id, title: t.title, portable: t.portable, sceneId: t.sceneId,
      entries: (t.entries ?? []).filter(e => e.published).map(e => ({ id: e.id, title: e.title, kind: e.kind, documentId: e.documentId, random: Boolean(e.tableUuid) })) };
  }
  return out;
}
export function createDocument(state, { title, body, source = '', holders = [], readers = [], images, authorId }, now = Date.now()) {
  title = String(title ?? '').trim().slice(0, 160); body = String(body ?? '').slice(0, 100000);
  if (!title) throw Error('Укажите название файла');
  const doc = { id: uid(), title, body, source: String(source).slice(0, 300), holders: [...new Set(holders)], readers: [...new Set(readers)], createdAt: now };
  if (authorId !== undefined) doc.authorId = authorId;
  if (images !== undefined) doc.images = documentImages(images);
  (state.documents ??= {})[doc.id] = doc;
  return doc;
}
export function attachDocument(state, { from, to, documentId, text = '' }, user) {
  ownDevice(state, from, user);
  const doc = state.documents?.[documentId];
  if (!canReadDocument(state, doc, user)) throw Error('Нет доступа к файлу');
  if (!state.devices[to]) throw Error('Номер не найден');
  doc.holders ??= []; if (!doc.holders.includes(to)) doc.holders.push(to);
  const message = pushMessage(state, from, to, String(text).slice(0, 2000));
  message.documentId = doc.id;
  return message;
}
export function organize(state, { number, other, draft, tags, pin }, user) {
  ownDevice(state, number, user);
  const entry = ((state.organizer ??= {})[number] ??= { drafts: {}, tags: {}, pins: [] });
  entry.drafts ??= {}; entry.tags ??= {}; entry.pins ??= [];
  if (typeof draft === 'string') entry.drafts[other] = draft.slice(0, 2000);
  if (Array.isArray(tags)) entry.tags[other] = [...new Set(tags.map(t => String(t).trim().slice(0, 24)).filter(Boolean))].slice(0, 6);
  if (typeof pin === 'number') {
    if (!state.threads[threadKey(number, other)]?.[pin]) throw Error('Сообщение не найдено');
    const key = `${threadKey(number, other)}:${pin}`;
    entry.pins = entry.pins.includes(key) ? entry.pins.filter(p => p !== key) : [...entry.pins, key];
  }
  return entry;
}
export function legacyInventory(state) {
  return { devices: Object.keys(state.devices ?? {}).length,
    contacts: Object.values(state.devices ?? {}).reduce((n, d) => n + Object.keys(d.book ?? {}).length, 0),
    threads: Object.keys(state.threads ?? {}).length,
    messages: Object.values(state.threads ?? {}).reduce((n, list) => n + list.length, 0) };
}
export function assertLegacyPreserved(before, after) {
  for (const field of ['devices', 'threads', 'read']) {
    if (JSON.stringify(before[field] ?? {}) !== JSON.stringify(after[field] ?? {})) throw Error(`Перенос остановлен: изменились данные ${field}`);
  }
  return legacyInventory(after);
}
