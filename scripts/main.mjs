/**
 * Точка входа модуля «Агент».
 */
import { MODULE_ID, registerSettings, readState, initializeStorage, storageLocked } from "./store.mjs";
import { registerSocket, refreshState, broadcastRefresh, UPDATE_HOOK } from "./socket.mjs";
import { openAgent, closeAllAgents } from "./app-agent.mjs";
import { openGMPanel } from "./app-gm.mjs";
import { openHelp } from "./help.mjs";
import { openWorkspace } from './workspace-app.mjs';
import { openConferences } from './conferences-app.mjs';
import { deliverScheduled } from './documents-service.mjs';
import { terminalAllowed } from './documents-model.mjs';
import * as M from "./model.mjs";
import * as Wealth from "./wealth.mjs";
import * as Services from "./services.mjs";
import * as Clock from "./clock.mjs";

Hooks.once("init", () => {
  registerSettings();
  console.log("night-city-agent | настройки зарегистрированы");
});

Hooks.once("setup", () => {
  registerSocket();
  console.log("night-city-agent | сокет готов");
});

Hooks.once("ready", async () => {
  try { await initializeStorage(); await refreshState(); } catch (e) { ui.notifications.warn(`Агент: ${e.message}`); }
  // Кнопка «Зачислить» в карточке перевода живёт в чате, а не в окне Агента,
  // поэтому обработчик вешается один раз на весь сеанс.
  Wealth.bindDepositButton();

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      openAgent, openGMPanel, openWorkspace, openConferences, openHelp, closeAllAgents, readState, model: M,
      // Деньги и службы отданы наружу: их удобно дёргать макросами мастера.
      transferEb: Wealth.transfer,
      adjustEb: Wealth.adjust,
      actorForUser: Wealth.actorForUser,
      callREO: Services.callREO,
      callTrauma: Services.callTrauma,
      broadcast: Services.broadcast,
      inspectLifestyle: Services.inspectLifestyle,
      findMembership: Services.findMembership,
      clock: Clock.now
    };
  }

  const tick = async () => {
    if (!game.user.isGM || storageLocked()) return;
    try { if (await deliverScheduled()) await broadcastRefresh(); }
    catch (error) { console.error('night-city-agent | расписание', error); }
  };
  setInterval(tick, 15000);
  Hooks.on('updateWorldTime', tick);
  Hooks.on('canvasReady', () => refreshState().then(() => Hooks.callAll(UPDATE_HOOK)).catch(() => {}));
  Hooks.on('updateUser', () => refreshState().then(() => Hooks.callAll(UPDATE_HOOK)).catch(() => {}));
  Hooks.on('updateActor', () => refreshState().then(() => Hooks.callAll(UPDATE_HOOK)).catch(() => {}));
  Hooks.on('updateItem', () => refreshState().then(() => Hooks.callAll(UPDATE_HOOK)).catch(() => {}));

});

/**
 * Страховка от гонки: сообщение по сокету может обогнать обновление настройки
 * мира, и окно отрисует устаревшую переписку. Штатный хук приходит тогда,
 * когда состояние на клиенте уже точно свежее.
 */
Hooks.on("updateSetting", setting => {
  if ([`${MODULE_ID}.state`, `${MODULE_ID}.vault`].includes(setting?.key)) Hooks.callAll(UPDATE_HOOK);
});

/** Кнопки в панели инструментов токенов: она видна и игрокам, и мастеру. */
Hooks.on("getSceneControlButtons", controls => {
  const group = Array.isArray(controls)
    ? controls.find(c => c.name === "token")
    : controls?.token;
  if (!group?.tools) return;

  group.tools.push({
    name: "nca-agent",
    title: "Агент",
    icon: "fa-solid fa-mobile-screen-button",
    button: true,
    visible: true,
    onClick: () => openAgent()
  });

  if (game.user.isGM) {
    group.tools.push({ name: "nca-workspace", title: "Агент — файлы и терминалы", icon: "fa-solid fa-folder-open", button: true, visible: true, onClick: () => openWorkspace() });
    group.tools.push({
      name: "nca-agent-gm",
      title: "Агент — пульт мастера",
      icon: "fa-solid fa-tower-broadcast",
      button: true,
      visible: true,
      onClick: () => openGMPanel()
    });
  }
});

Hooks.on('getSceneControlButtons', controls => {
  const group = Array.isArray(controls) ? controls.find(c => c.name === 'token') : controls?.token;
  if (group?.tools && !game.user.isGM) group.tools.push({ name: 'nca-terminals', title: 'Агент — доступные терминалы', icon: 'fa-solid fa-desktop', button: true, visible: true, onClick: () => openWorkspace({ tab: 'terminals' }) });
});

Hooks.on('getTileConfigHeaderButtons', (app, buttons) => {
  const id = app.document?.getFlag(MODULE_ID, 'terminalId');
  if (!id || storageLocked()) return;
  if (!terminalAllowed(readState().terminals?.[id], game.user, game.user.viewedScene)) return;
  buttons.unshift({ label: 'Терминал', class: 'nca-open-terminal', icon: 'fas fa-desktop', onclick: () => openWorkspace({ tab: 'terminals', terminalId: id }) });
});
