import { MODULE_ID, readState } from './store.mjs';
import { ownDevice } from './documents-model.mjs';
import { esc } from './clock.mjs';

const queues = new Map();
export function noteOwner(state, number, user) {
  const device = ownDevice(state, number, user);
  return user.isGM ? device.owner || user.id : user.id;
}
export const privateNoteOwnership = owner => ({ default: 0, [owner]: 3 });
export function notePage(title, body) {
  title = String(title ?? '').trim().slice(0, 160); body = String(body ?? '').trim().slice(0, 100000);
  if (!title || !body) throw Error('Укажите название и текст заметки');
  return { name: title, type: 'text', sort: 100000, text: { format: 1, content: `<p>${esc(body).replace(/\r?\n/g, '<br>')}</p>` } };
}
/** A GM creates the journal; ordinary players need no world-level Journal creation permission. */
export async function runNoteOperation(data, callerId) {
  const user = game.users.get(callerId);
  if (!user) throw Error('Пользователь не найден');
  const owner = noteOwner(readState(), data.number, user);
  const task = async () => {
    // Ownership may change while a request waits for an earlier journal write.
    if (noteOwner(readState(), data.number, user) !== owner || !game.users.get(owner)) throw Error('Владелец Агента изменился');
    if (!['create', 'open'].includes(data.op)) throw Error('Неизвестная операция с заметками');
    const page = data.op === 'create' ? notePage(data.title, data.body) : null;
    const mapping = game.settings.get(MODULE_ID, 'noteJournals') ?? {};
    let journal = game.journal.get(mapping[owner]);
    if (journal && journal.flags?.[MODULE_ID]?.noteOwner !== owner) throw Error('Связь с личным журналом повреждена');
    if (!journal) {
      if (!page) return null;
      journal = await JournalEntry.create({ name: `Заметки Агента — ${game.users.get(owner).name}`,
        ownership: privateNoteOwnership(owner), flags: { [MODULE_ID]: { noteOwner: owner } }, pages: [page] });
      try {
        // Merge after the await: other players may create their own journals concurrently.
        const fresh = game.settings.get(MODULE_ID, 'noteJournals') ?? {};
        await game.settings.set(MODULE_ID, 'noteJournals', { ...fresh, [owner]: journal.id });
      } catch (error) { await journal.delete(); throw error; }
      return { journalId: journal.id, pageId: journal.pages.contents[0].id };
    }
    // These journals are private even if their owner changed the Foundry permission dialog.
    const ownership = privateNoteOwnership(owner);
    if (JSON.stringify(journal.ownership) !== JSON.stringify(ownership)) await journal.update({ ownership }, { diff: false, recursive: false });
    if (page) page.sort = Math.max(0, ...journal.pages.contents.map(p => Number(p.sort) || 0)) + 100000;
    const created = page ? await journal.createEmbeddedDocuments('JournalEntryPage', [page]) : [];
    return { journalId: journal.id, pageId: created[0]?.id };
  };
  // One queue also serializes the shared journal-id setting across different owners.
  const pending = (queues.get('write') ?? Promise.resolve()).then(task, task);
  queues.set('write', pending.catch(() => {})); return pending;
}

export async function openNoteResult(result) {
  if (!result) { ui.notifications.info('Личных заметок пока нет. Создайте первую заметку в Агенте.'); return; }
  const journal = game.journal.get(result.journalId) ?? await fromUuid(`JournalEntry.${result.journalId}`);
  if (!journal?.testUserPermission(game.user, 'OWNER')) throw Error('Нет доступа к личному журналу');
  journal.sheet.render(true, result.pageId ? { pageId: result.pageId } : {});
}
