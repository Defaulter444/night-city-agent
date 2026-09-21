/**
 * Окно Агента. Слева — собеседники, справа — переписка, снизу — поле ввода.
 * Мастер видит в списке устройств все аппараты сразу и может писать от лица
 * любого НИПа, игрок — только свои.
 */
import { readState, storageLocked } from "./store.mjs";
import * as M from "./model.mjs";
import { sendMessage, sendImage, setBook, markRead, setRingtone, documentOperation, noteOperation, refreshState, UPDATE_HOOK } from "./socket.mjs";
import { shrinkImage, MAX_BYTES } from "./images.mjs";
import { browseFiles, canUploadFiles } from "./foundry-compat.mjs";
import { openHelp } from "./help.mjs";
import { setOpenThread, clearOpenThread } from "./presence.mjs";
import { ringKey, stopRing, stopRingsOn, ringingOn, RING_HOOK } from "./ringtone.mjs";
import { transfer as transferEb, actorForDevice } from "./wealth.mjs";
import { callREO, callTrauma, inspectLifestyle, findMembership } from "./services.mjs";

import { openWorkspace, inputDialog } from './workspace-app.mjs';
import { esc } from './clock.mjs';
import { noteOwner, openNoteResult } from './notes.mjs';
import { OSContext, contactPortrait } from './os-view.mjs';
import { performOS, OSRender, selectOSDocument } from './os-controller.mjs';
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
  await this.saveDraft();
  clearOpenThread(this.num);
  this.num = target.dataset.num;
  this.other = null;
  this.render();
}

async function onPickContact(event, target) {
  await this.saveDraft();
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
  if (this.sending) return;
  const field = this.element.querySelector('.nca-input'), text = field?.value ?? '';
  if (!text.trim() || !this.num || !this.other) return;
  this.sending = true;
  const from = this.num, to = this.other, key = `${from}|${to}`;
  try {
    await this.saveDraft();
    await sendMessage(from, to, text);
    if (this.drafts[key] === text) {
      this.drafts[key] = '';
      await documentOperation('organize', { number: from, other: to, draft: '' });
    }
  } catch (error) { ui.notifications.error(`Агент: ${error.message}`); }
  finally { this.sending = false; this.render(); }
}

/**
 * Отправка картинки. Файл выбирается обычным полем `input[type=file]`, а не
 * обозревателем Foundry: у обычного игрока нет права ни просматривать файлы на
 * сервере, ни загружать их туда. Здесь же картинка и сжимается — по сети и в
 * папку мира уходит уже уменьшенная.
 *
 * Подпись берём из того же поля ввода: людям привычно набрать текст и приложить
 * к нему картинку, а не наоборот.
 */
async function onSendImage() {
  if (!this.num || !this.other) return;

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/png,image/jpeg,image/webp,image/gif";
  picker.style.display = "none";
  document.body.appendChild(picker);

  const chosen = await new Promise(resolve => {
    // `cancel` есть не во всех браузерах, поэтому подстраховываемся фокусом:
    // окно выбора закрылось, файла нет — значит, передумали.
    picker.addEventListener("change", () => resolve(picker.files?.[0] ?? null), { once: true });
    picker.addEventListener("cancel", () => resolve(null), { once: true });
    picker.click();
  });
  picker.remove();
  if (!chosen) return;

  const field = this.element.querySelector(".nca-input");
  const caption = field?.value ?? "";

  const notice = ui.notifications.info("Агент: картинка отправляется…", { permanent: true });
  try {
    const image = await shrinkImage(chosen, { maxBytes: MAX_BYTES });
    await sendImage(this.num, this.other, image, caption);
    if (field) field.value = '';
    this.drafts[`${this.num}|${this.other}`] = '';
    await this.saveDraft();
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
  } finally {
    ui.notifications.remove?.(notice);
  }
  this.render();
}

