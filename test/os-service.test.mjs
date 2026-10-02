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
socket.notify=(name,ids,payload)=>delivered.push({name,ids,payload});
function reset(){
 failWrite=false;delivered=[];state=M.blankState();game.user=gm;game.journal=undefined;
 for(const [num,owner]of[['1111-1111','p'],['2222-2222','q'],['3333-3333','r'],['4444-4444',null]])M.addDevice(state,{num,owner});
 M.setBookName(state,'1111-1111','2222-2222','Друг');M.pushMessage(state,'1111-1111','2222-2222','Старая миссия');
}
const run=(op,data={},by='p')=>socket.handlers.get('osOperation').call({socketdata:{userId:by}},{number:'1111-1111',op,...data});

test('public news reaches the actual player view, updates refresh clients, and GM removal can be restored',async()=>{
 reset();
 const id=await run('article',{title:'Общая публикация',published:true,publicationDate:'2045-09-30',publicationTime:'23:40'},'gm');
 for(const id of ['p','q'])assert.ok(delivered.some(d=>d.name==='refresh'&&d.ids.includes(id)));
 await run('saveArticle',{id});
 game.user=p;
 let html=OSContext({num:'1111-1111',osTab:'news'},D.projectState(state,p)).osContent;
 assert.ok(html.includes('Общая публикация'));assert.equal(html.includes('data-os="articleDelete"'),false);assert.equal(html.includes('data-os="newsTrash"'),false);
 game.user=gm;
 const before=structuredClone(state);delivered=[];failWrite=true;
 await assert.rejects(run('articleDelete',{id},'gm'),/disk rejected/);
 assert.deepEqual(state,before);assert.deepEqual(delivered,[]);failWrite=false;
 await assert.rejects(run('articleDelete',{id,senderId:'gm'}),/мастер/);assert.deepEqual(state,before);
 await run('articleDelete',{id},'gm');
 assert.ok(delivered.some(d=>d.name==='refresh'&&d.ids.includes('p')));
 game.user=p;
 html=OSContext({num:'1111-1111',osTab:'news',osNewsTrash:true},D.projectState(state,p)).osContent;
 assert.equal(html.includes('Общая публикация'),false);assert.deepEqual(state.os.saved['1111-1111'],[]);
 game.user=gm;
 html=OSContext({num:'1111-1111',osTab:'news',osNewsTrash:true},state).osContent;
 assert.ok(html.includes('Общая публикация'));assert.ok(html.includes('data-os="articleRestore"'));
 failWrite=true;const deleted=structuredClone(state);
 await assert.rejects(run('articleRestore',{id},'gm'),/disk rejected/);assert.deepEqual(state,deleted);failWrite=false;
 await run('articleRestore',{id},'gm');
 game.user=p;html=OSContext({num:'1111-1111',osTab:'news'},D.projectState(state,p)).osContent;
 assert.ok(html.includes('Общая публикация'));assert.ok(html.includes('30.09.2045, 23:40'));
});

test('GM publication dates persist through socket writes and render in chronological order for players',async()=>{
 reset();
 const early=await run('article',{title:'Ранняя новость',publicationDate:'2045-09-29',publicationTime:'23:59',published:true,public:true},'gm');
 const late=await run('article',{title:'Поздняя новость',publicationDate:'2045-09-30',publicationTime:'00:10',published:true,public:true},'gm');
 const before=structuredClone(state);
 await assert.rejects(run('article',{id:early,title:'Подделка',publicationDate:'2045-10-01',publicationTime:'12:00',senderId:'gm'}),/мастер/);
 assert.deepEqual(state,before);
 failWrite=true;
 await assert.rejects(run('article',{id:late,title:'Потерянная правка',publicationDate:'2045-10-01',publicationTime:'12:00'},'gm'),/disk rejected/);
 assert.deepEqual(state,before);failWrite=false;
 game.user=p;
 const html=OSContext({num:'1111-1111',osTab:'news'},D.projectState(state,p)).osContent;
 assert.ok(html.includes('30.09.2045, 00:10'));assert.ok(html.includes('29.09.2045, 23:59'));
 assert.ok(html.indexOf('Поздняя новость')<html.indexOf('Ранняя новость'));
 assert.equal(html.includes('data-os="article"'),false);
});

