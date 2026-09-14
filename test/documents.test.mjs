import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../scripts/model.mjs'; import * as D from '../scripts/documents-model.mjs';
import {seal,unseal,newRecoveryKey} from '../scripts/vault.mjs';
import {runDocumentOperation,deliverScheduled} from '../scripts/documents-service.mjs';
import * as S from '../scripts/store.mjs';
const gm={id:'gm',isGM:true,active:true,isSelf:true}, p={id:'p',active:true,viewedScene:'scene'}, q={id:'q',active:true};
const users=[gm,p,q];users.get=id=>users.find(u=>u.id===id);users.has=id=>Boolean(users.get(id));users.activeGM=gm;
let data=new Map(),failKey=null; const local=new Map();
globalThis.localStorage={getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v)};
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:gm,users,world:{id:'test'},actors:[],scenes:new Map([['scene',{}]]),time:{worldTime:0},settings:{
 get:(_m,k)=>data.get(k),set:async(_m,k,v)=>{await Promise.resolve();if(k===failKey)throw Error('disk rejected');data.set(k,structuredClone(v));return v;}}};
const fixture=()=>{const s=M.blankState();M.addDevice(s,{num:'1111-1111',owner:'p'});M.addDevice(s,{num:'2222-2222',owner:'q'});M.addDevice(s,{num:'3333-3333'});M.setBookName(s,'1111-1111','2222-2222','Друг');M.pushMessage(s,'1111-1111','2222-2222','Привет');s.extra={mission:['совместимость']};return s;};
test('encryption preserves unicode and large histories, rejects tampering and wrong key',async()=>{
 const value={text:'🔒 Привет\n'.repeat(90000)},key=newRecoveryKey(),v=await seal(value,key);assert.deepEqual(await unseal(v,key),value);assert.equal(v.data.includes('Привет'),false);await assert.rejects(unseal(v,newRecoveryKey()));const damaged={...v,data:(v.data[0]==='A'?'B':'A')+v.data.slice(1)};await assert.rejects(unseal(damaged,key));
});
test('projection excludes hidden missions, books, original corrupted text and schedules',()=>{
 const s=fixture();M.pushMessage(s,'2222-2222','3333-3333','SECRET');s.devices['2222-2222'].book={secret:'SECRET_BOOK'};s.threads[M.threadKey('1111-1111','2222-2222')][0].o='ORIGINAL';s.scheduled=[{text:'FUTURE'}];
 const projection=D.projectState(s,p,'scene');const json=JSON.stringify(projection);for(const marker of ['SECRET','ORIGINAL','FUTURE','extra'])assert.ok(!json.includes(marker));assert.equal(projection.devices['1111-1111'].book['2222-2222'],'Друг');
});
test('terminal visibility requires both user and current scene; unpublished files remain hidden',()=>{
 const s=fixture(),doc=D.createDocument(s,{title:'Evidence',body:'Content'});s.terminals={t:{id:'t',sceneId:'scene',users:['p'],entries:[{id:'e',documentId:doc.id,published:false}]}};
 assert.equal(D.canReadDocument(s,doc,p,'scene'),false);s.terminals.t.entries[0].published=true;assert.equal(D.canReadDocument(s,doc,p,'scene'),true);assert.equal(D.canReadDocument(s,doc,p,'other'),false);assert.equal(D.canReadDocument(s,doc,q,'scene'),false);
});
test('document transfer grants recipient access without changing legacy messages',()=>{
 const s=fixture(),before=structuredClone(s),doc=D.createDocument(s,{title:'File',body:'Text',holders:['1111-1111']});
 assert.throws(()=>D.attachDocument(s,{from:'1111-1111',to:'2222-2222',documentId:doc.id},q));D.attachDocument(s,{from:'1111-1111',to:'2222-2222',documentId:doc.id},p);assert.equal(D.canReadDocument(s,doc,q),true);assert.deepEqual(s.threads[M.threadKey('1111-1111','2222-2222')][0],before.threads[M.threadKey('1111-1111','2222-2222')][0]);
});
test('drafts, pins and tags are per-device, preserve text and reject another owner',()=>{
 const s=fixture();D.organize(s,{number:'1111-1111',other:'2222-2222',draft:'не отправлено',tags:['Заказ','Заказ'],pin:0},p);assert.deepEqual(s.organizer['1111-1111'].tags['2222-2222'],['Заказ']);assert.equal(D.projectState(s,q).organizer['1111-1111'],undefined);assert.throws(()=>D.organize(s,{number:'1111-1111',draft:'overwrite'},q));
});
test('carrier access follows actual owned and carried item, not just forged flags',()=>{
 const s=fixture(),doc=D.createDocument(s,{title:'Carrier',body:'x'});doc.carriers=['Actor.a.Item.i'];const item={uuid:'Actor.a.Item.i',name:'Memory Chip',type:'gear',system:{equipped:'carried',amount:1},flags:{'night-city-agent':{documents:[doc.id]}}};game.actors=[{testUserPermission:u=>u.id==='p',items:[item]}];assert.equal(D.canReadDocument(s,doc,p),true);assert.equal(D.canReadDocument(s,doc,q),false);item.system.equipped='stored';assert.equal(D.canReadDocument(s,doc,p),false);game.actors=[];
});
test('service edits retain document IDs, terminal clones retain content, random content generated once',async()=>{
 data=new Map([['state',fixture()]]);const op=(op,data={})=>runDocumentOperation({op,...data},'gm');
 const id=await op('createDocument',{title:'Before',body:'body'});await op('createDocument',{id,title:'After',body:'edited'});assert.equal(Object.keys(S.readState().documents).length,1);assert.equal(S.readState().documents[id].body,'edited');
 const t=await op('terminal',{title:'A',portable:true,users:['p']});await op('terminalEntry',{terminalId:t,title:'File',documentId:id,published:true});const copy=await op('terminal',{templateId:t,title:'B',portable:true});assert.equal(S.readState().terminals[copy].entries[0].documentId,id);assert.notEqual(S.readState().terminals[copy].entries[0].id,S.readState().terminals[t].entries[0].id);
 let rolls=0;globalThis.fromUuid=async()=>({documentName:'RollTable',roll:async()=>{rolls++;await new Promise(r=>setTimeout(r,3));return{results:[{text:'shared result'}]};}});
 const e=await op('terminalEntry',{terminalId:t,title:'Random',tableUuid:'RollTable.x',published:true});const ids=await Promise.all(Array.from({length:6},()=>runDocumentOperation({op:'openEntry',terminalId:t,entryId:e},'p')));assert.equal(rolls,1);assert.equal(new Set(ids).size,1);
 await assert.rejects(runDocumentOperation({op:'createDocument',id,title:'hack',number:'1111-1111'},'p'));
});
test('scheduled messages deliver exactly once at the chosen world time',async()=>{
 data=new Map([['state',fixture()]]);game.time.worldTime=10;await runDocumentOperation({op:'schedule',from:'3333-3333',to:'1111-1111',text:'Later',minutes:1,clock:'world'},'gm');await deliverScheduled();assert.equal(S.readState().scheduled[0].status,'pending');game.time.worldTime=70;await Promise.all([deliverScheduled(),deliverScheduled()]);assert.equal(S.readState().threads[M.threadKey('3333-3333','1111-1111')].length,1);assert.equal(S.readState().scheduled[0].status,'sent');
});
test('failed backup or failed durable vault write never clears legacy state',async()=>{
 data=new Map([['state',fixture()]]);const before=structuredClone(S.readState());await assert.rejects(S.enableProtection(async()=>{throw Error('export cancelled');}));assert.deepEqual(S.readState(),before);assert.ok(!S.protectedStorage());failKey='vault';await assert.rejects(S.enableProtection(async()=>{}));failKey=null;assert.deepEqual(S.readState(),before);assert.ok(!S.protectedStorage());
});
test('migration serializes with concurrent sends and keeps a verified recovery snapshot',async()=>{
 data=new Map([['state',fixture()]]);const before=structuredClone(S.readState());let release,started;const exporting=new Promise(r=>started=r);let bundle;
 const migration=S.enableProtection(async b=>{bundle=b;started();await new Promise(r=>release=r);});await exporting;const message=S.mutate(s=>M.pushMessage(s,'1111-1111','2222-2222','during migration'));release();await Promise.all([migration,message]);assert.deepEqual(bundle.backup,before);assert.equal(S.readState().threads[M.threadKey('1111-1111','2222-2222')].at(-1).x,'during migration');assert.deepEqual(data.get('state'),M.blankState());const payload=await unseal(data.get('vault'),bundle.key);assert.deepEqual(payload.backup,before);assert.deepEqual(payload.state,S.readState());
 const wrong={...bundle,key:newRecoveryKey()};await assert.rejects(S.importRecovery(wrong));assert.equal(S.readState().extra.mission[0],'совместимость');await S.importRecovery(bundle);assert.equal(S.storageLocked(),false);
});
