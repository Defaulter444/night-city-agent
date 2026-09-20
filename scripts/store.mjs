/**
 * Единственное место, которое читает и пишет состояние Агента.
 * Запись доступна только мастеру — настройку с областью "world" Foundry
 * иначе сохранить не даст.
 */
import { blankState, normalize } from "./model.mjs";
import { projectState, assertLegacyPreserved } from './documents-model.mjs';
import { seal, unseal, newRecoveryKey } from './vault.mjs';

export const MODULE_ID = "night-city-agent";
const KEY = "state";
let privateState = null, privateBackup = null, secret = null, playerState = blankState();
const keyName = () => `nca-recovery:${game.world.id}:${game.user.id}`;
export const protectedStorage = () => Boolean(game.settings.get(MODULE_ID, 'vault')?.format);
export const storageLocked = () => protectedStorage() && game.user.isGM && !secret;
export async function initializeStorage() {
  if (!game.user.isGM) return;
  const envelope = game.settings.get(MODULE_ID, 'vault');
  if (!envelope?.format) return;
  secret ??= globalThis.localStorage?.getItem(keyName());
  if (!secret) return;
  try {
    const payload = await unseal(envelope, secret);
    if (!privateState || (payload.state?.revision ?? 0) >= (privateState.revision ?? 0)) {
      privateState = normalize(payload.state); privateBackup = payload.backup;
    }
  } catch (error) { secret = null; privateState = null; throw Error('Не удалось открыть данные Агента. Импортируйте ключ восстановления.'); }
}
export function acceptProjection(state) {
  if ((state?.revision ?? 0) >= (playerState.revision ?? 0)) playerState = normalize(state);
}
export function stateForUser(userId) {
  const user = game.users.get(userId);
  if (!user) throw Error('Пользователь не найден');
  return projectState(readState(), user, user.viewedScene ?? '');
}
export async function importRecovery(bundle) {
  if (!game.user.isGM || bundle?.format !== 'nca-recovery-1' || bundle.worldId !== game.world.id) throw Error('Это не ключ текущего мира');
  const payload = await unseal(game.settings.get(MODULE_ID, 'vault'), bundle.key);
  globalThis.localStorage.setItem(keyName(), bundle.key);
  secret = bundle.key; privateState = normalize(payload.state); privateBackup = payload.backup;
  return readState();
}
export function recoveryBundle() {
  if (!game.user.isGM || storageLocked()) throw Error('Сначала откройте хранилище');
  return { format: 'nca-recovery-1', worldId: game.world.id, key: secret, backup: structuredClone(readState()), exportedAt: new Date().toISOString() };
}
export function enableProtection(saveBackup) {
  const task = async () => {
  if (!game.user.isGM || protectedStorage()) throw Error('Защита уже включена или недостаточно прав');
  requirePrimaryGM();
  const before = structuredClone(readState());
  const nextSecret = newRecoveryKey();
  const payload = { state: before, backup: before };
  const envelope = await seal(payload, nextSecret);
  assertLegacyPreserved(before, (await unseal(envelope, nextSecret)).state);
  // No legacy data is cleared until the recovery export and durable ciphertext exist.
  await saveBackup({ format: 'nca-recovery-1', worldId: game.world.id, key: nextSecret, backup: before });
  globalThis.localStorage.setItem(keyName(), nextSecret);
  await game.settings.set(MODULE_ID, 'vault', envelope);
  assertLegacyPreserved(before, (await unseal(game.settings.get(MODULE_ID, 'vault'), nextSecret)).state);
  secret = nextSecret; privateState = before; privateBackup = before;
  await game.settings.set(MODULE_ID, KEY, blankState());
  return assertLegacyPreserved(before, privateState);
  };
  const pending = mutationQueue.then(task, task);
  mutationQueue = pending.catch(() => {});
  return pending;
}
let mutationQueue = Promise.resolve();
function requirePrimaryGM() {
  if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) throw Error('Изменения сохраняет основной подключённый мастер. Откройте Агент в его сеансе.');
}

export function registerSettings() {
  game.settings.register(MODULE_ID, 'noteJournals', { scope: 'world', config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, 'vault', { scope: 'world', config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: blankState()
  });

  game.settings.register(MODULE_ID, "defaultRingtone", {
    name: "NCA.Settings.DefaultRingtone",
    hint: "NCA.Settings.DefaultRingtoneHint",
    scope: "world",
    config: true,
    type: String,
    default: "sounds/notify.wav",
    filePicker: "audio"
  });

  game.settings.register(MODULE_ID, "ringtoneVolume", {
    name: "NCA.Settings.Volume",
    hint: "NCA.Settings.VolumeHint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.6
  });

  game.settings.register(MODULE_ID, "ringUntilRead", {
    name: "NCA.Settings.RingUntilRead",
    hint: "NCA.Settings.RingUntilReadHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "ringMaxSeconds", {
    name: "NCA.Settings.RingMax",
    hint: "NCA.Settings.RingMaxHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 120, step: 5 },
    default: 30
  });

  game.settings.register(MODULE_ID, "ringChannel", {
    name: "NCA.Settings.Channel",
    hint: "NCA.Settings.ChannelHint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      interface: "Интерфейс",
      environment: "Окружение",
      music: "Музыка"
    },
    default: "interface"
  });
}

export function readState() {
  if (!game.user.isGM) return playerState;
  if (protectedStorage()) {
    if (!privateState || !secret) throw Error('Хранилище Агента закрыто. Импортируйте ключ восстановления.');
    return privateState;
  }
  return normalize(game.settings.get(MODULE_ID, KEY));
}

export async function writeState(state) {
  if (!game.user.isGM) throw new Error("Состояние Агента пишет только мастер");
  requirePrimaryGM();
  if (protectedStorage()) {
    if (!secret) throw Error('Хранилище закрыто');
    const envelope = await seal({ state, backup: privateBackup }, secret);
    await game.settings.set(MODULE_ID, 'vault', envelope);
    privateState = structuredClone(state);
    return state;
  }
  return game.settings.set(MODULE_ID, KEY, state);
}

/**
 * Прочитать, изменить, записать. Мутатор получает состояние и может вернуть
 * значение — оно уйдёт вызывающему.
 */
export async function mutate(fn) {
  const task = async () => {
    if (!game.user.isGM) throw new Error("Состояние Агента пишет только мастер");
    // A setting is a live cached object. Failed writes must not publish part
    // of a mutation, and the next queued task must read the committed state.
    const state = foundry.utils.deepClone(readState());
    const result = await fn(state);
    state.revision = (state.revision ?? 0) + 1;
    await writeState(state);
    return result;
  };
  const pending = mutationQueue.then(task, task);
  mutationQueue = pending.catch(() => {});
  return pending;
}

export function defaultRingtone() {
  return game.settings.get(MODULE_ID, "defaultRingtone") || "sounds/notify.wav";
}

export function ringtoneVolume() {
  return game.settings.get(MODULE_ID, "ringtoneVolume") ?? 0.6;
}

export function ringSettings() {
  return {
    loop: game.settings.get(MODULE_ID, "ringUntilRead") ?? true,
    maxSeconds: game.settings.get(MODULE_ID, "ringMaxSeconds") ?? 30,
    channel: game.settings.get(MODULE_ID, "ringChannel") || "interface"
  };
}
