/** Publication dates are campaign wall time, independent of the viewer's timezone. */
const pad = n => String(n).padStart(2, '0');
function parts(value) {
  if (typeof value !== 'string' || value.length !== 16) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const stamp = new Date(0);
  stamp.setUTCFullYear(year, month - 1, day);
  stamp.setUTCHours(hour, minute, 0, 0);
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return null;
  return { date: value.slice(0, 10), time: value.slice(11), stamp: stamp.getTime() };
}
export function publicationValue(date, time) {
  const value = `${date}T${time}`;
  if (typeof date !== 'string' || typeof time !== 'string' || !parts(value)) throw Error('Укажите корректную дату и время публикации');
  return value;
}
export function publicationFormValues(record = {}, clock = {}) {
  const saved = parts(record.publicationAt);
  if (saved) return { date: saved.date, time: saved.time };
  if (Number.isFinite(record.createdAt)) {
    const legacy = new Date(record.createdAt);
    const year = String(legacy.getFullYear()).padStart(4, '0');
    const date = `${year}-${pad(legacy.getMonth() + 1)}-${pad(legacy.getDate())}`;
    const time = `${pad(legacy.getHours())}:${pad(legacy.getMinutes())}`;
    if (parts(`${date}T${time}`)) return { date, time };
  }
  const date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(clock.dateLabel || '');
  if (date) {
    const value = parts(`${date[3]}-${date[2]}-${date[1]}T${clock.timeLabel}`);
    if (value) return { date: value.date, time: value.time };
  }
  return { date: '', time: '' };
}
export function publicationLabel(record) {
  const saved = parts(record.publicationAt);
  if (saved) return `${saved.date.slice(8)}.${saved.date.slice(5, 7)}.${saved.date.slice(0, 4)}, ${saved.time}`;
  if (!Number.isFinite(record.createdAt)) return 'Дата не указана';
  return new Date(record.createdAt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
}
export function comparePublications(a, b) {
  const stamp = record => parts(record.publicationAt)?.stamp ?? (Number.isFinite(record.createdAt) ? record.createdAt : 0);
  return stamp(b) - stamp(a) || (b.createdAt || 0) - (a.createdAt || 0) || String(a.id).localeCompare(String(b.id), 'en');
}
