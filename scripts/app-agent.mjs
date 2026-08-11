/**
 * Окно Агента. Слева — собеседники, справа — переписка, снизу — поле ввода.
 * Мастер видит в списке устройств все аппараты сразу и может писать от лица
 * любого НИПа, игрок — только свои.
 */
import { readState } from "./store.mjs";
import * as M from "./model.mjs";
import { sendMessage, setBook, markRead, setRingtone, UPDATE_HOOK } from "./socket.mjs";
import { browseFiles, canUploadFiles } from "./foundry-compat.mjs";
import { openHelp } from "./help.mjs";
import { setOpenThread, clearOpenThread } from "./presence.mjs";
import { ringKey, stopRing, stopRingsOn, ringingOn, RING_HOOK } from "./ringtone.mjs";
import { transfer as transferEb, actorForUser } from "./wealth.mjs";
import { callREO, callTrauma, inspectLifestyle, findMembership } from "./services.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function hhmm(ts) {
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Игроки заходят на сервер по обычному http, а это не защищённый контекст —
 * navigator.clipboard там недоступен. Поэтому запасной путь через execCommand.
 */
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => ui.notifications.info(`Агент: номер ${text} скопирован`),
      () => legacyCopy(text)
    );
    return;
  }
  legacyCopy(text);
}

function legacyCopy(text) {
  const box = document.createElement("textarea");
  box.value = text;
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  box.remove();
  if (ok) ui.notifications.info(`Агент: номер ${text} скопирован`);
  else ui.notifications.warn(`Агент: скопируйте номер вручную — ${text}`);
}

/* --------------------------------------------------------------- действия */

async function onPickDevice(event, target) {
  this.num = target.dataset.num;
  this.other = null;
  this.render();
}

async function onPickContact(event, target) {
  this.other = target.dataset.num;
  if (this.num && this.other) {
    // Прочитано — значит, звонок смолкает.
    await stopRing(ringKey(this.num, this.other));
    await markRead(this.num, this.other).catch(() => {});
  }
  this.render();
}

/** Заглушить звонок, не открывая переписку. */
async function onMute() {
  if (this.num) await stopRingsOn(this.num);
  this.render();
}

async function onSend() {
  const field = this.element.querySelector(".nca-input");
  const text = field?.value ?? "";
  if (!text.trim() || !this.num || !this.other) return;
  field.value = "";
  try {
    await sendMessage(this.num, this.other, text);
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
    field.value = text;
    return;
  }
  this.render();
}

/** Новый контакт: номер обязателен, имя можно не указывать. */
async function onNewContact() {
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Новый контакт" },
    position: { width: 460 },
    content: `
      <div class="nca-dialog">
        <p class="hint">Введите номер собеседника целиком, восемь цифр через дефис.
        Имя можно оставить пустым — тогда контакт останется просто номером.</p>
        <label>Номер<input type="text" name="num" placeholder="2137-5581" maxlength="12" autofocus /></label>
        <label>Имя в книге<input type="text" name="name" placeholder="например, Ласточка" /></label>
      </div>`,
    ok: {
      label: "Добавить",
      icon: "fa-solid fa-user-plus",
      callback: (event, button, dialog) => ({
        num: dialog.querySelector('[name="num"]')?.value.trim() ?? "",
        name: dialog.querySelector('[name="name"]')?.value.trim() ?? ""
      })
    },
    rejectClose: false
  });

  if (!result?.num) return;
  const num = result.num;

  if (num === this.num) {
    ui.notifications.warn("Агент: это ваш собственный номер");
    return;
  }
  if (!readState().devices[num]) {
    ui.notifications.warn(`Агент: номер ${num} не отвечает`);
    return;
  }

  if (result.name) {
    try {
      await setBook(this.num, num, result.name);
    } catch (err) {
      ui.notifications.error(`Агент: ${err.message}`);
      return;
    }
  }
  this.other = num;
  this.render();
}

function onHelp() {
  openHelp("guide");
}

/**
 * Кому принадлежит кошелёк устройства.
 *
 * У аппарата игрока лист определяется по владельцу — выделять токен не нужно.
 * Токен остаётся запасным путём и нужен только для аппаратов НИПов, у которых
 * владельца нет вовсе: там мастер и правда должен показать, о ком речь.
 */
function actorOfDevice(num) {
  const dev = readState().devices[num];
  if (!dev) return null;
  if (dev.owner) return actorForUser(dev.owner) ?? canvas.tokens?.controlled?.[0]?.actor ?? null;
  return canvas.tokens?.controlled?.[0]?.actor ?? null;
}

/**
 * Перевод эдди прямо из переписки. Списание у отправителя проходит сразу,
 * зачисление получателю — либо сразу, либо кнопкой владельцу: чужой лист
 * игрок править не вправе.
 */
