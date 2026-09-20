import { readState, protectedStorage, storageLocked, enableProtection, importRecovery, recoveryBundle } from './store.mjs';
import { projectState, legacyInventory } from './documents-model.mjs';
import { documentOperation, refreshState, getSocket, broadcastRefresh, UPDATE_HOOK } from './socket.mjs';
import { esc } from './clock.mjs';
import { isStorageItem } from './documents-service.mjs';
import { editDocumentDialog } from './document-editor.mjs';
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const option = (value, label, selected = false) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
export function inputDialog(title, content, submit) {
  return new Promise(resolve => {
    class AgentInputDialog extends Dialog {
      async submit(button) {
        if (this.saving) return;
        if (button !== this.data.buttons.save) return this.close();
        const root = this.element[0], form = root.querySelector('form');
        if (!form.reportValidity()) return;
        this.saving = true;
        const buttons = root.querySelectorAll('.dialog-button'); buttons.forEach(b => b.disabled = true);
        try { const value = await submit(new FormData(form)); this.saving = false; resolve(value); await this.close(); }
        catch (error) {
          this.saving = false; buttons.forEach(b => b.disabled = false);
          const message = root.querySelector('.nca-form-error'); message.textContent = error.message; message.hidden = false;
        }
      }
      async close(options) { if (!this.saving) return super.close(options); }
    }
    new AgentInputDialog({ title, content: `<form class="nca-dialog">${content}<p class="nca-form-error" role="alert" hidden></p></form>`,
      buttons: { save: { label: 'Сохранить' }, cancel: { label: 'Отмена' } }, default: 'save', close: () => resolve(null)
    }, { width: 500, classes: ['dialog', 'nca-input-dialog'] }).render(true);
  });
}
const field = (name, title, value = '') => `<label>${title}<input name="${name}" value="${esc(value)}"></label>`;
const download = bundle => saveDataToFile(JSON.stringify(bundle, null, 2), 'application/json', `agent-${game.world.id}-${new Date().toISOString().slice(0,10)}.json`);
async function action(event, target) {
  if (this.busy) return;
  this.busy = true;
  try { await this.perform(target.dataset.action, target); }
  catch (error) { ui.notifications.error(`Агент: ${error.message}`); }
  finally { this.busy = false; if (!this.closing) this.render(); }
}
export class AgentWorkspace extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { id: 'nca-workspace', classes: ['nca-workspace'], tag: 'div',
    window: { title: 'Агент · Файлы и терминалы', icon: 'fa-solid fa-folder-open', resizable: true },
    position: { width: 900, height: 650 },
    actions: Object.fromEntries(['chooseSection','openDocument','openDocumentImage','createDocument','editDocument','sendDocument','saveDocument','carrier','createTerminal','editTerminal','cloneTerminal','selectTerminal','entry','publish','openEntry','push','bind','preview','schedule','cancelSchedule','backup','protect','importKey','netExample'].map(name => [name, action])) };
  static PARTS = { body: { template: 'modules/night-city-agent/templates/workspace.hbs', scrollable: ['.nca-library-list','.nca-reader'] } };
  constructor(options = {}) {
    const { tab = 'files', number = null, documentId = null, terminalId = null, recipient = null } = options;
    super(options); this.tab = tab; this.number = number;
    this.documentId = documentId; this.terminalId = terminalId;
    this.recipient = recipient;
    this.previewUser = null; this.closing = false;
    this.onUpdate = () => { if (this.rendered && !this.closing) this.render(); };
  }
  async _prepareContext() {
    await refreshState();
    const locked = storageLocked();
    let state = locked ? { devices: {}, documents: {}, terminals: {} } : readState();
    const all = state;
    if (this.previewUser) state = projectState(state, game.users.get(this.previewUser), game.user.viewedScene);
    const documents = Object.values(state.documents ?? {}), terminals = Object.values(state.terminals ?? {});
    const owned = Object.values(state.devices).filter(d => game.user.isGM || d.owner === game.user.id);
    this.number ||= owned[0]?.num;
    const terminal = state.terminals?.[this.terminalId] || null;
    const document = state.documents?.[this.documentId] || null;
    return { gm: game.user.isGM, locked, protected: protectedStorage(), tab: this.tab,
      filesTab: this.tab === 'files', terminalsTab: this.tab === 'terminals', storageTab: this.tab === 'storage', scheduledTab: this.tab === 'scheduled',
      documents: documents.map(d => ({ ...d, selected: d.id === this.documentId })), document,
      terminals: terminals.map(t => ({ ...t, selected: t.id === this.terminalId })), terminal,
      editable: game.user.isGM && !this.previewUser,
      preview: this.previewUser ? game.users.get(this.previewUser)?.name : '',
      entries: (terminal?.entries ?? []).map(e => ({ ...e, random: Boolean(e.tableUuid || e.random) })),
      scheduled: (all.scheduled ?? []).filter(e => e.status === 'pending').map(e => ({ ...e, when: e.clock === 'world' ? `Через ${Math.max(0,Math.ceil((e.due-game.time.worldTime)/60))} мин. игрового времени` : new Date(e.due * 1000).toLocaleString('ru-RU') })),
      counts: legacyInventory(all), number: this.number };
  }
  async perform(name, target) {
    if (name === 'chooseSection') { this.tab = target.dataset.tab; this.previewUser = null; return; }
    if (name === 'backup') { download(recoveryBundle()); return; }
    if (name === 'protect') {
      const ok = await Dialog.confirm({ title: 'Защита переписки', content: '<p>Будет скачан файл восстановления: резервная копия и ключ. Сохраните его вне папки Foundry Data. Он понадобится при смене браузера или компьютера мастера.</p><p>Контакты и история будут проверены перед переносом. Данные в мире станут зашифрованными.</p>' });
      if (ok) { await enableProtection(download); await broadcastRefresh(); ui.notifications.info('Защита включена. Контакты и история сохранены.'); }
      return;
    }
    if (name === 'importKey') {
      await inputDialog('Открыть хранилище', '<label>Файл восстановления<input name="key" type="file" accept=".json"></label>', async fd => {
        const file = fd.get('key'); if (!file?.size) throw Error('Выберите файл восстановления');
        await importRecovery(JSON.parse(await file.text())); await broadcastRefresh();
      }); return;
    }
    if (storageLocked()) throw Error('Сначала импортируйте ключ восстановления');
    const state = readState();
    if (name === 'openDocument') { this.documentId = target.dataset.id; return; }
    if (name === 'openDocumentImage') {
      const view = this.previewUser ? projectState(state, game.users.get(this.previewUser), game.user.viewedScene) : state;
      const doc = view.documents?.[this.documentId], image = doc?.images?.[Number(target.dataset.index)];
      if (!image) throw Error('Изображение недоступно');
      const Popout = typeof ImagePopout !== 'undefined' ? ImagePopout : foundry.applications.apps.ImagePopout;
      new Popout(image.src, { title: `${doc.title} · ${image.name}`, shareable: false }).render(true); return;
    }
    if (name === 'selectTerminal') { this.terminalId = target.dataset.id; this.documentId = null; return; }
    if (name === 'createDocument' || name === 'editDocument') {
      const doc = name === 'editDocument' ? state.documents?.[this.documentId] : null;
      const id = await editDocumentDialog(doc,
        fields => documentOperation('createDocument', { id: doc?.id, number: this.number, ...fields }));
      if (id) this.documentId = id; return;
    }
    if (name === 'saveDocument') { await documentOperation('saveDocument', { number: this.number, documentId: this.documentId }); ui.notifications.info('Файл сохранён в Агенте'); return; }
    if (name === 'sendDocument') {
      const contacts = { ...(state.devices[this.number]?.book ?? {}) };
      if (this.recipient && state.devices[this.recipient]) contacts[this.recipient] ||= this.recipient;
      await inputDialog('Отправить файл', `<p>С номера ${esc(this.number || '')}</p><label>Получатель<select name="to">${Object.entries(contacts).map(([n, title]) => option(n, `${title} · ${n}`, n === this.recipient)).join('')}</select></label>` + field('text','Сообщение'),
        fd => documentOperation('sendDocument', { from: this.number, to: fd.get('to'), text: fd.get('text'), documentId: this.documentId })); return;
    }
    if (name === 'carrier') {
      const items = game.actors.filter(a => a.isOwner).flatMap(a => a.items.filter(i => isStorageItem(i,a)).map(i => ({ actor: a.uuid, id: i.id, label: `${a.name} · ${i.name}` })));
      if (!items.length) throw Error('Нет носимого или установленного носителя данных на доступных листах');
      await inputDialog('Сохранить на носитель', `<label>Носитель<select name="item">${items.map((i, index) => option(index, i.label)).join('')}</select></label>`, fd => {
        const item = items[Number(fd.get('item'))];
        return documentOperation('carrier', { documentId: this.documentId, actorUuid: item.actor, itemId: item.id });
      }); return;
    }
    if (name === 'createTerminal' || name === 'editTerminal' || name === 'cloneTerminal') {
      const t = name !== 'createTerminal' ? state.terminals?.[this.terminalId] : null;
      const id = await inputDialog('Терминал', field('title','Название',t?.title) + `<label><input name="portable" type="checkbox" ${t?.portable ? 'checked' : ''}> Переносной ноутбук</label><label>Сцена<select name="sceneId">${game.scenes.map(s => option(s.id,s.name,s.id === (t?.sceneId || canvas.scene?.id))).join('')}</select></label><fieldset><legend>Кому доступен</legend>${game.users.filter(u => !u.isGM).map(u => `<label><input name="users" type="checkbox" value="${u.id}" ${t?.users?.includes(u.id) ? 'checked' : ''}> ${esc(u.name)}</label>`).join('')}</fieldset>`,
        fd => documentOperation('terminal', { id: name === 'editTerminal' ? t?.id : null, templateId: name === 'cloneTerminal' ? t?.id : null, title: fd.get('title'), portable: fd.has('portable'), sceneId: fd.get('sceneId'), users: fd.getAll('users') }));
      if (id) this.terminalId = id; return;
    }
    if (name === 'entry') {
      await inputDialog('Добавить письмо или файл', field('title','Название') + `<label>Раздел<select name="kind"><option value="file">Файлы</option><option value="email">Письма</option></select></label><label>Документ<select name="documentId"><option value="">—</option>${Object.values(state.documents ?? {}).map(d => option(d.id,d.title)).join('')}</select></label><label>Или случайная таблица<select name="tableUuid"><option value="">—</option>${game.tables.map(t => option(t.uuid,t.name)).join('')}</select></label><label><input type="checkbox" name="published"> Доступно игрокам</label>`,
        fd => documentOperation('terminalEntry', { terminalId: this.terminalId, title: fd.get('title'), kind: fd.get('kind'), documentId: fd.get('documentId'), tableUuid: fd.get('tableUuid'), published: fd.has('published') })); return;
    }
    if (name === 'publish') {
      const e = state.terminals[this.terminalId].entries.find(e => e.id === target.dataset.id);
      await documentOperation('terminalEntry', { ...e, terminalId: this.terminalId, published: !e.published }); return;
    }
    if (name === 'openEntry') {
      if (this.previewUser) {
        const e = projectState(state,game.users.get(this.previewUser),game.user.viewedScene).terminals[this.terminalId]?.entries.find(e => e.id === target.dataset.id);
        if (!e) throw Error('Файл скрыт от этого игрока');
        this.documentId = e.documentId;
        if (!this.documentId) ui.notifications.info('Случайное содержимое появится при первом открытии игроком. Просмотр мастера его не создаёт.');
      } else this.documentId = await documentOperation('openEntry',{ terminalId: this.terminalId, entryId: target.dataset.id });
      return;
    }
    if (name === 'preview') {
      if (this.previewUser) { this.previewUser = null; return; }
      const id = await inputDialog('Просмотр глазами игрока', `<label>Игрок<select name="user">${game.users.filter(u=> !u.isGM).map(u=>option(u.id,u.name)).join('')}</select></label>`, fd => fd.get('user'));
      this.previewUser = id; return;
    }
    if (name === 'push') {
      const t = state.terminals[this.terminalId];
      const id = await inputDialog('Открыть игроку', `<label>Подключённый игрок<select name="user">${game.users.filter(u => u.active && !u.isGM && t.users.includes(u.id)).map(u => option(u.id,u.name)).join('')}</select></label>`, fd => fd.get('user'));
      if (id) await getSocket().executeForUsers('terminalPush',[id],this.terminalId); return;
    }
    if (name === 'bind') {
      if (!game.user.isGM || !canvas.tiles.controlled.length) throw Error('Сначала выберите тайл на сцене');
      for (const tile of canvas.tiles.controlled) await tile.document.setFlag('night-city-agent','terminalId',this.terminalId);
      ui.notifications.info('В настройках тайла появилась кнопка «Терминал». Игрок открывает доступные терминалы кнопкой монитора на панели токенов.'); return;
    }
    if (name === 'schedule') {
      await inputDialog('Сообщение NPC', `<label>Отправитель<select name="from">${Object.values(state.devices).map(d=>option(d.num,`${d.label || d.num} · ${d.num}`)).join('')}</select></label><label>Получатель<select name="to">${Object.values(state.devices).map(d=>option(d.num,`${d.label || d.num} · ${d.num}`)).join('')}</select></label><label>Текст<textarea name="text" rows="5"></textarea></label><label>Через сколько минут<input name="minutes" type="number" min="1" value="10"></label><label>Часы<select name="clock"><option value="world">Время мира</option><option value="real">Реальное время</option></select></label>`,
        fd=>documentOperation('schedule',Object.fromEntries(fd))); return;
    }
    if (name === 'cancelSchedule') { await documentOperation('cancelSchedule',{id:target.dataset.id}); return; }
    if (name === 'netExample') {
      new Dialog({ title: 'Следующий этап: связь с Нетраннингом', content: '<p><b>Терминал → точка доступа → существующая NET-архитектура.</b></p><p>Предлагаемый сценарий: нетраннер получает файл в архитектуре, файл появляется в разделе «Файлы», затем его можно передать контакту через Агент.</p><p>Броски Интерфейса, ЛЁД, дистанция подключения и NET-действия остаются в модуле Нетраннинга. Этот автоматический переход пока не внедрён; сейчас мастер выдаёт документ через Агент вручную.</p>', buttons:{ok:{label:'Понятно'}} }).render(true);
    }
  }
  _onFirstRender(context,options) { super._onFirstRender?.(context,options); Hooks.on(UPDATE_HOOK,this.onUpdate); }
  async _preClose(options) { this.closing=true; Hooks.off(UPDATE_HOOK,this.onUpdate); await super._preClose?.(options); }
}
let workspace;
export function openWorkspace(options = {}) {
  if (workspace?.rendered) { Object.assign(workspace,options); workspace.render(); workspace.bringToFront(); return workspace; }
  workspace = new AgentWorkspace(options); workspace.render(true); return workspace;
}
