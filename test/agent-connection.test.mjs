import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,addDevice} from '../scripts/model.mjs';

const gm={id:'gm',isGM:true,active:true},player={id:'player',active:true,viewedScene:'scene'},users=[gm,player];
users.get=id=>users.find(user=>user.id===id);users.activeGM=gm;
let requests=[],scene=0,settingsState=blankState(),writes=0;
const hooks=new Map(),once=new Map();
globalThis.Hooks={on:(name,fn)=>{if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn);},once:(name,fn)=>once.set(name,fn),off(){},callAll(){}};
globalThis.foundry={utils:{deepClone:structuredClone},applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:value=>value}}};
globalThis.game={user:player,users,world:{id:'world'},actors:[],modules:new Map([['night-city-agent',{version:'0.17.1'}]]),socket:{on(){},emit(){},connected:true},
 settings:{get:(_module,key)=>key==='state'?settingsState:undefined,set:async(_module,_key,value)=>{settingsState=value;writes++;}}};
globalThis.canvas={tokens:{controlled:[]}};globalThis.document={};globalThis.ui={notifications:{warn(){},error(){},info(){}}};
const {registerSocket,refreshState,requestState,projectionStatus,invalidateProjection,documentOperation,connectionDiagnostics}=await import('../scripts/socket.mjs');
const {AgentApp}=await import('../scripts/app-agent.mjs');
const socket=registerSocket();
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function reset() {
 game.user=player;users.activeGM=gm;player.viewedScene='scene-'+(++scene);requests=[];writes=0;invalidateProjection();
 socket.executeAsGM=(name,...args)=>name==='snapshot'?new Promise((resolve,reject)=>requests.push({resolve,reject,args})):Promise.resolve('saved-document');
}
function projection(revision=1){const state=blankState();state.revision=revision;addDevice(state,{num:'1111-1111',owner:'player'});return state;}

test('first Agent render returns a loading shell while the snapshot is unanswered',async()=>{
 reset();const app=new AgentApp({num:'1111-1111',tab:'map'});
 const shell=await app._prepareContext();await tick();
 assert.equal(shell.shell,true);assert.equal(shell.syncing,true);assert.equal(requests.length,1);
 assert.equal(app.num,'1111-1111');assert.equal(shell.osContent,undefined);
 requests[0].resolve(projection());await tick();
 const loaded=await app._prepareContext();assert.equal(loaded.shell,undefined);assert.match(loaded.osContent,/os-map-image/);
 await app._prepareContext();assert.equal(requests.length,1);
});

test('timeout is visible, rerenders do not repeat it, and explicit retry makes one new read',async()=>{
 reset();const app=new AgentApp();await app._prepareContext();await tick();
 requests[0].reject(Error('Мастер не ответил. Попробуйте ещё раз.'));await tick();
 const failed=await app._prepareContext();assert.equal(failed.shell,true);assert.match(failed.syncError,/Мастер не ответил/);
 for(let i=0;i<5;i++)await app._prepareContext();assert.equal(requests.length,1);
 app.render=()=>{};AgentApp.DEFAULT_OPTIONS.actions.retrySync.call(app);await tick();assert.equal(requests.length,2);
 requests[1].resolve(projection());await tick();assert.equal(projectionStatus().fresh,true);
});

test('a revoked cached file is excluded from render during refresh and after acceptance',async()=>{
 reset();const initial=refreshState({cached:true});await tick();const state=projection();state.documents={secret:{title:'PRIVATE_SENTINEL',body:'SECRET_BODY'}};
 requests[0].resolve(state);await initial;invalidateProjection();
 const app=new AgentApp({tab:'files'}),shell=await app._prepareContext();await tick();
 assert.equal(shell.shell,true);assert.doesNotMatch(JSON.stringify(shell),/PRIVATE_SENTINEL|SECRET_BODY/);
 requests[1].resolve(projection(2));await tick();const loaded=await app._prepareContext();assert.doesNotMatch(JSON.stringify(loaded),/PRIVATE_SENTINEL|SECRET_BODY/);
});

test('disconnect releases a stuck read and replacement GM sync starts immediately',async()=>{
 reset();requestState();await tick();users.activeGM=null;requestState();await tick();
 assert.equal(projectionStatus().loading,false);users.activeGM={...gm,id:'new-gm'};requestState();await tick();
 assert.equal(requests.length,2);requests[1].resolve(projection());await tick();assert.equal(projectionStatus().fresh,true);
 requests[0].reject(Error('old GM timeout'));await tick();assert.equal(projectionStatus().fresh,true);assert.equal(connectionDiagnostics().lastSnapshot.ok,true);
});

