import { speaksAloud, previewOf } from './model.mjs';

export const MAX_MEMBERS = 32;
const uid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
export const conferenceKey = id => `conference:${id}`;
export function ownsNumber(state, number, user) {
  if (!state.devices[number] || (!user?.isGM && state.devices[number].owner !== user?.id)) throw Error('Это не ваше устройство');
}
export function canAccessConference(state, room, user) {
  return Boolean(room && (user?.isGM || room.members.some(n => state.devices[n]?.owner === user?.id)));
}
export function canManageConference(state, room, user) {
  return Boolean(room && (user?.isGM || (room.createdBy === user?.id && room.members.includes(room.creatorNumber) && state.devices[room.creatorNumber]?.owner === user?.id)));
}
export function requireParticipant(state, id, number, user) {
  ownsNumber(state, number, user);
  const room = state.conferences?.[id];
  if (!room?.members.includes(number)) throw Error('Этот Агент не участвует в конференции');
  return room;
}
function fields(state, title, members) {
  title = String(title ?? '').trim().slice(0, 120);
  if (!title) throw Error('Укажите название конференции');
  if (!Array.isArray(members)) throw Error('Выберите участников конференции');
  members = [...new Set(members)];
  if (members.length < 2 || members.length > MAX_MEMBERS) throw Error(`В конференции должно быть от 2 до ${MAX_MEMBERS} участников`);
  if (members.some(n => typeof n !== 'string' || !Object.hasOwn(state.devices, n))) throw Error('Один из номеров больше недоступен');
  return { title, members };
}
export function createConference(state, data, user, now = Date.now()) {
  ownsNumber(state, data.number, user);
  const values = fields(state, data.title, [data.number, ...(Array.isArray(data.members) ? data.members : [])]);
  const room = { id: uid(), ...values, createdBy: user.id, creatorNumber: data.number, createdAt: now, messages: [], read: {}, drafts: {} };
  (state.conferences ??= {})[room.id] = room;
  return room.id;
}
export function editConference(state, data, user) {
  const room = state.conferences?.[data.id];
  if (!canManageConference(state, room, user)) throw Error('Состав конференции меняет её создатель или мастер');
  const values = fields(state, data.title, data.members);
  if (!user.isGM && !values.members.includes(room.creatorNumber)) throw Error('Чтобы выйти, используйте кнопку «Покинуть»');
  for (const number of room.members) if (!values.members.includes(number)) {
    delete room.read[number]; delete room.drafts[number];
  }
  Object.assign(room, values); return room.id;
}
export function leaveConference(state, { id, number }, user) {
  const room = requireParticipant(state, id, number, user);
  room.members = room.members.filter(n => n !== number);
  delete room.read[number]; delete room.drafts[number]; return id;
}
export function sendConference(state, data, user, now = Date.now()) {
  const room = requireParticipant(state, data.id, data.number, user);
  const text = String(data.text ?? '').trim().slice(0, 2000);
  if (!text && !data.image && !data.documentId) throw Error('Пустое сообщение');
  const message = { id: uid(), f: data.number, x: text, ts: now };
  if (data.image) message.p = data.image;
  if (data.documentId) message.documentId = data.documentId;
  if (speaksAloud(state.devices[data.number])) message.a = 1;
  room.messages.push(message);
  return message.id;
}
export function conferenceUnread(room, number) {
  const index = room.read?.[number] ?? 0;
  return room.messages.slice(index).filter(m => m.f !== number).length;
}
export function markConferenceRead(state, { id, number, through }, user) {
  const room = requireParticipant(state, id, number, user);
  // Read only what was rendered, not a newer message that arrived during the request.
  if (!Number.isInteger(through) || through < 0 || through > room.messages.length) throw Error('Некорректная отметка прочтения');
  room.read[number] = Math.max(room.read[number] ?? 0, through); return true;
}
export function conferenceProjection(state, user) {
  const out = {};
  for (const room of Object.values(state.conferences ?? {})) if (canAccessConference(state, room, user)) {
    const own = room.members.filter(n => state.devices[n]?.owner === user.id);
    out[room.id] = { ...structuredClone(room),
      read: Object.fromEntries(own.map(n => [n, room.read?.[n] ?? 0])),
      drafts: Object.fromEntries(own.map(n => [n, room.drafts?.[n] ?? ''])) };
    for (const message of out[room.id].messages) delete message.o;
  }
  return out;
}
export function conferencePreview(room) {
  const last = room.messages.at(-1);
  return last?.documentId ? `[файл] ${last.x}` : previewOf(last);
}
