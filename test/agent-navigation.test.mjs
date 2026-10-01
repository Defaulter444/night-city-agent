import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,addDevice,pushMessage} from '../scripts/model.mjs';
import {OSContext} from '../scripts/os-view.mjs';
import {cityMap,DEFAULT_CITY_MAP} from '../scripts/os-model.mjs';

const gm={id:'gm',isGM:true},users=[gm];users.activeGM=gm;users.get=id=>users.find(u=>u.id===id);
let state,warnings=[];
globalThis.foundry={utils:{deepClone:structuredClone},applications:{api:{ApplicationV2:class{
 _replaceHTML(result){this.replaced=result;}
 _onClose(){}
},HandlebarsApplicationMixin:x=>x}}};
globalThis.game={user:gm,users,actors:[],modules:new Map(),journal:undefined,time:{worldTime:0},settings:{get:(_m,k)=>k==='state'?state:undefined}};
globalThis.canvas={tokens:{controlled:[]}};
globalThis.document={};
globalThis.Hooks={off(){}};
globalThis.ui={notifications:{warn:s=>warnings.push(s),error:s=>warnings.push(s)}};
const {AgentApp}=await import('../scripts/app-agent.mjs');
const {performOS}=await import('../scripts/os-controller.mjs');
function reset(){state=blankState();state.os={};addDevice(state,{num:'1111-1111',owner:'gm'});addDevice(state,{num:'2222-2222',owner:'gm'});warnings=[];}
function app(tab='map'){return new AgentApp({num:'1111-1111',other:'2222-2222',tab});}
function image(source){return {dataset:{mapSrc:source},alt:'Карта',getAttribute:key=>key==='src'?source:null,replaceWith(node){this.replacement=node;}};}
const body=node=>({querySelector:()=>node});

test('view navigation completes while draft persistence is still waiting for the GM',async()=>{
 reset();const instance=app('messages');let release,saved=false,renders=0;
 instance.saveDraft=()=>new Promise(resolve=>{release=()=>{saved=true;resolve();};});
 instance.render=async()=>{renders++;};
 const transition=performOS(instance,null,{dataset:{os:'nav',tab:'map'}});
 await Promise.race([transition,new Promise((_,reject)=>setTimeout(()=>reject(Error('Navigation is blocked by draft persistence')),500))]);
 assert.equal(instance.osTab,'map');assert.equal(saved,false);assert.equal(renders,1);assert.equal(instance.osBusy,false);
 release();await Promise.resolve();assert.equal(saved,true);
});

test('a failed background draft save is reported without blocking subsequent navigation',async()=>{
 reset();const instance=app();instance.saveDraft=async()=>{throw Error('GM disconnected');};instance.render=async()=>{};
 await performOS(instance,null,{dataset:{os:'nav',tab:'files'}});
 assert.equal(instance.osTab,'files');assert.match(warnings[0],/GM disconnected/);
 await performOS(instance,null,{dataset:{os:'nav',tab:'news'}});assert.equal(instance.osTab,'news');
});

test('non-message sections skip full message formatting and contact search indexes',async()=>{
 reset();pushMessage(state,'2222-2222','1111-1111','Searchable conversation');
 const message=state.threads['1111-1111|2222-2222'][0];
 Object.defineProperty(message,'clock',{get(){throw Error('A hidden conversation was formatted');},enumerable:true,configurable:true});
 const instance=app('map');const context=await instance._prepareContext();
 assert.deepEqual(context.messages,[]);assert.deepEqual(context.contacts,[]);
 assert.match(context.osNav,/<b>1<\/b>/);
 delete message.clock;instance.osTab='messages';
 const chat=await instance._prepareContext();assert.equal(chat.messages[0].text,'Searchable conversation');assert.match(chat.contacts[0].searchText,/Searchable conversation/);
});

test('map rendering does not read unrelated news, jobs, reminder collections or notes',()=>{
 reset();for(const key of ['articles','jobs','reminders'])Object.defineProperty(state.os,key,{get(){throw Error(`Unrelated ${key} accessed`);}});
 game.journal={get(){throw Error('Unrelated notes accessed');}};
 const context=OSContext(app(),state);assert.match(context.osContent,/os-map-image/);game.journal=undefined;
});

