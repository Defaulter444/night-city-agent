import test from 'node:test';
import assert from 'node:assert/strict';
import {handleNPCPayment} from '../scripts/wealth.mjs';
import {blankState,addDevice} from '../scripts/model.mjs';
import {applyOSOperation,callsForViewer,cityMap,DEFAULT_CITY_MAP} from '../scripts/os-model.mjs';
import {projectState} from '../scripts/documents-model.mjs';
import {OSContext} from '../scripts/os-view.mjs';
import {registerSocket} from '../scripts/socket.mjs';

const gm={id:'gm',isGM:true,active:true},p={id:'p',active:true},q={id:'q',active:true},r={id:'r',active:true};
const users=[gm,p,q,r];users.get=id=>users.find(u=>u.id===id);users.players=[p,q,r];users.activeGM=gm;
const npc='1000-0001',pn='1000-0002',qn='1000-0003',rn='1000-0004';
let state,docs,counter=0;
const get=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
globalThis.foundry={utils:{getProperty:get,deepClone:structuredClone,randomID:()=>`receipt${++counter}`},applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:x=>x}}};
globalThis.game={user:gm,users,modules:new Map(),time:{worldTime:0},socket:{on(){},emit(){}},settings:{get:(_m,k)=>k==='state'?state:undefined,set:async(_m,k,v)=>{if(k==='state')state=structuredClone(v);}}};
globalThis.Hooks={callAll(){}};
globalThis.canvas={tokens:{controlled:[]}};
globalThis.fromUuid=async uuid=>docs.get(uuid);
function actor(id,balance,owner){
 const a={id,uuid:`Actor.${id}`,name:id,type:'character',flags:{},system:{wealth:{value:balance,transactions:[]}},testUserPermission:u=>u.isGM||owner===u.id,async update(update){
  if(this.failNext){this.failNext=false;throw Error('write rejected');}
  for(const[k,v]of Object.entries(update)){const keys=k.split('.');let root=this;for(const key of keys.slice(0,-1))root=root[key]??={};root[keys.at(-1)]=structuredClone(v);}
 }};docs.set(a.uuid,a);game.actors.push(a);return a;
}
function reset(){
 state=blankState();docs=new Map();game.actors=[];game.user=gm;p.character=null;q.character=null;r.character=null;
 for(const[num,owner,label]of[[npc,null,'Фиксер'],[pn,'p','Ви'],[qn,'q','Джуди'],[rn,'r','Панам']])addDevice(state,{num,owner,label});
 const source=actor('Источник',1000),target=actor('Получатель',50,'p');p.character=target;canvas.tokens.controlled=[{actor:source}];return{source,target};
}
const payload=(extra={})=>({from:npc,to:pn,amount:100,note:'За работу',operationId:'a'.repeat(32),...extra});
const socket=registerSocket();socket.executeForUsers=async()=>{};
const wire=(data,by)=>socket.handlers.get('npcPayment').call({socketdata:{userId:by}},data);

