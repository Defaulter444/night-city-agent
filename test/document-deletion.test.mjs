import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../scripts/model.mjs';
import * as D from '../scripts/documents-model.mjs';
import {runDocumentOperation} from '../scripts/documents-service.mjs';
import {readState} from '../scripts/store.mjs';
import {seal,unseal,newRecoveryKey} from '../scripts/vault.mjs';

const gm={id:'gm',isGM:true,active:true},p={id:'p',active:true,viewedScene:'scene'},q={id:'q',active:true,viewedScene:'scene'};
const users=[gm,p,q];users.get=id=>users.find(u=>u.id===id);users.activeGM=gm;
let stored,failWrite=false;
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:gm,users,actors:[],time:{worldTime:0},settings:{get:(_m,key)=>key==='state'?stored:undefined,set:async(_m,_key,value)=>{if(failWrite)throw Error('disk rejected');stored=structuredClone(value);}}};
function fixture(){
  failWrite=false;stored=M.blankState();M.addDevice(stored,{num:'1111-1111',owner:p.id});M.addDevice(stored,{num:'2222-2222',owner:q.id});
  const doc=D.createDocument(stored,{title:'Улика',body:'СЕКРЕТНЫЙ ТЕКСТ',source:'Кироси',authorId:p.id,holders:['1111-1111'],readers:[],images:[{name:'Улика.png',src:'data:image/png;base64,aGVsbG8='}]},1000);
  D.attachDocument(stored,{from:'1111-1111',to:'2222-2222',documentId:doc.id},p);
  stored.terminals={t:{id:'t',title:'Архив',portable:true,users:[q.id],entries:[{id:'entry',title:'Улика',documentId:doc.id,published:true}]}};
  stored.os={fileMeta:{'2222-2222':{[doc.id]:{folder:'Дело',tags:['улика'],favorite:true}}}};
  doc.carriers=['Actor.a.Item.i'];return doc.id;
}
const run=(op,id,by='p',extra={})=>runDocumentOperation({op,documentId:id,...extra},by);

test('author deletion revokes document content from recipients and preserves references, images, metadata and exact restoration',async()=>{
  const id=fixture(),before=structuredClone(stored),original=structuredClone(stored.documents[id]);
  await run('deleteDocument',id);await run('deleteDocument',id);
  const state=readState();assert.equal(state.documents[id],undefined);assert.equal(state.documentTrash[id].authorId,'p');
  for(const field of ['devices','threads','terminals','os'])assert.deepEqual(state[field],before[field]);
  const recipient=D.projectState(state,q,'scene');assert.equal(recipient.documents[id],undefined);assert.equal(recipient.documentTrash[id],undefined);
  assert.equal(JSON.stringify(recipient).includes('СЕКРЕТНЫЙ ТЕКСТ'),false);
  assert.equal(D.projectState(state,p).documentTrash[id].canRestore,true);
  await assert.rejects(run('createDocument',id,'p',{id,title:'Устаревшая правка'}),/не найден/);
  await assert.rejects(run('sendDocument',id,'q',{from:'2222-2222',to:'1111-1111'}),/доступ/);
  await assert.rejects(run('saveDocument',id,'q',{number:'2222-2222'}),/доступ/);
  await run('restoreDocument',id);await run('restoreDocument',id);
  assert.deepEqual(readState().documents[id],original);assert.equal(readState().documentTrash[id],undefined);
  assert.equal(D.projectState(readState(),q).documents[id].body,'СЕКРЕТНЫЙ ТЕКСТ');
});

test('readers cannot delete or restore shared files, even with forged author, GM or holder fields',async()=>{
  const id=fixture(),before=structuredClone(stored);
  await assert.rejects(run('deleteDocument',id,'q',{authorId:'q',senderId:'gm',isGM:true}),/автор или Мастер/);
  await assert.rejects(run('deleteDocument',id,'missing'),/не найден/);assert.deepEqual(stored,before);
  await run('deleteDocument',id,'gm');const removed=structuredClone(stored);
  await assert.rejects(run('restoreDocument',id,'q',{authorId:'q',senderId:'gm',isGM:true}),/автор или Мастер/);
  assert.deepEqual(stored,removed);await run('restoreDocument',id,'gm');assert.ok(stored.documents[id]);
  const legacy=D.createDocument(stored,{title:'Старый файл',body:'Текст',holders:['2222-2222']});
  await assert.rejects(run('deleteDocument',legacy.id,'q'),/автор или Мастер/);await run('deleteDocument',legacy.id,'gm');
});

test('personal removal affects only the authenticated reader and attachments remain readable',async()=>{
  const id=fixture(),before=structuredClone(stored.documents[id]);
  await run('hideDocument',id,'q',{userId:'p',number:'1111-1111'});
  assert.equal(D.documentHidden(stored,id,q),true);assert.equal(D.documentHidden(stored,id,p),false);
  assert.deepEqual(stored.documents[id],before);assert.equal(D.canReadDocument(stored,stored.documents[id],q),true);
  assert.equal(D.removedDocuments(D.projectState(stored,q),q)[0].removal,'personal');
  assert.equal(D.projectState(stored,p).documentHidden.q,undefined);
  await run('showDocument',id,'q');assert.equal(D.documentHidden(stored,id,q),false);
  const secret=D.createDocument(stored,{title:'Тайный',body:'Текст',authorId:'gm'});
  await assert.rejects(run('hideDocument',secret.id,'q'),/недоступен/);
});

test('failed writes roll back deletion, restoration and personal removal; hostile IDs cannot touch prototypes',async()=>{
  const id=fixture();let before=structuredClone(stored);failWrite=true;
  for(const [op,by] of [['deleteDocument','p'],['hideDocument','q']]){await assert.rejects(run(op,id,by),/disk rejected/);assert.deepEqual(stored,before);}
  failWrite=false;await run('deleteDocument',id);before=structuredClone(stored);failWrite=true;
  await assert.rejects(run('restoreDocument',id),/disk rejected/);assert.deepEqual(stored,before);failWrite=false;
  for(const op of ['deleteDocument','restoreDocument','hideDocument','showDocument'])for(const key of ['__proto__','constructor','prototype'])await assert.rejects(run(op,key,'gm'),/идентификатор/);
  assert.deepEqual(stored,before);
});

test('deleted terminal files do not redraw random tables, and personal removal survives global deletion and restore',async()=>{
  const id=fixture();let rolls=0;globalThis.fromUuid=async()=>({roll(){rolls++;return{results:[]};}});
  stored.terminals.t.entries[0].tableUuid='RollTable.x';
  await run('hideDocument',id,'q');await run('deleteDocument',id);
  await assert.rejects(runDocumentOperation({op:'openEntry',terminalId:'t',entryId:'entry'},'q'),/удалён/);assert.equal(rolls,0);
  await run('restoreDocument',id);
  assert.equal(await runDocumentOperation({op:'openEntry',terminalId:'t',entryId:'entry'},'q'),id);assert.equal(rolls,0);
  assert.equal(D.documentHidden(readState(),id,q),true);
});

test('deleted documents and personal removals survive encrypted backup with recipient privacy intact',async()=>{
  const id=fixture();await run('hideDocument',id,'q');await run('deleteDocument',id);
  const state=readState(),key=newRecoveryKey(),restored=await unseal(await seal(state,key),key);
  assert.deepEqual(restored,state);assert.equal(D.projectState(restored,q).documentTrash[id],undefined);
  assert.equal(D.projectState(restored,p).documentTrash[id].images[0].name,'Улика.png');
});
