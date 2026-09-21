import { mutate, readState } from './store.mjs';
import * as D from './documents-model.mjs';
import * as M from './model.mjs';
import { documentImages } from './document-images.mjs';
const requireGM = user => { if (!user?.isGM) throw Error('Только для мастера'); };
import { isStorageItem } from './carriers.mjs';
export { isStorageItem } from './carriers.mjs';
export async function runDocumentOperation(data, callerId) {
  const user = game.users.get(callerId);
  if (!user) throw Error('Пользователь не найден');
  if (data.op === 'carrier') {
    return mutate(async state => {
    const doc = state.documents?.[data.documentId];
    if (!D.canReadDocument(state, doc, user, user.viewedScene)) throw Error('Нет доступа к файлу');
    const actor = await fromUuid(data.actorUuid), item = actor?.items?.get(data.itemId);
    if (!actor?.testUserPermission(user, 'OWNER') || !item || !isStorageItem(item, actor)) throw Error('Выберите доступный носитель на своём листе');
    const ids = [...new Set([...(item.flags?.['night-city-agent']?.documents ?? []), doc.id])];
    await item.update({ 'flags.night-city-agent.documents': ids });
    doc.carriers ??= []; if (!doc.carriers.includes(item.uuid)) doc.carriers.push(item.uuid);
    return doc.id;
    });
  }
  return mutate(async state => {
    switch (data.op) {
      case 'organize': return D.organize(state, data, user);
      case 'createDocument': {
        // Only the authenticated creator or an explicit GM assignment establishes authorship.
        // Readers/holders of older files are not reliable evidence of who created them.
        let authorId;
        if (Object.hasOwn(data, 'authorId')) {
          requireGM(user);
          authorId = data.authorId || null;
          if (authorId !== null && (typeof authorId !== 'string' || !game.users.get(authorId))) throw Error('Автор файла не найден');
        }
        if (data.id) {
          const doc = state.documents?.[data.id];
          if (!doc) throw Error('Файл не найден');
          if (!D.canEditDocument(doc, user)) throw Error('Редактировать файл может только его автор или мастер');
          const title = String(data.title ?? '').trim().slice(0, 160);
          if (!title) throw Error('Укажите название файла');
          // Older clients omit images when editing text. Only an explicit list replaces them.
          const images = data.images === undefined ? {} : { images: documentImages(data.images) };
          Object.assign(doc, { title, body: String(data.body ?? '').slice(0, 100000), source: String(data.source ?? '').slice(0, 300), ...images });
          if (authorId !== undefined) doc.authorId = authorId;
          return doc.id;
        }
        if (!user.isGM) D.ownDevice(state, data.number, user);
        return D.createDocument(state, { title: data.title, body: data.body, source: data.source, images: data.images,
          authorId: authorId === undefined ? user.id : authorId,
          holders: data.number ? [data.number] : [], readers: user.isGM ? data.readers ?? [] : [user.id] }).id;
      }
      case 'sendDocument': return D.attachDocument(state, data, user);
      case 'saveDocument': {
        D.ownDevice(state, data.number, user);
        const doc = state.documents?.[data.documentId];
        if (!D.canReadDocument(state, doc, user, user.viewedScene)) throw Error('Нет доступа к файлу');
        doc.holders ??= []; if (!doc.holders.includes(data.number)) doc.holders.push(data.number);
        return doc.id;
      }
      case 'shareContact': {
        const source = D.ownDevice(state, data.from, user);
        if (!state.devices[data.contact] || !state.devices[data.to]) throw Error('Контакт не найден');
        const msg = M.pushMessage(state, data.from, data.to, 'Контакт');
        msg.contact = { num: data.contact, name: source.book?.[data.contact] || data.contact };
        return msg;
      }
      case 'acceptContact': {
        D.ownDevice(state, data.number, user);
        const msg = M.thread(state, data.number, data.other)[data.index];
        if (!msg?.contact || msg.t !== data.number) throw Error('Карточка контакта не найдена');
        M.setBookName(state, data.number, msg.contact.num, msg.contact.name); return true;
      }
      case 'terminal': {
        requireGM(user);
        const id = data.id || D.uid(), old = state.terminals?.[id];
        const terminal = { id, title: String(data.title ?? '').trim().slice(0, 160), portable: Boolean(data.portable),
          sceneId: String(data.sceneId ?? ''), users: [...new Set((data.users ?? []).filter(id => game.users.has(id)))], entries: old?.entries ?? [] };
        if (data.templateId && !old) {
          const source = state.terminals?.[data.templateId];
          if (!source) throw Error('Исходный терминал не найден');
          terminal.entries = structuredClone(source.entries).map(e => ({ ...e, id: D.uid(), documentId: e.tableUuid ? null : e.documentId }));
        }
        if (!terminal.title || (!terminal.portable && !game.scenes.has(terminal.sceneId))) throw Error('Укажите имя и сцену терминала');
        (state.terminals ??= {})[id] = terminal; return id;
      }
      case 'terminalEntry': {
        requireGM(user);
        const t = state.terminals?.[data.terminalId];
        if (!t) throw Error('Терминал не найден');
        if (data.documentId && !state.documents?.[data.documentId]) throw Error('Файл не найден');
        if (data.tableUuid) {
          const table = await fromUuid(data.tableUuid);
          if (table?.documentName !== 'RollTable') throw Error('Выберите таблицу Foundry');
        }
        const old = t.entries.find(e => e.id === data.id);
        if (!old && data.documentId && data.tableUuid) throw Error('Выберите либо готовый файл, либо таблицу');
        const entry = { id: old?.id || D.uid(), title: String(data.title ?? '').trim().slice(0, 160),
          kind: data.kind === 'email' ? 'email' : 'file', published: Boolean(data.published),
          documentId: data.documentId || old?.documentId || null, tableUuid: data.tableUuid || null };
        if (!entry.title || (!entry.documentId && !entry.tableUuid)) throw Error('Выберите файл или таблицу');
        old ? Object.assign(old, entry) : t.entries.push(entry); return entry.id;
      }
      case 'openEntry': {
        const t = state.terminals?.[data.terminalId], entry = t?.entries.find(e => e.id === data.entryId);
        if (!D.terminalAllowed(t, user, user.viewedScene) || !entry || (!user.isGM && !entry.published)) throw Error('Нет доступа к файлу терминала');
        if (!entry.documentId && entry.tableUuid) {
          const table = await fromUuid(entry.tableUuid);
          if (!table?.roll) throw Error('Таблица больше недоступна');
          const draw = await table.roll();
          const body = (draw.results ?? []).map(r => String(r.text ?? '')).join('\n\n');
          entry.documentId = D.createDocument(state, { title: entry.title, body, source: t.title }).id;
        }
        return entry.documentId;
      }
      case 'schedule': {
        requireGM(user); D.ownDevice(state, data.from, user);
        if (!state.devices[data.to] || !String(data.text ?? '').trim()) throw Error('Укажите получателя и текст');
        const minutes = Number(data.minutes);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) throw Error('Задержка: от 1 минуты до года');
        const clock = data.clock === 'world' ? 'world' : 'real';
        const entry = { id: D.uid(), from: data.from, to: data.to, text: String(data.text).slice(0, 2000), clock,
          due: (clock === 'world' ? game.time.worldTime : Date.now() / 1000) + minutes * 60, status: 'pending' };
        (state.scheduled ??= []).push(entry); return entry.id;
      }
      case 'cancelSchedule': {
        requireGM(user); const entry = state.scheduled?.find(e => e.id === data.id);
        if (entry?.status === 'pending') entry.status = 'cancelled'; return true;
      }
      default: throw Error('Неизвестная операция');
    }
  });
}
export async function deliverScheduled() {
  if (!game.users.activeGM?.isSelf || !readState().scheduled?.some(e => e.status === 'pending' && e.due <= (e.clock === 'world' ? game.time.worldTime : Date.now() / 1000))) return false;
  return mutate(state => {
    let changed = false;
    for (const e of state.scheduled ?? []) {
      if (e.status !== 'pending' || e.due > (e.clock === 'world' ? game.time.worldTime : Date.now() / 1000)) continue;
      if (!state.devices[e.from] || !state.devices[e.to]) { e.status = 'unavailable'; changed = true; continue; }
      M.pushMessage(state, e.from, e.to, e.text); e.status = 'sent'; changed = true;
    }
    return changed;
  });
}
