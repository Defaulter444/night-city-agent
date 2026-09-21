import { now, calendarActive, advanceClock, openCalendar, toggleCalendarClock, setWorldDate, localDateInput, esc } from './clock.mjs';

const action=(op,label,attrs='')=>`<button type="button" data-action="osAction" data-os="${op}" ${attrs}>${label}</button>`;
export function clockControls() {
  return `<div class="os-time-controls"><span class="os-clock-status"></span><div class="os-actions">${action('clockCalendar','Календарь','data-clock-calendar')}
    ${game.user.isGM?[
      action('clockSet','Задать дату','data-clock-manual'),
      action('clockAdvance','+10 мин.','data-seconds="600" data-clock-advance'),
      action('clockAdvance','+1 час','data-seconds="3600" data-clock-advance'),
      action('clockAdvance','+8 часов','data-seconds="28800" data-clock-advance'),
      action('clockMore','Другое…','data-clock-advance'),
      action('clockToggle','Запустить часы','data-clock-toggle')
    ].join(''):''}</div></div>`;
}
export function updateClockElements(root) {
  const clock=now();
  for(const [selector,key] of [['.os-clock','timeLabel'],['.os-clock-date','dateLabel'],['.os-clock-source','sourceLabel'],['.os-clock-status','statusLabel']])
    root.querySelectorAll(selector).forEach(el=>{if(el.textContent!==clock[key])el.textContent=clock[key];});
  root.querySelectorAll('[data-clock-calendar]').forEach(el=>el.hidden=clock.source!=='calendar');
  root.querySelectorAll('[data-clock-manual]').forEach(el=>el.hidden=calendarActive());
  root.querySelectorAll('[data-clock-advance]').forEach(el=>el.hidden=!['calendar','world'].includes(clock.source));
  root.querySelectorAll('[data-clock-toggle]').forEach(el=>{el.hidden=clock.source!=='calendar';const label=clock.running?'Остановить часы':'Запустить часы';if(el.textContent!==label)el.textContent=label;});
}
export async function clockAction(op,target) {
  if(op==='clockCalendar')return openCalendar();
  if(op==='clockAdvance')return advanceClock(Number(target.dataset.seconds));
  if(op==='clockToggle')return toggleCalendarClock();
  if(!game.user.isGM)throw Error('Игровое время меняет только мастер');
  const { inputDialog } = await import('./workspace-app.mjs');
  if(op==='clockMore')return inputDialog('Пропустить игровое время',
    '<label>Сколько минут прошло<input name="minutes" type="number" min="1" max="525600" step="1" value="30" required></label><p class="hint">Наступившие напоминания и отложенные сообщения могут сработать сразу.</p>',
    fd=>advanceClock(Number(fd.get('minutes'))*60),{saveLabel:'Продвинуть время'});
  if(op==='clockSet')return inputDialog('Дата и время кампании',
    `<label>Игровая дата и время<input name="date" type="datetime-local" value="${esc(localDateInput())}" required></label>
    <p class="hint">Единое время для всех игроков, независимо от часового пояса компьютера. Оно меняется мастером и ходом времени Foundry. Перевод часов может вызвать уже наступившие напоминания.</p>
    <p class="hint">Для календаря событий и автоматического хода часов включите Simple Calendar в управлении модулями мира. Агент подключится к нему автоматически; текущую дату в календаре задаёт мастер.</p>`,
    fd=>setWorldDate(String(fd.get('date'))),{saveLabel:'Установить дату'});
}
