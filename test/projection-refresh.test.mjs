import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectionRefresh,requiresAccessRefresh,requiresUserAccessRefresh} from '../scripts/projection-refresh.mjs';
const tick=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
test('health and wallet changes reuse data, while ownership and memory-chip changes refresh access',()=>{
  assert.equal(requiresAccessRefresh('Actor',{system:{derivedStats:{hp:{value:10}},wealth:{value:200}}}),false);
  for(const changes of [{ownership:{player:0}},{'ownership.default':0},{'-=ownership':null}])assert.equal(requiresAccessRefresh('Actor',changes),true);
  for(const changes of [{system:{amount:0}},{'system.equipped':'stored'},{system:{installedItems:{list:[]}}},{flags:{'night-city-agent':{'-=documents':null}}},{name:'Memory Chip'},{'-=flags':null},{'==flags':{}},{ownership:{default:0}}])assert.equal(requiresAccessRefresh('Item',changes),true);
  assert.equal(requiresAccessRefresh('Item',{system:{price:{market:200},hp:{value:5}}}),false);
  assert.equal(requiresAccessRefresh('Item',{flags:{'another-module':{color:'red'}}}),false);
  assert.equal(requiresAccessRefresh('Item',{'flags.babele.originalName':'Memory Chip'}),true);
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

test('setting and committed-revision notices share a matching in-flight snapshot',async()=>{
  const f=fixture();f.refresh.invalidate();
  const setting=f.refresh.refresh({cached:true});await tick();
  const notices=Array.from({length:10},()=>f.refresh.refresh({cached:true,minRevision:9}));
  assert.equal(f.requests.length,1);
  f.requests[0].resolve({revision:9});await Promise.all([setting,...notices]);
  assert.equal(f.requests.length,1);assert.equal(f.accepted.length,1);assert.equal(f.refresh.status().fresh,true);
});

test('a committed-revision notice rejects an older response and coalesces the follow-up',async()=>{
  const f=fixture(),initial=f.refresh.refresh({cached:true});await tick();
  const notice=f.refresh.refresh({cached:true,minRevision:3});
  f.requests[0].resolve({revision:2,documents:{revoked:{}}});await tick();
  assert.equal(f.accepted.length,0);assert.equal(f.requests.length,2);
  f.requests[1].resolve({revision:3,documents:{}});await Promise.all([initial,notice]);
  assert.deepEqual(f.accepted,[{revision:3,documents:{}}]);
  await f.refresh.refresh({cached:true,minRevision:3});assert.equal(f.requests.length,2);
});

test('access invalidation immediately makes the cached projection unusable',async()=>{
  const f=fixture(),initial=f.refresh.refresh({cached:true});await tick();f.requests[0].resolve({revision:8});await initial;
  assert.equal(f.refresh.status().usable,true);f.refresh.invalidate();assert.equal(f.refresh.status().usable,false);
  const revoked=f.refresh.refresh({cached:true});await tick();f.requests[1].resolve({revision:8,documents:{}});await revoked;
  assert.equal(f.refresh.status().usable,true);
});

test('a replacement GM or an authoritative reset can serve a lower restored revision',async()=>{
  const f=fixture(),initial=f.refresh.refresh({cached:true,minRevision:100});await tick();f.requests[0].resolve({revision:100});await initial;
  f.setContext('replacement-gm');const next=f.refresh.refresh({cached:true});await tick();f.requests[1].resolve({revision:1});await next;
  assert.equal(f.refresh.status().fresh,true);
  f.refresh.invalidate();const restored=f.refresh.refresh({cached:true});await tick();f.requests[2].resolve({revision:0});await restored;
  assert.equal(f.refresh.status().fresh,true);
});

test('content refresh keeps a usable screen while permission refresh hides it',async()=>{
  const f=fixture(),initial=f.refresh.refresh({cached:true});await tick();f.requests[0].resolve({revision:1});await initial;
  f.refresh.invalidate({access:false});assert.equal(f.refresh.status().usable,true);assert.equal(f.refresh.status().fresh,false);
  const content=f.refresh.refresh({cached:true,minRevision:2});await tick();assert.equal(f.refresh.status().usable,true);
  f.requests[1].resolve({revision:2});await content;assert.equal(f.refresh.status().fresh,true);
  f.refresh.invalidate();assert.equal(f.refresh.status().usable,false);
});

test('repeated obsolete replies produce an error after a single follow-up',async()=>{
  const f=fixture(),read=f.refresh.refresh({cached:true,minRevision:9});await tick();
  f.requests[0].resolve({revision:1});await tick();assert.equal(f.requests.length,2);
  f.requests[1].resolve({revision:1});await assert.rejects(read,/устаревшие данные/);await tick();
  assert.equal(f.requests.length,2);assert.equal(f.accepted.length,0);assert.match(f.refresh.status().error,/устаревшие/);
});

test('disconnect clears an error so the same GM can reconnect and serve a new read',async()=>{
  const f=fixture(),initial=f.refresh.refresh({cached:true});await tick();f.requests[0].reject(Error('timeout'));await assert.rejects(initial);
  f.setContext(null);await f.refresh.refresh({cached:true});f.setContext('world|player|scene|gm');
  assert.equal(f.refresh.status().error,null);const resumed=f.refresh.refresh({cached:true});await tick();f.requests[1].resolve({revision:2});await resumed;
  assert.equal(f.refresh.status().fresh,true);
});
