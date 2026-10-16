import { atlasLocationId } from './atlas-link.mjs';
import { visibleRecord, JOB_STATES } from './os-model.mjs';

const jobId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)
    || ['__proto__', 'prototype', 'constructor'].includes(value)) throw Error('Задание недоступно');
  return value;
};
/** A second permission check keeps even accidental raw-state callers from leaking jobs. */
export function linkedJobs(state, user, value) {
  const id = atlasLocationId(value);
  if (!id || !user) return [];
  return Object.values(state.os?.jobs ?? {})
    .filter(job => job.atlasLocationId === id && visibleRecord(state, job, user))
    .map(job => ({ id: jobId(job.id), title: String(job.title ?? '').slice(0, 160),
      status: Object.hasOwn(JOB_STATES, job.status) ? job.status : 'planned' }));
}

/** Uses the normal viewer projection and editor; adds no storage or socket channel. */
export function createAtlasIntegration({ getUser, refreshState, readState, storageLocked, openAgent, openDraft }) {
  async function context() {
    const user = getUser();
    if (!user || storageLocked()) throw Error('Сначала откройте хранилище Агента');
    const identity = `${user.id}:${Boolean(user.isGM)}`;
    await refreshState({ cached: true });
    const current = getUser();
    if (!current || `${current.id}:${Boolean(current.isGM)}` !== identity || storageLocked()) throw Error('Доступ к Агенту изменился. Повторите действие.');
    return { state: readState(), user: current };
  }
  const deviceFor = (state, user, job = {}) => {
    const available = Object.values(state.devices ?? {}).filter(d => user.isGM || d.owner === user.id);
    return available.find(d => job.numbers?.includes(d.num)) ?? available[0];
  };
  return Object.freeze({
    async jobsForLocation(value) {
      const id = atlasLocationId(value);
      if (!id) return [];
      const { state, user } = await context();
      return linkedJobs(state, user, id);
    },
    async openJob(value) {
      const id = jobId(value), { state, user } = await context();
      const job = state.os?.jobs?.[id];
      if (!visibleRecord(state, job, user)) throw Error('Задание недоступно');
      const device = deviceFor(state, user, job);
      if (!device) throw Error('Сначала получите устройство Агента');
      return openAgent({ num: device.num, tab: 'jobs', jobId: id, jobArchive: ['done', 'archived'].includes(job.status) });
    },
    async draftJobForLocation(location) {
      if (!getUser()?.isGM) throw Error('Создать черновик из Atlas может только Мастер');
      const id = atlasLocationId(location?.id);
      if (!id) throw Error('Выберите место Atlas');
      const name = typeof location?.name === 'string' ? location.name.trim().slice(0, 140) : '';
      if (!name) throw Error('Укажите название места Atlas');
      const { state, user } = await context();
      if (!user.isGM) throw Error('Доступно только Мастеру');
      const device = deviceFor(state, user);
      if (!device) throw Error('Сначала создайте устройство Агента');
      return openDraft({ number: device.num, location: { id, name } });
    }
  });
}
