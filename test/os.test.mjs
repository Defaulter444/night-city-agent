import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, addDevice, setBookName, pushMessage, thread } from '../scripts/model.mjs';
import { applyOSOperation as op, projectOS, imageSource } from '../scripts/os-model.mjs';
import { projectState } from '../scripts/documents-model.mjs';
import { seal,unseal,newRecoveryKey } from '../scripts/vault.mjs';
const gm={id:'gm',isGM:true},p={id:'p'},q={id:'q'},r={id:'r'};
const a='1111-1111',b='2222-2222',c='3333-3333',npc='4444-4444';
const dataUrl='data:image/png;base64,aGVsbG8=';
function state(){const s=blankState();for(const[num,owner]of[[a,'p'],[b,'q'],[c,'r'],[npc,null]])addDevice(s,{num,owner});setBookName(s,a,npc,'Фиксер');pushMessage(s,a,npc,'Старая миссия');return s;}
function run(s,operation,extra={},user=p){return op(s,{op:operation,number:a,...extra},user,100000);}
test('OS leaves all previous devices, books, messages and read positions unchanged',()=>{
 const s=state(),before=structuredClone(s);
 run(s,'profile',{name:'Ви',avatar:dataUrl});run(s,'contact',{other:npc,category:'Фиксер',note:'Личная заметка',favorite:true});
 run(s,'job',{title:'Миссия',steps:'Прийти\nЗабрать',reward:100});run(s,'reminder',{title:'Встреча',due:100});
 for(const key of ['devices','threads','read'])assert.deepEqual(s[key],before[key]);
});
test('profiles and personal contact annotations are projected only to allowed users',()=>{
 const s=state();run(s,'profile',{number:npc,name:'Фиксер',avatar:dataUrl},gm);run(s,'profile',{number:c,name:'Скрытый',avatar:dataUrl},gm);
 run(s,'contact',{other:npc,note:'Наш секрет',favorite:true});
 const pv=projectState(s,p),qv=projectState(s,q);
 assert.equal(pv.os.profiles[npc].name,'Фиксер');assert.equal(pv.os.profiles[c],undefined);assert.equal(qv.os.contacts[a],undefined);assert.equal(qv.os.profiles[npc],undefined);
 assert.equal(qv.devices[npc].label,undefined);
});
test('no player may impersonate an NPC or edit the city configuration',()=>{
 const s=state();
 for(const operation of ['profile','contact','job','reminder','callStart'])assert.throws(()=>run(s,operation,{number:npc,title:'x',members:[b]}),/ваше/);
 for(const operation of ['map','place','article'])assert.throws(()=>run(s,operation,{title:'x',x:50,y:50}),/мастер/);
});
test('published targeted news and locations do not leak to other players; drafts stay with GM',()=>{
 const s=state();const news=run(s,'article',{title:'Секрет',published:true,numbers:[a]},gm);
 const place=run(s,'place',{title:'Склад',published:true,numbers:[a],x:20,y:30},gm);
 const hidden=run(s,'article',{title:'Черновик',published:false,public:true},gm);
 assert.ok(projectOS(s,p).articles[news]);assert.ok(projectOS(s,p).places[place]);assert.equal(projectOS(s,q).articles[news],undefined);assert.equal(projectOS(s,p).articles[hidden],undefined);
 assert.throws(()=>run(s,'saveArticle',{number:b,id:news},q),/недоступна/);
});
test('player jobs stay private even when an altered request asks to publish globally',()=>{
 const s=state(),rid=run(s,'job',{title:'Личное',public:true,numbers:[b],reward:40,steps:'A\nB'});
 assert.equal(s.os.jobs[rid].public,false);assert.deepEqual(s.os.jobs[rid].numbers,[a]);assert.equal(projectOS(s,q).jobs[rid],undefined);
 assert.throws(()=>run(s,'job',{id:rid,number:b,title:'Затереть'},q),/автор/);
 assert.throws(()=>run(s,'jobStep',{id:rid,number:b,stepId:s.os.jobs[rid].steps[0].id,done:true},q),/недоступно/);
});
test('participants can check shared mission steps but cannot rewrite its reward',()=>{
 const s=state(),rid=run(s,'job',{title:'Общее',published:true,numbers:[a,b],reward:100,steps:'A\nB'},gm),step=s.os.jobs[rid].steps[0].id;
 run(s,'jobStep',{id:rid,stepId:step,done:true});assert.equal(s.os.jobs[rid].steps[0].done,true);
 run(s,'job',{id:rid,title:'Общее',published:true,numbers:[a,b],reward:100,steps:'A\nB'},gm);assert.equal(s.os.jobs[rid].steps[0].done,true);
 assert.throws(()=>run(s,'job',{id:rid,title:'Взлом',reward:9999}),/автор/);
 assert.equal(s.os.jobs[rid].reward,100);
});
test('dangerous image protocols and invalid map coordinates are rejected',()=>{
 for(const src of ['javascript:alert(1)','data:text/html;base64,aGVsbG8=','//outside/x','file:///secret','worlds/x\" onerror=\"x'])assert.throws(()=>imageSource(src));
 assert.equal(imageSource('worlds/1/map.webp'),'worlds/1/map.webp');assert.equal(imageSource(dataUrl),dataUrl);
 const s=state();for(const x of [-1,101,NaN,Infinity])assert.throws(()=>run(s,'place',{title:'x',x,y:30},gm));
 assert.throws(()=>run(s,'fileMeta',{id:'__proto__',tags:'x'}));
});
test('calls invite only participants and lifecycle permissions are enforced',()=>{
 const s=state(),rid=run(s,'callStart',{members:[b,npc,b]});
 assert.deepEqual(s.os.calls[rid].members,[a,b,npc]);assert.equal(thread(s,a,b).length,1);
 assert.ok(projectOS(s,q).calls[rid]);assert.equal(projectOS(s,r).calls[rid],undefined);
 assert.throws(()=>run(s,'callReply',{number:c,id:rid,reply:'accepted'},r),/недоступен/);
 run(s,'callReply',{number:b,id:rid,reply:'accepted'},q);assert.equal(s.os.calls[rid].status,'active');
 assert.throws(()=>run(s,'callEnd',{number:b,id:rid},q),/инициатор/);
 run(s,'callInvite',{number:b,id:rid,members:[c]},q);assert.ok(projectOS(s,r).calls[rid]);assert.equal(thread(s,b,c).at(-1).t,c);
 run(s,'callEnd',{id:rid});assert.equal(s.os.calls[rid].status,'ended');assert.throws(()=>run(s,'callReply',{number:c,id:rid,reply:'accepted'},r),/недоступен/);
});
test('a caller cannot silently replace an unfinished call; all rejections finish it',()=>{
 const s=state(),rid=run(s,'callStart',{members:[b]});assert.throws(()=>run(s,'callStart',{members:[c]}),/завершите/);
 run(s,'callReply',{id:rid,number:b,reply:'declined'},q);assert.equal(s.os.calls[rid].status,'ended');
 assert.ok(run(s,'callStart',{members:[c]}));
});
test('reminders and file organization remain scoped to a device',()=>{
 const s=state(),rid=run(s,'reminder',{title:'Аренда',clock:'world',due:1800});run(s,'fileMeta',{id:'testfile',folder:'Улики',tags:'Склад,  НПС',favorite:true});
 assert.equal(projectOS(s,q).reminders[a],undefined);assert.equal(projectOS(s,q).fileMeta[a],undefined);
 run(s,'reminder',{id:rid,done:true});assert.equal(s.os.reminders[a][rid].done,true);
 assert.throws(()=>run(s,'reminder',{number:b,id:rid,done:true},q));
});
test('OS additions survive encryption, projection and roundtrip without altering legacy data',async()=>{
 const s=state();run(s,'job',{title:'Работа',steps:'A',reward:5});run(s,'profile',{avatar:dataUrl,name:'Ви'});
 const key=newRecoveryKey(),round=await unseal(await seal({state:s},key),key);assert.deepEqual(round.state,s);assert.deepEqual(projectState(round.state,p),projectState(s,p));
});
