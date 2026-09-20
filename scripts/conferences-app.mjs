import { readState, storageLocked } from './store.mjs';
import * as C from './conferences-model.mjs';
import { speaksAloud } from './model.mjs';
import { conferenceOperation, refreshState, UPDATE_HOOK } from './socket.mjs';
import { inputDialog, openWorkspace } from './workspace-app.mjs';
import { esc } from './clock.mjs';
import { shrinkImage, ALLOWED_TYPES } from './images.mjs';
import { stopRing, ringKey } from './ringtone.mjs';
import { openConferenceView, closeConferenceView } from './conference-presence.mjs';
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const label = (state, myNum, number) => state.devices[myNum]?.book?.[number] || state.devices[number]?.label || number;
const senderLabel = (state, myNum, number) => {
  const name = label(state, myNum, number);
  return name === number ? number : `${name} · ${number}`;
};

async function action(event, target) {
  if (this.busy) return;
  this.busy = true;
  try { await this.perform(target.dataset.action, target); }
  catch (error) { ui.notifications.error(`Агент: ${error.message}`); }
  finally { this.busy = false; if (!this.closing) this.render(); }
}
export class ConferencesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { id: 'nca-conferences', classes: ['nca-app', 'nca-conferences'],
    window: { title: 'Агент · Конференции', icon: 'fa-solid fa-users', resizable: true }, position: { width: 960, height: 650 },
    actions: Object.fromEntries(['selectRoom','createRoom','editRoom','leaveRoom','sendGroup','groupImage','groupFile','openGroupImage','openGroupDocument'].map(n => [n, action])) };
  static PARTS = { body: { template: 'modules/night-city-agent/templates/conferences.hbs', scrollable: ['.nca-contacts', '.nca-thread'] } };
  constructor(options = {}) {
    super(options); this.number = options.number ?? null; this.roomId = options.roomId ?? null;
    this.drafts = {}; this.closing = false;
    this.onUpdate = () => {
      if (!this.rendered || this.closing) return;
      const input = this.element.querySelector('.nca-group-input');
      if (document.activeElement === input && input) this.focus = { start: input.selectionStart, end: input.selectionEnd };
      const thread = this.element.querySelector('.nca-thread');
      if (thread && thread.scrollHeight - thread.clientHeight - thread.scrollTop > 30) this.scroll = thread.scrollTop;
      this.render();
    };
  }
  async _prepareContext() {
    await refreshState(); if (storageLocked()) return { locked: true };
    const state = readState(), user = game.user;
    const devices = Object.values(state.devices).filter(d => user.isGM || d.owner === user.id);
    if (!devices.some(d => d.num === this.number)) this.number = devices[0]?.num ?? null;
    const rooms = Object.values(state.conferences ?? {}).filter(r => C.canAccessConference(state, r, user));
    if (this.roomId && !rooms.some(r => r.id === this.roomId)) this.roomId = null;
    const room = rooms.find(r => r.id === this.roomId);
    const senders = room ? devices.filter(d => room.members.includes(d.num)) : devices;
    if (room && !senders.some(d => d.num === this.number)) this.number = senders[0]?.num ?? null;
    const key = `${this.roomId}|${this.number}`;
    return { locked: false, noDevice: !devices.length, noGM: !game.users.activeGM, room, number: this.number,
      devices: senders.map(d => ({ ...d, label: d.label || d.num, selected: d.num === this.number })),
      canSend: Boolean(room && this.number && game.users.activeGM),
      canManage: C.canManageConference(state, room, user), canLeave: Boolean(room?.members.includes(this.number)),
      draft: this.drafts[key] ?? room?.drafts?.[this.number] ?? '',
      members: (room?.members ?? []).map(n => ({ number: n, name: label(state, this.number, n) })),
      rooms: rooms.sort((a,b) => (b.messages.at(-1)?.ts || b.createdAt) - (a.messages.at(-1)?.ts || a.createdAt)).map(r => ({
        id: r.id, title: r.title, count: r.members.length, selected: r.id === this.roomId, preview: C.conferencePreview(r),
        unread: r.members.filter(n => user.isGM ? !state.devices[n]?.owner || state.devices[n].owner === user.id : state.devices[n]?.owner === user.id).reduce((sum,n) => sum + C.conferenceUnread(r,n),0)
      })),
      messages: (room?.messages ?? []).map((m,index) => ({ ...m, index, mine: m.f === this.number,
        sender: senderLabel(state,this.number,m.f), time: new Date(m.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),
        aloud: m.a === 1 || (m.f !== this.number && speaksAloud(state.devices[this.number])),
        documentTitle: state.documents?.[m.documentId]?.title || 'Файл' })) };
  }
  async saveDraft() {
    clearTimeout(this.timer);
    if (storageLocked()) return;
    const room = readState().conferences?.[this.roomId], text = this.drafts[`${this.roomId}|${this.number}`];
    if (!room?.members.includes(this.number) || text === undefined || text === room.drafts?.[this.number]) return;
    await conferenceOperation('draft',{id:this.roomId,number:this.number,text});
  }
  async perform(name, target) {
    if (storageLocked()) throw Error('Сначала откройте хранилище в Агенте');
    const state = readState(), room = state.conferences?.[this.roomId];
    if (name === 'selectRoom') { await this.saveDraft(); this.roomId = target.dataset.id; return; }
    if (name === 'createRoom' || name === 'editRoom') {
      await this.saveDraft();
      const editing = name === 'editRoom';
      const number = this.number || Object.values(state.devices).find(d => game.user.isGM || d.owner === game.user.id)?.num;
      if (!number) throw Error('Сначала получите Агент у мастера');
      const selected = editing ? room.members : [number];
      const choices = Object.values(state.devices).map(d => `<label class="nca-member-choice"><input type="checkbox" name="members" value="${esc(d.num)}" ${selected.includes(d.num) ? 'checked' : ''}><span>${esc(label(state,number,d.num))}<small>${esc(d.num)}</small></span></label>`).join('');
      const id = await inputDialog(editing ? 'Участники конференции' : 'Новая конференция',
        `<label>Название<input name="title" required maxlength="120" value="${esc(editing ? room.title : '')}"></label><p class="hint">От 2 до ${C.MAX_MEMBERS} участников. Добавленные участники увидят всю историю. Удалённые потеряют доступ к конференции.</p><fieldset class="nca-member-picker"><legend>Участники · ваш номер ${esc(number)}</legend>${choices}</fieldset>`,
        fd => conferenceOperation(editing ? 'edit' : 'create', { id: editing ? room.id : undefined, number, title: fd.get('title'), members: fd.getAll('members') }));
      if (id) this.roomId = id; return;
    }
    if (name === 'leaveRoom') {
      if (await Dialog.confirm({ title: 'Покинуть конференцию?', content: `<p>Агент ${esc(this.number)} потеряет доступ к «${esc(room.title)}». История останется у участников.</p>` })) {
        await conferenceOperation('leave',{id:this.roomId,number:this.number}); this.roomId=null;
      } return;
    }
    if (name === 'openGroupDocument') { openWorkspace({ number:this.number, documentId:target.dataset.id }); return; }
    if (name === 'openGroupImage') {
      const image = room?.messages[Number(target.dataset.index)]?.p;
      if (image) new ImagePopout(image,{title:room.title}).render(true); return;
    }
    if (['sendGroup','groupImage','groupFile'].includes(name)) {
      if (!room?.members.includes(this.number)) throw Error('Выберите свой Агент среди участников');
      const id=this.roomId, number=this.number, key=`${id}|${number}`;
      const text=this.element.querySelector('.nca-group-input')?.value ?? '';
      let image, documentId;
      if (name === 'groupImage') {
        const picker=document.createElement('input');picker.type='file';picker.accept=ALLOWED_TYPES.join(',');picker.hidden=true;document.body.append(picker);
        const file=await new Promise(resolve=>{picker.addEventListener('change',()=>resolve(picker.files?.[0]),{once:true});picker.addEventListener('cancel',()=>resolve(null),{once:true});picker.click();});picker.remove();
        if (!file) return; image=await shrinkImage(file);
      }
      if (name === 'groupFile') {
        const docs=Object.values(state.documents??{});
        if (!docs.length) throw Error('Сначала создайте или сохраните файл в Агенте');
        documentId=await inputDialog('Файл для конференции',`<label>Файл<select name="document">${docs.map(d=>`<option value="${esc(d.id)}">${esc(d.title)}</option>`).join('')}</select></label>`,fd=>fd.get('document'));
        if (!documentId) return;
      }
      if (!text.trim()&&!image&&!documentId) return;
      await this.saveDraft();
      await conferenceOperation('send',{id,number,text,image,documentId});
      if (this.drafts[key] === text) { this.drafts[key]=''; await conferenceOperation('draft',{id,number,text:''}); }
    }
  }
  _onRender(context, options) {
    super._onRender?.(context,options);
    const input=this.element.querySelector('.nca-group-input'), key=`${this.roomId}|${this.number}`;
    if (input) {
      if (Object.hasOwn(this.drafts,key)) input.value=this.drafts[key]; else this.drafts[key]=input.value;
      input.addEventListener('input',()=>{this.drafts[key]=input.value;clearTimeout(this.timer);this.timer=setTimeout(()=>this.saveDraft().catch(e=>ui.notifications.warn(e.message)),900);});
      input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();action.call(this,e,{dataset:{action:'sendGroup'}});}});
      if (this.focus) { input.focus();input.setSelectionRange(this.focus.start,this.focus.end);this.focus=null; }
    }
    this.element.querySelector('.nca-group-sender')?.addEventListener('change',async e=>{
      try { await this.saveDraft();this.number=e.target.value;this.render(); } catch(error){ui.notifications.error(error.message);this.render();}
    });
    const thread=this.element.querySelector('.nca-thread');if(thread)thread.scrollTop=this.scroll??thread.scrollHeight;this.scroll=null;
    if (this.view) closeConferenceView(...this.view);
    this.view=context.room&&this.number ? [this.number,context.room.id] : null;
    if (this.view) {
      openConferenceView(...this.view);stopRing(ringKey(this.number,C.conferenceKey(context.room.id)));
      if (!this.reading&&C.conferenceUnread(context.room,this.number)>0&&game.users.activeGM) {
        this.reading=true;conferenceOperation('read',{id:context.room.id,number:this.number,through:context.messages.length})
          .then(()=>{if(!this.closing)this.render();})
          .catch(e=>console.warn('Агент: отметка конференции',e)).finally(()=>{this.reading=false;});
      }
    }
  }
  _onFirstRender(context,options) { super._onFirstRender?.(context,options);Hooks.on(UPDATE_HOOK,this.onUpdate); }
  async _preClose(options) {
    await this.saveDraft();this.closing=true;clearTimeout(this.timer);if(this.view)closeConferenceView(...this.view);Hooks.off(UPDATE_HOOK,this.onUpdate);await super._preClose?.(options);
  }
}
let instance;
export function openConferences(options={}) {
  if(instance?.rendered){instance.bringToFront();return instance;}
  instance=new ConferencesApp(options);instance.render(true);return instance;
}
