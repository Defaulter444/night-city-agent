import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,addDevice} from '../scripts/model.mjs';
import {applyOSOperation,visiblePlace} from '../scripts/os-model.mjs';
import {projectState} from '../scripts/documents-model.mjs';
const gm={id:'gm',isGM:true},p={id:'p'},q={id:'q'};
function fixture(){const s=blankState();addDevice(s,{num:'1111-1111',owner:'p'});addDevice(s,{num:'2222-2222',owner:'q'});return s;}
const place=(s,data,user=gm)=>applyOSOperation(s,{op:'place',number:'1111-1111',title:'Клиника',x:25,y:40,...data},user,1000);
test('published places reach all players, including older empty audiences, while drafts and private jobs remain hidden',()=>{
 const s=fixture(),id=place(s,{published:true});
 s.os.places.legacy={id:'legacy',title:'Старая метка',authorId:'gm',published:true,public:false,numbers:[]};
 const draft=place(s,{published:false,audience:'all'});
 s.os.jobs={private:{id:'private',authorId:'gm',published:true,public:false,numbers:[]}};
 for(const u of[p,q]){const v=projectState(s,u);assert.ok(v.os.places[id]);assert.ok(v.os.places.legacy);assert.equal(v.os.places[draft],undefined);assert.equal(v.os.jobs.private,undefined);}
 assert.equal(visiblePlace(s,s.os.places[id],null),false);
});
test('selected and legacy addressed places keep privacy after edits or lost recipients',()=>{
 const s=fixture(),id=place(s,{published:true,audience:'selected',numbers:['1111-1111'],public:true});
 assert.equal(s.os.places[id].public,false);assert.ok(projectState(s,p).os.places[id]);assert.equal(projectState(s,q).os.places[id],undefined);
 const before=structuredClone(s);assert.throws(()=>place(s,{id,published:true,numbers:[]}),/хотя бы один/);assert.deepEqual(s,before);
 s.os.places.legacy={id:'legacy',title:'Для одного',published:true,public:false,numbers:['1111-1111']};
 assert.ok(projectState(s,p).os.places.legacy);assert.equal(projectState(s,q).os.places.legacy,undefined);
 s.os.places[id].numbers=[];assert.equal(projectState(s,p).os.places[id],undefined);
 assert.throws(()=>place(s,{published:true,audience:'selected'}),/хотя бы один/);
 assert.throws(()=>place(s,{audience:'spoof'}),/аудиторию/);
});
test('players cannot publish places or override audiences and pin moves preserve visibility',()=>{
 const s=fixture(),id=place(s,{published:true,audience:'selected',numbers:['1111-1111']});
 assert.throws(()=>place(s,{isGM:true,senderId:'gm',published:true,public:true},p),/мастеру/);
 const old=structuredClone(s.os.places[id]);applyOSOperation(s,{op:'placeMove',number:'1111-1111',id,x:70,y:80,published:true,audience:'all'},gm,2000);
 assert.deepEqual(s.os.places[id],{...old,x:70,y:80,updatedAt:2000});assert.equal(projectState(s,q).os.places[id],undefined);
});
