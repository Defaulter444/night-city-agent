/** Simple Calendar owns calendar time when active; never advance both clocks.
 * Real timestamps remain intact for ordering, unread markers and call timers. */
export const SIMPLE_CALENDAR = 'foundryvtt-simple-calendar';
const MODULE = 'night-city-agent';
let queue = Promise.resolve();
export function calendarActive() { return !!globalThis.game?.modules?.get(SIMPLE_CALENDAR)?.active; }
function api() { return calendarActive() ? globalThis.SimpleCalendar?.api : null; }
export function worldClock() { try { return game.settings.get(MODULE,'worldClock') || {}; } catch { return {}; } }
export function registerClockSettings() {
  game.settings.register(MODULE,'worldClock',{scope:'world',config:false,type:Object,default:{}});
}
const pad = n => String(n).padStart(2,'0');
function dateLabels(ms, utc=false) {
  const options=utc?{timeZone:'UTC'}:{};
  return {dateLabel:new Date(ms).toLocaleDateString('ru-RU',{...options,day:'2-digit',month:'2-digit',year:'numeric'}),
    timeLabel:new Date(ms).toLocaleTimeString('ru-RU',{...options,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})};
}
export function now() {
  const realTime=Date.now(), worldTime=Number(globalThis.game?.time?.worldTime ?? 0);
  const base={realTime,worldTime,calendarTimestamp:null,calendarId:null};
  if(calendarActive()) {
    try {
      const calendar=api(), parts=calendar?.currentDateTime(), display=calendar?.currentDateTimeDisplay();
      const stamp=calendar?.timestamp();
      if(parts&&display&&Number.isFinite(stamp)) {
        const status=calendar.clockStatus?.() || {};
        // Display values are one-based; date API month and day are zero-based.
        const dateLabel=[pad(display.day),pad(display.month),display.year].join('.');
        const timeLabel=`${pad(parts.hour)}:${pad(parts.minute)}`;
        return {...base,source:'calendar',sourceLabel:'ВРЕМЯ МИРА',dateLabel,timeLabel,label:`${dateLabel}, ${timeLabel}`,
          calendarTimestamp:stamp,calendarId:calendar.getCurrentCalendar?.()?.id || 'active',
          statusLabel:status.paused?'Ход времени приостановлен':status.started?'Время идёт':'Время меняет мастер',running:!!(status.started||status.paused)};
      }
    } catch { /* Do not silently substitute PC time for a loading calendar. */ }
    return {...base,source:'unavailable',sourceLabel:'ВРЕМЯ МИРА',dateLabel:'Календарь недоступен',timeLabel:'—',label:'Календарь недоступен',statusLabel:'Simple Calendar ещё не готов'};
  }
  const config=worldClock();
  if(Number.isFinite(config.epoch)&&Number.isFinite(config.worldTime)) {
    const labels=dateLabels(config.epoch+(worldTime-config.worldTime)*1000,true);
    return {...base,...labels,source:'world',sourceLabel:'ВРЕМЯ МИРА',label:`${labels.dateLabel}, ${labels.timeLabel}`,statusLabel:'Время меняет мастер'};
  }
  const labels=dateLabels(realTime);
  return {...base,...labels,source:'local',sourceLabel:'ВРЕМЯ КОМПЬЮТЕРА',label:`${labels.dateLabel}, ${labels.timeLabel}`,statusLabel:'Игровое время ещё не настроено'};
}
export function clockFlag(clock=now()) {
  return Object.fromEntries(['source','label','dateLabel','timeLabel','realTime','worldTime','calendarTimestamp','calendarId'].map(k=>[k,clock[k]??null]));
}
export function messageTime(message) {
  const clock=message?.clock;
  return clock?.label && ['calendar','world'].includes(clock.source)?clock.label:
    new Date(message.ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
export function messageTimeTitle(message) {
  return message?.clock?.label?'Игровое время при отправке':'Реальное время при отправке (старая запись или календарь не настроен)';
}
/** GM-side durable mutation only. History is never recalculated. */
export function stampNewEntries(before,after,clock=now()) {
  if(!['calendar','world'].includes(clock.source))return;
  const flag=clockFlag(clock);
  for(const [key,list] of Object.entries(after.threads??{}))
    for(const message of list.slice(before.threads?.[key]?.length??0))message.clock={...flag};
  for(const [id,room] of Object.entries(after.conferences??{}))
    for(const message of room.messages.slice(before.conferences?.[id]?.messages?.length??0))message.clock={...flag};
  for(const [id,call] of Object.entries(after.os?.calls??{}))if(!before.os?.calls?.[id])call.clock={...flag};
}
export function deadlineNow(entry) {
  if(entry.clock==='calendar') {
    try { const calendar=api();if(!calendar?.currentDateTime(entry.calendarId))return null;
      const stamp=calendar.timestamp(entry.calendarId);return Number.isFinite(stamp)?stamp:null;
    } catch { return null; }
  }
  return entry.clock==='world'?Number(game.time.worldTime):Date.now()/1000;
}
export function deadlineRemaining(entry) { const stamp=deadlineNow(entry);return stamp===null?null:entry.due-stamp; }
export function deadlineDue(entry) { const left=deadlineRemaining(entry);return left!==null&&left<=0; }
export function makeDeadline(minutes,kind='world') {
  if(!Number.isFinite(minutes)||minutes<1||minutes>525600)throw Error('Задержка: от 1 минуты до года');
  const current=now();
  if(kind==='world'&&calendarActive()) {
    if(current.source!=='calendar')throw Error('Дождитесь загрузки Simple Calendar');
    return {clock:'calendar',calendarId:current.calendarId,due:current.calendarTimestamp+minutes*60};
  }
  return {clock:kind==='world'?'world':'real',due:(kind==='world'?Number(game.time.worldTime):Date.now()/1000)+minutes*60};
}
function gm() { if(!globalThis.game?.user?.isGM)throw Error('Игровое время меняет только мастер'); }
function serial(task) { const result=queue.then(task,task);queue=result.catch(()=>{});return result; }
export function advanceClock(seconds) {
  gm();
  if(!Number.isSafeInteger(seconds)||seconds<=0||seconds>31536000)throw Error('Укажите положительный промежуток не больше года');
  return serial(async()=>{
    gm();const current=now();
    if(current.source==='calendar') {
      if(!await api().changeDate({seconds}))throw Error('Simple Calendar не изменил время. Проверьте права и настройки календаря.');
    } else if(current.source==='world')await game.time.advance(seconds);
    else throw Error('Сначала настройте игровую дату');
  });
}
export function openCalendar() {
  if(now().source!=='calendar')throw Error('Включите Simple Calendar в управлении модулями мира и дождитесь загрузки');
  api().showCalendar();
}
export async function toggleCalendarClock() {
  gm();if(now().source!=='calendar')throw Error('Simple Calendar недоступен');
  const calendar=api(),status=calendar.clockStatus(),running=status.started||status.paused;
  if(!await (running?calendar.stopClock():calendar.startClock()))throw Error('Запускать часы может основной мастер Simple Calendar. Проверьте, снята ли пауза игры.');
}
export function localDateInput() {
  const config=worldClock();
  const ms=Number.isFinite(config.epoch)?config.epoch+(Number(game.time.worldTime)-config.worldTime)*1000:Date.UTC(2045,0,1,12);
  return new Date(ms).toISOString().slice(0,16);
}
export function setWorldDate(input) {
  gm();
  if(calendarActive())throw Error('Текущую дату задайте в Simple Calendar');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input))throw Error('Укажите дату и время');
  const epoch=Date.parse(input+':00Z');
  if(!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,16)!==input)throw Error('Такой даты не существует');
  return serial(async()=>{
    gm();if(calendarActive())throw Error('Текущую дату задайте в Simple Calendar');
    const config=worldClock(),worldTime=Number(game.time.worldTime);
    if(Number.isFinite(config.epoch)&&Number.isFinite(config.worldTime))
      await game.time.advance((epoch-config.epoch)/1000-(worldTime-config.worldTime));
    else await game.settings.set(MODULE,'worldClock',{epoch,worldTime});
  });
}
export function clockHTML(clock=now()) {
  return `<div class="nca-card-clock"><i class="far fa-clock"></i><span class="nca-card-clock-source">${esc(clock.sourceLabel)}</span><span>${esc(clock.label)}</span></div>`;
}
export function esc(value='') {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