async function onPayEb() {
  if (!this.num || !this.other) return;

  const me = actorOfDevice(this.num);
  const them = actorOfDevice(this.other);
  if (!me) return ui.notifications.warn("Агент: не понял, чей это счёт. Мастеру — выделите токен отправителя.");
  if (!them) return ui.notifications.warn("Агент: у собеседника нет листа со счётом.");

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Перевод эдди" },
    position: { width: 460 },
    content: `
      <div class="nca-dialog">
        <p class="hint">Со счёта «${me.name}» на счёт «${them.name}». Запись появится в журнале обоих.</p>
        <label>Сумма, эдди<input type="number" name="sum" min="1" step="1" value="100" autofocus /></label>
        <label>За что<input type="text" name="note" placeholder="например, за работу в Уотсоне" /></label>
      </div>`,
    ok: {
      label: "Перевести",
      icon: "fa-solid fa-coins",
      callback: (event, button, dialog) => ({
        sum: Number(dialog.querySelector('[name="sum"]')?.value ?? 0),
        note: dialog.querySelector('[name="note"]')?.value.trim() ?? ""
      })
    },
    rejectClose: false
  });
  if (!result?.sum) return;

  try {
    const sum = await transferEb(me, them, result.sum, result.note);
    const tail = result.note ? ` — ${result.note}` : "";
    await sendMessage(this.num, this.other, `[перевод] ${sum} эдди${tail}`);
    ui.notifications.info(`Агент: переведено ${sum} эдди`);
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
  }
  this.render();
}

