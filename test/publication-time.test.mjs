import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { publicationValue, publicationFormValues, publicationLabel, comparePublications } from '../scripts/publication-time.mjs';
import { blankState, addDevice } from '../scripts/model.mjs';
import { applyOSOperation, projectOS } from '../scripts/os-model.mjs';

const gm={id:'gm',isGM:true}, player={id:'p'}, other={id:'q'}, number='1111-1111';
function fixture() {
  const state=blankState();addDevice(state,{num:number,owner:player.id});return state;
}
function article(state,data={},user=gm,now=1000) {
  return applyOSOperation(state,{op:'article',number,title:'Новость',published:true,numbers:[number],...data},user,now);
}

test('GM sets and edits a publication date while real creation time stays intact',()=>{
  const state=fixture();
  const id=article(state,{publicationDate:'2045-09-29',publicationTime:'23:40'});
  assert.equal(state.os.articles[id].publicationAt,'2045-09-29T23:40');
  assert.equal(state.os.articles[id].createdAt,1000);
  article(state,{id,body:'Исправлено',publicationDate:'2045-09-30',publicationTime:'00:10'},gm,5000);
  assert.equal(state.os.articles[id].publicationAt,'2045-09-30T00:10');
  assert.equal(state.os.articles[id].createdAt,1000);
  assert.equal(state.os.articles[id].updatedAt,5000);
  article(state,{id,title:'Правка старым клиентом'},gm,9000);
  assert.equal(state.os.articles[id].publicationAt,'2045-09-30T00:10');
  assert.equal(projectOS(state,player).articles[id].publicationAt,'2045-09-30T00:10');
  assert.equal(projectOS(state,other).articles[id],undefined);
});

test('players cannot create or alter dated news, and dates never grant visibility',()=>{
  const state=fixture();
  assert.throws(()=>article(state,{publicationDate:'2045-09-30',publicationTime:'00:10'},player),/мастер/);
  const id=article(state,{publicationDate:'9999-12-31',publicationTime:'23:59',published:false,public:true});
  assert.equal(projectOS(state,player).articles[id],undefined);
  article(state,{id,publicationDate:'9999-12-31',publicationTime:'23:59',published:true,public:true});
  assert.ok(projectOS(state,player).articles[id]);
});

test('legacy records keep their dates until the GM explicitly changes them',()=>{
  const state=fixture(),id=article(state);
  assert.equal(Object.hasOwn(state.os.articles[id],'publicationAt'),false);
  const before=structuredClone(state.os.articles[id]);
  article(state,{id,title:'Исправлено'},gm,2000);
  assert.equal(state.os.articles[id].createdAt,before.createdAt);
  assert.equal(Object.hasOwn(state.os.articles[id],'publicationAt'),false);
  assert.deepEqual(publicationFormValues(state.os.articles[id]),publicationFormValues(before));
});

test('real Gregorian dates, leap days, boundaries and complete minute precision are validated',()=>{
  for(const [date,time] of [['2044-02-29','23:59'],['0001-01-01','00:00'],['0099-12-31','01:05'],['2000-02-29','12:00'],['9999-12-31','23:59']])
    assert.equal(publicationValue(date,time),`${date}T${time}`);
  for(const [date,time] of [['2045-02-29','00:00'],['1900-02-29','00:00'],['2045-04-31','00:00'],['2045-00-01','00:00'],['0000-01-01','00:00'],['10000-01-01','00:00'],['2045-01-01','24:00'],['2045-01-01','00:60'],['2045-01-01','0:10'],['2045-01-01','00:10\n'],['2045-01-01',''],['','00:00'],[null,'00:00']]) {
    assert.throws(()=>publicationValue(date,time),/дату и время/);
    const state=fixture();assert.throws(()=>article(state,{publicationDate:date,publicationTime:time}));
    assert.equal(Object.keys(state.os?.articles??{}).length,0);
  }
  const state=fixture(),id=article(state,{publicationDate:'2045-09-30',publicationTime:'12:00'}),before=structuredClone(state.os.articles[id]);
  assert.throws(()=>article(state,{id,publicationDate:'2045-02-30',publicationTime:'00:00'}));
  assert.deepEqual(state.os.articles[id],before);
  assert.throws(()=>article(state,{publicationDate:'2045-09-30'}));
});

test('form defaults use the game clock, saved values survive a later calendar date',()=>{
  const clock={dateLabel:'30.09.2045',timeLabel:'23:40'};
  assert.deepEqual(publicationFormValues({},clock),{date:'2045-09-30',time:'23:40'});
  assert.deepEqual(publicationFormValues({publicationAt:'2045-01-01T10:05'},clock),{date:'2045-01-01',time:'10:05'});
  assert.deepEqual(publicationFormValues({}, {dateLabel:'Календарь недоступен',timeLabel:'—'}),{date:'',time:''});
  assert.deepEqual(publicationFormValues({}, {dateLabel:'31.02.2045',timeLabel:'12:00'}),{date:'',time:''});
});

test('feed order follows publication time with stable ties and an unchanged legacy fallback',()=>{
  const records=[
    {id:'early',publicationAt:'2045-09-30T00:10',createdAt:3000},
    {id:'late',publicationAt:'2045-09-30T23:40',createdAt:1000},
    {id:'same-time-newer',publicationAt:'2045-09-30T23:40',createdAt:2000},
    {id:'legacy',createdAt:Date.UTC(2026,8,30)},
  ];
  assert.deepEqual([...records].sort(comparePublications).map(a=>a.id),['same-time-newer','late','early','legacy']);
  assert.equal(publicationLabel(records[0]),'30.09.2045, 00:10');
  assert.equal(publicationLabel({publicationAt:'0099-12-31T23:59'}),'31.12.0099, 23:59');
  assert.equal(publicationLabel({publicationAt:'<script>'}),'Дата не указана');
});

test('manual dates and order are identical in different viewer timezones',()=>{
  const moduleUrl=new URL('../scripts/publication-time.mjs',import.meta.url).href;
  const code=`import {publicationLabel,comparePublications,publicationFormValues} from ${JSON.stringify(moduleUrl)}; const a={id:'a',publicationAt:'2045-09-30T00:10'},b={id:'b',publicationAt:'2045-09-29T23:59'};console.log(JSON.stringify([publicationLabel(a),publicationFormValues(a),[b,a].sort(comparePublications).map(x=>x.id)]));`;
  const outputs=['UTC','Europe/Moscow','America/Los_Angeles'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,TZ}}));
  assert.equal(outputs[0],outputs[1]);assert.equal(outputs[1],outputs[2]);
});
