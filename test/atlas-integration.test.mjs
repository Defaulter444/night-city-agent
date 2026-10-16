import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, addDevice } from '../scripts/model.mjs';
import { applyOSOperation, projectOS } from '../scripts/os-model.mjs';
import { projectState } from '../scripts/documents-model.mjs';
import { atlasLocationId, canOpenAtlasLocation, openAtlasLocation } from '../scripts/atlas-link.mjs';
import { createAtlasIntegration, linkedJobs } from '../scripts/atlas-integration.mjs';

const gm={id:'gm',isGM:true},p={id:'p',isGM:false},q={id:'q',isGM:false};
const a='1111-1111',b='2222-2222',location='wiki-location-45aacb4d5a554ecf218f';
function fixture(){const s=blankState();addDevice(s,{num:a,owner:p.id});addDevice(s,{num:b,owner:q.id});return s;}
const op=(s,kind,data,user=gm)=>applyOSOperation(s,{op:kind,number:a,...data},user,1000);
const job=(s,data={},user=gm)=>op(s,'job',{title:'Работа',body:'Private details',reward:500,steps:'Secret step',atlasLocationId:location,...data},user);

test('Atlas link is an optional bounded identifier, never a URL, coercible object or prototype key',()=>{
  for(const value of [undefined,null,''])assert.equal(atlasLocationId(value),'');
  for(const value of [location,'a'.repeat(128),'ABC_123-xy'])assert.equal(atlasLocationId(value),value);
  for(const value of ['a'.repeat(129),' foo','foo ','x/y','https://example.test/x','javascript:x','__proto__','constructor','prototype','город',42,true,[],{}])assert.throws(()=>atlasLocationId(value),/Atlas/);
});

test('jobs and places retain independent Atlas links across legacy edits and allow explicit unlinking',()=>{
  const s=fixture(),id=job(s),place=op(s,'place',{title:'Место',x:20.25,y:81.5,atlasLocationId:location});
  assert.equal(s.os.jobs[id].atlasLocationId,location);assert.equal(s.os.places[place].atlasLocationId,location);
  op(s,'job',{id,title:'Редакция'});op(s,'place',{id:place,title:'Редакция места',x:20.25,y:81.5});
  assert.equal(s.os.jobs[id].atlasLocationId,location);assert.equal(s.os.places[place].atlasLocationId,location);
  assert.deepEqual([s.os.places[place].x,s.os.places[place].y],[20.25,81.5]);
  const before=structuredClone(s);
  assert.throws(()=>op(s,'job',{id,title:'Bad',atlasLocationId:'../../secret'}),/Atlas/);assert.deepEqual(s,before);
  op(s,'job',{id,title:'Без связи',atlasLocationId:''});assert.equal(s.os.jobs[id].atlasLocationId,undefined);
});

test('linking a job does not publish it or grant another user edit or read access',()=>{
  const s=fixture(),hidden=job(s),shared=job(s,{title:'Адресное',published:true,numbers:[a]}),own=job(s,{title:'Личное',public:true,numbers:[b]},p);
  assert.equal(projectOS(s,p).jobs[hidden],undefined);assert.equal(projectOS(s,q).jobs[shared],undefined);
  assert.deepEqual(linkedJobs(s,p,location).map(j=>j.id),[shared,own]);assert.deepEqual(linkedJobs(s,q,location),[]);
  assert.deepEqual(linkedJobs(projectState(s,p),p,location),linkedJobs(s,p,location));
  const before=structuredClone(s);assert.throws(()=>op(s,'job',{id:shared,title:'Take over',atlasLocationId:'other'},p),/автор/);assert.deepEqual(s,before);
  assert.throws(()=>op(s,'place',{title:'Player pin',x:1,y:2,atlasLocationId:location},p),/мастер/);
});

