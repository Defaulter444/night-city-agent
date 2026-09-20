/**
 * Чистая логика Агента: номера, устройства, адресная книга, треды.
 *
 * Здесь НЕТ обращений к API Foundry, к сокетам и к отрисовке — только работа
 * с обычным объектом состояния. Благодаря этому файл можно гонять тестами
 * вне игры. Порт доменной части из версии для Tabletop Simulator.
 */

export const KIND = {
  POCKET: "pocket",     // карманный агент
  INTERNAL: "internal"  // внутренний агент кибераудио
};

/** Пустое состояние. */
export function blankState() {
  return { v: 1, devices: {}, threads: {}, read: {} };
}

/** Достраивает недостающие поля, чтобы старое состояние не роняло модуль. */
export function normalize(state) {
  const s = state && typeof state === "object" ? state : {};
  return {
    ...s,
    v: 1,
    devices: s.devices ?? {},
    threads: s.threads ?? {},
    read: s.read ?? {}
  };
}

/* ------------------------------------------------------------------ номера */

/**
 * Номер вида 2137-5581: восемь цифр, узнаваемо «телефонный», но не настоящий.
 * Восемь вместо семи — по просьбе мастера: пространство номеров вырастает
 * с 8 до 90 миллионов, и случайные совпадения при выдаче становятся редкостью.
 * Старые семизначные номера остаются рабочими — номер везде просто строка.
 */
export function newNumber(state, rng = Math.random) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const head = 1000 + Math.floor(rng() * 9000);        // 1000..9999
    const tail = String(Math.floor(rng() * 10000)).padStart(4, "0");
    const num = `${head}-${tail}`;
    if (!state.devices[num]) return num;
  }
  throw new Error("Не удалось подобрать свободный номер");
}

export function isKnownNumber(state, num) {
  return Boolean(state.devices[num]);
}

/** Восемь цифр через дефис; семизначные номера старой выдачи тоже принимаются. */
export const NUMBER_RE = /^\d{3,4}-\d{4}$/;

/**
 * Приводит введённое вручную к виду 2137-5581: дефисы, пробелы и скобки
 * игнорируются, разделитель ставится сам. Непонятное возвращается как есть,
 * чтобы numberIssue могла честно сказать, что это не номер.
 */
export function normalizeNumber(input) {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return raw;
}

/** Что не так с номером: "format", "taken" или null, если всё в порядке. */
export function numberIssue(state, num) {
  if (!NUMBER_RE.test(num)) return "format";
  if (state.devices[num]) return "taken";
  return null;
}

/* -------------------------------------------------------------- устройства */

/**
 * Заводит устройство. Внутренний агент кибераудио без хирона в киберглазу
 * умеет только голос — текст ему недоступен (корбук, с. 113).
 */
export function addDevice(state, { kind = KIND.POCKET, owner = null, label = "", audioOnly = false, ringtone = "", num = null } = {}, rng = Math.random) {
  let number;
  if (num !== null && String(num).trim() !== "") {
    number = normalizeNumber(num);
    const issue = numberIssue(state, number);
    if (issue === "format") {
      throw new Error(`«${String(num).trim()}» не похоже на номер: нужно восемь цифр, например 2137-5581`);
    }
    if (issue === "taken") {
      const busyLabel = state.devices[number].label;
      throw new Error(`Номер ${number} уже занят${busyLabel ? ` — «${busyLabel}»` : ""}`);
    }
  } else {
    number = newNumber(state, rng);
  }
  state.devices[number] = {
    num: number,
    kind,
    label,
    owner,                                       // id пользователя Foundry или null (НИП мастера)
    audioOnly: kind === KIND.INTERNAL ? audioOnly : false,
    ringtone,
    book: {}
  };
  return state.devices[number];
}

export function removeDevice(state, num) {
  delete state.devices[num];
  for (const room of Object.values(state.conferences ?? {})) {
    room.members = room.members.filter(n => n !== num);
    delete room.read?.[num]; delete room.drafts?.[num];
  }
  for (const key of Object.keys(state.threads)) {
    if (key.split("|").includes(num)) delete state.threads[key];
  }
  // Отметку надо снимать с ОБЕИХ сторон: ключ здесь «моё устройство|собеседник»,
  // и у собеседника остаётся своя отметка про изъятый аппарат.
  for (const key of Object.keys(state.read)) {
    if (key.split("|").includes(num)) delete state.read[key];
  }
}

/**
 * Убирает ссылки на несуществующие устройства: адресные книги, переписки,
 * отметки о прочтении. Возвращает число убранных записей.
 */
