import { readState, MODULE_ID, storageLocked } from './store.mjs';
import { osOperation, documentOperation, sendMailing, setBook, markRead } from './socket.mjs';
import { inputDialog, openWorkspace } from './workspace-app.mjs';
import { editDocumentDialog } from './document-editor.mjs';
import { contactLabel, contactsFor, normalizeNumber } from './model.mjs';
import { uid, canEditDocument } from './documents-model.mjs';
import { shrinkImage, ALLOWED_TYPES } from './images.mjs';
import { esc, makeDeadline, deadlineDue, deadlineRemaining } from './clock.mjs';
import { clockAction, updateClockElements } from './clock-ui.mjs';
import { openNoteResult } from './notes.mjs';
import { JOB_STATES, PLACE_TYPES, OS_TABS, DEFAULT_CITY_MAP } from './os-model.mjs';
import { actorForDevice, transfer, hasLedger, isNPCDevice, payFromNPC } from './wealth.mjs';
import { clearOpenThread } from './presence.mjs';
import { stopRing, ringKey } from './ringtone.mjs';
import { bindMapNavigation } from './map-navigation.mjs';
const field=(name,label,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const area=(name,label,value='',rows=4)=>`<label>${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const select=(name,label,options,value='')=>`<label>${esc(label)}<select name="${name}">${Object.entries(options).map(([v,s])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(s)}</option>`).join('')}</select></label>`;
const check=(name,label,checked=false)=>`<label class="os-form-check"><input type="checkbox" name="${name}" ${checked?'checked':''}>${esc(label)}</label>`;
function imageFields(value='') { return field('image','Путь или ссылка на изображение',value.startsWith('data:')?'':value)+`<label>Или изображение с компьютера<input type="file" name="upload" accept="${ALLOWED_TYPES.join(',')}"></label>`+check('clearImage','Убрать изображение')+(value?'<p class="hint">Текущее изображение сохранится, если не выбрать новое.</p>':''); }
async function imageValue(fd,old='',maxBytes=1500000) {
  if(fd.has('clearImage'))return '';
  const file=fd.get('upload');if(file?.size)return shrinkImage(file,{maxBytes,maxSide:maxBytes<300000?512:1600,outputType:'image/webp'});
  return String(fd.get('image')||'').trim()||old;
}
function audience(state,record={}) {
  if(!game.user.isGM)return '<p class="hint">Личное задание доступно вам и мастеру.</p>';
  return `<fieldset class="os-audience"><legend>Доступ</legend>${check('published','Опубликовать для игроков',record.published)}${check('public','Для всех Агентов',record.public)}<p class="hint">Либо выберите отдельные номера:</p>${Object.values(state.devices).map(d=>check(`aud-${d.num}`,`${d.label||d.num} · ${d.num}`,record.numbers?.includes(d.num))).join('')}</fieldset>`;
}
function audienceData(fd,state) {return {published:fd.has('published'),public:fd.has('public'),numbers:Object.keys(state.devices).filter(n=>fd.has(`aud-${n}`))};}
function chooseNumbers(state,number,{exclude=[],selected=[]}={}) {
  const contacts=game.user.isGM?Object.values(state.devices).map(d=>({num:d.num,name:contactLabel(state,number,d.num)===d.num?d.label||d.num:contactLabel(state,number,d.num)})):contactsFor(state,number);
  return `<fieldset class="nca-member-picker"><legend>Участники</legend>${contacts.filter(c=>c.num!==number&&!exclude.includes(c.num)).map(c=>`<label class="nca-member-choice"><input type="checkbox" name="members" value="${c.num}" ${selected.includes(c.num)?'checked':''}><span>${esc(c.name)}<small>${c.num}</small></span></label>`).join('')}</fieldset>`+field('extra','Дополнительные номера через запятую');
}
const memberValues=fd=>[...new Set([...fd.getAll('members'),...String(fd.get('extra')||'').split(/[,;]+/).filter(s=>s.trim())].map(normalizeNumber))];
export function selectOSDocument(app,id) {
  app.osDocId=id;app.osTab='files';app.osFileType='';app.osFolder='';(app.osSearch??={}).files='';
}
async function sendTextDialog(state,number,title,text) {
  const operationId=uid();
  return inputDialog(title,area('text','Сообщение',text)+chooseNumbers(state,number),fd=>sendMailing(number,memberValues(fd),fd.get('text'),operationId),{saveLabel:'Отправить'});
}
export async function performOS(app,event,target) {
  const op=target.dataset.os;
  if(app.osBusy)return;
  app.osBusy=true;
  try {
    if(op.startsWith('clock')){await clockAction(op,target);return;}
    await app.saveDraft();
    if(storageLocked())throw Error('Сначала откройте хранилище');
    const state=readState(),number=app.num,os=state.os??{},user=game.user;
    const mutate=(action,data={})=>osOperation(action,{number,...data});
    if(op==='nav') { if(!OS_TABS.some(([key])=>key===target.dataset.tab))return; app.osTab=target.dataset.tab;clearOpenThread(number);return; }
    if(op==='message') {app.other=target.dataset.num;app.osTab='messages';await stopRing(ringKey(number,app.other));await markRead(number,app.other);return;}
    if(op==='contactFilter'){app.osContactFilter=target.dataset.filter;return;}
    if(op==='jobFilter'){app.osJobArchive=target.dataset.filter==='archive';return;}
    if(op==='newsFilter'){app.osSavedOnly=!app.osSavedOnly;return;}
    if(op==='fileFilter'){app.osFileType=target.dataset.filter;return;}
    if(op==='documentSelect'){app.osDocId=target.dataset.id;return;}
    if(op==='placeSelect'||op==='gotoPlace'){
      app.osPlaceId=target.dataset.id;app.osTab='map';
      if(op==='gotoPlace'||target.dataset.focus){app.osMapFocus=target.dataset.id;app.osMapCategory='';(app.osSearch??={}).map='';}
      return;
    }
    if(op==='callSelect'){app.osCallId=target.dataset.id;return;}
    if(op==='callScope'){if(!user.isGM)throw Error('Доступно только мастеру');app.osCallScope=target.dataset.scope==='mine'?'mine':'all';app.osCallId=null;return;}
    if(op==='callFilter'){app.osCallFilter=target.dataset.filter;app.osCallId=null;return;}
    if(op==='workspace'){openWorkspace({number,tab:target.dataset.tab||'files'});return;}
    if(op==='favorite'||op==='contact') {
      const other=target.dataset.num,old=os.contacts?.[number]?.[other]??{};
      if(op==='favorite'){await mutate('contact',{other,...old,favorite:!old.favorite});return;}
      await inputDialog('Карточка контакта',field('name','Имя в вашей адресной книге',state.devices[number]?.book?.[other]||'')+`<p class="hint">Номер: ${esc(other)}</p>`+field('category','Категория',old.category)+area('note','Ваша заметка',old.note)+check('favorite','Избранный контакт',old.favorite)+imageFields(old.avatar||''),async fd=>{
        const avatar=await imageValue(fd,old.avatar,250000);
        await mutate('contact',{other,category:fd.get('category'),note:fd.get('note'),favorite:fd.has('favorite'),avatar});
        await setBook(number,other,fd.get('name')||other);
      });return;
    }
    if(op==='profile') {
      const p=os.profiles?.[number]??{};
      await inputDialog('Профиль Агента',field('name','Позывной',p.name||state.devices[number]?.label)+field('role','Роль или занятие',p.role)+area('bio','О себе',p.bio,2)+select('status','Статус персонажа',{online:'На связи',away:'Занят',offline:'Недоступен'},p.status||'online')+imageFields(p.avatar||''),async fd=>mutate('profile',{name:fd.get('name'),role:fd.get('role'),bio:fd.get('bio'),status:fd.get('status'),avatar:await imageValue(fd,p.avatar,250000)}));return;
    }
    if(['job','place','article'].includes(op)) {
      const collection={job:'jobs',place:'places',article:'articles'}[op],old=os[collection]?.[target.dataset.id]??{};
      let form=field('title','Название',old.title,'text','required maxlength="160"')+area('body','Описание',old.body);
      if(op==='job') form+=select('status','Состояние',JOB_STATES,old.status||'planned')+field('reward','Награда, эдди',old.reward||0,'number','min="0" step="1"')+field('fixer','Заказчик',old.fixer)+field('due','Игровой срок',old.due,'text','placeholder="Сегодня, 23:00"')+select('placeId','Место',{'':'Без привязки',...Object.fromEntries(Object.values(os.places??{}).map(p=>[p.id,p.title]))},old.placeId)+area('steps','Этапы — по одному на строку',(old.steps??[]).map(s=>s.label).join('\n'));
      if(op==='place') form+=select('category','Категория',PLACE_TYPES,old.category||'place')+field('district','Район',old.district)+field('contact','Номер контакта',old.contact)+'<details class="os-map-coordinates"><summary>Точные координаты</summary>'+field('x','Положение по горизонтали, %',old.x??target.dataset.mapX??50,'number','min="0" max="100" step="0.01"')+field('y','Положение по вертикали, %',old.y??target.dataset.mapY??50,'number','min="0" max="100" step="0.01"')+'</details>';
      if(op==='article')form+=field('source','Источник',old.source)+field('category','Раздел',old.category||'Новости');
      form+=imageFields(old.image||'')+audience(state,old);
      const rid=await inputDialog({job:'Задание',place:'Место на карте',article:'Публикация Data Pool'}[op],form,async fd=>mutate(op,{...Object.fromEntries([...fd.entries()].filter(([k])=>!k.startsWith('aud-')&&k!=='upload')),id:old.id,...audienceData(fd,state),image:await imageValue(fd,old.image)}));
      if(rid&&op==='place'){app.osPlaceId=rid;app.osMapCategory='';(app.osSearch??={}).map='';}return;
    }
    if(op==='mapEdit') {
      const old=os.map??{};
      await inputDialog('Карта и город',field('title','Название карты',old.title||'Найт-Сити')+field('location','Текущее место группы',old.location)+field('weather','Погода в вашей кампании',old.weather)+imageFields(old.image||''),async fd=>mutate('map',{title:fd.get('title'),location:fd.get('location'),weather:fd.get('weather'),image:await imageValue(fd,old.image,4000000)}));return;
    }
    if(op==='defaultMap'){await mutate('map',{...os.map,title:'Найт-Сити 2045',image:DEFAULT_CITY_MAP});app.osMapView=null;app.osMapMode=null;return;}
    if(op==='reminder') {
      await inputDialog('Напоминание',field('title','О чём напомнить','','text','required')+field('minutes','Через сколько минут',30,'number','min="1" max="525600" required')+select('clock','По каким часам',{world:'Игровое время Foundry',real:'Реальное время'},'world')+'<p class="hint">Напоминание появится при достижении срока. Игровые часы продвигает мастер.</p>',fd=>{
        const minutes=Number(fd.get('minutes'));if(!Number.isFinite(minutes)||minutes<1||minutes>525600)throw Error('От 1 до 525600 минут');
        return mutate('reminder',{title:fd.get('title'),...makeDeadline(minutes,fd.get('clock'))});
      });return;
    }
    if(op==='bookmark'){await mutate('saveArticle',{id:target.dataset.id});return;}
    if(op==='articleFile') {
      const a=os.articles?.[target.dataset.id];if(!a)throw Error('Статья недоступна');
      const embedded=a.image?.startsWith('data:');
      selectOSDocument(app,await documentOperation('createDocument',{number,title:a.title,body:a.body+(!embedded&&a.image?'\n\nИзображение: '+a.image:''),source:a.source,images:embedded?[{name:a.title,src:a.image}]:[]}));return;
    }
    if(['shareArticle','sharePlace','shareJob'].includes(op)) {
      const record=os[{shareArticle:'articles',sharePlace:'places',shareJob:'jobs'}[op]]?.[target.dataset.id];if(!record)throw Error('Запись недоступна');
      await sendTextDialog(state,number,'Поделиться',`${record.title}\n${record.body}${record.district?'\nРайон: '+record.district:''}${record.due?'\nСрок: '+record.due:''}`);return;
    }
    if(op==='documentNew'||op==='documentEdit') {
      const doc=op==='documentEdit'?state.documents?.[target.dataset.id]:null;
      const authors=user.isGM?{authors:game.users.map(u=>({id:u.id,name:u.name})),authorId:doc?.authorId??user.id}:undefined;
      const rid=await editDocumentDialog(doc,fields=>documentOperation('createDocument',{id:doc?.id,number,...fields}),authors);
      if(rid)selectOSDocument(app,rid);return;
    }
    if(op==='fileMeta') {
      const doc=state.documents?.[target.dataset.id];if(!doc)throw Error('Файл недоступен');const old=os.fileMeta?.[number]?.[doc.id]??{};
      await inputDialog('Организация файла',field('folder','Папка',old.folder)+field('tags','Метки через запятую',old.tags?.join(', '))+check('favorite','Избранный файл',old.favorite)+'<p class="hint">Эти метки и папка относятся к вашему Агенту.</p>',fd=>mutate('fileMeta',{id:doc.id,folder:fd.get('folder'),tags:fd.get('tags'),favorite:fd.has('favorite')}));return;
    }
    if(op==='documentSend') {
      const doc=state.documents?.[target.dataset.id];if(!doc)throw Error('Файл недоступен');
      await inputDialog('Передать файл',field('to','Номер получателя',app.other||'')+area('text','Сообщение','',2),fd=>documentOperation('sendDocument',{from:number,to:normalizeNumber(fd.get('to')),documentId:doc.id,text:fd.get('text')}));return;
    }
    if(op==='documentExport') {
      const doc=state.documents?.[target.dataset.id];if(!doc)throw Error('Файл недоступен');
      saveDataToFile(JSON.stringify({title:doc.title,body:doc.body,source:doc.source,images:doc.images??[]},null,2),'application/json',`agent-file-${doc.id}.json`);return;
    }
    if(op==='documentWorkspace'){openWorkspace({number,documentId:target.dataset.id,tab:'files'});return;}
    if(op==='documentImage') {
      const doc=state.documents?.[target.dataset.id],image=doc?.images?.[Number(target.dataset.index)];if(!image)throw Error('Картинка недоступна');
      new ImagePopout(image.src,{title:doc.title,shareable:false}).render(true);return;
    }
    if(op==='notePage') {
      const owner=user.isGM?(state.devices[number]?.owner||user.id):user.id;
      await openNoteResult({journalId:game.settings.get(MODULE_ID,'noteJournals')?.[owner],pageId:target.dataset.page});return;
    }
    if(op==='pay') {
      if(user.isGM&&isNPCDevice(state.devices[number])) {
        const recipients=Object.values(state.devices).filter(d=>d.owner&&game.users.get(d.owner)&&!game.users.get(d.owner).isGM);
        const choices=Object.fromEntries(recipients.map(d=>[d.num,`${d.label||contactLabel(state,number,d.num)} · ${d.num}`]));
        const sources=Object.fromEntries(game.actors.filter(hasLedger).map(a=>[a.uuid,`${a.name} · ${a.system.wealth.value} эдди`]));
        const operationId=uid(),label=os.profiles?.[number]?.name||state.devices[number].label||number;
        await inputDialog('Выплата от НПС',`<p>Отправитель: <strong>${esc(label)} · ${esc(number)}</strong></p>`+select('to','Агент игрока',{'':'Выберите получателя',...choices},target.dataset.num||app.other||'')+field('amount','Сумма',1,'number','min="1" step="1" required')+select('sourceUuid','Источник средств',{'':'Выплата мастера — без списания',...sources},'')+field('note','Назначение платежа')+'<p class="hint">Без списания: мастер начисляет сумму от имени НПС. Если выбрать лист, сумма спишется с его счёта. Получателю деньги зачисляются сразу; в истории сохранятся имя и номер НПС.</p>',async fd=>{
          const result=await payFromNPC({from:number,to:fd.get('to'),amount:Number(fd.get('amount')),sourceUuid:fd.get('sourceUuid'),note:fd.get('note'),operationId});
          ui.notifications.info(`${result.replayed?'Уже зачислено':'Зачислено'}: ${result.amount} эдди · ${result.actorName}`);
        },{saveLabel:'Перевести'});return;
      }
      const actor=actorForDevice(state.devices[number]);if(!actor||!hasLedger(actor))throw Error('Назначьте персонажа владельцу Агента');
      await inputDialog('Перевести эдди',field('to','Номер получателя',target.dataset.num||app.other||'')+field('amount','Сумма',1,'number','min="1" step="1" required')+field('note','Назначение платежа'),async fd=>{
        const to=normalizeNumber(fd.get('to')),device=state.devices[to];
        if(!device)throw Error('Получатель не найден');
        // Ownerless NPC wallets must be explicitly bound; never reuse the selected sender token.
        if(!device.owner)throw Error('Для НПС используйте перевод через выбранные листы в обычной переписке');
        const recipient=actorForDevice(device);if(!recipient)throw Error('У получателя не назначен персонаж');
        await transfer(actor,recipient,Number(fd.get('amount')),fd.get('note'));ui.notifications.info('Перевод оформлен. При необходимости получатель подтверждает зачисление в чате Foundry.');
      },{saveLabel:'Перевести'});return;
    }
    if(op==='split') {
      const operationId=uid();
      await inputDialog('Разделить счёт',field('amount','Общая сумма',100,'number','min="1" step="1" required')+chooseNumbers(state,number)+'<p class="hint">Вы тоже участвуете. Остаток округления относится к вашей доле. Остальным придёт запрос на перевод; деньги автоматически не списываются.</p>',fd=>{
        const members=memberValues(fd),amount=Number(fd.get('amount'));if(!members.length||!Number.isSafeInteger(amount)||amount<1)throw Error('Укажите целую сумму и получателей');
        const share=Math.floor(amount/(members.length+1)),mine=amount-share*members.length;
        return sendMailing(number,members,`Общий счёт: ${amount} эдди на ${members.length+1} участников. Ваша доля: ${share} эдди. Доля организатора: ${mine} эдди. Переведите свою долю на ${number}.`,operationId);
      },{saveLabel:'Отправить запросы'});return;
    }
    if(op==='call'||op==='callInvite') {
      const call=os.calls?.[target.dataset.id];
      const result=await inputDialog(op==='call'?'Новый вызов':'Пригласить в вызов','<p class="hint">Участники получат приглашение. Разговор отыгрывается в вашем голосовом чате.</p>'+chooseNumbers(state,number,{exclude:call?.members,selected:target.dataset.num?[target.dataset.num]:[]}),fd=>mutate(op==='call'?'callStart':'callInvite',{id:call?.id,members:memberValues(fd)}),{saveLabel:'Позвонить'});
      if(result){app.osCallId=result;app.osTab='calls';}return;
    }
    if(op==='callReply'||op==='callEnd'){await mutate(op,{id:target.dataset.id,reply:target.dataset.reply});return;}
    if(op==='actor'||op==='item') {
      const actor=actorForDevice(state.devices[number]);if(!actor||( !user.isGM&&!actor.isOwner))throw Error('Лист недоступен');
      if(op==='actor')actor.sheet.render(true);else actor.items.get(target.dataset.id)?.sheet.render(true);return;
    }
  } finally {app.osBusy=false;if(!app.closing)app.render();}
}
export function OSRender(app) {
  app.osMapController?.destroy();app.osMapController=null;
  if(app.osTab!=='map')app.osMapMode=null;
  const root=app.element;if(!root)return;
  const pageKey=`${app.num}|${app.osTab}`;
  if(app.osRenderedPage!==pageKey){const page=root.querySelector('.os-page');if(page)page.scrollTop=0;app.osRenderedPage=pageKey;}
  const input=root.querySelector('.os-search-input');
  const filter=()=>{const query=(input?.value??'').trim().toLocaleLowerCase('ru-RU');root.querySelectorAll('[data-os-search]').forEach(el=>el.hidden=!el.dataset.osSearch.includes(query));const none=root.querySelector('.os-no-results');if(none)none.hidden=!query||[...root.querySelectorAll('[data-os-search]')].some(el=>!el.hidden);};
  input?.addEventListener('input',()=>{(app.osSearch??={})[app.osTab]=input.value;filter();});filter();
  const update=async(op,data)=>{try{await osOperation(op,{number:app.num,...data});}catch(e){ui.notifications.error(e.message);}finally{if(!app.closing)app.render();}};
  root.querySelectorAll('.os-job-step').forEach(el=>el.addEventListener('change',()=>update('jobStep',{id:el.dataset.id,stepId:el.dataset.step,done:el.checked})));
  root.querySelectorAll('.os-reminder-check').forEach(el=>el.addEventListener('change',()=>update('reminder',{id:el.dataset.id,done:el.checked})));
  root.querySelector('.os-map-category')?.addEventListener('change',e=>{app.osMapCategory=e.target.value;app.render();});
  app.osMapController=bindMapNavigation(app,{
    isGM:game.user.isGM,
    create:point=>performOS(app,null,{dataset:{os:'place',mapX:String(point.x),mapY:String(point.y)}}),
    move:(id,point)=>osOperation('placeMove',{number:app.num,id,...point}),
    onError:error=>ui.notifications.error(error.message)
  });
  root.querySelector('.os-folder-filter')?.addEventListener('change',e=>{app.osFolder=e.target.value;app.render();});
  for(const [cls,key,setting] of [['os-compact-toggle','osCompact','osCompact'],['os-motion-toggle','osReducedMotion','osReducedMotion']])root.querySelector('.'+cls)?.addEventListener('change',async e=>{app[key]=e.target.checked;try{await game.settings.set(MODULE_ID,setting,app[key]);}catch(e){ui.notifications.warn(e.message);}app.render();});
  const tick=()=>{updateClockElements(root);root.querySelectorAll('[data-reminder-due]').forEach(el=>{const left=deadlineRemaining({clock:el.dataset.clock,calendarId:el.dataset.calendarId,due:Number(el.dataset.reminderDue)});el.textContent=el.dataset.done==='true'?'Готово':left===null?'Календарь недоступен':left<=0?'Срок наступил':`через ${Math.ceil(left/60)} мин.`;});root.querySelectorAll('.os-call-timer').forEach(el=>{const seconds=Math.max(0,Math.floor(((Number(el.dataset.end)||Date.now())-Number(el.dataset.start))/1000));el.textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;});};
  clearInterval(app.osTimer);if(root.querySelector('.os-call-timer, .os-clock, .os-time-controls, [data-reminder-due]')){tick();app.osTimer=setInterval(tick,1000);}
}

const notified=new Set();
export function checkOSReminders() {
  if(storageLocked())return;const state=readState(),user=game.user;
  for(const device of Object.values(state.devices)) {
    if(device.owner!==user.id && !(user.isGM&&!device.owner))continue;
    for(const r of Object.values(state.os?.reminders?.[device.num]??{})) {
      const key=`${device.num}:${r.id}:${r.due}`;
      if(!r.done&&deadlineDue(r)&&!notified.has(key)){notified.add(key);ui.notifications.info(`Агент · ${r.title}`);}
    }
  }
}
