import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../scripts/model.mjs';
import * as D from '../scripts/documents-model.mjs';
import * as C from '../scripts/conferences-model.mjs';
import * as S from '../scripts/store.mjs';
import { runConferenceOperation } from '../scripts/conferences-service.mjs';
import { runNoteOperation, notePage, privateNoteOwnership } from '../scripts/notes.mjs';
import { npcIncoming } from '../scripts/incoming.mjs';
import { seal, unseal, newRecoveryKey } from '../scripts/vault.mjs';

const gm={id:'gm',name:'Мастер',isGM:true,active:true}, p={id:'p',name:'Ви',active:true}, q={id:'q',name:'Джуди',active:true}, x={id:'x',name:'Посторонний',active:true};
const users=[gm,p,q,x];users.get=id=>users.find(u=>u.id===id);users.activeGM=gm;
let settings, journals, failMapping, failPage, serial=0;
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:gm,users,actors:[],world:{id:'test'},settings:{
  get:(_m,k)=>settings.get(k),set:async(_m,k,v)=>{await Promise.resolve();if(failMapping&&k==='noteJournals')throw Error('mapping failed');settings.set(k,structuredClone(v));return v;}
}};
globalThis.JournalEntry={create:async data=>{
  await Promise.resolve();const id=`journal${++serial}`;
  const j={id,...structuredClone(data),pages:{contents:data.pages.map(p=>({...p,id:`page${++serial}`}))},
    async delete(){journals.delete(id);},async update(value){Object.assign(this,structuredClone(value));},
    async createEmbeddedDocuments(type,pages){assert.equal(type,'JournalEntryPage');if(failPage)throw Error('page failed');const result=pages.map(p=>({...p,id:`page${++serial}`}));this.pages.contents.push(...result);return result;}};
  journals.set(id,j);return j;
}};
const nums={p:'1111-1111',q:'2222-2222',npc:'3333-3333',x:'4444-4444',gm:'5555-5555'};
function reset(){
  const s=M.blankState();for(const [owner,num] of Object.entries(nums))M.addDevice(s,{num,owner:owner==='npc'?null:owner});
  M.setBookName(s,nums.p,nums.q,'Джуди');M.pushMessage(s,nums.p,nums.q,'До обновления');s.mission={id:'same'};
  settings=new Map([['state',s],['noteJournals',{}]]);journals=new Map();game.journal=journals;failMapping=false;failPage=false;return structuredClone(s);
}
const group=(op,data={},user='p')=>runConferenceOperation({op,...data},user);
const create=()=>group('create',{number:nums.p,title:'Команда',members:[nums.q,nums.npc]});
const png='data:image/png;base64,aGVsbG8=';