/** Экстренные службы: «мясовозка» и «Травма Тим». */
async function onEmergency() {
  const actor = actorOfDevice(this.num);
  if (!actor) return ui.notifications.warn("Агент: не найден лист вызывающего.");

  const life = inspectLifestyle(actor);
  const reo = findMembership(actor, "reo");
  const trauma = findMembership(actor, "trauma");

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Экстренные службы" },
    // Три кнопки в ряд: при 480 «Отмена» не помещалась и обрезалась краем окна.
    position: { width: 620 },
    classes: ["nca-dialog-app"],
    content: `
      <div class="nca-dialog">
        <p class="hint">Вызывает: <b>${actor.name}</b>. Еда и жильё: ${life.totalMonthly} эдди/мес
        ${life.totalMonthly > 800 ? "— вызов «мясовозки» бесплатный" : `— вызов «мясовозки» стоит 5 эдди`}.</p>
        <p class="hint">R.E.O.: ${reo ? `подписка «${reo.tier}»` : "подписки нет, поедут медленнее"}.<br>
        Травма Тим: ${trauma ? `подписка «${trauma.tier}»` : "подписки нет, вызов недоступен"}.</p>
      </div>`,
    buttons: [
      { action: "reo", label: "R.E.O. Meatwagon", icon: "fa-solid fa-truck-medical" },
      { action: "trauma", label: "Травма Тим", icon: "fa-solid fa-helicopter", disabled: !trauma },
      { action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return;

  try {
    const eta = choice === "reo" ? await callREO(actor) : await callTrauma(actor);
    ui.notifications.info(`Агент: вызов принят, прибытие через ${eta} раунд(ов)`);
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
  }
}

/** Игрок сам выбирает рингтон своему устройству. */
async function onPickRingtone() {
  if (!this.num) return;

  const state = readState();
  const opened = browseFiles({
    type: "audio",
    current: state.devices[this.num]?.ringtone || "",
    callback: async path => {
      try {
        await setRingtone(this.num, path);
        ui.notifications.info("Агент: рингтон изменён");
      } catch (err) {
        ui.notifications.error(`Агент: ${err.message}`);
      }
      this.render();
    }
  });

  if (!opened) {
    ui.notifications.warn(
      "Агент: обозреватель файлов вам недоступен. Мастеру нужно выдать право " +
      "«Использовать обозреватель файлов» (и «Загружать новые файлы», чтобы вы могли " +
      "заливать свои звуки) в Настройки → Настроить права."
    );
  } else if (!canUploadFiles()) {
    ui.notifications.info("Агент: свои файлы загружать нельзя — выбирайте из уже имеющихся.");
  }
}

/** Вернуть общий рингтон. */
async function onResetRingtone() {
  if (!this.num) return;
  try {
    await setRingtone(this.num, "");
    ui.notifications.info("Агент: возвращён общий рингтон");
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
  }
  this.render();
}

function onCopyNum() {
  if (this.num) copyToClipboard(this.num);
}

async function onSaveName() {
  const field = this.element.querySelector(".nca-name");
  if (!this.num || !this.other) return;
  try {
    await setBook(this.num, this.other, field?.value ?? "");
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
    return;
  }
  this.render();
}

/* ------------------------------------------------------------------- окно */

export class AgentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.num = options.num ?? null;
    this.other = options.other ?? null;
    this.closing = false;
    // Перерисовка и закрытие стоят в одной очереди (семафор ApplicationV2).
    // Без флага перерисовка, поставленная в очередь во время закрытия,
    // открывала окно обратно — и закрыть его было нельзя.
    this._onUpdate = () => { if (this.rendered && !this.closing) this.render(); };
    this._onRing = this._onUpdate;
  }

  static DEFAULT_OPTIONS = {
    id: "night-city-agent-{id}",
    classes: ["nca-app"],
    tag: "div",
    window: {
      title: "Агент",
      icon: "fa-solid fa-mobile-screen-button",
      resizable: true
    },
    position: { width: 760, height: 580 },
    actions: {
      pickDevice: onPickDevice,
      pickContact: onPickContact,
      send: onSend,
      newContact: onNewContact,
      saveName: onSaveName,
      copyNum: onCopyNum,
      mute: onMute,
      pickRingtone: onPickRingtone,
      resetRingtone: onResetRingtone,
      payEb: onPayEb,
      emergency: onEmergency,
      help: onHelp
    }
  };

  static PARTS = {
    body: {
      template: "modules/night-city-agent/templates/agent.hbs",
      scrollable: [".nca-contacts", ".nca-thread"]
    }
  };

  async _prepareContext() {
    const state = readState();
    const isGM = game.user.isGM;

    const owned = isGM
      ? Object.values(state.devices)
      : M.devicesOfUser(state, game.user.id);
    owned.sort((a, b) => a.num.localeCompare(b.num));

    if (!this.num || !state.devices[this.num]) this.num = owned[0]?.num ?? null;
    const device = this.num ? state.devices[this.num] : null;

    const contacts = this.num ? M.contactsFor(state, this.num) : [];
    if (this.other && !contacts.some(c => c.num === this.other)) {
      contacts.unshift({
        num: this.other,
        name: M.contactLabel(state, this.num, this.other),
        known: false, preview: "", lastTs: 0, unread: 0
      });
    }

    const aloud = M.speaksAloud(device);
    const messages = (this.num && this.other)
      ? M.thread(state, this.num, this.other).map(m => ({
          mine: m.f === this.num,
          text: m.x,
          time: hhmm(m.ts),
          // «Вслух» — либо надиктовано с безхиронного аппарата, либо прочитано
          // вслух моим собственным: без хирона агент проговаривает всё.
          aloud: m.a === 1 || (aloud && m.t === this.num)
        }))
      : [];

    return {
      isGM,
      noDevice: !device,
      noGM: !game.users.activeGM,
      device: device ? {
        ...device,
        label: device.label || (device.kind === M.KIND.INTERNAL ? "внутренний агент" : "карманный агент")
      } : null,
      aloud,
      ringing: this.num ? ringingOn(this.num) : false,
      ringtoneName: device?.ringtone ? device.ringtone.split("/").pop() : "",
      hasOwnRingtone: Boolean(device?.ringtone),
      manyDevices: owned.length > 1,
      devices: owned.map(d => ({
        num: d.num,
        label: d.label || (d.kind === M.KIND.INTERNAL ? "внутренний" : "агент"),
        selected: d.num === this.num
      })),
      contacts: contacts.map(c => ({ ...c, selected: c.num === this.other })),
      active: this.other,
      activeName: this.other ? M.contactLabel(state, this.num, this.other) : "",
      activeBookName: this.other ? M.bookName(state, this.num, this.other) : "",
      messages
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Enter отправляет, Shift+Enter — перенос строки.
    const input = this.element.querySelector(".nca-input");
    input?.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        onSend.call(this);
      }
    });
    // Enter в поле имени сразу записывает контакт в книгу.
    this.element.querySelector(".nca-name")?.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); onSaveName.call(this); }
    });

    // Переписка всегда прокручена к свежему сообщению.
    const thread = this.element.querySelector(".nca-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;

    // Сообщаем доставке, на какую переписку игрок сейчас смотрит:
    // пришедшее в неё сообщение не звонит и сразу считается прочитанным.
    clearOpenThread(this.num);
    if (this.num && this.other) setOpenThread(this.num, this.other);
  }

  /* Подписка ставится и снимается ровно по одному разу за жизнь окна. */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(UPDATE_HOOK, this._onUpdate);
    Hooks.on(RING_HOOK, this._onRing);
  }

  async _preClose(options) {
    this.closing = true;
    Hooks.off(UPDATE_HOOK, this._onUpdate);
    Hooks.off(RING_HOOK, this._onRing);
    clearOpenThread(this.num);
    await super._preClose?.(options);
  }

  _onClose(options) {
    super._onClose?.(options);
    Hooks.off(UPDATE_HOOK, this._onUpdate);
    Hooks.off(RING_HOOK, this._onRing);
    clearOpenThread(this.num);
    for (const [key, app] of instances) if (app === this) instances.delete(key);
  }
}

/** По окну на устройство: мастеру удобно держать открытыми несколько НИПов. */
const instances = new Map();

export function openAgent(opts = {}) {
  const key = opts.num ?? "self";
  const existing = instances.get(key);
  if (existing?.rendered) {
    if (opts.other) existing.other = opts.other;
    existing.bringToFront();
    existing.render();
    return existing;
  }
  const app = new AgentApp(opts);
  instances.set(key, app);
  app.render(true);
  return app;
}

/** Закрыть все окна Агента — пригодится, если что-то всё же зависнет. */
export async function closeAllAgents() {
  for (const app of [...instances.values()]) await app.close();
  instances.clear();
}