test('a committed write returns before its following snapshot and is never retried',async()=>{
 reset();let operations=0;
 socket.executeAsGM=(name,...args)=>name==='snapshot'?new Promise((resolve,reject)=>requests.push({resolve,reject,args})):(operations++,Promise.resolve('saved-document'));
 assert.equal(await documentOperation('create',{}),'saved-document');await tick();assert.equal(operations,1);assert.equal(requests.length,1);
 requests[0].reject(Error('read failed after save'));await tick();assert.equal(operations,1);assert.equal(projectionStatus().error,'read failed after save');
});

test('snapshot diagnostics contain timings and byte count without user contents',async()=>{
 reset();const fresh=refreshState({cached:true});await tick();requests[0].resolve({protocol:'nca-snapshot-2',state:projection(),metrics:{gmVersion:'0.17.1',initMs:4,projectMs:6,bytes:1234,secret:'RECOVERY_SENTINEL',title:'PRIVATE_TITLE'}});await fresh;
 const report=connectionDiagnostics();assert.equal(report.lastSnapshot.bytes,1234);assert.equal(report.lastSnapshot.gmVersion,'0.17.1');
 assert.doesNotMatch(JSON.stringify(report),/RECOVERY_SENTINEL|PRIVATE_TITLE|1111-1111/);
 invalidateProjection({access:false});const next=refreshState({cached:true});await tick();requests[1].resolve(projection(2));await next;
 assert.equal(connectionDiagnostics().lastMeasuredSnapshot.bytes,1234);
 invalidateProjection({access:false});const failed=refreshState({cached:true});await tick();requests[2].reject(Error('timeout'));await assert.rejects(failed);
 assert.equal(connectionDiagnostics().lastSnapshot.ok,false);assert.equal(connectionDiagnostics().lastMeasuredSnapshot.bytes,1234);
});

test('GM save completes without recipient acknowledgements; failed persistence sends nothing',async()=>{
 reset();game.user=gm;settingsState=projection();addDevice(settingsState,{num:'2222-2222',owner:'gm'});
 const emitted=[];game.socket.emit=(...args)=>emitted.push(args);
 const result=await socket.invoke('send',[{from:'1111-1111',to:'2222-2222',text:'MESSAGE_SENTINEL'}],'player');
 assert.ok(result);assert.equal(writes,1);assert.equal(settingsState.threads['1111-1111|2222-2222'].length,1);assert.equal(socket.pending.size,0);
 assert.ok(emitted.some(([,packet,options])=>packet.notify&&options.recipients.includes('player')));
 const count=emitted.length,save=game.settings.set;game.settings.set=async()=>{throw Error('disk failed');};
 await assert.rejects(socket.invoke('send',[{from:'1111-1111',to:'2222-2222',text:'FAILED'}],'player'),/disk failed/);
 assert.equal(emitted.length,count);assert.equal(settingsState.threads['1111-1111|2222-2222'].length,1);game.settings.set=save;game.user=player;
});

test('module API is ready during pending startup sync; unrelated joins reuse the request',async()=>{
 reset();await import('../scripts/main.mjs');
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try {await once.get('ready')();}finally{globalThis.setInterval=interval;}
 await tick();assert.equal(typeof game.modules.get('night-city-agent').api.openAgent,'function');assert.equal(requests.length,1);
 for(const fn of hooks.get('userConnected'))fn('another-player',true);await tick();assert.equal(requests.length,1);
 requests[0].resolve(projection());await tick();for(const fn of hooks.get('userConnected'))fn('another-player',false);await tick();assert.equal(requests.length,1);
 invalidateProjection({access:false});const failed=refreshState({cached:true});await tick();requests[1].reject(Error('timeout'));await assert.rejects(failed);
 for(const fn of hooks.get('userConnected'))fn('gm',true);await tick();assert.equal(requests.length,3);
 requests[2].resolve(projection());await tick();assert.equal(projectionStatus().fresh,true);
});

test('ordinary content updates keep navigation, while a no-revision legacy notice still refreshes',async()=>{
 reset();const initial=refreshState({cached:true});await tick();requests[0].resolve(projection());await initial;
 const app=new AgentApp({tab:'map'});invalidateProjection({access:false});const view=await app._prepareContext();await tick();
 assert.equal(view.shell,undefined);assert.equal(view.syncing,true);assert.match(view.osContent,/os-map-image/);
 requests[1].resolve(projection(2));await tick();const legacy=socket.handlers.get('refresh')();await tick();assert.equal(requests.length,3);
 requests[2].resolve(projection(2));await legacy;assert.equal(projectionStatus().fresh,true);
});
