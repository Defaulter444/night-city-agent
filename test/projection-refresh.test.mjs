import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectionRefresh,requiresAccessRefresh,requiresUserAccessRefresh} from '../scripts/projection-refresh.mjs';
const tick=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
test('health and wallet changes reuse data, while ownership and memory-chip changes refresh access',()=>{
  assert.equal(requiresAccessRefresh('Actor',{system:{derivedStats:{hp:{value:10}},wealth:{value:200}}}),false);
  for(const changes of [{ownership:{player:0}},{'ownership.default':0},{'-=ownership':null}])assert.equal(requiresAccessRefresh('Actor',changes),true);
  for(const changes of [{system:{amount:0}},{'system.equipped':'stored'},{system:{installedItems:{list:[]}}},{flags:{'night-city-agent':{'-=documents':null}}},{name:'Memory Chip'},{'-=flags':null},{'==flags':{}},{ownership:{default:0}}])assert.equal(requiresAccessRefresh('Item',changes),true);
  assert.equal(requiresAccessRefresh('Item',{system:{price:{market:200},hp:{value:5}}}),false);
});
test('user flags and other players changing scene reuse the projection',()=>{
  assert.equal(requiresUserAccessRefresh('other',{viewedScene:'scene'},'player'),false);
  assert.equal(requiresUserAccessRefresh('player',{flags:{module:{value:1}},name:'New name'},'player'),false);
  assert.equal(requiresUserAccessRefresh('player',{viewedScene:'scene'},'player'),true);
  assert.equal(requiresUserAccessRefresh('player',{character:'actor'},'player'),true);
  assert.equal(requiresUserAccessRefresh('other',{role:4},'player'),true);
});
function fixture() {
  let context='world|player|scene|gm';const requests=[],accepted=[];
  const refresh=new ProjectionRefresh({context:()=>context,accept:state=>accepted.push(state),fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))});
  return {refresh,requests,accepted,setContext:value=>context=value};
}
test('concurrent renders share one request and subsequent cached renders make none',async()=>{
  const f=fixture(),renders=Array.from({length:20},()=>f.refresh.refresh({cached:true}));
  await tick();assert.equal(f.requests.length,1);f.requests[0].resolve({revision:1});await Promise.all(renders);
  for(let index=0;index<20;index++)await f.refresh.refresh({cached:true});
  assert.equal(f.requests.length,1);assert.equal(f.accepted.length,1);
});
test('authoritative refreshes queue one request after an older response and discard it',async()=>{
  const f=fixture(),render=f.refresh.refresh({cached:true});await tick();
  const changes=Array.from({length:5},()=>f.refresh.refresh());
  assert.equal(f.requests.length,1);f.requests[0].resolve({revision:1,secret:'old access'});await tick();
  assert.equal(f.requests.length,2);assert.equal(f.accepted.length,0);
  f.requests[1].resolve({revision:1,documents:{}});await Promise.all([render,...changes]);
  assert.deepEqual(f.accepted,[{revision:1,documents:{}}]);
});
test('invalidation during a render forces a fresh permission projection',async()=>{
  const f=fixture(),render=f.refresh.refresh({cached:true});await tick();f.refresh.invalidate();
  f.requests[0].resolve({revision:2,documents:{revoked:{}}});await tick();
  assert.equal(f.requests.length,2);assert.equal(f.accepted.length,0);
  f.requests[1].resolve({revision:2,documents:{}});await render;assert.deepEqual(f.accepted[0].documents,{});
});
test('scene and GM changes reject results for the previous context',async()=>{
  const f=fixture(),render=f.refresh.refresh({cached:true});await tick();f.setContext('world|player|other-scene|other-gm');
  f.requests[0].resolve({revision:5,documents:{oldScene:{}}});await tick();assert.equal(f.accepted.length,0);
  assert.equal(f.requests.length,2);f.requests[1].resolve({revision:5,documents:{}});await render;
  assert.deepEqual(f.accepted[0].documents,{});
  f.setContext(null);await f.refresh.refresh();assert.equal(f.requests.length,2);
});
test('a failed request does not poison retries or a queued authoritative refresh',async()=>{
  const f=fixture(),failed=f.refresh.refresh({cached:true});await tick();
  f.requests[0].reject(Error('connection lost'));await assert.rejects(failed,/connection lost/);
  const stale=f.refresh.refresh({cached:true});await tick();const retry=f.refresh.refresh();
  f.requests[1].reject(Error('obsolete request failed'));await tick();
  assert.equal(f.requests.length,3);f.requests[2].resolve({revision:3});await Promise.all([stale,retry]);
  await f.refresh.refresh({cached:true});assert.equal(f.requests.length,3);
});
test('a new context does not wait for an unanswered request or its queued refresh',async()=>{
  const f=fixture(),old=f.refresh.refresh({cached:true});await tick();
  const queued=f.refresh.refresh();await tick();
  f.setContext('other-gm');const next=f.refresh.refresh({cached:true});await tick();
  assert.equal(f.requests.length,2);f.requests[1].resolve({revision:1,documents:{}});await next;
  assert.deepEqual(f.accepted,[{revision:1,documents:{}}]);
  await Promise.all([old,queued]);
  f.requests[0].reject(Error('old GM timeout'));await tick();
  assert.equal(f.requests.length,2);assert.equal(f.accepted.length,1);
});
test('GM disconnect releases waiting renders without waiting for the socket timeout',async()=>{
  const f=fixture(),render=f.refresh.refresh({cached:true});await tick();f.setContext(null);f.refresh.invalidate();
  await render;assert.equal(f.accepted.length,0);f.requests[0].reject(Error('timeout'));await tick();
});
