/**
 * Звонки. Модуль не заводит плейлистов: звук проигрывается напрямую через
 * AudioHelper и по умолчанию идёт в канал "interface" — значит, его громкость
 * регулируется ползунком «Интерфейс» в панели звука Foundry.
 *
 * Раньше звук запускался и терялся: ссылки на него не оставалось, остановить
 * было нечем и нигде не видно, что он играет. Теперь каждый звонок лежит
 * в реестре, его видно в окне Агента и он смолкает, когда сообщение прочитано.
 */
import { ringtoneVolume, defaultRingtone, ringSettings } from "./store.mjs";

export const RING_HOOK = "nightCityAgentRing";

/** ключ звонка -> { sound, src, timer, since } */
const ringing = new Map();

/** Ключ звонка: моё устройство + номер, с которого пришло. */
export function ringKey(myNum, otherNum) {
  return `${myNum}|${otherNum}`;
}

function helper() {
  return foundry.audio?.AudioHelper ?? null;
}

function announce() {
  Hooks.callAll(RING_HOOK, activeKeys());
}

export function activeKeys() {
  return [...ringing.keys()];
}

export function isRinging(key) {
  return ringing.has(key);
}

/**
 * Sound шлёт "end", когда доиграл сам, и "stop", когда его прервали
 * (Sound.emittedEvents = load, play, pause, end, stop). Слушаем оба.
 */
function whenFinished(sound, fn) {
  if (!sound?.addEventListener) return;
  for (const event of ["end", "stop"]) {
    try { sound.addEventListener(event, fn, { once: true }); } catch { /* событие не поддержано */ }
  }
}

/** Звонит ли хоть что-то на этом устройстве. */
export function ringingOn(myNum) {
  return activeKeys().some(k => k.startsWith(`${myNum}|`));
}

/**
 * Запускает звонок. Повторный вызов с тем же ключом ничего не ломает —
 * второе сообщение подряд не накладывает второй звук поверх первого.
 */
export async function startRing(key, src) {
  const AudioHelper = helper();
  if (!AudioHelper?.play) return;
  if (ringing.has(key)) return;

  const file = src || defaultRingtone();
  if (!file) return;

  const { loop, maxSeconds, channel } = ringSettings();
  const entry = { sound: null, src: file, timer: null, since: Date.now() };
  ringing.set(key, entry);
  announce();

  // Предохранитель: если игрок отошёл, звонок не будет длиться вечно.
  if (maxSeconds > 0) {
    entry.timer = window.setTimeout(() => stopRing(key), maxSeconds * 1000);
  }

  try {
    const sound = await AudioHelper.play(
      { src: file, volume: ringtoneVolume(), autoplay: true, loop, channel },
      false
    );
    // Пока звук грузился, сообщение могли успеть прочитать.
    if (!ringing.has(key)) {
      await sound?.stop();
      return;
    }
    entry.sound = sound ?? null;
    // Незацикленный звук, доигравший до конца, шлёт "end", а не "stop" —
    // без этого кнопка «заглушить» продолжала бы гореть над тишиной.
    if (sound && !loop) whenFinished(sound, () => stopRing(key));
  } catch (err) {
    console.warn("night-city-agent | не удалось проиграть рингтон", err);
    stopRing(key);
  }
}

/** Останавливает конкретный звонок — вызывается, когда сообщение прочитано. */
export async function stopRing(key) {
  const entry = ringing.get(key);
  if (!entry) return;
  ringing.delete(key);
  if (entry.timer) window.clearTimeout(entry.timer);
  try { await entry.sound?.stop(); } catch { /* звук уже мог кончиться сам */ }
  announce();
}

/** Заглушить всё на этом устройстве. */
export async function stopRingsOn(myNum) {
  for (const key of activeKeys()) {
    if (key.startsWith(`${myNum}|`)) await stopRing(key);
  }
}

export async function stopAll() {
  for (const key of activeKeys()) await stopRing(key);
}

/**
 * Прослушать файл на пульте мастера: один раз, без зацикливания,
 * с отдельным ключом — чтобы кнопка «прослушать» могла его же и оборвать.
 */
const PREVIEW = "__preview__";

export async function preview(src) {
  if (ringing.has(PREVIEW)) {
    await stopRing(PREVIEW);
    return;
  }
  const AudioHelper = helper();
  if (!AudioHelper?.play) return;

  const file = src || defaultRingtone();
  if (!file) return;

  const { channel } = ringSettings();
  const entry = { sound: null, src: file, timer: null, since: Date.now() };
  ringing.set(PREVIEW, entry);
  announce();

  try {
    const sound = await AudioHelper.play(
      { src: file, volume: ringtoneVolume(), autoplay: true, loop: false, channel },
      false
    );
    if (!ringing.has(PREVIEW)) {
      await sound?.stop();
      return;
    }
    entry.sound = sound ?? null;
    whenFinished(sound, () => stopRing(PREVIEW));
  } catch (err) {
    console.warn("night-city-agent | не удалось проиграть рингтон", err);
    stopRing(PREVIEW);
  }
}

export function previewPlaying() {
  return ringing.has(PREVIEW);
}