/** Открыть присланную картинку во весь экран. */
async function onOpenImage(event, target) {
  const src = target.dataset.src;
  if (!src) return;
  const Popout = typeof ImagePopout !== 'undefined' ? ImagePopout : foundry.applications?.apps?.ImagePopout;
  if (!Popout) {
    window.open(src, "_blank", "noopener");
    return;
  }
  new Popout(src, { title: "Агент: вложение", shareable: false }).render(true);
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
  const num = M.normalizeNumber(result.num);

  if (num === this.num) {
    ui.notifications.warn("Агент: это ваш собственный номер");
    return;
  }
  if (!readState().devices[num]) {
    ui.notifications.warn(`Агент: номер ${num} не отвечает`);
    return;
  }

  try {
    await this.saveDraft();
    await setBook(this.num, num, result.name || num);
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
    return;
  }
  this.other = num;
  this.osTab = 'messages';
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
  return actorForDevice(readState().devices[num]);
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
  if (!me) return ui.notifications.warn("Агент: не определён счёт отправителя. Назначьте персонажа в настройках пользователя или выделите его токен; для аппарата НИПа токен выбирает мастер.");
  if (!them) return ui.notifications.warn("Агент: не определён счёт собеседника. Его владельцу нужно назначить персонажа в настройках пользователя; для аппарата НИПа токен выбирает мастер.");

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Перевод эдди" },
    position: { width: 460 },
    content: `
      <div class="nca-dialog">
        <p class="hint">Со счёта «${esc(me.name)}» на счёт «${esc(them.name)}». Запись появится в журнале обоих.</p>
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

  let sum;
  try {
    sum = await transferEb(me, them, result.sum, result.note);
  } catch (err) {
    ui.notifications.error(`Агент: ${err.message}`);
    this.render();
    return;
  }
  try {
    const tail = result.note ? ` — ${result.note}` : "";
    await sendMessage(this.num, this.other, `[перевод] ${sum} эдди${tail}`);
    ui.notifications.info(`Агент: переведено ${sum} эдди`);
  } catch (err) {
    ui.notifications.warn(`Агент: ${sum} эдди отправлено, но сообщение в переписку не доставлено. Повторять перевод не нужно. ${err.message}`);
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
        <p class="hint">Вызывает: <b>${esc(actor.name)}</b>. Еда и жильё: ${life.totalMonthly} эдди/мес
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

async function modernAction(event, target) {
  try {
    const state = storageLocked() ? null : readState();
    switch (target.dataset.action) {
      case 'osAction': await performOS(this,event,target); return;
      case 'mailing': {
        if (this.mailingOpen) return;
        if (!state) throw Error('Сначала откройте хранилище');
        this.mailingOpen = true;
        try {
          const { mailingDialog } = await import('./mailing-dialog.mjs');
          const result = await mailingDialog(this.num, this.other);
          if (result) ui.notifications.info(`Агент: рассылка отправлена. Получателей: ${result.count}`);
        } finally { this.mailingOpen = false; }
        break;
      }
      case 'conferences': {
        await this.saveDraft(); const { openConferences } = await import('./conferences-app.mjs');
        openConferences({ number: this.num }); return;
      }
      case 'newNote': {
        const number = this.num;
        const result = await inputDialog('Новая заметка Агента', '<p class="hint">Заметка сохранится в личном журнале Foundry. Он доступен владельцу Агента и мастеру.</p><label>Название<input name="title" required maxlength="160"></label><label>Текст заметки<textarea name="body" rows="10" required maxlength="100000"></textarea></label>',
          fd => noteOperation('create', { number, title: fd.get('title'), body: fd.get('body') }));
        if (result) { await openNoteResult(result); ui.notifications.info('Заметка сохранена в личном журнале'); } return;
      }
      case 'notes': {
        const owner = noteOwner(state, this.num, game.user), id = game.settings.get('night-city-agent', 'noteJournals')?.[owner];
        await openNoteResult(id ? { journalId: id } : null); return;
      }
      case 'files': await this.saveDraft(); this.osTab='files'; break;
      case 'data': openWorkspace({ tab: 'storage' }); return;
      case 'openDocument': await this.saveDraft(); selectOSDocument(this,target.dataset.id); break;
      case 'pin': await documentOperation('organize', { number: this.num, other: this.other, pin: Number(target.dataset.index) }); break;
      case 'pins': this.onlyPins = !this.onlyPins; break;
      case 'tags': await inputDialog('Метки контакта', `<label>До шести меток через запятую<input name="tags" value="${esc((state.organizer?.[this.num]?.tags?.[this.other] ?? []).join(', '))}"></label>`,
        fd => documentOperation('organize', { number: this.num, other: this.other, tags: fd.get('tags').split(',') })); break;
      case 'shareContact': {
        const book = state.devices[this.num]?.book ?? {};
        await inputDialog('Поделиться контактом', `<label>Контакт<select name="contact">${Object.entries(book).map(([num, name]) => `<option value="${esc(num)}">${esc(name)} · ${esc(num)}</option>`).join('')}</select></label>`,
          fd => documentOperation('shareContact', { from: this.num, to: this.other, contact: fd.get('contact') })); break;
      }
      case 'acceptContact': await documentOperation('acceptContact', { number: this.num, other: this.other, index: Number(target.dataset.index) }); ui.notifications.info('Контакт добавлен в вашу книгу'); break;
    }
    this.render();
  } catch (error) { ui.notifications.error(`Агент: ${error.message}`); }
}

/* ------------------------------------------------------------------- окно */

export class AgentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    const { num = null, other = null } = options;
    super(options);
    this.num = num;
    this.other = other;
    this.closing = false;
    this.osTab = options.tab || (other ? 'messages' : 'home');
    this.osCallScope = options.callScope || 'all';
    this.osCompact = Boolean(game.settings.get('night-city-agent','osCompact'));
    this.osReducedMotion = Boolean(game.settings.get('night-city-agent','osReducedMotion'));
    this.drafts = {}; this.search = ''; this.onlyPins = false;
    // Перерисовка и закрытие стоят в одной очереди (семафор ApplicationV2).
    // Без флага перерисовка, поставленная в очередь во время закрытия,
    // открывала окно обратно — и закрыть его было нельзя.
    this._onUpdate = () => {
      if (!this.rendered || this.closing) return;
      const focused = document.activeElement;
      if (this.element.contains(focused) && (focused.matches('.nca-input') || focused.matches('.nca-search'))) {
        this._restoreFocus = { selector: focused.matches('.nca-input') ? '.nca-input' : '.nca-search', start: focused.selectionStart, end: focused.selectionEnd };
      }
      const thread = this.element.querySelector('.nca-thread');
      if (thread && thread.scrollHeight - thread.clientHeight - thread.scrollTop > 30) this._restoreScroll = thread.scrollTop;
      this.render();
    };
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
    position: { width: 1100, height: 780 },
    actions: {
      ...Object.fromEntries(['files','data','openDocument','pin','pins','tags','shareContact','acceptContact','conferences','newNote','notes','mailing','osAction'].map(n => [n,modernAction])),
      pickDevice: onPickDevice,
      pickContact: onPickContact,
      send: onSend,
      sendImage: onSendImage,
      openImage: onOpenImage,
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
      template: "modules/night-city-agent/templates/agent-modern.hbs",
      scrollable: [".nca-contacts", ".nca-thread", ".os-page"]
    }
  };

  async _prepareContext() {
    try { await refreshState(); } catch (error) { console.warn('Агент:',error.message); }
    if (storageLocked()) return { locked: true, isGM: true };
    const state = readState();
    const isGM = game.user.isGM;

    const owned = isGM
      ? Object.values(state.devices)
      : M.devicesOfUser(state, game.user.id);
    owned.sort((a, b) => a.num.localeCompare(b.num));

    if (!owned.some(d=>d.num===this.num)) this.num = owned[0]?.num ?? null;
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
      ? M.thread(state, this.num, this.other).map((m, index) => ({
          index, documentId: m.documentId, documentTitle: state.documents?.[m.documentId]?.title || 'Файл', contact: m.contact,
          pinned: (state.organizer?.[this.num]?.pins ?? []).includes(`${M.threadKey(this.num,this.other)}:${index}`),
          mine: m.f === this.num,
          text: m.x,
          image: m.p || "",
          time: hhmm(m.ts),
          // «Вслух» — либо надиктовано с безхиронного аппарата, либо прочитано
          // вслух моим собственным: без хирона агент проговаривает всё.
          aloud: m.a === 1 || (aloud && m.t === this.num)
        }))
      : [];

    return {
      ...OSContext(this,state),
      isGM, search: this.search, onlyPins: this.onlyPins, contactCount: contacts.length,
      draft: this.drafts[`${this.num}|${this.other}`] ?? state.organizer?.[this.num]?.drafts?.[this.other] ?? '',
      tags: state.organizer?.[this.num]?.tags?.[this.other] ?? [],
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
      contacts: contacts.map(c => ({ ...c, avatar:contactPortrait(state,this.num,c.num), selected: c.num === this.other, tags: state.organizer?.[this.num]?.tags?.[c.num] ?? [], searchText: [c.name,c.num,...(state.organizer?.[this.num]?.tags?.[c.num] ?? []),...M.thread(state,this.num,c.num).map(m => m.x)].join(' ') })),
      active: this.other,
      activeName: this.other ? M.contactLabel(state, this.num, this.other) : "",
      activeBookName: this.other ? M.bookName(state, this.num, this.other) : "",
      messages
    };
  }

  async saveDraft() {
    clearTimeout(this.draftTimer);
    if (!this.num || !this.other || storageLocked()) return;
    const key = `${this.num}|${this.other}`;
    const value = this.drafts[key];
    if (value === undefined || value === readState().organizer?.[this.num]?.drafts?.[this.other]) return;
    await documentOperation('organize', { number: this.num, other: this.other, draft: value });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    OSRender(this);

    const search = this.element.querySelector('.nca-search');
    const filter = () => {
      const q = this.search.trim().toLocaleLowerCase('ru-RU');
      for (const el of this.element.querySelectorAll('[data-search]')) el.hidden = !el.dataset.search.toLocaleLowerCase('ru-RU').includes(q);
      for (const el of this.element.querySelectorAll('.nca-msg')) if (this.onlyPins && el.dataset.pinned !== 'true') el.hidden = true;
      const noContacts = this.element.querySelector('.nca-search-empty');
      if (noContacts) noContacts.hidden = !q || Array.from(this.element.querySelectorAll('.nca-contacts li[data-search]')).some(el => !el.hidden);
      const noMessages = this.element.querySelector('.nca-filter-empty');
      if (noMessages) {
        const messages = Array.from(this.element.querySelectorAll('.nca-msg'));
        noMessages.hidden = !(q || this.onlyPins) || messages.some(el => !el.hidden);
        noMessages.textContent = q ? 'В этой переписке совпадений нет.' : 'В этой переписке пока нет закреплённых сообщений.';
      }
      for (const empty of this.element.querySelectorAll('.nca-thread > .nca-empty')) empty.hidden = Boolean(q || this.onlyPins);
    };
    search?.addEventListener('input', () => { this.search = search.value; filter(); });
    filter();
    // Enter отправляет, Shift+Enter — перенос строки.
    const input = this.element.querySelector(".nca-input");
    if (input && this.num && this.other) {
      const key = `${this.num}|${this.other}`;
      // A queued render may contain the draft from before a completed send or
      // the latest keystroke. Keep the current local value over that snapshot.
      if (Object.hasOwn(this.drafts, key)) input.value = this.drafts[key];
      else this.drafts[key] = input.value;
    }
    input?.addEventListener('input', () => {
      this.drafts[`${this.num}|${this.other}`] = input.value;
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(() => this.saveDraft().catch(e => ui.notifications.warn(`Черновик пока не сохранён: ${e.message}`)), 900);
    });
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

    // Полоса устройств прокручивается обычным колесом, а не только
    // Shift+колесом: полоска прокрутки тут в шесть пикселей, и целиться в неё
    // мышью при двух десятках аппаратов — мучение.
    const devbar = this.element.querySelector(".nca-devbar");
    devbar?.addEventListener("wheel", ev => {
      // Вертикального хода у полосы нет, поэтому вертикальное колесо здесь
      // пропало бы впустую — обращаем его в горизонтальное. Если игрок и так
      // крутит вбок (трекпад, наклон колеса), не мешаем.
      if (ev.deltaY === 0 || ev.shiftKey) return;
      if (devbar.scrollWidth <= devbar.clientWidth) return;
      ev.preventDefault();
      devbar.scrollLeft += ev.deltaY;
    }, { passive: false });

    // Выбранный аппарат виден, даже если он далеко в конце полосы: иначе
    // после переключения непонятно, на каком номере ты сейчас.
    devbar?.querySelector(".nca-dev.on")?.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });

    // Переписка всегда прокручена к свежему сообщению.
    const thread = this.element.querySelector(".nca-thread");
    if (thread) thread.scrollTop = this._restoreScroll ?? thread.scrollHeight;
    this._restoreScroll = null;
    if (this._restoreFocus) {
      const { selector, start, end } = this._restoreFocus;
      const field = this.element.querySelector(selector);
      field?.focus(); field?.setSelectionRange(start,end); this._restoreFocus = null;
    }

    // Сообщаем доставке, на какую переписку игрок сейчас смотрит:
    // пришедшее в неё сообщение не звонит и сразу считается прочитанным.
    clearOpenThread(this.num);
    if ((!this.osTab || this.osTab === 'messages') && this.num && this.other) {
      setOpenThread(this.num, this.other);
      if (!this._markingRead && M.unreadCount(readState(),this.num,this.other)>0 && game.users.activeGM) {
        this._markingRead = true;
        markRead(this.num,this.other).catch(error=>console.warn('Агент: отметка прочтения',error)).finally(()=>{this._markingRead=false;});
      }
    }
  }

  /* Подписка ставится и снимается ровно по одному разу за жизнь окна. */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(UPDATE_HOOK, this._onUpdate);
    Hooks.on(RING_HOOK, this._onRing);
  }

  async _preClose(options) {
    clearInterval(this.osTimer);
    this.closing = true;
    try { await this.saveDraft(); } catch (e) { this.closing = false; ui.notifications.error(`Черновик не сохранён: ${e.message}`); throw e; }
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
    if (opts.other) { existing.other = opts.other; existing.osTab='messages'; }
    if (opts.tab) existing.osTab=opts.tab;
    if (opts.callScope) { existing.osCallScope=opts.callScope;existing.osCallId=null;existing.osCallFilter=''; }
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
