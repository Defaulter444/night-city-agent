/**
 * Проверки связности, которые Foundry не покажет ошибкой:
 *  - версия в манифесте совпадает со свежей записью истории;
 *  - каждый data-action в шаблонах зарегистрирован в actions окна;
 *  - каждый селектор, который ищет код, встречается в разметке.
 *
 * Запуск: node test/wiring.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHANGELOG } from "../scripts/changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/** Имена действий из блока `actions: { ... }` в файле окна. */
function registeredActions(src) {
  const block = src.match(/actions:\s*\{([^}]*)\}/s);
  const names = new Set([...(block?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map(m => m[1]));
  for (const arr of src.matchAll(/Object\.fromEntries\(\[([^\]]+)\]\.map/g)) for (const name of arr[1].matchAll(/'([^']+)'/g)) names.add(name[1]);
  return names;
}

/** Значения data-action из шаблона. */
function usedActions(hbs) {
  return new Set([...hbs.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
}

test("версия манифеста совпадает со свежей записью истории", () => {
  const manifest = JSON.parse(read("module.json"));
  assert.equal(manifest.version, CHANGELOG[0].version,
    `module.json = ${manifest.version}, история = ${CHANGELOG[0].version}`);
});

test("история версий не содержит пустых записей", () => {
  for (const release of CHANGELOG) {
    assert.ok(release.entries.length > 0, `версия ${release.version} без записей`);
    for (const e of release.entries) {
      assert.ok(["add", "fix", "change"].includes(e.type), `неизвестный тип «${e.type}»`);
      assert.ok(e.text.trim().length > 10, `слишком короткая запись в ${release.version}`);
    }
  }
});

const pairs = [
  ["окно Агента", "scripts/app-agent.mjs", "templates/agent-modern.hbs"],
  ["пульт мастера", "scripts/app-gm.mjs", "templates/gm.hbs"],
  ["справка", "scripts/help.mjs", "templates/help.hbs"],
  ["файлы и терминалы", "scripts/workspace-app.mjs", "templates/workspace.hbs"]
];

for (const [label, script, template] of pairs) {
  test(`${label}: каждая кнопка разметки имеет обработчик`, () => {
    const declared = registeredActions(read(script));
    for (const action of usedActions(read(template))) {
      assert.ok(declared.has(action), `data-action="${action}" не зарегистрирован в ${script}`);
    }
  });

  test(`${label}: каждый обработчик используется в разметке`, () => {
    const used = usedActions(read(template));
    for (const action of registeredActions(read(script))) {
      assert.ok(used.has(action), `действие «${action}» объявлено, но кнопки для него нет`);
    }
  });
}

/**
 * Ядро Foundry перехватывает эти имена в своём switch (application.mjs,
 * #onClickAction) — обработчик модуля с таким именем никогда не вызовется.
 */
const RESERVED = ["close", "tab", "toggleControls"];

for (const [label, script, template] of pairs) {
  test(`${label}: не занимает имена действий, зарезервированные ядром`, () => {
    for (const action of registeredActions(read(script))) {
      assert.ok(!RESERVED.includes(action),
        `действие «${action}» перехватывается ядром Foundry, переименуйте его`);
    }
    for (const action of usedActions(read(template))) {
      if (RESERVED.includes(action)) {
        assert.fail(`data-action="${action}" в ${template} обрабатывает ядро, а не модуль`);
      }
    }
  });
}

test("окна не переопределяют close(), а используют точки жизненного цикла", () => {
  for (const script of ["scripts/app-agent.mjs", "scripts/app-gm.mjs", "scripts/help.mjs"]) {
    const src = read(script);
    assert.ok(!/^\s*async close\(/m.test(src),
      `${script} переопределяет close() — закрытие и перерисовка стоят в одной очереди, ` +
      `используйте _preClose/_onClose`);
  }
});

test("подписка на обновление снимается при закрытии окна", () => {
  for (const script of ["scripts/app-agent.mjs", "scripts/app-gm.mjs"]) {
    const src = read(script);
    if (!src.includes("Hooks.on(UPDATE_HOOK")) continue;
    assert.ok(src.includes("_preClose"), `${script}: подписка ставится, но _preClose не найден`);
    assert.ok(src.includes("Hooks.off(UPDATE_HOOK"), `${script}: подписка не снимается`);
    assert.ok(/closing/.test(src), `${script}: нет флага, гасящего перерисовку во время закрытия`);
  }
});

test("глобальные классы Foundry не берутся через globalThis", () => {
  for (const script of ["scripts/app-agent.mjs", "scripts/app-gm.mjs", "scripts/ringtone.mjs", "scripts/help.mjs"]) {
    const src = read(script);
    for (const cls of ["FilePicker", "Dialog", "Application"]) {
      assert.ok(!src.includes(`globalThis.${cls}`),
        `${script}: ${cls} объявлен в обычном скрипте и в globalThis не попадает`);
    }
  }
});

test("код не ищет селекторов, которых нет в разметке", () => {
  const checks = [
    ["scripts/app-agent.mjs", "templates/agent-modern.hbs"],
    ["scripts/app-gm.mjs", "templates/gm.hbs"]
  ];
  for (const [script, template] of checks) {
    const hbs = read(template);
    const selectors = [...read(script).matchAll(/querySelector(?:All)?\(["'`]\.([a-z0-9-]+)/gi)]
      .map(m => m[1]);
    for (const cls of new Set(selectors)) {
      assert.ok(hbs.includes(`class="${cls}`) || hbs.includes(`${cls}"`) || hbs.includes(cls),
        `${script} ищет .${cls}, но в ${template} такого класса нет`);
    }
  }
});

test("манифест перечисляет существующие файлы", () => {
  const manifest = JSON.parse(read("module.json"));
  for (const f of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) {
    assert.doesNotThrow(() => read(f), `в манифесте указан отсутствующий файл ${f}`);
  }
});

test("полосы прокрутки внутри флекса умеют сжиматься", () => {
  // У флекс-элемента `min-width` по умолчанию равен `auto`: он отказывается
  // становиться уже своего содержимого. Из-за этого полоса устройств в шапке
  // раздвигала строку, упиралась в край окна и обрезалась — при том, что
  // `overflow-x: auto` у неё стоял и выглядел рабочим. Ошибка тихая: в вёрстке
  // всё «правильно», а прокрутки нет.
  const css = read("styles/agent.css");
  const блоки = [...css.matchAll(/\.nca-top \.nca-devbar\s*\{([^}]*)\}/g)]
    .map(m => m[1]);
  assert.ok(блоки.length, "правило .nca-top .nca-devbar пропало");
  const свод = блоки.join(" ");
  assert.match(свод, /overflow-x:\s*auto|min-width:\s*0/,
    "у полосы устройств нет ни прокрутки, ни разрешения сжиматься");
  assert.match(свод, /min-width:\s*0/,
    "полосе устройств не задан min-width: 0 — прокрутка не включится");
});

test("прокрутка полосы устройств колесом не потерялась", () => {
  const src = read("scripts/app-agent.mjs");
  assert.ok(src.includes(".nca-devbar"), "окно больше не находит полосу устройств");
  assert.match(src, /addEventListener\("wheel"/,
    "колесо не прокручивает полосу — целиться в шестипиксельную полоску мышью мучительно");
  assert.match(src, /passive:\s*false/,
    "обработчик колеса объявлен пассивным: preventDefault в нём не сработает");
});

test("вложения видны и в переписке, и в перехвате", () => {
  // Мастер жаловался, что в перехвате не видно, кто кому послал картинку:
  // облачко там рисовалось только текстом. Оба окна должны показывать
  // вложение одинаково.
  for (const [где, шаблон, скрипт] of [
    ["переписка", "templates/agent-modern.hbs", "scripts/app-agent.mjs"],
    ["перехват", "templates/gm.hbs", "scripts/app-gm.mjs"]
  ]) {
    const hbs = read(шаблон);
    assert.ok(hbs.includes("nca-photo"), `${где}: облачко не показывает картинку`);
    assert.ok(hbs.includes('data-action="openImage"'),
      `${где}: картинку нельзя открыть во весь экран`);
    assert.ok(read(скрипт).includes("image:"),
      `${где}: путь к картинке не передаётся в шаблон`);
  }
});

console.log(`\n${passed} проверок пройдено`);
