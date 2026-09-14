/** Foundry 12 server-side recipients; socketlib filters broadcasts only on clients. */
import { uid } from './documents-model.mjs';
export class PrivateSocket {
  constructor() {
    this.handlers = new Map(); this.pending = new Map(); this.requests = new Map();
    this.channel = 'module.night-city-agent';
    game.socket.on(this.channel, (packet, senderId) => this.receive(packet, senderId));
  }
  register(name, handler) { this.handlers.set(name, handler); }
  async executeAsGM(name, ...args) {
    const gm = game.users.activeGM;
    if (!gm) throw Error('Нет связи с мастером');
    return this.request(gm.id, name, args);
  }
  async executeForUsers(name, ids, ...args) {
    return Promise.all([...new Set(ids)].filter(id => game.users.get(id)?.active)
      .map(id => this.request(id, name, args)));
  }
  async request(target, name, args) {
    if (target === game.user.id) return this.invoke(name, args, game.user.id);
    const id = uid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Мастер не ответил. Попробуйте ещё раз.')); }, 20000);
      this.pending.set(id, { resolve, reject, timer, target });
      this.send(target, { request: id, name, args });
    });
  }
  send(target, packet) {
    game.socket.emit(this.channel, { protocol: 'nca-direct-1', ...packet }, { recipients: [target] });
  }
  async invoke(name, args, senderId) {
    if (!game.users.get(senderId)?.active) throw Error('Отправитель не подключён');
    const clientHandler = ['deliver', 'refresh', 'terminalPush'].includes(name);
    if (clientHandler ? !game.users.get(senderId)?.isGM : !game.user.isGM) throw Error('Операция доступна только мастеру');
    const handler = this.handlers.get(name);
    if (!handler) throw Error('Обновите Агент на всех клиентах');
    return handler.call({ socketdata: { userId: senderId } }, ...args);
  }
  async receive(packet, senderId) {
    if (packet?.protocol !== 'nca-direct-1') return;
    if (packet.response) {
      const pending = this.pending.get(packet.response);
      if (!pending || pending.target !== senderId) return;
      clearTimeout(pending.timer); this.pending.delete(packet.response);
      packet.error ? pending.reject(Error(packet.error)) : pending.resolve(packet.value);
    } else if (packet.request && typeof packet.name === 'string' && Array.isArray(packet.args)) {
      if (['snapshot','refresh','deliver','terminalPush'].includes(packet.name)) {
        const result = await this.invoke(packet.name, packet.args, senderId)
          .then(value => ({ value }), error => ({ error: error.message || 'Операция отклонена' }));
        this.send(senderId, { response: packet.request, ...result }); return;
      }
      const key = `${senderId}:${packet.request}`;
      if (!this.requests.has(key)) {
        if (this.requests.size >= 500) this.requests.delete(this.requests.keys().next().value);
        this.requests.set(key, this.invoke(packet.name, packet.args, senderId)
          .then(value => ({ value }), error => ({ error: error.message || 'Операция отклонена' })));
      }
      this.send(senderId, { response: packet.request, ...await this.requests.get(key) });
    }
  }
}
