/**
 * Что сейчас открыто у этого клиента.
 *
 * Нужно, чтобы доставка сообщения знала: игрок уже смотрит на эту переписку —
 * значит, звонить не надо, сообщение считается прочитанным сразу.
 *
 * Отдельный модуль, а не поле в окне: иначе транспорт и окно импортировали бы
 * друг друга по кругу.
 */

const open = new Set();

function key(myNum, otherNum) {
  return `${myNum}|${otherNum}`;
}

/** Окно сообщает, какую переписку показывает. */
export function setOpenThread(myNum, otherNum) {
  if (myNum && otherNum) open.add(key(myNum, otherNum));
}

export function clearOpenThread(myNum, otherNum) {
  if (myNum && otherNum) open.delete(key(myNum, otherNum));
  else if (myNum) {
    for (const k of [...open]) if (k.startsWith(`${myNum}|`)) open.delete(k);
  }
}

export function isThreadOpen(myNum, otherNum) {
  return open.has(key(myNum, otherNum));
}

export function reset() {
  open.clear();
}