export function prune(state) {
  const known = n => Boolean(state.devices[n]);
  let removed = 0;

  for (const dev of Object.values(state.devices)) {
    for (const contact of Object.keys(dev.book ?? {})) {
      if (!known(contact)) { delete dev.book[contact]; removed++; }
    }
  }
  for (const key of Object.keys(state.threads)) {
    if (!key.split("|").every(known)) { delete state.threads[key]; removed++; }
  }
  for (const key of Object.keys(state.read)) {
    if (!key.split("|").every(known)) { delete state.read[key]; removed++; }
  }
  return removed;
}

/**
 * Вживлённый агент из рук в руки не передаётся: «щепку памяти имплантированного
 * агента нельзя извлечь без хирургического вмешательства» (корбук, с. 367).
 * Удалить такое устройство мастер по-прежнему может — это и есть та самая хирургия.
 */
export function canTransfer(dev) {
  return Boolean(dev) && dev.kind !== KIND.INTERNAL;
}

/** Передача устройства другому владельцу — переписка уходит вместе с ним. */
export function transferDevice(state, num, newOwner) {
  const dev = state.devices[num];
  if (!dev) return null;
  if (dev.owner === newOwner) return dev;
  if (!canTransfer(dev)) {
    throw new Error(`${num} — внутренний агент, его нельзя передать: он вживлён`);
  }
  dev.owner = newOwner;
  return dev;
}

export function devicesOfUser(state, userId) {
  return Object.values(state.devices).filter(d => d.owner === userId);
}

export function ownsDevice(state, userId, num) {
  return state.devices[num]?.owner === userId;
}

/**
 * Проговаривает ли устройство всё вслух.
 *
 * Внутренний агент управляется голосом, а изображения «описываются голосом»,
 * если нет хирона в киберглазу или экрана рядом (корбук, с. 367). Писать он
 * умеет — сообщение просто диктуется, — но и надиктованное, и полученное
 * звучит вслух, и рядом стоящие это слышат.
 */
export function speaksAloud(dev) {
  return Boolean(dev) && dev.audioOnly === true;
}

/* -------------------------------------------------------------------- треды */

/** Ключ переписки не зависит от того, кто кому пишет. */
export function threadKey(a, b) {
  return [a, b].sort().join("|");
}

export function thread(state, a, b) {
  return state.threads[threadKey(a, b)] ?? [];
}

/**
 * @param extra  {eb} — сумма перевода, если сообщение сопровождает деньги;
 *               {img} — путь к присланной картинке.
 *
 * Картинка хранится путём, а не содержимым: состояние Агента лежит в настройке
 * мира и целиком уходит каждому клиенту при каждом чтении. Пара снимков,
 * вписанных туда строкой base64, раздули бы его на мегабайты — и так при каждом
 * открытии окна у каждого игрока.
 */
export function pushMessage(state, from, to, text, now = Date.now(), extra = {}) {
  const key = threadKey(from, to);
  const msg = { f: from, t: to, x: text, ts: now };
  if (typeof extra.img === "string" && extra.img) msg.p = extra.img;
  // Надиктованное вслух помечаем навсегда: мастеру потом важно знать,
  // кто мог это услышать, а хирон персонажу могли поставить позже.
  if (speaksAloud(state.devices[from])) msg.a = 1;
  if (Number.isFinite(extra.eb) && extra.eb !== 0) msg.eb = Math.trunc(extra.eb);
  (state.threads[key] ??= []).push(msg);
  return msg;
}

/**
 * Пути всех картинок, на которые ссылается хоть одно сообщение.
 *
 * Нужно для уборки: изъятое устройство уносит свои переписки, а файлы
 * остаются на диске навсегда. Сверять по этому списку — единственный честный
 * способ понять, что файл больше никому не нужен: одну и ту же картинку могли
 * переслать в несколько переписок.
 *
 * @param {Object} state - состояние Агента
 * @returns {Set<String>}
 */
export function usedImages(state) {
  const used = new Set();
  for (const msgs of Object.values(state?.threads ?? {})) {
    for (const msg of msgs ?? []) if (msg?.p) used.add(msg.p);
  }
  for (const room of Object.values(state?.conferences ?? {})) for (const msg of room.messages ?? []) if (msg.p) used.add(msg.p);
  return used;
}

/* ------------------------------------------------------------------- помехи */

const JUNK = "*%^?!#.,";

