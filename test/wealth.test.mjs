import assert from 'node:assert/strict';
import { adjustRaw, transfer, handleTransfer } from '../scripts/wealth.mjs';
const gm={id:'gm',isGM:true};const player={id:'player',isGM:false};
const users=[gm,player];users.get=id=>users.find(u=>u.id===id);users.players=[player];
const docs=new Map();let id=0;let failMessage=false;
globalThis.game={user:gm,users,modules:new Map()};
const get=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);
globalThis.foundry={utils:{getProperty:get,deepClone:structuredClone,randomID:()=>`r${++id}`}};
globalThis.fromUuid=async uuid=>docs.get(uuid);
globalThis.ChatMessage={getSpeaker:()=>({}),create:async()=>{if(failMessage)throw Error('delivery failed');return{}}};
function actor(name,value,owner=false){const a={name,id:name,uuid:`Actor.${name}`,flags:{},isOwner:true,system:{wealth:{value,transactions:[]}},testUserPermission:u=>u.isGM||owner,async update(update){await new Promise(r=>setTimeout(r,1));for(const[k,v]of Object.entries(update)){const keys=k.split('.');let o=this;for(const key of keys.slice(0,-1))o=o[key]??=( {} );o[keys.at(-1)]=v;}}};docs.set(a.uuid,a);return a;}
const rows=[];
async function test(name,fn){try{await fn();rows.push({name,pass:true})}catch(e){rows.push({name,pass:false,error:e.message});process.exitCode=1}}
await test('invalid recipient leaves sender balance untouched',async()=>{const a=actor('a',100),b=actor('b',undefined);await assert.rejects(transfer(a,b,10));assert.equal(a.system.wealth.value,100)});
await test('concurrent transfers cannot spend the same balance',async()=>{const a=actor('c',100),b=actor('d',0);const rs=await Promise.allSettled([transfer(a,b,80),transfer(a,b,80)]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(a.system.wealth.value,20);assert.equal(b.system.wealth.value,80)});
await test('receipt survives 251 newer entries and duplicate parallel clicks',async()=>{const a=actor('e',0);await adjustRaw(a,10,'first','old');for(let i=0;i<251;i++)await adjustRaw(a,1,'new',`new${i}`);assert.equal(await adjustRaw(a,10,'first','old'),false);await Promise.all([adjustRaw(a,1,'parallel','same'),adjustRaw(a,1,'parallel','same')]);assert.equal(a.system.wealth.value,262)});
await test('rejected delivery refunds the debit',async()=>{const a=actor('f',100,true),b=actor('g',0,true);failMessage=true; // another player owns recipient, sender does not
 b.testUserPermission=u=>u.isGM||u.id==='recipient';const receiver={id:'recipient',isGM:false};users.push(receiver);users.players.push(receiver);
 await assert.rejects(handleTransfer({fromUuid:a.uuid,toUuid:b.uuid,amount:10,note:''},'player'));failMessage=false;assert.equal(a.system.wealth.value,100);assert.equal(b.system.wealth.value,0)});
await test('non-owner cannot initiate a transfer',async()=>{const a=actor('h',100),b=actor('i',0);await assert.rejects(handleTransfer({fromUuid:a.uuid,toUuid:b.uuid,amount:10},'player'));assert.equal(a.system.wealth.value,100)});
console.log(JSON.stringify(rows,null,2));
