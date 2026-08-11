/**
 * Окно справки: руководство для игрока и мастера плюс история версий.
 * Открывается кнопкой со знаком вопроса в заголовке окна Агента и пульта.
 */
import { CHANGELOG, TYPE_LABEL, currentVersion } from "./changelog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Действие НЕ должно называться "tab": ядро перехватывает это имя в своём
 * switch и уводит клик во встроенную систему вкладок, до обработчика модуля
 * управление не доходит. Зарезервированы также "close" и "toggleControls".
 */
function onShowTab(event, target) {
  this.tab = target.dataset.pane;
  this.render();
}

export class AgentHelpApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.tab = options.tab ?? "guide";
  }

  static DEFAULT_OPTIONS = {
    id: "night-city-agent-help",
    classes: ["nca-app", "nca-help"],
    tag: "div",
    window: { title: "Агент — руководство", icon: "fa-solid fa-circle-question", resizable: true },
    position: { width: 700, height: 640 },
    actions: { showTab: onShowTab }
  };

  static PARTS = {
    body: {
      template: "modules/night-city-agent/templates/help.hbs",
      scrollable: [".nca-help-body"]
    }
  };

  async _prepareContext() {
    return {
      isGM: game.user.isGM,
      version: currentVersion(),
      showGuide: this.tab === "guide",
      showLog: this.tab === "log",
      guideTab: this.tab === "guide",
      logTab: this.tab === "log",
      releases: CHANGELOG.map(r => ({
        version: r.version,
        date: r.date,
        entries: r.entries.map(e => ({ label: TYPE_LABEL[e.type] ?? e.type, type: e.type, text: e.text }))
      }))
    };
  }
}

let instance = null;

export function openHelp(tab = "guide") {
  if (instance?.rendered) {
    instance.tab = tab;
    instance.bringToFront();
    instance.render();
    return instance;
  }
  instance = new AgentHelpApp({ tab });
  instance.render(true);
  return instance;
}