test('player and GM can create conferences, but cannot spoof another device',async()=>{
  const before=reset(),id=await create();assert.deepEqual(S.readState().conferences[id].members,[nums.p,nums.q,nums.npc]);
  await group('create',{number:nums.npc,title:'Брифинг',members:[nums.p,nums.q]},'gm');
  await assert.rejects(group('create',{number:nums.npc,title:'Spoof',members:[nums.p]}));
  await assert.rejects(group('create',{number:nums.p,title:'Invalid',members:['not-real']}));
  D.assertLegacyPreserved(before,S.readState());assert.deepEqual(S.readState().mission,before.mission);
});
test('only members can send, and only creator/GM can change participants',async()=>{
  reset();const id=await create();
  await group('send',{id,number:nums.q,text:'Ответ'},'q');await group('send',{id,number:nums.npc,text:'НПС'},'gm');
  await assert.rejects(group('send',{id,number:nums.p,text:'Подмена'},'q'));
  await assert.rejects(group('send',{id,number:nums.x,text:'Чужой'},'x'));
  await assert.rejects(group('edit',{id,title:'Захват',members:[nums.q,nums.x]},'q'));
  assert.equal(S.readState().conferences[id].messages.length,2);
});
test('projection filters conference history and drafts; read cursors are independent even in the same millisecond',async()=>{
  reset();const id=await create();await group('draft',{id,number:nums.p,text:'Личный черновик'});
  const s=S.readState();C.sendConference(s,{id,number:nums.p,text:'first'},p,100);C.sendConference(s,{id,number:nums.p,text:'second'},p,100);
  assert.equal(C.conferenceUnread(s.conferences[id],nums.q),2);
  C.markConferenceRead(s,{id,number:nums.q,through:1},q);assert.equal(C.conferenceUnread(s.conferences[id],nums.q),1);
  assert.equal(C.conferenceUnread(s.conferences[id],nums.npc),2);
  const view=D.projectState(s,q);assert.equal(view.conferences[id].drafts[nums.p],undefined);assert.equal(view.conferences[id].read[nums.npc],undefined);
  assert.equal(D.projectState(s,x).conferences[id],undefined);
  assert.throws(()=>C.markConferenceRead(s,{id,number:nums.q,through:999},q));
});
test('files and pictures follow membership; removal revokes access and cannot re-use another sender',async()=>{
  reset();const id=await create();const doc=await S.mutate(s=>D.createDocument(s,{title:'План',holders:[nums.p],images:[{name:'x',src:png}]}).id);
  await group('send',{id,number:nums.p,documentId:doc});await group('send',{id,number:nums.p,image:png});
  assert.equal(D.projectState(S.readState(),q).documents[doc].images[0].src,png);
  assert.equal(D.projectState(S.readState(),x).documents[doc],undefined);
  await group('edit',{id,title:'Команда',members:[nums.p,nums.npc]});
  assert.equal(D.projectState(S.readState(),q).documents[doc],undefined);
  assert.equal(D.projectState(S.readState(),q).conferences[id],undefined);
  await assert.rejects(group('send',{id,number:nums.q,text:'После удаления'},'q'));
  await group('edit',{id,title:'Команда',members:[nums.p,nums.q,nums.npc]});
  assert.equal(D.projectState(S.readState(),q).conferences[id].messages.length,2);
  await group('leave',{id,number:nums.q},'q');assert.equal(D.projectState(S.readState(),q).conferences[id],undefined);
});
test('hidden files, invalid images and failed writes never append a message or grant access',async()=>{
  reset();const id=await create();const doc=await S.mutate(s=>D.createDocument(s,{title:'GM only'}).id),before=structuredClone(S.readState());
  await assert.rejects(group('send',{id,number:nums.p,documentId:doc}));await assert.rejects(group('send',{id,number:nums.p,image:'data:text/html;base64,AAAA'}));
  assert.deepEqual(S.readState(),before);
  const set=game.settings.set;game.settings.set=async()=>{throw Error('disk');};
  try{await assert.rejects(group('send',{id,number:nums.p,text:'Failed'}));}finally{game.settings.set=set;}
  assert.deepEqual(S.readState(),before);
});
test('device removal and transfer change access without deleting group history',async()=>{
  reset();const id=await create();await group('send',{id,number:nums.p,text:'Saved'});
  await S.mutate(s=>M.transferDevice(s,nums.q,'x'));
  assert.equal(D.projectState(S.readState(),q).conferences[id],undefined);assert.ok(D.projectState(S.readState(),x).conferences[id]);
  await S.mutate(s=>M.removeDevice(s,nums.q));assert.equal(D.projectState(S.readState(),x).conferences[id],undefined);assert.equal(S.readState().conferences[id].messages[0].x,'Saved');
});
test('conference history, read positions and drafts survive encryption and roundtrip',async()=>{
  reset();const id=await create();await group('send',{id,number:nums.p,text:'Привет',image:png});await group('draft',{id,number:nums.q,text:'Ответ'},'q');
  const key=newRecoveryKey(),value=structuredClone(S.readState()),restored=await unseal(await seal(value,key),key);assert.deepEqual(restored,value);assert.ok(D.projectState(restored,q).conferences[id]);
});
test('notes create one private journal per user and append separate pages under concurrent calls',async()=>{
  const before=reset();const [a,b,c]=await Promise.all([
    runNoteOperation({op:'create',number:nums.p,title:'Раз',body:'Текст'},'p'),
    runNoteOperation({op:'create',number:nums.p,title:'Два',body:'Продолжение'},'p'),
    runNoteOperation({op:'create',number:nums.q,title:'Три',body:'Другое'},'q')]);
  assert.equal(a.journalId,b.journalId);assert.notEqual(a.journalId,c.journalId);assert.equal(journals.size,2);
  assert.deepEqual(journals.get(a.journalId).ownership,privateNoteOwnership('p'));assert.equal(journals.get(a.journalId).pages.contents.length,2);
  assert.deepEqual(journals.get(a.journalId).pages.contents.map(p=>p.sort),[100000,200000]);
  assert.equal(settings.get('noteJournals').p,a.journalId);assert.equal(settings.get('noteJournals').q,c.journalId);assert.deepEqual(S.readState(),before);
});
test('note ownership cannot be forged; journal privacy is restored; HTML is escaped',async()=>{
  reset();await assert.rejects(runNoteOperation({op:'create',number:nums.q,title:'X',body:'X',owner:'q'},'p'));
  const a=await runNoteOperation({op:'create',number:nums.p,title:'За игрока',body:'<script>bad</script>\nДалее',owner:'x'},'gm');
  const j=journals.get(a.journalId);assert.deepEqual(j.ownership,{default:0,p:3});assert.match(j.pages.contents[0].text.content,/&lt;script&gt;/);assert.ok(!j.pages.contents[0].text.content.includes('<script>'));
  j.ownership={default:2,p:3,x:3};await runNoteOperation({op:'open',number:nums.p},'p');assert.deepEqual(j.ownership,{default:0,p:3});
  assert.throws(()=>notePage('','text'));assert.throws(()=>notePage('title',''));
});
test('note mapping failure rolls back only the newly-created journal; page failure retains old notes',async()=>{
  reset();failMapping=true;await assert.rejects(runNoteOperation({op:'create',number:nums.p,title:'Fail',body:'Text'},'p'));assert.equal(journals.size,0);assert.deepEqual(settings.get('noteJournals'),{});
  failMapping=false;const a=await runNoteOperation({op:'create',number:nums.p,title:'Saved',body:'Text'},'p');failPage=true;
  await assert.rejects(runNoteOperation({op:'create',number:nums.p,title:'Fail',body:'More'},'p'));assert.equal(journals.get(a.journalId).pages.contents.length,1);
});
test('personal notes stay with the player when their Agent changes owner',async()=>{
  reset();const a=await runNoteOperation({op:'create',number:nums.p,title:'Before',body:'Personal'},'p');await S.mutate(s=>M.transferDevice(s,nums.p,'q'));
  const b=await runNoteOperation({op:'create',number:nums.p,title:'After',body:'New owner'},'q');assert.notEqual(a.journalId,b.journalId);assert.deepEqual(journals.get(a.journalId).ownership,{default:0,p:3});
});
test('GM alerts include NPCs without owners and GM-owned Agents, never unrelated player conversations or GM messages',()=>{
  const s=reset();assert.deepEqual(npcIncoming(s,users,gm,'p',nums.p,[nums.npc,nums.gm]),[nums.npc,nums.gm]);
  for(const [viewer,sender,recipients] of [[p,'p',[nums.npc]],[gm,'gm',[nums.npc]],[gm,'p',[nums.q]],[gm,'missing',[nums.npc]]])assert.deepEqual(npcIncoming(s,users,viewer,sender,nums.p,recipients),[]);
});