test('only the map image survives body replacement; current pins and cards are always rendered',()=>{
 reset();const instance=app(),first=image('worlds/test/map.png');
 const initial={body:body(first)};instance._replaceHTML(initial,null,{});assert.equal(instance.osMapImage,first);assert.equal(first.src,'worlds/test/map.png');
 let destroyed=0;instance.osMapController={destroy(){destroyed++;}};
 instance._replaceHTML({body:body(null)},null,{});assert.equal(destroyed,1);assert.equal(instance.osMapImage,first);
 const replacement=image('worlds/test/map.png'),result={body:body(replacement)};
 instance._replaceHTML(result,null,{});assert.equal(replacement.replacement,first);assert.equal(instance.replaced,result);
 const changed=image('worlds/test/new-map.png');instance._replaceHTML({body:body(changed)},null,{});assert.equal(instance.osMapImage,changed);assert.equal(changed.replacement,undefined);
 instance._onClose({});assert.equal(instance.osMapImage,null);
});

test('a failed map gets a fresh image and navigation never inserts a placeholder into real contacts',async()=>{
 reset();const instance=app('map'),broken=image('worlds/test/missing.png');broken.complete=true;broken.naturalWidth=0;
 instance.osMapImage=broken;const fresh=image('worlds/test/missing.png');instance._replaceHTML({body:body(fresh)},null,{});
 assert.equal(instance.osMapImage,fresh);assert.equal(fresh.replacement,undefined);
 instance.other='9999-9999';instance.osTab='contacts';const context=await instance._prepareContext();
 assert.doesNotMatch(context.osContent,/9999-9999/);instance.osTab='messages';
 assert.equal((await instance._prepareContext()).contacts[0].num,'9999-9999');
});

test('news search keeps current selection during replacement and does not steal focus from buttons',()=>{
 reset();const instance=app('news'),search={selectionStart:3,selectionEnd:5},content={querySelector:()=>search};
 document.activeElement=search;instance._replaceHTML({body:body(null)},content,{});
 assert.deepEqual(instance._restoreFocus,{selector:'.os-search-input',start:3,end:5});
 document.activeElement={tagName:'BUTTON'};instance._replaceHTML({body:body(null)},content,{});assert.equal(instance._restoreFocus,null);
});

test('lossless default map replaces only the exact legacy built-in path without modifying stored settings',()=>{
 reset();state.os.map={image:'modules/night-city-agent/assets/night-city-2045.png',title:'Map title'};
 assert.equal(cityMap(state).image,DEFAULT_CITY_MAP);assert.equal(cityMap(state).title,'Map title');assert.match(state.os.map.image,/\.png$/);
 state.os.map.image='worlds/test/map.png';assert.equal(cityMap(state).image,state.os.map.image);
 state.os.map.image='modules/night-city-agent/assets/night-city-2045.png?custom=1';assert.equal(cityMap(state).image,state.os.map.image);
});

test('long news feeds render in batches while search and saved filters still reach older articles',()=>{
 reset();state.os.articles=Object.fromEntries(Array.from({length:80},(_,i)=>['a'+i,{id:'a'+i,title:i===0?'Редкая находка':'Новости '+i,body:'Текст',source:'Город',published:true,createdAt:i}]));
 const instance=app('news');let html=OSContext(instance,state).osContent;
 assert.equal((html.match(/class="os-card os-article"/g)||[]).length,30);assert.match(html,/30 из 80/);assert.doesNotMatch(html,/Редкая находка/);
 instance.osNewsLimit=60;html=OSContext(instance,state).osContent;assert.equal((html.match(/class="os-card os-article"/g)||[]).length,60);
 instance.osSearch={news:'редкая находка'};html=OSContext(instance,state).osContent;assert.match(html,/Редкая находка/);assert.equal((html.match(/class="os-card os-article"/g)||[]).length,1);assert.doesNotMatch(html,/newsMore/);
 instance.osSearch.news='';instance.osSavedOnly=true;state.os.saved={'1111-1111':['a0']};html=OSContext(instance,state).osContent;assert.match(html,/Редкая находка/);assert.equal((html.match(/class="os-card os-article"/g)||[]).length,1);
 delete state.os.articles.a0;html=OSContext(instance,state).osContent;assert.doesNotMatch(html,/Редкая находка/);
});
