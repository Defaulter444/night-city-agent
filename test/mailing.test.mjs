import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../scripts/model.mjs';
import * as D from '../scripts/documents-model.mjs';
import * as S from '../scripts/store.mjs';
import { registerSocket } from '../scripts/socket.mjs';
import { mailingRecipients } from '../scripts/mailing-model.mjs';
import { seal, unseal, newRecoveryKey } from '../scripts/vault.mjs';

const gm={id:'gm',isGM:true,active:true},p={id:'p',active:true},q={id:'q',active:true},r={id:'r',active:true},offline={id:'offline',active:false};
const users=[gm,p,q,r,offline];users.get=id=>users.find(u=>u.id===id);users.activeGM=gm;
let state,delivered,failWrite=false;
globalThis.foundry={utils:{deepClone:structuredClone},applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:x=>x}}};
globalThis.game={user:gm,users,actors:[],socket:{on(){},emit(){}},settings:{
  get:(_m,k)=>k==='state'?state:undefined,
  set:async(_m,_k,value)=>{if(failWrite)throw Error('disk rejected');state=structuredClone(value);}
}};
globalThis.Hooks={callAll(){}};
const socket=registerSocket();
socket.executeForUsers=async(name,ids,payload)=>delivered.push({name,ids,payload});
function reset(){
  failWrite=false;delivered=[];state=M.blankState();game.user=gm;
  for(const [num,owner] of [['1111-1111','p'],['2222-2222','q'],['3333-3333','r'],['4444-4444',null],['5555-5555','offline']])M.addDevice(state,{num,owner});
  M.setBookName(state,'1111-1111','2222-2222','Друг');M.pushMessage(state,'1111-1111','2222-2222','Старая переписка');
  return structuredClone(state);
}
const payload=(extra={})=>({from:'1111-1111',recipients:['2222-2222','3333-3333'],text:'Общее сообщение',operationId:'a'.repeat(32),...extra});
const send=(data=payload(),by='p')=>socket.handlers.get('sendMailing').call({socketdata:{userId:by}},data);

test('mailing writes one personal message per normalized recipient and preserves old data',async()=>{
  const before=reset();const result=await send(payload({recipients:['2222 2222','3333-3333','22222222']}));
  assert.equal(result.count,2);assert.equal(result.replayed,false);
  for(const num of result.recipients){const messages=M.thread(state,'1111-1111',num);assert.equal(messages.at(-1).x,'Общее сообщение');assert.equal(messages.at(-1).t,num);}
  assert.deepEqual(M.thread(state,'1111-1111','2222-2222')[0],M.thread(before,'1111-1111','2222-2222')[0]);
  assert.deepEqual(state.devices,before.devices);assert.deepEqual(state.read,before.read);assert.equal(state.conferences,undefined);
  assert.equal(M.unreadCount(state,'2222-2222','1111-1111'),2);
});

test('all recipients and sender are checked before any mutation',async()=>{
  const before=reset();
  for(const data of [payload({recipients:['2222-2222','9999-9999']}),payload({recipients:[]}),payload({recipients:['1111-1111']}),payload({recipients:'2222-2222'}),payload({recipients:['constructor']}),payload({text:'   '}),payload({operationId:'__proto__'})])await assert.rejects(send(data));
  await assert.rejects(send(payload({from:'4444-4444'})));
  await assert.rejects(send(payload(),'missing'));
  assert.deepEqual(state,before);assert.deepEqual(delivered,[]);
  assert.throws(()=>mailingRecipients(Array.from({length:33},(_,i)=>`6000-${String(i).padStart(4,'0')}`)),/32/);
});

test('GM can send as an NPC; audio-only sender and offline recipient retain normal semantics',async()=>{
  reset();state.devices['4444-4444'].audioOnly=true;
  await send(payload({from:'4444-4444',recipients:['1111-1111','5555-5555']}),'gm');
  assert.equal(M.thread(state,'4444-4444','5555-5555')[0].a,1);
  assert.equal(D.projectState(state,offline).threads['4444-4444|5555-5555'][0].x,'Общее сообщение');
  assert.ok(!delivered.some(d=>d.ids.includes('offline')));
});

