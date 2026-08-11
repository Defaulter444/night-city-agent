/**
 * Точка входа модуля «Агент».
 */
import { MODULE_ID, registerSettings, readState } from "./store.mjs";
import { registerSocket, UPDATE_HOOK } from "./socket.mjs";
import { openAgent, closeAllAgents } from "./app-agent.mjs";
import { openGMPanel } from "./app-gm.mjs";
import { openHelp } from "./help.mjs";
import * as M from "./model.mjs";
import * as Wealth from "./wealth.mjs";
import * as Services from "./services.mjs";
import * as Clock from "./clock.mjs";

Hooks.once("init", () => {
  registerSettings();
  console.log("night-city-agent | настройки зарегистрированы");
});

Hooks.once("socketlib.ready", () => {
  registerSocket();
  console.log("night-city-agent | сокет готов");
});

Hooks.once("ready", () => {
  // Кнопка «Зачислить» в карточке перевода живёт в чате, а не в окне Агента,
  // поэтому обработчик вешается один раз на весь сеанс.
  Wealth.bindDepositButton();

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      openAgent, openGMPanel, openHelp, closeAllAgents, readState, model: M,
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

  if (!globalThis.socketlib) {
    ui.notifications.error("Агент: не найден модуль socketlib — включите его в управлении модулями.");
  }
});

/**
 * Страховка от гонки: сообщение по сокету может обогнать обновление настройки
 * мира, и окно отрисует устаревшую переписку. Штатный хук приходит тогда,
 * когда состояние на клиенте уже точно свежее.
 */
Hooks.on("updateSetting", setting => {
  if (setting?.key === `${MODULE_ID}.state`) Hooks.callAll(UPDATE_HOOK);
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
