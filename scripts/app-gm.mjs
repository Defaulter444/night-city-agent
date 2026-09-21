/**
 * Пульт мастера: список устройств и «Перехват».
 * Мастер заводит аппараты, раздаёт их игрокам, забирает обратно и читает
 * любую переписку.
 */
import { readState, mutate, storageLocked } from "./store.mjs";
import { openWorkspace } from './workspace-app.mjs';
import * as M from "./model.mjs";
import { broadcastRefresh, UPDATE_HOOK } from "./socket.mjs";
import { openAgent } from "./app-agent.mjs";
import { openHelp } from "./help.mjs";
import { browseFiles } from "./foundry-compat.mjs";
import { messageTime, messageTimeTitle } from './clock.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function hhmm(ts) {
  return ts ? new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

/* --------------------------------------------------------------- действия */

async function onCreate() {
  const kind = this.element.querySelector(".nca-new-kind").value;
  const owner = this.element.querySelector(".nca-new-owner").value || null;
  const label = this.element.querySelector(".nca-new-label").value.trim();
  const audioOnly = this.element.querySelector(".nca-new-audio").checked;
  const numField = this.element.querySelector(".nca-new-num");
  const num = numField?.value.trim() ?? "";

  // Проверяем до записи: mutate сохраняет состояние даже при пустом изменении,
  // а нам нужно, чтобы кривой номер вообще ничего не менял.
  if (num) {
    const normalized = M.normalizeNumber(num);
    const issue = M.numberIssue(readState(), normalized);
    if (issue) {
      ui.notifications.error(issue === "taken"
        ? `Агент: номер ${normalized} уже занят`
        : `Агент: «${num}» не похоже на номер — нужно восемь цифр, например 2137-5581`);
      numField?.focus();
      return;
    }
  }

  let dev;
  try {
    dev = await mutate(s => M.addDevice(s, { kind, owner, label, audioOnly, num }));
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
    return;
  }

  if (numField) numField.value = "";
  this.element.querySelector(".nca-new-label").value = "";
  await broadcastRefresh();
  ui.notifications.info(`Агент: выдан номер ${dev.num}`);
  this.render();
}

async function onAssign(event, target) {
  const num = target.dataset.num;
  const owner = target.value || null;
  try {
    await mutate(s => M.transferDevice(s, num, owner));
  } catch (err) {
    ui.notifications.warn(`Агент: ${err.message}`);
    this.render();                       // возвращаем прежнего владельца в списке
    return;
  }
  await broadcastRefresh();
  this.render();
}

async function saveRingtone(num, path) {
  await mutate(s => { if (s.devices[num]) s.devices[num].ringtone = String(path ?? "").trim(); });
  await broadcastRefresh();
}

async function onRingtone(event, target) {
  await saveRingtone(target.dataset.num, target.value);
}

/** Выбор рингтона обозревателем файлов — путь руками вводить не нужно. */
async function onPickRingtone(event, target) {
  const num = target.dataset.num;
  const field = this.element.querySelector(`.nca-ringtone[data-num="${num}"]`);

  const opened = browseFiles({
    type: "audio",
    current: field?.value || "",
    callback: async path => {
      if (field) field.value = path;
      await saveRingtone(num, path);
      this.render();
    }
  });

  if (!opened) ui.notifications.warn("Агент: обозреватель файлов недоступен, впишите путь вручную");
}

/** Прослушать выбранный рингтон. Повторное нажатие обрывает прослушивание. */
async function onPlayRingtone(event, target) {
  const num = target.dataset.num;
  const field = this.element.querySelector(`.nca-ringtone[data-num="${num}"]`);
  const { preview } = await import("./ringtone.mjs");
  await preview(field?.value || "");
}

/** Оборвать все звонки на своём клиенте — на случай, если звук где-то залип. */
async function onSilence() {
  const { stopAll } = await import("./ringtone.mjs");
  await stopAll();
  ui.notifications.info("Агент: звонки заглушены");
}

async function onRemove(event, target) {
  const num = target.dataset.num;
  const dev = readState().devices[num];
  const internal = dev?.kind === M.KIND.INTERNAL;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: internal ? "Хирургическое извлечение" : "Изъять устройство" },
    content: internal
      ? `<p>Устройство <b>${num}</b> вживлено. Удалить его вместе со всей перепиской?</p>
         <p style="opacity:.7">По книге такой агент достаётся только хирургией — но номер
         освободить это не мешает.</p>`
      : `<p>Удалить устройство <b>${num}</b> вместе со всей его перепиской?</p>`
  });
  if (!ok) return;
  await mutate(s => M.removeDevice(s, num));
  await broadcastRefresh();
  this.render();
}

async function onOpen(event, target) {
  openAgent({ num: target.dataset.num });
}
function onCalls() { openAgent({tab:'calls',callScope:'all'}); }

async function onWatch(event, target) {
  this.watching = target.dataset.key;
  this.render();
}

function onHelp() {
  openHelp("guide");
}

/* ------------------------------------------------------------------- окно */

/**
 * Показать картинки, на которые больше никто не ссылается.
 *
 * Удалять модуль их не может: в Foundry 12 у клиента нет команды удаления
 * файла — сервер принимает только просмотр, создание папки и настройку пути.
 * Поэтому окно показывает список и путь к папке, а убирает мастер сам.
 */
