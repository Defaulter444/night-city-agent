import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {seal,newRecoveryKey} from '../scripts/vault.mjs';
import * as Store from '../scripts/store.mjs';
let decrypts=0,settings=new Map(),local=new Map(),failSave=false,failAfterSave=false,onSave=null,gate=null;
const gm={id:'gm',isGM:true,active:true};
const users=[gm];users.activeGM=gm;users.get=id=>users.find(user=>user.id===id);
Object.defineProperty(globalThis,'crypto',{configurable:true,value:{
  getRandomValues:webcrypto.getRandomValues.bind(webcrypto),
  subtle:{importKey:webcrypto.subtle.importKey.bind(webcrypto.subtle),encrypt:webcrypto.subtle.encrypt.bind(webcrypto.subtle),
    async decrypt(...args){decrypts++;if(gate){const waiting=gate;gate=null;await waiting;}return webcrypto.subtle.decrypt(...args);}}
}});
globalThis.localStorage={getItem:key=>local.get(key),setItem:(key,value)=>local.set(key,value)};
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:gm,users,world:{id:''},time:{worldTime:0},settings:{
  get:(_module,key)=>settings.get(key),
  async set(_module,key,value){
    if(failSave)throw Error('save failed');
    settings.set(key,structuredClone(value));onSave?.();await Promise.resolve();if(failAfterSave)throw Error('failed after update');return value;
  }
}};
let next=0;
const state=(revision=1)=>({v:1,revision,devices:{},threads:{},read:{},marker:revision});
async function setup(){
  settings=new Map();local=new Map();failSave=false;failAfterSave=false;onSave=null;gate=null;decrypts=0;gm.id='gm';game.world.id='vault-'+(++next);
  const key=newRecoveryKey(),envelope=await seal({state:state(),backup:state()},key);
  settings.set('vault',envelope);local.set(`nca-recovery:${game.world.id}:${gm.id}`,key);
  return {key,envelope};
}
test('unchanged vault and concurrent opens decrypt once; changed vault decrypts again',async()=>{
  const {key}=await setup();await Promise.all([Store.initializeStorage(),Store.initializeStorage(),Store.initializeStorage()]);
  assert.equal(decrypts,1);for(let index=0;index<10;index++)await Store.initializeStorage();assert.equal(decrypts,1);
  settings.set('vault',await seal({state:state(2),backup:state()},key));await Store.initializeStorage();
  assert.equal(decrypts,2);assert.equal(Store.readState().revision,2);
});
test('durable writes and their setting hook reuse committed data without decrypting',async()=>{
  await setup();await Store.initializeStorage();let refreshing;
  onSave=()=>{refreshing=Store.initializeStorage();};
  await Store.writeState(state(2));await refreshing;
  assert.equal(decrypts,1);assert.equal(Store.readState().revision,2);
  await Store.initializeStorage();assert.equal(decrypts,1);
});
test('failed saves preserve the valid cache and permit later writes',async()=>{
  await setup();await Store.initializeStorage();failSave=true;
  await assert.rejects(Store.writeState(state(2)),/save failed/);assert.equal(Store.readState().revision,1);
  failSave=false;await Store.initializeStorage();assert.equal(decrypts,1);
  await Store.writeState(state(3));await Store.initializeStorage();assert.equal(decrypts,1);assert.equal(Store.readState().revision,3);
});
test('an older decode cannot overwrite a newer local commit',async()=>{
  const {key}=await setup();await Store.initializeStorage();
  settings.set('vault',await seal({state:state(2),backup:state()},key));let release;gate=new Promise(resolve=>release=resolve);
  const decoding=Store.initializeStorage();await Promise.resolve();await Store.writeState(state(3));release();await decoding;
  assert.equal(Store.readState().revision,3);const before=decrypts;await Store.initializeStorage();assert.equal(decrypts,before);
});
test('a stale decode failure cannot erase a successful recovery import',async()=>{
  const {key}=await setup();await Store.initializeStorage();const valid=await seal({state:state(2),backup:state()},key);
  settings.set('vault',{...valid,data:(valid.data[0]==='A'?'B':'A')+valid.data.slice(1)});
  let release;gate=new Promise(resolve=>release=resolve);const old=Store.initializeStorage();await Promise.resolve();
  settings.set('vault',valid);await Store.importRecovery({format:'nca-recovery-1',worldId:game.world.id,key});
  release();await old;assert.equal(Store.storageLocked(),false);assert.equal(Store.readState().revision,2);
});
test('bad keys are rejected once per envelope and recovery clears that failure',async()=>{
  const {key}=await setup();local.set(`nca-recovery:${game.world.id}:${gm.id}`,newRecoveryKey());
  await assert.rejects(Store.initializeStorage(),/ключ восстановления/);assert.equal(decrypts,1);
  await assert.rejects(Store.initializeStorage(),/ключ восстановления/);assert.equal(decrypts,1);assert.equal(Store.storageLocked(),true);
  await Store.importRecovery({format:'nca-recovery-1',worldId:game.world.id,key});assert.equal(decrypts,2);
  await Store.initializeStorage();assert.equal(decrypts,2);assert.equal(Store.storageLocked(),false);
});
test('a different world or GM cannot reuse the previous decrypted vault',async()=>{
  const {key,envelope}=await setup();await Store.initializeStorage();const previousWorld=game.world.id;
  game.world.id='other-world';await Store.initializeStorage();assert.equal(Store.storageLocked(),true);assert.throws(()=>Store.readState(),/закрыто/);
  local.set(`nca-recovery:${game.world.id}:${gm.id}`,key);await Store.initializeStorage();assert.equal(decrypts,2);
  gm.id='other-gm';await Store.initializeStorage();assert.equal(Store.storageLocked(),true);
  local.set(`nca-recovery:${game.world.id}:${gm.id}`,key);await Store.initializeStorage();assert.equal(decrypts,3);
  settings.set('vault',{...envelope});await Store.initializeStorage();assert.equal(decrypts,3);
  assert.notEqual(game.world.id,previousWorld);
});
test('a restored current envelope can replace a higher revision',async()=>{
  const {key}=await setup();await Store.initializeStorage();await Store.writeState(state(9));
  settings.set('vault',await seal({state:state(2),backup:state()},key));await Store.initializeStorage();
  assert.equal(Store.readState().revision,2);await Store.initializeStorage();assert.equal(Store.readState().revision,2);
});
test('the first pending decode remains locked until valid data is available',async()=>{
  await setup();let release;gate=new Promise(resolve=>release=resolve);const pending=Store.initializeStorage();
  assert.equal(Store.storageLocked(),true);release();await pending;assert.equal(Store.storageLocked(),false);
});
test('an ordered player snapshot can replace a higher revision after recovery',()=>{
  game.user={id:'player',isGM:false};Store.acceptProjection(state(20));Store.acceptProjection(state(2));
  assert.equal(Store.readState().revision,2);game.user=gm;
});
test('a write error after a setting hook lets refresh read the current envelope',async()=>{
  await setup();await Store.initializeStorage();let refreshing;onSave=()=>{refreshing=Store.initializeStorage();};failAfterSave=true;
  await assert.rejects(Store.writeState(state(2)),/failed after update/);await refreshing;
  assert.equal(Store.readState().revision,2);assert.equal(decrypts,2);
});