/**
 * Портит текст: часть знаков заменяется мусором, пробелы остаются на месте,
 * чтобы сообщение читалось как перехваченное, а не как случайная строка.
 * Генератор случайных чисел передаётся снаружи — иначе такое не проверить тестом.
 * Приём заимствован из Holophone/Agent Messenger™ (автор Lt Atlas).
 */
export function garble(text, ratio = 0.5, rng = Math.random) {
  const share = Math.min(1, Math.max(0, Number(ratio) || 0));
  return [...String(text)].map(ch => {
    if (/\s/.test(ch) || rng() >= share) return ch;
    return JUNK[Math.floor(rng() * JUNK.length)];
  }).join("");
}

/**
 * Портит уже отправленное сообщение — след перехвата нетраннером.
 * Исходный текст сохраняем в поле o: мастеру нужно видеть, что там было.
 */
export function corruptMessage(state, a, b, index, ratio = 0.5, rng = Math.random) {
  const msgs = state.threads[threadKey(a, b)];
  const msg = msgs?.[index];
  if (!msg) return null;
  if (msg.o === undefined) msg.o = msg.x;
  msg.x = garble(msg.o, ratio, rng);
  msg.c = 1;
  return msg;
}

/** Возвращает испорченному сообщению исходный вид. */
export function restoreMessage(state, a, b, index) {
  const msg = state.threads[threadKey(a, b)]?.[index];
  if (!msg || msg.o === undefined) return null;
  msg.x = msg.o;
  delete msg.o;
  delete msg.c;
  return msg;
}

/* ------------------------------------------------------------ адресная книга */

/** Имя контакта по адресной книге устройства; незнакомый номер остаётся номером. */
export function bookName(state, myNum, other) {
  return state.devices[myNum]?.book?.[other] ?? "";
}

export function contactLabel(state, myNum, other) {
  return bookName(state, myNum, other) || other;
}

export function setBookName(state, myNum, other, name) {
  const dev = state.devices[myNum];
  if (!dev) return;
  dev.book ??= {};
  const clean = String(name ?? "").trim();
  if (clean) dev.book[other] = clean;
  else delete dev.book[other];
}

/* ------------------------------------------------------------- непрочитанное */

export function markRead(state, myNum, other, now = Date.now()) {
  state.read[`${myNum}|${other}`] = now;
}

export function unreadCount(state, myNum, other) {
  const since = state.read[`${myNum}|${other}`] ?? 0;
  return thread(state, myNum, other).filter(m => m.t === myNum && m.ts > since).length;
}

/**
 * Список собеседников устройства: все, с кем есть переписка, плюс те,
 * кто записан в адресную книгу. Сортировка — свежие сверху.
 */
/**
 * Короткая строка последнего сообщения для списков.
 *
 * У картинки без подписи текста нет вовсе, и превью выходило пустым: в списке
 * контактов и в перехвате у мастера строка молчала, хотя сообщение было. Здесь
 * такое сообщение честно называет себя картинкой, а подпись, если она есть,
 * идёт следом.
 *
 * @param {Object} msg - сообщение или undefined
 * @returns {String}
 */
export function previewOf(msg) {
  if (!msg) return "";
  if (!msg.p) return msg.x ?? "";
  return msg.x ? `[картинка] ${msg.x}` : "[картинка]";
}

export function contactsFor(state, myNum) {
  const dev = state.devices[myNum];
  if (!dev) return [];

  const numbers = new Set(Object.keys(dev.book ?? {}));
  for (const key of Object.keys(state.threads)) {
    const parts = key.split("|");
    if (parts.includes(myNum)) numbers.add(parts[0] === myNum ? parts[1] : parts[0]);
  }
  numbers.delete(myNum);

  return [...numbers].map(other => {
    const msgs = thread(state, myNum, other);
    const last = msgs[msgs.length - 1];
    return {
      num: other,
      name: contactLabel(state, myNum, other),
      known: Boolean(bookName(state, myNum, other)),
      preview: previewOf(last),
      lastTs: last ? last.ts : 0,
      unread: unreadCount(state, myNum, other)
    };
  }).sort((a, b) => b.lastTs - a.lastTs || a.num.localeCompare(b.num));
}

/** Все переписки — для вкладки «Перехват» у мастера. */
export function allThreads(state) {
  return Object.entries(state.threads).map(([key, msgs]) => {
    const [a, b] = key.split("|");
    const last = msgs[msgs.length - 1];
    return { key, a, b, count: msgs.length, lastTs: last ? last.ts : 0, preview: previewOf(last) };
  }).sort((x, y) => y.lastTs - x.lastTs);
}
