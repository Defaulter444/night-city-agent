import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../scripts/model.mjs';
import * as D from '../scripts/documents-model.mjs';
import * as S from '../scripts/store.mjs';
import { runDocumentOperation } from '../scripts/documents-service.mjs';
import { seal, unseal, newRecoveryKey } from '../scripts/vault.mjs';

const gm = { id: 'gm', name: 'Мастер', isGM: true, active: true };
const p = { id: 'p', name: 'Автор', active: true }, q = { id: 'q', name: 'Читатель', active: true };
const users = [gm, p, q]; users.get = id => users.find(u => u.id === id); users.activeGM = gm;
let settings, revision = 0;
globalThis.foundry = { utils: { deepClone: structuredClone }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: x => x } } };
globalThis.game = { user: gm, users, actors: [], world: { id: 'test' }, settings: {
  get: (_m, key) => settings.get(key), set: async (_m, key, value) => settings.set(key, structuredClone(value))
} };
const { AgentWorkspace } = await import('../scripts/workspace-app.mjs');
const png = { name: 'План.png', src: 'data:image/png;base64,aGVsbG8=' };
function reset() {
  game.user = gm;
  const state = M.blankState(); state.revision = revision += 100;
  M.addDevice(state, { num: '1111-1111', owner: p.id }); M.addDevice(state, { num: '2222-2222', owner: q.id });
  M.setBookName(state, '1111-1111', '2222-2222', 'Сохранённый контакт');
  M.pushMessage(state, '1111-1111', '2222-2222', 'Текущая миссия');
  settings = new Map([['state', state]]); return structuredClone(state);
}
const edit = (data, caller = 'p') => runDocumentOperation({ op: 'createDocument', ...data }, caller);
const create = () => edit({ title: 'План', body: 'До правки', number: '1111-1111', images: [png] });

test('authenticated author can edit title, text, source and images without changing identity or sharing', async () => {
  const before = reset(), id = await create(), initial = structuredClone(S.readState().documents[id]);
  assert.equal(initial.authorId, p.id);
  await edit({ id, title: 'Новый план', body: 'После правки', source: 'Мои записи' });
  assert.deepEqual(S.readState().documents[id].images, [png]);
  await edit({ id, title: 'Новый план', body: 'После правки', source: 'Мои записи', images: [] });
  const doc = S.readState().documents[id]; assert.deepEqual(doc.images, []); assert.equal(doc.body, 'После правки');
  for (const key of ['id', 'createdAt', 'authorId', 'readers', 'holders']) assert.deepEqual(doc[key], initial[key]);
  D.assertLegacyPreserved(before, S.readState());
});

test('recipients can read and save but cannot edit, claim authorship or spoof edit capability', async () => {
  reset(); const id = await create();
  await runDocumentOperation({ op: 'sendDocument', from: '1111-1111', to: '2222-2222', documentId: id }, p.id);
  await runDocumentOperation({ op: 'saveDocument', number: '2222-2222', documentId: id }, q.id);
  assert.equal(D.projectState(S.readState(), q).documents[id].canEdit, false);
  const before = structuredClone(S.readState());
  for (const payload of [{ canEdit: true }, { authorId: q.id }, { readers: [q.id], holders: ['2222-2222'] }]) {
    await assert.rejects(edit({ id, title: 'Подмена', body: 'Чужая правка', number: '2222-2222', ...payload }, q.id));
  }
  await assert.rejects(edit({ title: 'Подмена автора', number: '2222-2222', authorId: p.id }, q.id));
  assert.deepEqual(S.readState(), before);
});

test('legacy reader/holder combinations never imply authorship; GM can explicitly restore editing', async () => {
  reset(); const id = await S.mutate(s => D.createDocument(s, { title: 'Старый файл', body: 'Содержимое', readers: [p.id], holders: ['1111-1111'], images: [png] }).id);
  assert.equal(D.projectState(S.readState(), p).documents[id].canEdit, false);
  await assert.rejects(edit({ id, title: 'Правка без автора' }));
  const before = structuredClone(S.readState().documents[id]);
  await edit({ id, title: before.title, body: before.body, authorId: p.id }, gm.id);
  assert.deepEqual(S.readState().documents[id], { ...before, authorId: p.id });
  await edit({ id, title: before.title, body: 'Права восстановлены' });
  assert.equal(S.readState().documents[id].body, 'Права восстановлены');
});

test('GM can reassign or revoke authorship; stale clients cannot retain write permission', async () => {
  reset(); const id = await create();
  await edit({ id, title: 'Передан', authorId: q.id }, gm.id);
  assert.equal(D.projectState(S.readState(), q).documents[id].canEdit, true);
  await assert.rejects(edit({ id, title: 'Старая форма' }));
  await edit({ id, title: 'Правка нового автора' }, q.id);
  await edit({ id, title: 'Только мастер', authorId: null }, gm.id);
  await assert.rejects(edit({ id, title: 'Отозванные права' }, q.id));
  const before = structuredClone(S.readState());
  await assert.rejects(edit({ id, title: 'Неизвестный', authorId: 'missing' }, gm.id));
  assert.deepEqual(S.readState(), before);
});

test('device transfer conveys reading, not authorship; author retains access without their old Agent', async () => {
  reset(); const id = await create();
  await S.mutate(s => M.transferDevice(s, '1111-1111', q.id));
  assert.equal(D.projectState(S.readState(), q).documents[id].canEdit, false);
  assert.equal(D.projectState(S.readState(), p).documents[id].canEdit, true);
  await edit({ id, title: 'Правка после передачи устройства' });
  await assert.rejects(edit({ id, title: 'Чужой автор' }, q.id));
});

test('invalid images and failed writes leave previous content and permissions intact', async () => {
  reset(); const id = await create(), before = structuredClone(S.readState());
  await assert.rejects(edit({ id, title: 'Ошибка', images: [{ src: 'javascript:bad' }] }));
  const save = game.settings.set; game.settings.set = async () => { throw Error('disk rejected'); };
  try { await assert.rejects(edit({ id, title: 'Ошибка записи', body: 'Не сохранено' })); }
  finally { game.settings.set = save; }
  assert.deepEqual(S.readState(), before);
});

test('workspace exposes Edit for author and GM, hides it from readers and GM preview', async () => {
  reset(); const id = await create();
  await runDocumentOperation({ op: 'sendDocument', from: '1111-1111', to: '2222-2222', documentId: id }, p.id);
  const state = structuredClone(S.readState());
  for (const [user, expected] of [[p, true], [q, false], [gm, true]]) {
    game.user = user; S.acceptProjection(D.projectState(state, user));
    const app = new AgentWorkspace({ documentId: id });
    assert.equal((await app._prepareContext()).canEditDocument, expected);
  }
  const app = new AgentWorkspace({ documentId: id }); app.previewUser = p.id;
  assert.equal((await app._prepareContext()).canEditDocument, false);
  await assert.rejects(app.perform('editDocument', {}), /просмотра/);
  app.previewUser = null; app.documentId = 'missing';
  await assert.rejects(app.perform('editDocument', {}), /недоступен/);
});

test('recovery roundtrip preserves author rights and does not expand recipient rights', async () => {
  reset(); const id = await create();
  await runDocumentOperation({ op: 'sendDocument', from: '1111-1111', to: '2222-2222', documentId: id }, p.id);
  const key = newRecoveryKey(), restored = await unseal(await seal(S.readState(), key), key);
  assert.equal(D.projectState(restored, p).documents[id].canEdit, true);
  assert.equal(D.projectState(restored, q).documents[id].canEdit, false);
});
