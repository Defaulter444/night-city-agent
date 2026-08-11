/**
 * Собирает компендиум модуля: подписки экстренных служб и питание.
 *
 * Каждый предмет несёт метку flags.night-city-agent — служба, уровень,
 * стоимость в месяц. Именно по ней модуль узнаёт вещь, поэтому мастер может
 * переименовывать предметы как угодно, не ломая распознавание.
 *
 * Запуск при ЗАКРЫТОМ Foundry: node tools/build-pack.mjs
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("C:/Program Files/Foundry Virtual Tabletop/resources/app/");
const { ClassicLevel } = require("classic-level");

const MODULE_ID = "night-city-agent";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(root, "packs", "services");

/** Идентификатор Foundry — ровно 16 знаков, иначе документ молча отбрасывается. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function id16(seed) {
  // Детерминированно: пересборка пака не должна плодить дубли на листах.
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let out = "";
  for (let i = 0; i < 16; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; out += ALPHABET[h % ALPHABET.length]; }
  return out;
}

/**
 * Всё ниже взято из основной книги правил (RU v1.3), а не придумано:
 * подписки Trauma Team — таблица услуг, с. 379; питание — «Образ жизни»,
 * с. 380; жильё — «Образ жизни и жильё», с. 381.
 *
 * Уровней подписки в корбуке ровно два: Silver и Executive.
 */

const FOUNDRY_PUBLIC = "C:/Program Files/Foundry Virtual Tabletop/resources/app/public";
const DATA_ROOT = "C:/Users/Horusian/AppData/Local/FoundryVTT/Data";

/**
 * Берёт первый существующий путь из списка. Битая ссылка на картинку даёт
 * в компендиуме серый прямоугольник, поэтому каждый путь проверяется на диске.
 */
function icon(...candidates) {
  for (const rel of candidates) {
    const inData = join(DATA_ROOT, rel);
    const inCore = join(FOUNDRY_PUBLIC, rel);
    if (fs.existsSync(inData) || fs.existsSync(inCore)) return rel;
  }
  console.warn("  иконка не найдена:", candidates[0]);
  return "icons/svg/item-bag.svg";
}

const CPR = "systems/cyberpunk-red-core/icons/compendium";
const ICONS = {
  trauma:  icon(`${CPR}/gear/medtech_bag.svg`, "icons/svg/heal.svg"),
  reo:     icon(`${CPR}/gear/cryopump.svg`, "icons/svg/heal.svg"),
  kibble:  icon(`${CPR}/gear/kibble.svg`, "icons/svg/item-bag.svg"),
  prepak:  icon(`${CPR}/gear/mre.svg`, "icons/svg/item-bag.svg"),
  fresh:   icon(`${CPR}/gear/foodstick.svg`, "icons/svg/item-bag.svg"),
  street:  icon("icons/svg/city.svg", "icons/svg/item-bag.svg"),
  vehicle: icon("icons/svg/cave.svg", "icons/svg/item-bag.svg"),
  cube:    icon(`${CPR}/cargo-containers-and-cube-hotels/hidden-compartment.svg`, "icons/svg/chest.svg"),
  cargo:   icon(`${CPR}/cargo-containers-and-cube-hotels/furniture-set.svg`, "icons/svg/chest.svg"),
  flat:    icon("icons/svg/house.svg", "icons/svg/village.svg", "icons/svg/city.svg"),
  lux:     icon("icons/svg/castle.svg", "icons/svg/city.svg")
};

const MEMBERSHIPS = [
  { name: "Подписка Trauma Team Silver",    service: "trauma", tier: "Silver",    monthly: 500 },
  { name: "Подписка Trauma Team Executive", service: "trauma", tier: "Executive", monthly: 1000 }
];

/** R.E.O. Meatwagon в основной книге отсутствует — цену ставит мастер. */
const REO = [
  { name: "Подписка R.E.O. Meatwagon", service: "reo", tier: "Стандарт", monthly: 0 }
];

const FOOD = [
  { name: "Образ жизни: на киббле",                 label: "На киббле",                 monthly: 100 },
  { name: "Образ жизни: на обычных полуфабрикатах", label: "На обычных полуфабрикатах", monthly: 300 },
  { name: "Образ жизни: на хороших полуфабрикатах", label: "На хороших полуфабрикатах", monthly: 600 },
  { name: "Образ жизни: на свежей еде",             label: "На свежей еде",             monthly: 1500 }
];

