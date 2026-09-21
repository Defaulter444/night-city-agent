import test from 'node:test';
import assert from 'node:assert/strict';
import {mapPoint,mapLayout,mapScroll} from '../scripts/map-navigation.mjs';
import {applyOSOperation,projectOS} from '../scripts/os-model.mjs';
import {blankState,addDevice} from '../scripts/model.mjs';

test('fit contains the whole image and centers its unused dimension',()=>{
  const landscape=mapLayout(600,400,3000,1000);
  assert.deepEqual(landscape,{width:600,height:200,left:0,top:100,areaWidth:600,areaHeight:400});
  const portrait=mapLayout(600,400,1000,2000);
  assert.equal(portrait.width,200);assert.equal(portrait.left,200);assert.equal(portrait.height,400);
  assert.equal(mapLayout(0,400,1000,2000),null);
});
test('pin coordinates use the rendered image after pan and zoom, excluding letterbox margins',()=>{
  assert.deepEqual(mapPoint({left:-120,top:75,width:1200,height:600},780,225),{x:75,y:25});
  assert.equal(mapPoint({left:200,top:0,width:200,height:400},150,200),null);
  assert.equal(mapPoint({left:0,top:0,width:0,height:0},0,0),null);
  assert.deepEqual(mapPoint({left:0,top:0,width:100,height:100},-20,140,{outside:true}),{x:0,y:100});
});
test('zoom keeps the map coordinate under the cursor fixed while scroll is available',()=>{
  const layout=mapLayout(600,400,1200,800,3),point={x:40,y:55},anchor={x:200,y:150};
  const offset=mapScroll(layout,point,anchor,600,400);
  assert.equal(layout.left+layout.width*.4-offset.left,anchor.x);
  assert.equal(layout.top+layout.height*.55-offset.top,anchor.y);
  const fit=mapLayout(600,400,1200,800,1);
  assert.deepEqual(mapScroll(fit,point,anchor,600,400),{left:0,top:0});
});
test('zoom limits and edge focus never scroll outside the image area',()=>{
  const layout=mapLayout(600,400,1200,800,100);
  assert.equal(layout.width,4800);
  assert.deepEqual(mapScroll(layout,{x:100,y:100},{x:300,y:200},600,400),{left:4200,top:2800});
  assert.equal(mapLayout(600,400,1200,800,.5).width,600);
});
function fixture(){
  const state=blankState(),gm={id:'gm',isGM:true},player={id:'p'};
  addDevice(state,{num:'1000-0001',owner:null});addDevice(state,{num:'1000-0002',owner:'p'});
  const id=applyOSOperation(state,{op:'place',number:'1000-0001',title:'Миссия',body:'Старое описание',x:30,y:40,published:false,public:false,numbers:['1000-0002']},gm,1000);
  return{state,gm,player,id};
}
test('moving a pin preserves its id, description, audience and every other mission record',()=>{
  const{state,gm,id}=fixture();state.os.jobs={existing:{title:'Текущая миссия',placeId:id}};
  const before=structuredClone(state);
  applyOSOperation(state,{op:'placeMove',number:'1000-0001',id,x:67.32,y:14.65,title:'spoof',published:true,public:true},gm,2000);
  const expected=structuredClone(before);Object.assign(expected.os.places[id],{x:67.32,y:14.65,updatedAt:2000});
  assert.deepEqual(state,expected);
  assert.equal(projectOS(state,{id:'p'}).places[id],undefined);
});
test('players cannot move pins and invalid or deleted pins leave the campaign intact',()=>{
  const{state,gm,player,id}=fixture(),before=structuredClone(state);
  assert.throws(()=>applyOSOperation(state,{op:'placeMove',number:'1000-0002',id,x:10,y:20,isGM:true},player),/мастеру/);
  for(const extra of [{x:-1},{y:101},{x:NaN},{y:Infinity},{x:null},{x:''},{y:false},{id:'missing'},{id:'__proto__'}]){
    assert.throws(()=>applyOSOperation(state,{op:'placeMove',number:'1000-0001',id,x:0,y:100,...extra},gm));
    assert.deepEqual(state,before);
  }
  applyOSOperation(state,{op:'placeMove',number:'1000-0001',id,x:0,y:100},gm);
  assert.equal(state.os.places[id].x,0);assert.equal(state.os.places[id].y,100);
});