test('GM pays as an NPC without a source sheet and records the NPC identity',async()=>{
 const{source,target}=reset();const result=await handleNPCPayment(payload(),'gm');
 assert.equal(result.replayed,false);assert.equal(target.system.wealth.value,150);assert.equal(source.system.wealth.value,1000);
 assert.match(target.system.wealth.transactions[0][1],/Фиксер.*1000-0001.*За работу/);
 assert.equal(Object.keys(target.flags['night-city-agent'].npcPayments).length,1);
});
test('NPC payment authenticates the socket caller, ignoring forged GM payload fields',async()=>{
 const{target}=reset();const result=await wire(payload({callerId:'gm',isGM:true}),'p');
 assert.equal(result.ok,false);assert.equal(target.system.wealth.value,50);
 assert.equal((await wire(payload(),'gm')).ok,true);
});
test('parallel retry credits and debits exactly once and rejects changed payment details',async()=>{
 const{source,target}=reset(),data=payload({sourceUuid:source.uuid});
 const results=await Promise.all([handleNPCPayment(data,'gm'),handleNPCPayment(data,'gm')]);
 assert.equal(results.filter(r=>r.replayed).length,1);assert.equal(source.system.wealth.value,900);assert.equal(target.system.wealth.value,150);
 await assert.rejects(handleNPCPayment({...data,amount:200},'gm'),/другими/);
 assert.equal(target.system.wealth.value,150);
});
test('invalid amounts, bad recipients and insufficient funds do not change either balance',async()=>{
 const{source,target}=reset();
 for(const extra of [{amount:0},{amount:-1},{amount:1.5},{amount:Infinity},{operationId:'__proto__'},{from:pn},{to:npc},{to:'9999-9999'},{sourceUuid:'Actor.missing'},{sourceUuid:target.uuid},{sourceUuid:source.uuid,amount:1001}])await assert.rejects(handleNPCPayment(payload(extra),'gm'));
 assert.equal(source.system.wealth.value,1000);assert.equal(target.system.wealth.value,50);
 assert.deepEqual(target.flags,{});
});
test('failed recipient update refunds the explicit debit; a later retry succeeds',async()=>{
 const{source,target}=reset();target.failNext=true;const data=payload({sourceUuid:source.uuid});
 await assert.rejects(handleNPCPayment(data,'gm'));
 assert.equal(source.system.wealth.value,1000);assert.equal(target.system.wealth.value,50);assert.deepEqual(target.flags,{});
 await handleNPCPayment(data,'gm');assert.equal(source.system.wealth.value,900);assert.equal(target.system.wealth.value,150);
});
test('retry after changing the assigned character cannot issue a second payment',async()=>{
 const{target}=reset();const data=payload();await handleNPCPayment(data,'gm');
 const replacement=actor('Новый персонаж',0,'p');p.character=replacement;
 assert.equal((await handleNPCPayment(data,'gm')).replayed,true);
 assert.equal(target.system.wealth.value,150);assert.equal(replacement.system.wealth.value,0);
});
test('GM sees player-to-player calls from an unrelated NPC; other players do not',()=>{
 reset();const id=applyOSOperation(state,{op:'callStart',number:pn,members:[qn]},p,1000);
 assert.equal(callsForViewer(state,gm,npc).length,1);assert.equal(callsForViewer(state,gm,npc,'mine').length,0);
 assert.equal(callsForViewer(state,r,rn).length,0);assert.equal(projectState(state,r).os.calls[id],undefined);
 const html=OSContext({num:npc,osTab:'calls'},state).osContent;
 assert.match(html,/Звонки · пульт мастера/);assert.match(html,/Джуди/);assert.match(html,/Завершить вызов/);
 assert.ok(!html.includes('data-os="callInvite"'));assert.ok(!html.includes('data-reply="accepted"'));
 assert.throws(()=>applyOSOperation(state,{op:'callEnd',number:rn,id},r),/недоступен/);
 const members=[...state.os.calls[id].members];applyOSOperation(state,{op:'callEnd',number:npc,id},gm,2000);
 assert.equal(state.os.calls[id].status,'ended');assert.deepEqual(state.os.calls[id].members,members);
});
test('GM wallet does not display the selected token as an NPC bank account',()=>{
 reset();const html=OSContext({num:npc,osTab:'wallet'},state).osContent;
 assert.match(html,/Выплаты от имени НПС/);assert.ok(!html.includes('1 000 эдди'));
});
test('bundled 2045 map is the default, preserves custom maps, and does not mutate legacy data',()=>{
 reset();const before=structuredClone(state);assert.equal(cityMap(state).image,DEFAULT_CITY_MAP);assert.deepEqual(state,before);
 state.os={map:{title:'Своя карта',image:'worlds/campaign/custom.png'},places:{safe:{title:'Старое место'}}};
 assert.equal(cityMap(state).image,'worlds/campaign/custom.png');
 applyOSOperation(state,{op:'map',number:npc,title:'Найт-Сити 2045',image:DEFAULT_CITY_MAP},gm);
 assert.equal(cityMap(state).image,DEFAULT_CITY_MAP);assert.equal(state.os.places.safe.title,'Старое место');
});