function integration(s,user=p){
  const calls=[],drafts=[];let current=user,locked=false,refresh=async()=>{};
  const api=createAtlasIntegration({getUser:()=>current,storageLocked:()=>locked,
    refreshState:async options=>{calls.push({refresh:options});await refresh();},
    // Deliberately provide raw state: the second visibility guard must still work.
    readState:()=>s,openAgent:opts=>{calls.push({open:opts});return opts;},
    openDraft:async data=>{drafts.push(data);return null;}});
  return {api,calls,drafts,setUser:value=>current=value,setLocked:value=>locked=value,setRefresh:value=>refresh=value};
}

test('jobsForLocation returns only readable scalar DTOs after the normal projection refresh',async()=>{
  const s=fixture(),visible=job(s,{title:'Visible',published:true,numbers:[a],status:'active'});job(s,{title:'Hidden'});
  const h=integration(s),result=await h.api.jobsForLocation(location);
  assert.deepEqual(result,[{id:visible,title:'Visible',status:'active'}]);assert.deepEqual(h.calls,[{refresh:{cached:true}}]);
  result[0].title='modified';assert.equal(s.os.jobs[visible].title,'Visible');
  assert.deepEqual(await h.api.jobsForLocation('unrelated'),[]);assert.deepEqual(await h.api.jobsForLocation(''),[]);
  await assert.rejects(h.api.jobsForLocation('invalid/link'),/Atlas/);
});

test('openJob rejects inaccessible jobs and opens an owned device with the correct archive and focus',async()=>{
  const s=fixture(),hidden=job(s),visible=job(s,{published:true,numbers:[a],status:'archived'}),h=integration(s);
  await assert.rejects(h.api.openJob(hidden),/недоступно/);await assert.rejects(h.api.openJob('__proto__'),/недоступно/);
  assert.equal(h.calls.some(c=>c.open),false);
  assert.deepEqual(await h.api.openJob(visible),{num:a,tab:'jobs',jobId:visible,jobArchive:true});
});

test('locked storage or changed viewer during refresh fails closed without opening a job',async()=>{
  const s=fixture(),id=job(s,{published:true,numbers:[a]}),h=integration(s);
  h.setLocked(true);await assert.rejects(h.api.jobsForLocation(location),/хранилище/);assert.deepEqual(h.calls,[]);
  h.setLocked(false);h.setRefresh(async()=>h.setUser(q));await assert.rejects(h.api.openJob(id),/изменился/);assert.equal(h.calls.some(c=>c.open),false);
});

test('draft integration is GM-only and only opens a prefilled editor, with no automatic job writes',async()=>{
  const s=fixture(),h=integration(s),before=structuredClone(s);
  await assert.rejects(h.api.draftJobForLocation({id:location,name:'Посмертие'}),/Мастер/);assert.deepEqual(h.calls,[]);assert.deepEqual(h.drafts,[]);
  h.setUser(gm);assert.equal(await h.api.draftJobForLocation({id:location,name:' Посмертие '}),null);
  assert.deepEqual(h.drafts,[{number:a,location:{id:location,name:'Посмертие'}}]);assert.deepEqual(s,before);
  await assert.rejects(h.api.draftJobForLocation({id:'bad/id',name:'X'}),/Atlas/);
  await assert.rejects(h.api.draftJobForLocation({id:location,name:''}),/название/);
});

test('optional Atlas access is checked both for the button and again on activation',async()=>{
  let allowed=true,calls=[];
  const module={active:true,api:{canOpen:()=>allowed,openLocation:async id=>{calls.push(id);return id;}}};
  globalThis.game={modules:new Map([['night-city-2045-atlas',module]])};
  assert.equal(canOpenAtlasLocation(location),true);allowed=false;
  await assert.rejects(openAtlasLocation(location),/недоступен/);assert.deepEqual(calls,[]);
  allowed=true;assert.equal(await openAtlasLocation(location),location);assert.deepEqual(calls,[location]);
  module.active=false;assert.equal(canOpenAtlasLocation(location),false);
  module.active=true;module.api.canOpen=()=>{throw Error('unavailable');};assert.equal(canOpenAtlasLocation(location),false);
});
