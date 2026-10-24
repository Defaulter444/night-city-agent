import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, addDevice } from '../scripts/model.mjs';
import { applyOSOperation } from '../scripts/os-model.mjs';
import { waitingCalls } from '../scripts/holo-call.mjs';

const gm={id:'gm',isGM:true},p={id:'p',isGM:false},q={id:'q',isGM:false};
const users=new Map([[gm.id,gm],[p.id,p],[q.id,q]]);
const a='1111-1111',b='2222-2222',npc='9999-9999';
function fixture(){const s=blankState();addDevice(s,{num:a,owner:p.id,label:'Ви'});addDevice(s,{num:b,owner:q.id,label:'Джеки'});addDevice(s,{num:npc,label:'Роуг'});return s;}

test('a holo-call waits only for the invited owner, and the GM answers for NPC devices',()=>{
  const s=fixture();
  const call=applyOSOperation(s,{op:'callStart',number:npc,members:[a]},gm,1000);
  (s.os.profiles??={})[npc]={name:'Роуг',role:'Фиксер',avatar:'worlds/x/rogue.webp'};
  assert.deepEqual(waitingCalls(s,p,users).map(c=>[c.id,c.number,c.from,c.name,c.role,c.avatar,c.group]),[[call,a,npc,'Роуг','Фиксер','worlds/x/rogue.webp',false]]);
  assert.deepEqual(waitingCalls(s,q,users),[]);
  assert.deepEqual(waitingCalls(s,gm,users),[]);
  applyOSOperation(s,{op:'callReply',number:a,id:call,reply:'accepted'},p,2000);
  assert.deepEqual(waitingCalls(s,p,users),[]);
  const toNpc=applyOSOperation(s,{op:'callStart',number:b,members:[npc]},q,3000);
  assert.deepEqual(waitingCalls(s,gm,users).map(c=>[c.id,c.number,c.name]),[[toNpc,npc,'Джеки']]);
  assert.deepEqual(waitingCalls(s,p,users),[]);
});

test('declined or ended calls disappear; the caller book name wins over the profile',()=>{
  const s=fixture();s.devices[a].book={[b]:'Напарник'};
  const call=applyOSOperation(s,{op:'callStart',number:b,members:[a]},q,1000);
  assert.equal(waitingCalls(s,p,users)[0].name,'Напарник');
  applyOSOperation(s,{op:'callReply',number:a,id:call,reply:'declined'},p,2000);
  assert.deepEqual(waitingCalls(s,p,users),[]);
  const again=applyOSOperation(s,{op:'callStart',number:npc,members:[a,b]},gm,3000);
  assert.equal(waitingCalls(s,p,users)[0].group,true);
  applyOSOperation(s,{op:'callEnd',number:npc,id:again},gm,4000);
  assert.deepEqual(waitingCalls(s,p,users),[]);
  assert.deepEqual(waitingCalls(null,p,users),[]);
});
