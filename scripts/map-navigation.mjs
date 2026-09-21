/** Map geometry is relative to the image, never to its scroll viewport. */
export const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
export function mapPoint(rect,x,y,{outside=false}={}) {
  if(!rect.width||!rect.height)return null;
  const px=(x-rect.left)/rect.width*100,py=(y-rect.top)/rect.height*100;
  if(!outside&&(px<0||px>100||py<0||py>100))return null;
  return {x:Math.round(clamp(px,0,100)*100)/100,y:Math.round(clamp(py,0,100)*100)/100};
}
export function mapLayout(vw,vh,iw,ih,zoom=1) {
  if(![vw,vh,iw,ih].every(n=>Number.isFinite(n)&&n>0))return null;
  const scale=Math.min(vw/iw,vh/ih)*clamp(zoom,1,8),width=iw*scale,height=ih*scale;
  return {width,height,left:Math.max(0,(vw-width)/2),top:Math.max(0,(vh-height)/2),areaWidth:Math.max(vw,width),areaHeight:Math.max(vh,height)};
}
export function mapScroll(layout,point,anchor,vw,vh) {
  return {left:clamp(layout.left+point.x/100*layout.width-anchor.x,0,Math.max(0,layout.areaWidth-vw)),
    top:clamp(layout.top+point.y/100*layout.height-anchor.y,0,Math.max(0,layout.areaHeight-vh))};
}