/** Аренда в месяц; прочерк в книге означает, что платить не нужно. */
const HOUSING = [
  { name: "Жильё: жизнь на улице",                      monthly: 0 },
  { name: "Жильё: жизнь на улице в транспорте",         monthly: 0 },
  { name: "Жильё: куб-отель",                           monthly: 500 },
  { name: "Жильё: грузовой контейнер",                  monthly: 1000,  buy: 15000 },
  { name: "Жильё: квартира-студия",                     monthly: 1500,  buy: 25000 },
  { name: "Жильё: двуспальная квартира",                monthly: 2500,  buy: 35000 },
  { name: "Жильё: корпоративный конапт",                monthly: 0,     note: "Предоставляется корпорацией" },
  { name: "Жильё: улучшенный конапт",                   monthly: 7500,  buy: 85000 },
  { name: "Жильё: роскошный пентхаус",                  monthly: 15000, buy: 150000 },
  { name: "Жильё: корпоративный дом в Бивервилле",      monthly: 0,     buy: 200000, note: "Предоставляется корпорацией" },
  { name: "Жильё: корпоративный особняк в Бивервилле",  monthly: 0,     buy: 500000, note: "Предоставляется корпорацией" }
];

function gear(name, flags, price = 0, description = "", img = "icons/svg/item-bag.svg") {
  const _id = id16(name);
  return {
    _id, name, type: "gear", img,
    system: {
      description: { value: description, chat: "", unidentified: "" },
      amount: 1, equipped: "carried", concealable: { concealable: false, isConcealed: false },
      price: { market: price, category: "" }, quality: "standard", source: { book: "", page: 0 }
    },
    flags: { [MODULE_ID]: flags },
    ownership: { default: 0 },
    _stats: { systemId: "cyberpunk-red-core", coreVersion: "12.331" }
  };
}

/** Иконка по виду жилья — от улицы к особняку. */
function housingIcon(h) {
  const n = h.name.toLowerCase();
  if (n.includes("транспорт")) return ICONS.vehicle;
  if (n.includes("на улице")) return ICONS.street;
  if (n.includes("куб-отель")) return ICONS.cube;
  if (n.includes("контейнер")) return ICONS.cargo;
  if (n.includes("пентхаус") || n.includes("бивервилл")) return ICONS.lux;
  return ICONS.flat;
}

const docs = [];
for (const m of [...MEMBERSHIPS, ...REO]) {
  const price = m.monthly
    ? `${m.monthly} эдди в месяц (осн. книга, с. 379)`
    : "цену задаёт мастер: в основной книге этой службы нет";
  docs.push(gear(m.name, { service: { service: m.service, tier: m.tier, monthly: m.monthly } }, m.monthly,
    `<p>Действующая подписка, ${price}.</p><p>Пока предмет носится с собой, «Агент» видит подписку при вызове службы.</p>`,
    m.service === "trauma" ? ICONS.trauma : ICONS.reo));
}
for (const f of FOOD) {
  docs.push(gear(f.name, { lifestyle: { kind: "food", label: f.label, monthly: f.monthly } }, f.monthly,
    `<p>Образ жизни, ${f.monthly} эдди в месяц (осн. книга, с. 380).</p>
     <p>Вместе с жильём определяет, будет ли вызов «мясовозки» бесплатным.</p>`,
    f.monthly <= 100 ? ICONS.kibble : f.monthly >= 1500 ? ICONS.fresh : ICONS.prepak));
}
for (const h of HOUSING) {
  const rent = h.monthly ? `${h.monthly} эдди в месяц` : (h.note ?? "аренда не платится");
  const buy = h.buy ? ` Покупка — ${h.buy} эдди.` : "";
  docs.push(gear(h.name, { lifestyle: { kind: "housing", label: h.name.replace(/^Жильё:\s*/, ""), monthly: h.monthly } }, h.monthly,
    `<p>Жильё: ${rent} (осн. книга, с. 381).${buy}</p>`, housingIcon(h)));
}

fs.rmSync(packDir, { recursive: true, force: true });
fs.mkdirSync(packDir, { recursive: true });

const db = new ClassicLevel(packDir, { valueEncoding: "json" });
await db.open();
const batch = db.batch();
for (const doc of docs) batch.put(`!items!${doc._id}`, doc);
await batch.write();
await db.close();

console.log(`компендиум собран: ${docs.length} предметов`);
console.log(`  подписки: ${MEMBERSHIPS.length}, питание: ${FOOD.length}, жильё: ${HOUSING.length}`);
console.log(`  ${packDir}`);
