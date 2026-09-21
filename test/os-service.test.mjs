import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../scripts/model.mjs';
import * as D from '../scripts/documents-model.mjs';
import { registerSocket } from '../scripts/socket.mjs';
import { OSContext } from '../scripts/os-view.mjs';

const gm={id:'gm',isGM:true,active:true},p={id:'p',active:true},q={id:'q',active:true},r={id:'r',active:true};
const users=[gm,p,q,r];users.get=id=>users.find(u=>u.id===id);users.activeGM=gm;
let state,delivered,failWrite=false;
globalThis.foundry={utils:{deepClone:structuredClone},applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:x=>x}}};
globalThis.canvas={tokens:{controlled:[]}};
globalThis.game={user:gm,users,actors:[],modules:new Map(),time:{worldTime:0},socket:{on(){},emit(){}},settings:{
 get:(_m,k)=>k==='state'?state:undefined,
 set:async(_m,_k,value)=>{if(failWrite)throw Error('disk rejected');state=structuredClone(value);}
}};
globalThis.Hooks={callAll(){}};
const socket=registerSocket();
socket.executeForUsers=async(name,ids,payload)=>delivered.push({name,ids,payload});
function reset(){
 failWrite=false;delivered=[];state=M.blankState();game.user=gm;game.journal=undefined;
 for(const [num,owner]of[['1111-1111','p'],['2222-2222','q'],['3333-3333','r'],['4444-4444',null]])M.addDevice(state,{num,owner});
 M.setBookName(state,'1111-1111','2222-2222','Друг');M.pushMessage(state,'1111-1111','2222-2222','Старая миссия');
}
const run=(op,data={},by='p')=>socket.handlers.get('osOperation').call({socketdata:{userId:by}},{number:'1111-1111',op,...data});

test('opening an attachment or a new file clears filters that would hide it',async()=>{
 const {selectOSDocument}=await import('../scripts/os-controller.mjs');
 const app={osTab:'files',osFileType:'notes',osFolder:'Another folder',osSearch:{files:'unrelated',contacts:'Ви'}};
 selectOSDocument(app,'test-document');
 assert.equal(app.osDocId,'test-document');assert.equal(app.osFileType,'');assert.equal(app.osFolder,'');
 assert.equal(app.osSearch.files,'');assert.equal(app.osSearch.contacts,'Ви');
});

test('OS transport authenticates caller and requires document read access for personal metadata',async()=>{
 reset();const hidden=D.createDocument(state,{title:'GM SECRET',body:'x',authorId:'gm'});
 const visible=D.createDocument(state,{title:'Mine',body:'x',holders:['1111-1111']});
 const before=structuredClone(state);
 await assert.rejects(run('fileMeta',{id:hidden.id,tags:'x',senderId:'gm'}));
 await assert.rejects(run('profile',{number:'4444-4444',name:'fake',senderId:'gm'}));
 await assert.rejects(run('profile',{name:'fake'},'missing'));
 assert.deepEqual(state,before);
 await run('fileMeta',{id:visible.id,tags:'улика, миссия',folder:'Дело'});
 assert.deepEqual(state.os.fileMeta['1111-1111'][visible.id].tags,['улика','миссия']);
 assert.equal(D.projectState(state,q).os.fileMeta['1111-1111'],undefined);
});
test('call notifications normalize numbers, reach only involved users, and skip duplicate invitations',async()=>{
 reset();const id=await run('callStart',{members:['22222222'],senderId:'gm'});
 let incoming=delivered.filter(d=>d.name==='deliver');
 assert.ok(incoming.some(d=>d.ids.includes('q')&&d.payload.senderId==='p'));
 assert.ok(!incoming.some(d=>d.ids.includes('r')));
 delivered=[];
 await run('callInvite',{id,members:['22222222','3333 3333','3333-3333']});
 incoming=delivered.filter(d=>d.name==='deliver');
 assert.ok(incoming.some(d=>d.ids.includes('r')&&d.payload.to==='3333-3333'));
 assert.ok(!incoming.some(d=>d.ids.includes('q')));
 assert.equal(M.thread(state,'1111-1111','2222-2222').length,2);
 assert.equal(M.thread(state,'1111-1111','3333-3333').length,1);
});
test('invalid invitations and failed durable writes leave the old mission and notifications intact',async()=>{
 reset();let before=structuredClone(state);
 await assert.rejects(run('callStart',{members:['2222-2222','9999-9999']}));
 assert.deepEqual(state,before);assert.deepEqual(delivered,[]);
 failWrite=true;await assert.rejects(run('callStart',{members:['2222-2222']}));
 assert.deepEqual(state,before);assert.deepEqual(delivered,[]);
 failWrite=false;await run('callStart',{members:['2222-2222']});
 assert.equal(M.thread(state,'1111-1111','2222-2222').length,2);
});
test('all ten views render old data without requiring an OS migration and escape user content',()=>{
 reset();game.user=p;
 M.setBookName(state,'1111-1111','2222-2222','<img src=x onerror=alert(1)>');
 for(const osTab of ['home','contacts','messages','map','wallet','jobs','files','news','calls','settings']){
   const context=OSContext({num:'1111-1111',osTab},D.projectState(state,p));
   assert.equal((context.osNav.match(/data-os="nav"/g)||[]).length,10);
   assert.ok(!context.osContent.includes('<img src=x'));
 }
 assert.ok(OSContext({num:'1111-1111',osTab:'contacts'},state).osContent.includes('&lt;img'));
 assert.equal(state.os,undefined);
});
test('a call selected from history is not replaced by an unrelated active call',async()=>{
 reset();const old=await run('callStart',{members:['2222-2222']});await run('callEnd',{id:old});
 await run('callStart',{members:['3333-3333']});
 const html=OSContext({num:'1111-1111',osTab:'calls',osCallId:old},state).osContent;
 assert.ok(html.includes('Разговор завершён'));assert.ok(!html.includes('Ожидание ответа'));
});
