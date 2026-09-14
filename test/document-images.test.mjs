import test from 'node:test';
import assert from 'node:assert/strict';
import { documentImages, MAX_DOCUMENT_IMAGES } from '../scripts/document-images.mjs';
import { MAX_BYTES } from '../scripts/images.mjs';
import * as M from '../scripts/model.mjs';
import * as D from '../scripts/documents-model.mjs';
import * as S from '../scripts/store.mjs';
import { runDocumentOperation } from '../scripts/documents-service.mjs';
import { seal, unseal, newRecoveryKey } from '../scripts/vault.mjs';

const png = { name: 'План склада.png', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=' };
const gif = { name: 'Маяк.gif', src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
const gm = { id: 'gm', isGM: true }, player = { id: 'p', viewedScene: 'scene' }, recipient = { id: 'q', viewedScene: 'scene' }, outsider = { id: 'x' };
const users = [gm, player, recipient, outsider]; users.get = id => users.find(u => u.id === id); users.has = id => Boolean(users.get(id)); users.activeGM = gm;
let settings = new Map();
globalThis.foundry = { utils: { deepClone: structuredClone } };
globalThis.game = { user: gm, users, actors: [], world: { id: 'document-images' }, scenes: new Map(), settings: {
  get: (_m, key) => settings.get(key), set: async (_m, key, value) => { settings.set(key, structuredClone(value)); return value; }
} };
const fixture = () => {
  const state = M.blankState();
  M.addDevice(state, { num: '1111-1111', owner: 'p' }); M.addDevice(state, { num: '2222-2222', owner: 'q' });
  M.setBookName(state, '1111-1111', '2222-2222', 'Фиксер'); M.pushMessage(state, '1111-1111', '2222-2222', 'Текущая миссия');
  state.extra = { mission: 'untouched' }; settings = new Map([['state', state]]); return structuredClone(state);
};
const op = (data, user = 'gm') => runDocumentOperation({ op: 'createDocument', ...data }, user);

test('valid image lists are copied and bounded; unknown attachment metadata is discarded', () => {
  assert.deepEqual(documentImages(), []);
  const input = [{ ...png, name: '  План склада.png ', readers: ['x'] }, gif];
  const result = documentImages(input); assert.deepEqual(result, [png, gif]);
  result[0].name = 'changed'; assert.notEqual(input[0].name, 'changed');
  for (const value of [null, 'path.png', {}, [null], [{ src: 'https://example.com/private.png' }], [{ src: 'data:image/svg+xml;base64,AAAA' }], [{ src: 'data:text/html;base64,AAAA' }], [{ src: 'data:image/png;base64,A=AA' }], [{ src: 'data:image/png;base64,AAA' }]]) assert.throws(() => documentImages(value));
  assert.throws(() => documentImages(Array(MAX_DOCUMENT_IMAGES + 1).fill(png)), /до 4/);
});
test('per-image and aggregate byte limits are checked on the receiving side', () => {
  const sized = bytes => ({ name: 'size', src: `data:image/png;base64,${Buffer.alloc(bytes).toString('base64')}` });
  const max = sized(MAX_BYTES); assert.equal(documentImages([max, max]).length, 2);
  assert.throws(() => documentImages([sized(MAX_BYTES + 1)]), /тяжелее/);
  assert.throws(() => documentImages([max, max, png]), /8 МБ/);
});
test('old documents and mission data retain their exact structure without a migration', async () => {
  const before = fixture();
  const id = await op({ title: 'Старый файл', body: 'Текст', number: '1111-1111' });
  const doc = S.readState().documents[id]; assert.equal(Object.hasOwn(doc, 'images'), false);
  await op({ id, title: 'Обновлённый текст', body: 'Новый текст' });
  assert.equal(Object.hasOwn(S.readState().documents[id], 'images'), false);
  D.assertLegacyPreserved(before, S.readState()); assert.deepEqual(S.readState().extra, before.extra);
});
test('create, text-only edit, replacement, deletion and failed edits preserve document identity and access', async () => {
  const before = fixture();
  const id = await op({ title: 'Разведданные', images: [png], number: '1111-1111' }, 'p');
  const initial = structuredClone(S.readState().documents[id]);
  await op({ id, title: 'План', body: 'Вход со двора' }); assert.deepEqual(S.readState().documents[id].images, [png]);
  await op({ id, title: 'План', body: 'Вход со двора', images: [gif] }); assert.deepEqual(S.readState().documents[id].images, [gif]);
  const unchanged = structuredClone(S.readState());
  await assert.rejects(op({ id, title: 'Invalid', images: [{ src: 'javascript:alert(1)' }] }));
  await assert.rejects(op({ id, title: 'Forged edit', number: '2222-2222', images: [] }, 'q'), /мастера/);
  await assert.rejects(op({ title: 'Forged holder', number: '1111-1111', images: [png] }, 'q'), /устройство/);
  assert.deepEqual(S.readState(), unchanged);
  await op({ id, title: 'План', images: [] });
  const after = S.readState().documents[id]; assert.deepEqual(after.images, []);
  for (const key of ['id', 'holders', 'readers', 'createdAt']) assert.deepEqual(after[key], initial[key]);
  assert.equal(Object.keys(S.readState().documents).length, 1); D.assertLegacyPreserved(before, S.readState());
});
test('forwarding exposes the complete file only to its recipient and keeps legacy messages', async () => {
  const before = fixture(); const id = await op({ title: 'Evidence', number: '1111-1111', images: [png, gif] }, 'p');
  assert.equal(D.projectState(S.readState(), recipient).documents[id], undefined);
  await runDocumentOperation({ op: 'sendDocument', from: '1111-1111', to: '2222-2222', documentId: id }, 'p');
  const state = S.readState(), view = D.projectState(state, recipient);
  assert.deepEqual(view.documents[id].images, [png, gif]); assert.equal(view.documents[id].holders, undefined);
  assert.equal(D.projectState(state, outsider).documents[id], undefined);
  view.documents[id].images[0].name = 'client mutation'; assert.equal(state.documents[id].images[0].name, png.name);
  assert.deepEqual(state.threads['1111-1111|2222-2222'][0], before.threads['1111-1111|2222-2222'][0]);
});
test('terminal publication and carried media grant and revoke images with document access', () => {
  const state = fixture(), doc = D.createDocument(state, { title: 'Terminal image', images: [png] });
  (state.terminals ??= {}).t = { id: 't', portable: false, sceneId: 'scene', users: ['p'], entries: [{ id: 'e', documentId: doc.id, published: false }] };
  assert.equal(D.projectState(state, player, 'scene').documents[doc.id], undefined);
  state.terminals.t.entries[0].published = true;
  assert.deepEqual(D.projectState(state, player, 'scene').documents[doc.id].images, [png]);
  assert.equal(D.projectState(state, player, 'other').documents[doc.id], undefined);
  state.terminals.t.entries[0].published = false;
  const item = { uuid: 'Actor.a.Item.i', name: 'Memory Chip', type: 'gear', system: { amount: 1, equipped: 'carried' }, flags: { 'night-city-agent': { documents: [doc.id] } } };
  doc.carriers = [item.uuid]; game.actors = [{ testUserPermission: u => u.id === 'p', items: [item] }];
  assert.deepEqual(D.projectState(state, player).documents[doc.id].images, [png]);
  item.system.equipped = 'stored'; assert.equal(D.projectState(state, player).documents[doc.id], undefined); game.actors = [];
});
test('encrypted storage and recovery retain image bytes, Unicode names and existing contacts', async () => {
  fixture(); const id = await op({ title: 'Шифрованный план', images: [png, gif], number: '1111-1111' });
  const state = structuredClone(S.readState()), key = newRecoveryKey();
  const sealed = await seal({ state, backup: state }, key);
  assert.equal(JSON.stringify(sealed).includes(png.src), false);
  assert.deepEqual((await unseal(sealed, key)).state.documents[id].images, [png, gif]);
  const local = new Map(); globalThis.localStorage = { getItem: k => local.get(k), setItem: (k, v) => local.set(k, v) };
  let recovery; await S.enableProtection(async bundle => { recovery = bundle; });
  assert.deepEqual(settings.get('state'), M.blankState()); assert.deepEqual(S.readState(), state);
  await op({ id, title: 'После переноса', images: [gif] });
  await S.importRecovery(recovery); assert.deepEqual(S.readState().documents[id].images, [gif]);
  assert.deepEqual(S.readState().devices, state.devices); assert.deepEqual(S.readState().threads, state.threads);
});
