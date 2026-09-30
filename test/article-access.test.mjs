import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, addDevice } from '../scripts/model.mjs';
import { applyOSOperation, visibleArticle } from '../scripts/os-model.mjs';
import { projectState } from '../scripts/documents-model.mjs';

const gm={id:'gm',isGM:true},p={id:'p'},q={id:'q'},number='1111-1111',other='2222-2222';
function fixture(){const state=blankState();addDevice(state,{num:number,owner:p.id});addDevice(state,{num:other,owner:q.id});return state;}
const run=(state,op,data={},user=gm)=>applyOSOperation(state,{op,number,...data},user,1000);

test('publishing with one checkbox reaches players and repairs older empty audiences without exposing drafts or other record types',()=>{
  const state=fixture();
  const id=run(state,'article',{title:'Городская новость',published:true});
  assert.equal(state.os.articles[id].audience,'all');
  assert.ok(projectState(state,p).os.articles[id]);assert.ok(projectState(state,q).os.articles[id]);
  state.os.articles.legacy={id:'legacy',title:'Ранее опубликовано',authorId:'gm',published:true,public:false,numbers:[]};
  state.os.articles.draft={id:'draft',title:'Черновик',authorId:'gm',published:false,public:true,numbers:[]};
  state.os.jobs={private:{id:'private',authorId:'gm',published:true,public:false,numbers:[]}};
  const projected=projectState(state,p);
  assert.ok(projected.os.articles.legacy);assert.equal(projected.os.articles.draft,undefined);assert.equal(projected.os.jobs.private,undefined);
  assert.equal(visibleArticle(state,state.os.articles.legacy,undefined),false);
});

test('explicit audience retains recipient privacy and never becomes public after losing a recipient',()=>{
  const state=fixture(),id=run(state,'article',{title:'Для одного Агента',published:true,audience:'selected',numbers:[number],public:true});
  assert.equal(state.os.articles[id].public,false);
  assert.ok(projectState(state,p).os.articles[id]);assert.equal(projectState(state,q).os.articles[id],undefined);
  assert.throws(()=>run(state,'article',{id,title:'Очистили получателей в старом редакторе',published:true,public:false,numbers:[]}),/хотя бы один/);
  assert.equal(state.os.articles[id].audience,'selected');
  state.os.articles.legacyTarget={id:'legacyTarget',title:'Старая адресная новость',authorId:'gm',published:true,public:false,numbers:[number]};
  assert.throws(()=>run(state,'article',{id:'legacyTarget',title:'Убрали адресата',published:true,public:false,numbers:[]}),/хотя бы один/);
  assert.equal(projectState(state,q).os.articles.legacyTarget,undefined);
  state.os.articles[id].numbers=[];
  assert.equal(projectState(state,p).os.articles[id],undefined);assert.equal(projectState(state,q).os.articles[id],undefined);
  assert.throws(()=>run(state,'article',{title:'Без адресата',published:true,audience:'selected'}),/хотя бы один/);
  assert.throws(()=>run(state,'article',{title:'Подмена аудитории',audience:'other'}),/аудиторию/);
  const draft=run(state,'article',{title:'Незаконченная адресная публикация',published:false,audience:'selected'});
  assert.equal(projectState(state,p).os.articles[draft],undefined);
});

test('only GM can delete and restore; trash stays private, bookmarks are cleared, restored dates and audiences survive',()=>{
  const state=fixture(),id=run(state,'article',{title:'Слух',published:true,audience:'selected',numbers:[number],publicationDate:'2045-09-30',publicationTime:'23:40'});
  run(state,'saveArticle',{id},p);state.os.saved[other]=[id,'other-news'];
  const original=structuredClone(state.os.articles[id]);
  assert.throws(()=>run(state,'articleDelete',{id,senderId:'gm'},p),/мастер/);
  run(state,'articleDelete',{id});run(state,'articleDelete',{id});
  assert.equal(state.os.articles[id],undefined);assert.deepEqual(state.os.saved[number],[]);assert.deepEqual(state.os.saved[other],['other-news']);
  assert.equal(projectState(state,p).os.articleTrash,undefined);assert.equal(projectState(state,p).os.articles[id],undefined);
  assert.equal(projectState(state,gm).os.articleTrash[id].publicationAt,original.publicationAt);
  assert.throws(()=>run(state,'saveArticle',{id},p),/недоступна/);
  assert.throws(()=>run(state,'article',{id,title:'Устаревшая правка'}),/не существует/);
  assert.throws(()=>run(state,'articleRestore',{id},p),/мастер/);
  run(state,'articleRestore',{id});run(state,'articleRestore',{id});
  assert.deepEqual(state.os.articles[id],original);assert.equal(state.os.articleTrash[id],undefined);
  assert.ok(projectState(state,p).os.articles[id]);assert.equal(projectState(state,q).os.articles[id],undefined);
  assert.deepEqual(state.os.saved[number],[]);
});