async function onSweepImages() {
  const { usedImages } = await import("./model.mjs");
  const { findOrphanImages } = await import("./images.mjs");
  const { getFilePicker } = await import("./foundry-compat.mjs");

  const picker = getFilePicker();
  if (!picker) {
    ui.notifications.error("Агент: обозреватель файлов недоступен");
    return;
  }

  let result;
  try {
    result = await findOrphanImages(usedImages(readState()), game.world.id, picker);
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
    return;
  }

  const list = result.orphans.length
    ? `<ul class="nca-orphans">${result.orphans
        .map(path => `<li>${path.split("/").pop()}</li>`)
        .join("")}</ul>`
    : "<p>Лишних вложений нет — на все картинки в папке ссылается хотя бы одна переписка.</p>";

  await foundry.applications.api.DialogV2.prompt({
    window: { title: "Неиспользуемые вложения" },
    position: { width: 520 },
    content: `
      <div class="nca-dialog">
        <p class="hint">Эти файлы остались от переписок, которых больше нет —
        обычно от изъятых устройств. Удалить их отсюда нельзя: в Foundry 12 у
        модулей нет команды удаления файла. Уберите вручную из папки
        <code>${result.folder}</code>.</p>
        ${list}
        <p class="hint">Используется вложений: ${result.kept}.</p>
      </div>`,
    ok: { label: "Понятно" }
  });
}

/** Открыть перехваченную картинку во весь экран. */
async function onOpenImage(event, target) {
  const src = target.dataset.src;
  if (!src) return;
  const Popout = typeof ImagePopout !== 'undefined' ? ImagePopout : foundry.applications?.apps?.ImagePopout;
  if (!Popout) {
    window.open(src, "_blank", "noopener");
    return;
  }
  new Popout(src, { title: 'Перехват: вложение', shareable: false }).render(true);
}

export class AgentGMApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.watching = null;
    this.closing = false;
    this._onUpdate = () => { if (this.rendered && !this.closing) this.render(); };
  }

  static DEFAULT_OPTIONS = {
    id: "night-city-agent-gm",
    classes: ["nca-app", "nca-gm"],
    tag: "div",
    window: { title: "Агент — пульт мастера", icon: "fa-solid fa-tower-broadcast", resizable: true },
    position: { width: 820, height: 620 },
    actions: {
      create: onCreate,
      remove: onRemove,
      open: onOpen,
      watch: onWatch,
      openImage: onOpenImage,
      pickRingtone: onPickRingtone,
      playRingtone: onPlayRingtone,
      silence: onSilence,
      calls: onCalls,
      sweepImages: onSweepImages,
      help: onHelp
    }
  };

  static PARTS = {
    body: {
      template: "modules/night-city-agent/templates/gm.hbs",
      scrollable: [".nca-devices", ".nca-watch"]
    }
  };

  async _prepareContext() {
    const state = readState();
    const users = game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: u.name }));

    const devices = Object.values(state.devices)
      .sort((a, b) => a.num.localeCompare(b.num))
      .map(d => ({
        ...d,
        kindName: d.kind === M.KIND.INTERNAL ? "внутренний" : "карманный",
        ownerName: d.owner ? (game.users.get(d.owner)?.name ?? "—") : "НИП мастера",
        // Вживлённый агент не переходит из рук в руки — список владельцев запираем.
        locked: !M.canTransfer(d),
        users: users.map(u => ({ ...u, selected: u.id === d.owner }))
      }));

    let watching = null;
    if (this.watching) {
      const [a, b] = this.watching.split("|");
      watching = {
        key: this.watching,
        a, b,
        aName: state.devices[a]?.label || a,
        bName: state.devices[b]?.label || b,
        // Картинку мастер должен видеть так же, как её видят собеседники:
        // перехват без вложений показывал пустое облачко и молчал о том, что
        // вообще что-то передали.
        messages: M.thread(state, a, b).map(m => ({
          from: m.f,
          text: m.x,
          image: m.p || "",
          time: messageTime(m), timeTitle: messageTimeTitle(m),
          left: m.f === a
        }))
      };
    }

    return {
      devices,
      users,
      threads: M.allThreads(state).map(t => ({
        ...t,
        aLabel: state.devices[t.a]?.label ? `${t.a} (${state.devices[t.a].label})` : t.a,
        bLabel: state.devices[t.b]?.label ? `${t.b} (${state.devices[t.b].label})` : t.b,
        time: hhmm(t.lastTs),
        selected: t.key === this.watching
      })),
      watching,
      kinds: [
        { value: M.KIND.POCKET, label: "Карманный агент" },
        { value: M.KIND.INTERNAL, label: "Внутренний агент (кибераудио)" }
      ]
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const sel of this.element.querySelectorAll(".nca-owner")) {
      sel.addEventListener("change", ev => onAssign.call(this, ev, ev.currentTarget));
    }
    for (const inp of this.element.querySelectorAll(".nca-ringtone")) {
      inp.addEventListener("change", ev => onRingtone.call(this, ev, ev.currentTarget));
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(UPDATE_HOOK, this._onUpdate);
  }

  async _preClose(options) {
    this.closing = true;
    Hooks.off(UPDATE_HOOK, this._onUpdate);
    await super._preClose?.(options);
  }

  _onClose(options) {
    super._onClose?.(options);
    Hooks.off(UPDATE_HOOK, this._onUpdate);
    instance = null;
  }
}

let instance = null;

export function openGMPanel() {
  if (storageLocked()) return openWorkspace({ tab: 'storage' });
  if (instance?.rendered) {
    instance.bringToFront();
    return instance;
  }
  instance = new AgentGMApp();
  instance.render(true);
  return instance;
}