/** Local navigation; only the supplied callbacks may write campaign state. */
export function bindMapNavigation(app,{isGM,create,move,onError}) {
  const root=app.element,viewport=root.querySelector('.os-map-viewport');
  if(!viewport)return null;
  const stage=viewport.querySelector('.os-map-stage'),area=viewport.querySelector('.os-map-area'),image=stage.querySelector('img');
  const source=image.getAttribute('src'),abort=new AbortController(),signal=abort.signal;
  let disposed=false,drag=null,layout=null,suppressClick=false,saving=false;
  const previous=app.osMapView;
  const view=app.osMapView=previous?.source===source?previous:{source,zoom:1,x:50,y:50};
  const listen=(el,event,fn,options={})=>el?.addEventListener(event,fn,{...options,signal});
  const status=root.querySelector('.os-map-status'),cancel=root.querySelector('[data-map-action="cancel"]');
  const ready=()=>image.naturalWidth>0&&Boolean(layout);
  function remember(){
    if(!layout||disposed)return;
    view.x=clamp((viewport.scrollLeft+viewport.clientWidth/2-layout.left)/layout.width*100,0,100);
    view.y=clamp((viewport.scrollTop+viewport.clientHeight/2-layout.top)/layout.height*100,0,100);
  }
  function paint(point={x:view.x,y:view.y},anchor={x:viewport.clientWidth/2,y:viewport.clientHeight/2}) {
    if(disposed)return;
    layout=mapLayout(viewport.clientWidth,viewport.clientHeight,image.naturalWidth,image.naturalHeight,view.zoom);
    if(!layout)return;
    Object.assign(area.style,{width:`${layout.areaWidth}px`,height:`${layout.areaHeight}px`});
    Object.assign(stage.style,{width:`${layout.width}px`,height:`${layout.height}px`,left:`${layout.left}px`,top:`${layout.top}px`});
    const scroll=mapScroll(layout,point,anchor,viewport.clientWidth,viewport.clientHeight);
    viewport.scrollLeft=scroll.left;viewport.scrollTop=scroll.top;
    const label=root.querySelector('.os-map-scale');if(label)label.textContent=`${Math.round(view.zoom*100)}%`;
    remember();
  }
  function mode(value=null){
    app.osMapMode=isGM?value:null;
    viewport.classList.toggle('is-placing',Boolean(app.osMapMode));
    if(cancel)cancel.hidden=!app.osMapMode;
    root.querySelector('[data-map-action="add"]')?.setAttribute('aria-pressed',String(app.osMapMode==='add'));
    if(status)status.textContent=app.osMapMode==='add'?'Щёлкните по карте, чтобы добавить метку. Enter — центр экрана, Esc — отмена.':app.osMapMode?'Щёлкните по новому месту метки. Enter — центр экрана, Esc — отмена.':'Тяните карту мышью. Колесо — масштаб. Стрелки — перемещение.';
  }
  function zoom(next,client){
    if(!ready()||drag)return;
    const rect=viewport.getBoundingClientRect(),anchor=client?{x:client.x-rect.left-viewport.clientLeft,y:client.y-rect.top-viewport.clientTop}:{x:viewport.clientWidth/2,y:viewport.clientHeight/2};
    const point={x:(viewport.scrollLeft+anchor.x-layout.left)/layout.width*100,y:(viewport.scrollTop+anchor.y-layout.top)/layout.height*100};
    view.zoom=clamp(next,1,8);paint(point,anchor);
  }
  async function persist(id,point){
    if(saving||app.osBusy||!point)return;
    saving=true;mode();
    try{await move(id,point);}catch(error){onError(error);}finally{saving=false;if(!app.closing)app.render();}
  }
  function placeAt(x,y){
    const point=mapPoint(stage.getBoundingClientRect(),x,y);if(!point)return;
    const action=app.osMapMode;mode();
    if(action==='add')void Promise.resolve(create(point)).catch(onError);else void persist(action,point);
  }
  function focus(id){
    const pin=[...stage.querySelectorAll('.os-map-pin')].find(p=>p.dataset.id===id);
    if(!pin||!ready())return;
    view.zoom=Math.max(2,view.zoom);paint({x:Number(pin.dataset.x),y:Number(pin.dataset.y)});
  }
  function endDrag(rollback=false){
    if(!drag)return;
    if(rollback&&drag.pin){drag.pin.style.left=drag.oldLeft;drag.pin.style.top=drag.oldTop;}
    const pointer=drag.pointer;drag=null;
    if(viewport.hasPointerCapture(pointer))viewport.releasePointerCapture(pointer);
    viewport.classList.remove('is-dragging');
  }
  listen(viewport,'pointerdown',event=>{
    if(event.button!==0||!ready()||app.osBusy||saving)return;
    const pin=event.target.closest('.os-map-pin');
    if(pin&&!isGM&&!app.osMapMode)return;
    viewport.focus({preventScroll:true});suppressClick=false;
    drag={pointer:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,pin:app.osMapMode?null:pin,oldLeft:pin?.style.left,oldTop:pin?.style.top,moved:false};
    if(drag.pin){const rect=stage.getBoundingClientRect();drag.offsetX=event.clientX-rect.left-Number(pin.dataset.x)/100*rect.width;drag.offsetY=event.clientY-rect.top-Number(pin.dataset.y)/100*rect.height;}
    viewport.setPointerCapture(event.pointerId);
    // Pointer capture handles the gesture without native image dragging.
    event.preventDefault();
  });
  listen(viewport,'pointermove',event=>{
    if(!drag||drag.pointer!==event.pointerId)return;
    if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5&&!drag.moved)return;
    drag.moved=true;viewport.classList.add('is-dragging');
    if(drag.pin){const p=mapPoint(stage.getBoundingClientRect(),event.clientX-drag.offsetX,event.clientY-drag.offsetY,{outside:true});drag.point=p;drag.pin.style.left=`${p.x}%`;drag.pin.style.top=`${p.y}%`;}
    else{viewport.scrollLeft=drag.left-(event.clientX-drag.x);viewport.scrollTop=drag.top-(event.clientY-drag.y);remember();}
  });
  listen(viewport,'pointerup',event=>{
    if(!drag||drag.pointer!==event.pointerId)return;
    const gesture=drag;endDrag();
    if(gesture.moved){suppressClick=true;if(gesture.pin)void persist(gesture.pin.dataset.id,gesture.point);return;}
    if(app.osMapMode){
      suppressClick=true;placeAt(event.clientX,event.clientY);
    }else if(gesture.pin){
      // Captured pointer clicks target the viewport, so explicitly select the pin.
      suppressClick=true;gesture.pin.click();
    }
  });
  listen(viewport,'pointercancel',()=>{endDrag(true);suppressClick=true;});
  listen(viewport,'lostpointercapture',()=>endDrag(true));
  listen(viewport,'click',event=>{if(suppressClick&&event.isTrusted){event.preventDefault();event.stopPropagation();suppressClick=false;}}, {capture:true});
  listen(viewport,'dragstart',event=>event.preventDefault());
  listen(viewport,'wheel',event=>{if(!ready())return;event.preventDefault();event.stopPropagation();zoom(view.zoom*Math.exp(-clamp(event.deltaY*(event.deltaMode===1?16:1),-120,120)*.0025),{x:event.clientX,y:event.clientY});},{passive:false});
  listen(viewport,'scroll',()=>remember(),{passive:true});
  listen(root,'keydown',event=>{
    if(event.key==='Escape'&&(app.osMapMode||drag)){event.preventDefault();event.stopPropagation();endDrag(true);mode();return;}
    if(event.target!==viewport)return;
    if(event.key==='Enter'&&app.osMapMode&&ready()){event.preventDefault();const r=viewport.getBoundingClientRect();placeAt(r.left+viewport.clientLeft+viewport.clientWidth/2,r.top+viewport.clientTop+viewport.clientHeight/2);}
    const direction={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]}[event.key];
    if(direction){event.preventDefault();viewport.scrollLeft+=direction[0];viewport.scrollTop+=direction[1];remember();}
    if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0'){view.zoom=1;paint({x:50,y:50});}else zoom(view.zoom*(event.key==='-'?.8:1.25));}
  },{capture:true});
  for(const button of root.querySelectorAll('[data-map-action]'))listen(button,'click',()=>{
    const action=button.dataset.mapAction;
    if(action==='add'||action==='move'){if(!isGM||app.osBusy||saving)return;mode(action==='add'?(app.osMapMode==='add'?null:'add'):button.dataset.id);viewport.focus({preventScroll:true});}
    if(action==='cancel')mode();
    if(action==='in'||action==='out')zoom(view.zoom*(action==='in'?1.25:.8));
    if(action==='fit'){view.zoom=1;paint({x:50,y:50});}
    if(action==='focus')focus(button.dataset.id);
  });
  const loaded=()=>{paint();if(app.osMapFocus){focus(app.osMapFocus);app.osMapFocus=null;}};
  listen(image,'load',loaded);listen(image,'error',()=>{if(status)status.textContent='Карта не загрузилась. Проверьте путь к изображению в настройках карты.';});
  const observer=new ResizeObserver(()=>paint());observer.observe(viewport);
  mode(app.osMapMode);loaded();
  return {destroy(){disposed=true;endDrag(true);abort.abort();observer.disconnect();}};
}
