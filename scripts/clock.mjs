/**
 * Отметка времени для карточек в чате.
 *
 * Если в мире работает Simple Calendar, берём внутриигровую дату — иначе
 * сообщение о вызове «Травма Тим» окажется помечено реальным вторником,
 * а не третьим днём заезда в Найт-Сити. Без календаря честно пишем, что
 * время местное, и не притворяемся, будто знаем игровое.
 *
 * Приём заимствован из модуля Holophone/Agent Messenger™ (автор Lt Atlas).
 */

const SIMPLE_CALENDAR = "foundryvtt-simple-calendar";
let warned = false;

function calendarActive() {
  return Boolean(game.modules.get(SIMPLE_CALENDAR)?.active && globalThis.SimpleCalendar?.api);
}

/** Simple Calendar возвращает то строку, то объект с датой и временем. */
function displayLabel(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  const date = String(value.date ?? "").trim();
  const time = String(value.time ?? "").trim();
  return [date, time].filter(Boolean).join(", ");
}

function localLabel(ms) {
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

/** {source, sourceLabel, label, realTime, calendarTimestamp} */
export function now() {
  const realTime = Date.now();

  if (calendarActive()) {
    try {
      const api = globalThis.SimpleCalendar.api;
      let label = displayLabel(api.currentDateTimeDisplay?.());
      if (!label) {
        const current = api.currentDateTime?.() ?? api.getCurrentDate?.();
        if (current) label = displayLabel(api.formatDateTime?.(current));
      }
      if (label) {
        const stamp = Number(api.timestamp?.());
        return {
          source: "calendar",
          sourceLabel: "ВРЕМЯ МИРА",
          label,
          realTime,
          calendarTimestamp: Number.isFinite(stamp) ? stamp : null
        };
      }
    } catch (err) {
      if (!warned) {
        console.warn("night-city-agent | Simple Calendar не отдал время, беру местное", err);
        warned = true;
      }
    }
  }

  return {
    source: "local",
    sourceLabel: "МЕСТНОЕ ВРЕМЯ",
    label: localLabel(realTime),
    realTime,
    calendarTimestamp: null
  };
}

export function clockHTML(clock = now()) {
  return `<div class="nca-card-clock"><i class="far fa-clock"></i>
    <span class="nca-card-clock-source">${esc(clock.sourceLabel)}</span>
    <span>${esc(clock.label)}</span></div>`;
}

export function clockFlag(clock) {
  return {
    source: clock.source,
    label: clock.label,
    realTime: clock.realTime,
    calendarTimestamp: clock.calendarTimestamp
  };
}

export function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