test('the actual GM article editor retains manually chosen date and time',async()=>{
 reset();
 const id=await run('article',{title:'Новость',publicationDate:'2045-09-30',publicationTime:'23:40'},'gm');
 const {performOS}=await import('../scripts/os-controller.mjs');
 let content;
 const previous=globalThis.Dialog;
 globalThis.Dialog=class {constructor(data){this.data=data;content=data.content;}render(){this.data.close();return this;}};
 try {
   await performOS({num:'1111-1111',saveDraft:async()=>{},render(){}},null,{dataset:{os:'article',id}});
   assert.match(content,/name="publicationDate" type="date" value="2045-09-30"/);
   assert.match(content,/name="publicationTime" type="time" value="23:40"/);
   assert.match(content,/Дата публикации/);assert.match(content,/Время публикации/);
   assert.match(content,/Видно игрокам/);assert.match(content,/name="audience"/);assert.match(content,/value="all" selected/);
   assert.equal(content.includes('name="public"'),false);
 } finally {globalThis.Dialog=previous;}
});

test('opening an attachment or a new file clears filters that would hide it',async()=>{
 const {selectOSDocument}=await import('../scripts/os-controller.mjs');
 const app={osTab:'files',osFileTrash:true,osFileType:'notes',osFolder:'Another folder',osSearch:{files:'unrelated',contacts:'Ви'}};
 selectOSDocument(app,'test-document');
 assert.equal(app.osDocId,'test-document');assert.equal(app.osFileType,'');assert.equal(app.osFolder,'');
 assert.equal(app.osFileTrash,false);
 assert.equal(app.osSearch.files,'');assert.equal(app.osSearch.contacts,'Ви');
});

test('file views distinguish global author deletion from personal removal and retain attachment access',async()=>{
 reset();
 const doc=D.createDocument(state,{title:'Файл расследования',body:'Текст',holders:['1111-1111','2222-2222'],authorId:'p'});
 game.user=p;
 let html=OSContext({num:'1111-1111',osTab:'files',osDocId:doc.id},D.projectState(state,p)).osContent;
 assert.ok(html.includes('data-os="documentDelete"'));assert.equal(html.includes('data-os="documentHide"'),false);
 game.user=q;
 html=OSContext({num:'2222-2222',osTab:'files',osDocId:doc.id},D.projectState(state,q)).osContent;
 assert.ok(html.includes('data-os="documentHide"'));assert.equal(html.includes('data-os="documentDelete"'),false);
 D.setDocumentHidden(state,doc.id,q,true,1);
 html=OSContext({num:'2222-2222',osTab:'files'},D.projectState(state,q)).osContent;
 assert.equal(html.includes(`data-os="documentSelect" data-id="${doc.id}"`),false);
 html=OSContext({num:'2222-2222',osTab:'files',osDocId:doc.id,osFileTrash:true},D.projectState(state,q)).osContent;
 assert.ok(html.includes('data-os="documentShow"'));assert.ok(html.includes('Убран из моего списка'));
 html=OSContext({num:'2222-2222',osTab:'files',osDocId:doc.id},D.projectState(state,q)).osContent;
 assert.ok(html.includes('Текст'));assert.ok(html.includes('data-os="documentShow"'));
 D.deleteDocument(state,doc.id,p,2);
 html=OSContext({num:'2222-2222',osTab:'files',osFileTrash:true},D.projectState(state,q)).osContent;
 assert.equal(html.includes('Файл расследования'),false);
 game.user=p;
 html=OSContext({num:'1111-1111',osTab:'files',osDocId:doc.id,osFileTrash:true},D.projectState(state,p)).osContent;
 assert.ok(html.includes('data-os="documentRestore"'));assert.equal(html.includes('data-os="documentSend"'),false);
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
 assert.ok(html.includes('Разговор завершён'));assert.ok(!html.includes('<h3>Ожидание ответа</h3>'));
});

test('pin movement uses the authenticated GM and rolls back failed saves',async()=>{
 reset();const id=await run('place',{title:'Место миссии',x:20,y:30,published:true,public:true},'gm');
 const before=structuredClone(state);
 await assert.rejects(run('placeMove',{id,x:70,y:80,senderId:'gm'}));assert.deepEqual(state,before);
 failWrite=true;await assert.rejects(run('placeMove',{id,x:70,y:80},'gm'));assert.deepEqual(state,before);
 failWrite=false;await run('placeMove',{id,x:70,y:80},'gm');
 assert.equal(state.os.places[id].x,70);assert.equal(state.os.places[id].title,'Место миссии');
 assert.equal(D.projectState(state,q).os.places[id].y,80);
});