test('simultaneous retries and a later retry produce neither duplicate messages nor notifications',async()=>{
  reset();const results=await Promise.all([send(),send()]);
  assert.equal(results.filter(x=>!x.replayed).length,1);
  const count=delivered.length;assert.equal((await send()).replayed,true);assert.equal(delivered.length,count);
  assert.equal(M.thread(state,'1111-1111','2222-2222').length,2);assert.equal(M.thread(state,'1111-1111','3333-3333').length,1);
});

test('retry identity is bound to sender, recipient set and content',async()=>{
  reset();await send();const before=structuredClone(state);
  for(const extra of [{text:'Другое'},{recipients:['2222-2222']},{from:'2222-2222',recipients:['3333-3333']}])await assert.rejects(send(payload(extra),extra.from?'q':'p'));
  await assert.rejects(send(payload(),'gm'));assert.deepEqual(state,before);
  assert.equal((await send(payload({recipients:['3333-3333','22222222']}))).replayed,true);
});

test('failed durable write sends nothing and allows a safe retry',async()=>{
  const before=reset();failWrite=true;await assert.rejects(send());assert.deepEqual(state,before);assert.deepEqual(delivered,[]);
  failWrite=false;await send();assert.equal(M.thread(state,'1111-1111','3333-3333').length,1);
});

test('notification failures cannot roll back a committed mailing or trigger duplicate delivery',async()=>{
  reset();const notify=socket.executeForUsers;socket.executeForUsers=async()=>{throw Error('disconnected');};
  try{assert.equal((await send()).count,2);assert.equal((await send()).replayed,true);}
  finally{socket.executeForUsers=notify;}
  assert.equal(M.thread(state,'1111-1111','3333-3333').length,1);
});

test('recipient projection and addressed notifications disclose only their personal thread',async()=>{
  reset();await send(payload({recipients:['2222-2222','3333-3333','4444-4444'],senderId:'gm'}));
  const view=D.projectState(state,q);assert.equal(view.mailingReceipts,undefined);
  assert.equal(view.threads['1111-1111|3333-3333'],undefined);assert.equal(view.threads['1111-1111|4444-4444'],undefined);
  for(const item of delivered.filter(d=>d.ids.includes('q'))){assert.equal(item.name,'deliver');assert.equal(item.payload.to,'2222-2222');assert.equal(item.payload.senderId,'p');assert.equal(item.payload.recipients,undefined);}
  assert.ok(delivered.some(d=>d.ids.includes('gm')&&d.payload.to==='4444-4444'&&d.payload.senderId==='p'));
});

test('durable receipts survive encrypted recovery and prevent repeats after reconnect',async()=>{
  reset();await send();const key=newRecoveryKey();state=await unseal(await seal(state,key),key);
  const count=delivered.length;assert.equal((await send()).replayed,true);assert.equal(delivered.length,count);
  assert.equal(M.thread(state,'1111-1111','3333-3333').length,1);
});

test('mailing form retains input after lost response and reuses its operation id on retry',async()=>{
  reset();let dialog;const fields=new Map([['text','Рассылка из формы'],['recipients',['2222-2222']],['numbers','3333-3333, 2222 2222']]);
  const error={hidden:true,textContent:''},buttons=[{disabled:false},{disabled:false}],form={reportValidity:()=>true};
  const root={querySelector:selector=>selector==='form'?form:error,querySelectorAll:()=>buttons};
  globalThis.FormData=class{get(key){return fields.get(key);}getAll(key){return fields.get(key)??[];}};
  globalThis.Dialog=class{constructor(data){this.data=data;this.element=[root];dialog=this;}render(){return this;}async close(){this.data.close();}};
  const {mailingDialog}=await import('../scripts/mailing-dialog.mjs');
  const original=socket.executeAsGM,attempts=[];
  socket.executeAsGM=async(name,data)=>{assert.equal(name,'sendMailing');attempts.push(data);const result=await send(data);if(attempts.length===1)throw Error('Ответ потерян');return result;};
  try{
    const pending=mailingDialog('1111-1111');
    assert.equal(dialog.data.buttons.save.label,'Отправить');
    await dialog.submit(dialog.data.buttons.save);assert.equal(error.hidden,false);assert.equal(fields.get('text'),'Рассылка из формы');
    assert.ok(buttons.every(b=>!b.disabled));
    await dialog.submit(dialog.data.buttons.save);assert.equal((await pending).replayed,true);
    assert.equal(attempts[0].operationId,attempts[1].operationId);assert.equal(M.thread(state,'1111-1111','3333-3333').length,1);
  }finally{socket.executeAsGM=original;}
});
