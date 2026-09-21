import test from 'node:test';
import assert from 'node:assert/strict';
import * as Clock from '../scripts/clock.mjs';
import { clockControls } from '../scripts/clock-ui.mjs';
import { mutate } from '../scripts/store.mjs';
import { runDocumentOperation, deliverScheduled } from '../scripts/documents-service.mjs';
import * as M from '../scripts/model.mjs';

let config,state,writes,advances,calendarStamp,refused=false;
const gm={id:'gm',isGM:true,isSelf:true}, player={id:'player',isGM:false};
const users=[gm,player];users.get=id=>users.find(u=>u.id===id);users.activeGM=gm;
function reset(){
 config={};writes=0;advances=[];calendarStamp=2000;refused=false;state=M.blankState();
 globalThis.foundry={utils:{deepClone:structuredClone}};
 globalThis.game={user:gm,users,modules:new Map(),time:{worldTime:100,advance:async seconds=>{advances.push(seconds);game.time.worldTime+=seconds;}},
 settings:{get:(_module,key)=>key==='worldClock'?config:key==='state'?state:undefined,
 set:async(_module,key,value)=>{writes++;if(refused)throw Error('write rejected');if(key==='worldClock')config=structuredClone(value);if(key==='state')state=structuredClone(value);}}};
 delete globalThis.SimpleCalendar;
 M.addDevice(state,{num:'1111-1111',owner:'player'});M.addDevice(state,{num:'2222-2222',owner:null});
}
function withCalendar(){
 game.modules.set(Clock.SIMPLE_CALENDAR,{active:true});
 globalThis.SimpleCalendar={api:{
 currentDateTime:id=>id&&id!=='night-city'&&id!=='active'?null:{year:2045,month:3,day:16,hour:23,minute:50,seconds:0},
 currentDateTimeDisplay:()=>({day:'17',month:'4',year:'2045',date:'April 17, 2045',time:'23:50:00'}),
 timestamp:()=>calendarStamp,getCurrentCalendar:()=>({id:'night-city'}),
 clockStatus:()=>({started:false}),changeDate:({seconds})=>{calendarStamp+=seconds;return true;}
 }};
}
test('reading clocks never creates campaign data; an unavailable calendar is explicit',()=>{
 reset();assert.equal(Clock.now().source,'local');assert.deepEqual(config,{});assert.equal(writes,0);
 withCalendar();assert.equal(Clock.now().label,'17.04.2045, 23:50');assert.equal(Clock.now().calendarId,'night-city');
 delete SimpleCalendar.api;assert.equal(Clock.now().source,'unavailable');assert.equal(writes,0);
});
test('manual world date is time-zone independent, crosses midnight and never moves time on initial setup',async()=>{
 reset();await Clock.setWorldDate('2045-04-17T23:50');
 assert.equal(game.time.worldTime,100);assert.equal(Clock.now().label,'17.04.2045, 23:50');
 await Clock.advanceClock(600);assert.equal(Clock.now().label,'18.04.2045, 00:00');assert.deepEqual(advances,[600]);
 await Clock.setWorldDate('2045-04-18T01:00');assert.equal(Clock.now().timeLabel,'01:00');assert.deepEqual(advances,[600,3600]);
 assert.throws(()=>Clock.setWorldDate('2045-02-30T12:00'));assert.throws(()=>Clock.advanceClock(-1));
});
test('only GM controls time; players see no mutation buttons',async()=>{
 reset();game.user=player;const before=JSON.stringify(config);
 assert.throws(()=>Clock.setWorldDate('2045-04-17T12:00'));assert.throws(()=>Clock.advanceClock(600));
 await assert.rejects(Clock.toggleCalendarClock());assert.equal(JSON.stringify(config),before);assert.equal(writes,0);
 assert.ok(!clockControls().includes('data-os="clockAdvance"'));assert.ok(!clockControls().includes('data-os="clockSet"'));
});
test('Simple Calendar is advanced once; a rejected API call never falls back to world time',async()=>{
 reset();withCalendar();await Clock.advanceClock(600);assert.equal(calendarStamp,2600);assert.deepEqual(advances,[]);
 SimpleCalendar.api.changeDate=()=>false;await assert.rejects(Clock.advanceClock(600));assert.deepEqual(advances,[]);
 assert.throws(()=>Clock.setWorldDate('2045-04-17T12:00'));
});
test('failed initial save leaves time untouched and does not poison the queue',async()=>{
 reset();refused=true;await assert.rejects(Clock.setWorldDate('2045-04-17T12:00'));assert.equal(Clock.now().source,'local');
 refused=false;await Clock.setWorldDate('2045-04-17T12:00');await Promise.all([Clock.advanceClock(600),Clock.advanceClock(600)]);
 assert.equal(Clock.now().timeLabel,'12:20');assert.deepEqual(advances,[600,600]);
});
test('Simple Calendar paused clock is shown as paused and can be stopped',async()=>{
 reset();withCalendar();let stopped=false;
 SimpleCalendar.api.clockStatus=()=>({started:false,paused:true,stopped:false});
 SimpleCalendar.api.stopClock=()=>{stopped=true;return true;};
 assert.equal(Clock.now().statusLabel,'Ход времени приостановлен');assert.equal(Clock.now().running,true);
 await Clock.toggleCalendarClock();assert.equal(stopped,true);
});
test('new private/group/call records get a GM time snapshot, while mission history and unread timestamps stay unchanged',async()=>{
 reset();withCalendar();
 M.pushMessage(state,'1111-1111','2222-2222','Старая миссия',1000);
 const original=structuredClone(state.threads);
 await mutate(s=>{
  M.pushMessage(s,'1111-1111','2222-2222','Новое сообщение',5000);
  s.conferences={room:{messages:[{ts:5000,x:'Группа'}]}};
  s.os={calls:{call:{createdAt:5000}}};
 });
 assert.deepEqual(state.threads['1111-1111|2222-2222'][0],original['1111-1111|2222-2222'][0]);
 const message=state.threads['1111-1111|2222-2222'][1];assert.equal(message.ts,5000);
 assert.equal(message.clock.label,'17.04.2045, 23:50');assert.equal(state.conferences.room.messages[0].clock.label,message.clock.label);
 assert.equal(state.os.calls.call.clock.label,message.clock.label);
 SimpleCalendar.api.currentDateTimeDisplay=()=>({day:'18',month:'4',year:'2045'});
 await mutate(s=>M.pushMessage(s,'1111-1111','2222-2222','Наутро',6000));
 assert.equal(Clock.messageTime(message),'17.04.2045, 23:50');assert.ok(!original['1111-1111|2222-2222'][0].clock);
});
test('calendar deadlines keep their calendar identity, pause if absent, and are independent of real/world clocks',()=>{
 reset();withCalendar();const entry=Clock.makeDeadline(10);
 assert.deepEqual(entry,{clock:'calendar',calendarId:'night-city',due:2600});
 game.time.worldTime=99999999;assert.equal(Clock.deadlineDue(entry),false);
 calendarStamp=2600;assert.equal(Clock.deadlineDue(entry),true);
 game.modules.clear();assert.equal(Clock.deadlineRemaining(entry),null);assert.equal(Clock.deadlineDue(entry),false);
 withCalendar();assert.equal(Clock.deadlineDue({...entry,calendarId:'deleted-calendar'}),false);
 assert.equal(Clock.makeDeadline(1,'real').clock,'real');
});
test('scheduled calendar messages deliver at the due time exactly once, including simultaneous ticks',async()=>{
 reset();withCalendar();
 await runDocumentOperation({op:'schedule',from:'2222-2222',to:'1111-1111',text:'Встреча',clock:'world',minutes:10},'gm');
 assert.equal(state.scheduled[0].clock,'calendar');assert.equal(await deliverScheduled(),false);
 game.time.worldTime=999999;assert.equal(await deliverScheduled(),false);
 calendarStamp+=600;await Promise.all([deliverScheduled(),deliverScheduled()]);
 assert.equal(state.scheduled[0].status,'sent');
 const history=M.thread(state,'1111-1111','2222-2222');assert.equal(history.length,1);assert.equal(history[0].clock.calendarTimestamp,2600);
});
