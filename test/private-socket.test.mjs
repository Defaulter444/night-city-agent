import test from 'node:test'; import assert from 'node:assert/strict';
import {PrivateSocket} from '../scripts/private-socket.mjs';
const gm={id:'gm',active:true,isGM:true},p={id:'p',active:true},q={id:'q',active:true};
const users=[gm,p,q];users.get=id=>users.find(u=>u.id===id);users.activeGM=gm;
const packets=[];globalThis.game={user:gm,users,socket:{on(){},emit:(...args)=>packets.push(args)}};
test('requests and replies always name server recipients; duplicate delivery applies once',async()=>{
 const socket=new PrivateSocket();let counter=0;
 socket.register('create',async function(){assert.equal(this.socketdata.userId,'p');counter++;await Promise.resolve();return {id:counter};});
 const packet={protocol:'nca-direct-1',request:'test-1',name:'create',args:[],userId:'gm'};
 await Promise.all([socket.receive(packet,'p'),socket.receive(packet,'p')]);assert.equal(counter,1);assert.equal(packets.length,2);
 for(const [channel,reply,options]of packets){assert.equal(channel,'module.night-city-agent');assert.deepEqual(options,{recipients:['p']});assert.equal(reply.value.id,1);}
});
test('player cannot call delivery on another player; nonexistent sender rejected',async()=>{
 const socket=new PrivateSocket();socket.register('deliver',()=>true);socket.register('conferenceDeliver',()=>true);game.user=p;
 await assert.rejects(socket.invoke('deliver',[],'q'));await assert.rejects(socket.invoke('deliver',[],'missing'));
 await assert.rejects(socket.invoke('conferenceDeliver',[],'q'));assert.equal(await socket.invoke('conferenceDeliver',[],'gm'),true);
 assert.equal(await socket.invoke('deliver',[],'gm'),true);game.user=gm;
});
test('reply is accepted only from expected server-authenticated sender',async()=>{
 const socket=new PrivateSocket();let value;const timer=setTimeout(()=>{},1000);socket.pending.set('a',{target:'gm',timer,resolve:x=>value=x,reject:()=>{}});
 await socket.receive({protocol:'nca-direct-1',response:'a',value:'forged'},'q');assert.equal(value,undefined);assert.ok(socket.pending.has('a'));
 await socket.receive({protocol:'nca-direct-1',response:'a',value:'valid'},'gm');assert.equal(value,'valid');assert.equal(socket.pending.size,0);
});
