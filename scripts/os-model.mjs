/** Additive Agent OS data. No conversion of existing books, documents or threads. */
import { NUMBER_RE, normalizeNumber, pushMessage } from './model.mjs';
import { imageIssue } from './images.mjs';
const clone = x => structuredClone(x);
const id = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2,'0')).join('');
const text = (s, max=2000) => String(s ?? '').trim().slice(0,max);
const gm = user => { if (!user?.isGM) throw Error('Доступно только мастеру'); };
const safeId = key => { if (['__proto__','prototype','constructor'].includes(key) || !/^[a-zA-Z0-9_-]{1,80}$/.test(key ?? '')) throw Error('Некорректный идентификатор'); return key; };
export const OS_TABS = [['home','Главная','house'],['contacts','Контакты','address-book'],['messages','Сообщения','comments'],['map','Карта','map-location-dot'],['wallet','Кошелёк','wallet'],['jobs','Задания','list-check'],['files','Файлы','folder-open'],['news','Data Pool','globe'],['calls','Вызовы','phone'],['settings','Настройки','gear']];
export const JOB_STATES = { planned:'Запланировано', active:'В работе', blocked:'Приостановлено', done:'Завершено', archived:'Архив' };
export const PLACE_TYPES = { place:'Место', fixer:'Фиксер', shop:'Магазин', clinic:'Клиника', home:'Убежище', transit:'Транспорт', danger:'Опасность' };
export const DEFAULT_CITY_MAP='modules/night-city-agent/assets/night-city-2045.png';
export function cityMap(state) { return {title:'Найт-Сити 2045',...state.os?.map,image:state.os?.map?.image||DEFAULT_CITY_MAP}; }
export function callsForViewer(state,user,number,scope='all') {
  return Object.values(state.os?.calls??{}).filter(c=>user?.isGM&&scope==='all'||c.members.includes(number)&&(user?.isGM||state.devices[number]?.owner===user?.id)).sort((a,b)=>Number(a.status==='ended')-Number(b.status==='ended')||b.createdAt-a.createdAt);
}
export function ownOSDevice(state, number, user) {
  if (!NUMBER_RE.test(number ?? '') || !state.devices[number] || !user || (!user.isGM && state.devices[number].owner !== user.id)) throw Error('Это не ваше устройство');
  return state.devices[number];
}
export function imageSource(value, max=2000000) {
  const src = text(value, max*2);
  if (!src) return '';
  if (src.startsWith('data:')) { const issue = imageIssue(src,max); if (issue) throw Error(issue); return src; }
  if (/^(https?:\/\/|(?:modules|systems|worlds|icons|assets|uploads)\/)/i.test(src) && !/[<>"\x00-\x1f]/.test(src) && src.length <= 2048) return src;
  throw Error('Укажите картинку из Foundry, ссылку http(s) или загрузите изображение');
}
function numbers(state, values) {
  if (!Array.isArray(values)) throw Error('Выберите получателей');
  const list = [...new Set(values.map(v => normalizeNumber(v)))];
  if (list.length > 32 || list.some(n => !NUMBER_RE.test(n) || !state.devices[n])) throw Error('Получатель не найден или выбрано больше 32 номеров');
  return list;
}
export function visibleRecord(state, record, user) {
  return Boolean(record && user && (user.isGM || record.authorId === user.id || (record.published && (record.public || record.numbers?.some(n => state.devices[n]?.owner === user.id)))));
}
export function editableRecord(record,user) { return Boolean(record && user && (user.isGM || record.authorId === user.id)); }
export function projectOS(state,user) {
  const os = state.os;
  if (!os) return undefined;
  if (user?.isGM) return clone(os);
  const mine = Object.values(state.devices).filter(d => d.owner === user?.id).map(d => d.num);
  const known = new Set(mine);
  for (const n of mine) {
    Object.keys(state.devices[n].book ?? {}).forEach(k => known.add(k));
    Object.keys(state.threads).filter(k => k.split('|').includes(n)).forEach(k => k.split('|').forEach(v => known.add(v)));
  }
  const out = { profiles:{}, contacts:{}, jobs:{}, places:{}, articles:{}, reminders:{}, calls:{}, fileMeta:{}, saved:{}, map:clone(os.map ?? {}) };
  for (const key of ['jobs','places','articles']) for (const [rid,record] of Object.entries(os[key] ?? {})) if (visibleRecord(state,record,user)) out[key][rid] = clone(record);
  for (const [rid,call] of Object.entries(os.calls ?? {})) if (mine.some(n => call.members.includes(n))) { out.calls[rid] = clone(call); call.members.forEach(n=>known.add(n)); }
  for (const n of known) if (os.profiles?.[n]) out.profiles[n] = clone(os.profiles[n]);
  for (const n of mine) for (const key of ['contacts','reminders','fileMeta','saved']) if (os[key]?.[n]) out[key][n] = clone(os[key][n]);
  return out;
}
export function applyOSOperation(state,data,user,now=Date.now()) {
  if (!user) throw Error('Пользователь не найден');
  const {op,number} = data;
  const device = ownOSDevice(state,number,user);
  const os = state.os ??= {};
  if (op === 'profile') {
    const profile = { name:text(data.name,80), role:text(data.role,60), bio:text(data.bio,240), status:['online','away','offline'].includes(data.status)?data.status:'online', avatar:imageSource(data.avatar,250000) };
    (os.profiles ??= {})[number] = profile; return number;
  }
  if (op === 'contact') {
    const other = normalizeNumber(data.other);
    if (!state.devices[other] || other === number) throw Error('Контакт не найден');
    const current = os.contacts?.[number]?.[other] ?? {};
    const next = { ...current, category:text(data.category,40), note:text(data.note,2000), favorite:Boolean(data.favorite), avatar:imageSource(data.avatar,250000) };
    ((os.contacts ??= {})[number] ??= {})[other] = next; return other;
  }
  if (['job','place','article'].includes(op)) {
    if (op !== 'job') gm(user);
    const collection = {job:'jobs',place:'places',article:'articles'}[op];
    const rid = data.id ? safeId(data.id) : id(), old = os[collection]?.[rid];
    if (data.id && !old) throw Error('Запись больше не существует');
    if (old && !editableRecord(old,user)) throw Error('Изменять запись может автор или мастер');
    const title = text(data.title,160); if (!title) throw Error('Укажите название');
    const record = { id:rid, title, body:text(data.body,16000), image:imageSource(data.image), authorId:old?.authorId || user.id,
      numbers:user.isGM ? numbers(state,data.numbers ?? []) : [number], public:Boolean(user.isGM && data.public), published:user.isGM ? Boolean(data.published) : true,
      createdAt:old?.createdAt || now, updatedAt:now };
    if (op === 'job') {
      const reward=Number(data.reward || 0); if (!Number.isFinite(reward) || reward<0) throw Error('Некорректная награда');
      const lines = String(data.steps ?? '').split('\n').map(s=>text(s,240)).filter(Boolean).slice(0,30);
      Object.assign(record,{ status:Object.hasOwn(JOB_STATES,data.status)?data.status:'planned', reward:Math.trunc(reward), due:text(data.due,100), fixer:text(data.fixer,100),
        placeId: data.placeId && visibleRecord(state,os.places?.[data.placeId],user) ? data.placeId : '',
        steps:lines.map((label,index)=>({id:old?.steps?.[index]?.label===label?old.steps[index].id:id(), label, done:old?.steps?.[index]?.label===label?old.steps[index].done:false})) });
    }
    if (op === 'place') {
      const x=Number(data.x), y=Number(data.y);
      if (![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=100)) throw Error('Положение метки должно быть от 0 до 100%');
      Object.assign(record,{x,y,category:Object.hasOwn(PLACE_TYPES,data.category)?data.category:'place',district:text(data.district,100), contact:text(data.contact,16)});
    }
    if (op === 'article') Object.assign(record,{ source:text(data.source,120), category:text(data.category,40) || 'Новости' });
    (os[collection] ??= {})[rid] = record; return rid;
  }
  if (op === 'placeMove') {
    gm(user);
    const place=os.places?.[safeId(data.id)];if(!place)throw Error('Метка больше не существует');
    const x=Number(data.x),y=Number(data.y);
    if([data.x,data.y].some(v=>v==null||typeof v==='boolean'||(typeof v==='string'&&!v.trim()))||![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=100))throw Error('Положение метки должно быть от 0 до 100%');
    // Moving a pin must not overwrite concurrently edited text or visibility.
    Object.assign(place,{x,y,updatedAt:now});return place.id;
  }
  if (op === 'jobStep') {
    const job=os.jobs?.[data.id]; if (!visibleRecord(state,job,user)) throw Error('Задание недоступно');
    const step=job.steps.find(s=>s.id===data.stepId); if (!step) throw Error('Пункт не найден'); step.done=Boolean(data.done); return job.id;
  }
  if (op === 'map') { gm(user); os.map={ image:imageSource(data.image,4000000), title:text(data.title,100)||'Найт-Сити', location:text(data.location,100), weather:text(data.weather,100) }; return true; }
  if (op === 'saveArticle') {
    if (!visibleRecord(state,os.articles?.[data.id],user)) throw Error('Статья недоступна');
    const saved=((os.saved ??= {})[number] ??= []); const i=saved.indexOf(data.id); if(i<0) saved.push(data.id); else saved.splice(i,1); return true;
  }
  if (op === 'reminder') {
    const rid=data.id?safeId(data.id):id(), old=os.reminders?.[number]?.[rid];
    if (data.id && !old) throw Error('Напоминание не найдено');
    if (data.done !== undefined && old) { old.done=Boolean(data.done); return rid; }
    const title=text(data.title,160), due=Number(data.due); if (!title || !Number.isFinite(due)) throw Error('Укажите текст и время');
    ((os.reminders ??= {})[number] ??= {})[rid]={id:rid,title,due,clock:data.clock==='world'?'world':'real',done:false}; return rid;
  }
  if (op === 'fileMeta') {
    safeId(data.id);
    const tags=text(data.tags,300).split(',').map(s=>text(s,30)).filter(Boolean).slice(0,8);
    ((os.fileMeta ??= {})[number] ??= {})[data.id]={tags,folder:text(data.folder,60),favorite:Boolean(data.favorite)}; return true;
  }
  if (op === 'callStart') {
    const members=numbers(state,[number,...(data.members ?? [])]);
    if (members.length<2) throw Error('Выберите собеседника');
    const busy=Object.values(os.calls ?? {}).find(c=>c.from===number && c.status!=='ended');
    if (busy) throw Error('Сначала завершите текущий вызов');
    const rid=id(), call={id:rid,from:number,members,status:'ringing',createdAt:now,startedAt:null,endedAt:null,replies:Object.fromEntries(members.map(n=>[n,n===number?'accepted':'invited']))};
    (os.calls ??= {})[rid]=call;
    for (const to of members.filter(n=>n!==number)) pushMessage(state,number,to,'Входящий вызов. Откройте «Вызовы» в Агенте.',now);
    return rid;
  }
  if (['callReply','callEnd','callInvite'].includes(op)) {
    const call=os.calls?.[data.id]; if (!call || (!call.members.includes(number)&&!(op==='callEnd'&&user.isGM)) || call.status==='ended') throw Error('Вызов недоступен');
    if (op==='callEnd') { if(call.from!==number && !user.isGM) throw Error('Завершить общий вызов может инициатор'); call.status='ended'; call.endedAt=now; return call.id; }
    if (op==='callInvite') {
      if(call.replies[number]!=='accepted') throw Error('Сначала примите вызов');
      const added=numbers(state,data.members ?? []).filter(n=>!call.members.includes(n));
      if(call.members.length+added.length>32) throw Error('Не более 32 участников');
      for(const to of added){call.members.push(to);call.replies[to]='invited';pushMessage(state,number,to,'Приглашение в вызов. Откройте «Вызовы» в Агенте.',now);} return call.id;
    }
    const reply=data.reply;
    if (!['accepted','declined','left'].includes(reply) || number===call.from) throw Error('Недопустимый ответ');
    if(call.replies[number]==='left'||call.replies[number]==='declined') throw Error('Этот вызов уже отклонён');
    call.replies[number]=reply;
    if (reply==='accepted') {call.status='active';call.startedAt ??= now;}
    if(call.members.filter(n=>n!==call.from).every(n=>['declined','left'].includes(call.replies[n]))) {call.status='ended';call.endedAt=now;}
    return call.id;
  }
  throw Error('Неизвестное действие Агента');
}
