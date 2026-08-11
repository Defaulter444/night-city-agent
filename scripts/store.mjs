/**
 * Единственное место, которое читает и пишет состояние Агента.
 * Запись доступна только мастеру — настройку с областью "world" Foundry
 * иначе сохранить не даст.
 */
import { blankState, normalize } from "./model.mjs";

export const MODULE_ID = "night-city-agent";
const KEY = "state";

export function registerSettings() {
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
  return normalize(game.settings.get(MODULE_ID, KEY));
}

export async function writeState(state) {
  if (!game.user.isGM) throw new Error("Состояние Агента пишет только мастер");
  return game.settings.set(MODULE_ID, KEY, state);
}

/**
 * Прочитать, изменить, записать. Мутатор получает состояние и может вернуть
 * значение — оно уйдёт вызывающему.
 */
export async function mutate(fn) {
  const state = readState();
  const result = await fn(state);
  await writeState(state);
  return result;
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
