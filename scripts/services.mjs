/**
 * Экстренные службы и городская трансляция.
 *
 * Логика вызовов «мясовозки» и «Травма Тим» перенесена из модуля
 * Holophone/Agent Messenger™ (автор Lt Atlas) с его разрешения и переведена
 * под русский стол 2045 года: сеть здесь «Зиккурат», а не CitiNet.
 *
 * Почему подписки ищутся по названию вещи, а не по галочке в листе: в системе
 * нет поля «есть подписка», зато сама подписка существует как предмет
 * снаряжения. Значит, надёжнее смотреть на то, что персонаж носит с собой.
 */
import { MODULE_ID } from "./store.mjs";
import { now, clockHTML, clockFlag, esc } from "./clock.mjs";
import { adjustRaw, hasLedger } from "./wealth.mjs";

export const REO_FEE = 5;
export const REO_FREE_ABOVE = 800;   // корбук: при дорогом образе жизни вызов бесплатен

const norm = v => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Ступени питания и их месячная стоимость — по таблице «Образ жизни»
 * основной книги правил (RU v1.3, с. 380). Названия в книге пишутся через
 * два «б»: «киббл», поэтому в опознавании они именно такие.
 */
const FOOD = [
  { rank: 0, label: "без питания", monthly: 0, aliases: [] },
  { rank: 1, label: "На киббле", monthly: 100, aliases: ["kibble", "киббл", "кибл"] },
  { rank: 2, label: "На обычных полуфабрикатах", monthly: 300, aliases: ["generic prepak", "generic prepack", "обычных полуфабрикат", "обычный полуфабрикат"] },
  { rank: 3, label: "На хороших полуфабрикатах", monthly: 600, aliases: ["good prepak", "good prepack", "хороших полуфабрикат", "хороший полуфабрикат"] },
  { rank: 4, label: "На свежей еде", monthly: 1500, aliases: ["fresh food", "свежей еде", "свежая еда"] }
];

/** Виды жилья — по таблице «Образ жизни и жильё» (с. 381). */
const HOUSING = [
  "living on the street", "жизнь на улице", "живёт на улице",
  "living in a vehicle", "на улице в транспорте", "жизнь в транспорте",
  "cube hotel", "куб-отель", "кубический отель", "кубический-отель",
  "cargo container", "грузовой контейнер",
  "studio apartment", "квартира-студия", "студия",
  "two-bedroom apartment", "двуспальная квартира",
  "corporate conapt", "корпоративный конапт",
  "upscale conapt", "улучшенный конапт",
  "luxury penthouse", "роскошный пентхаус", "пентхаус",
  "beaverville", "бивервилл"
];

const amount = item => {
  const v = item?.system?.amount;
  return v === undefined || v === null || v === "" ? 1 : Math.max(0, Number(v) || 0);
};
const marketValue = item => Math.max(0, Number(item?.system?.price?.market ?? item?.system?.price ?? 0) || 0);
const monthlyFromName = name => {
  const m = String(name).replaceAll(",", "").match(/(\d+)\s*(?:eb|эдди|эб)\s*\/\s*(?:month|мес)/i);
  return m ? Math.max(0, Number(m[1]) || 0) : null;
};

/** Вещь считается носимой, если это снаряжение в наличии и не сдано на склад. */
function carriedGear(item) {
  if (norm(item?.type) !== "gear" || amount(item) <= 0) return false;
  const state = norm(item?.system?.equipped ?? "");
  return !state || state === "equipped" || state === "carried";
}

function foodTier(item) {
  const name = norm(item?.name);
  let best = FOOD[0];
  for (const tier of FOOD) {
    if (tier.rank <= best.rank) continue;
    if (tier.aliases.some(a => name.includes(norm(a)))) best = tier;
  }
  return best;
}

/** Сколько персонаж тратит в месяц на еду и жильё — по носимым вещам. */
export function inspectLifestyle(actor) {
  const foods = [], homes = [];
  for (const item of actor?.items ?? []) {
    if (!carriedGear(item)) continue;

    // Метка на предмете важнее разбора названия: она задана явно.
    const tag = foundry.utils.getProperty(item, `flags.${MODULE_ID}.lifestyle`);
    if (tag?.kind) {
      const sum = Math.max(0, Number(tag.monthly) || 0);
      if (tag.kind === "food") foods.push({ item, tier: { rank: 9, label: String(tag.label ?? item.name) }, sum });
      else if (tag.kind === "housing") homes.push({ item, sum });
      continue;
    }

    const name = norm(item.name);
    const parsed = monthlyFromName(item.name);
    const tier = foodTier(item);
    if (tier.rank > 0) {
      const market = marketValue(item);
      foods.push({ item, tier, sum: parsed ?? (market > 0 ? market : tier.monthly) });
    }
    if (HOUSING.some(p => name.includes(norm(p)))) homes.push({ item, sum: parsed ?? marketValue(item) });
  }
  foods.sort((a, b) => b.tier.rank - a.tier.rank || b.sum - a.sum);
  homes.sort((a, b) => b.sum - a.sum);

  const food = foods[0] ?? null, home = homes[0] ?? null;
  const foodMonthly = Math.max(0, food?.sum ?? 0);
  const housingMonthly = Math.max(0, home?.sum ?? 0);
  return {
    foodLabel: food?.tier.label ?? "не найдено",
    foodSource: food?.item?.name ?? "платного питания не найдено",
    foodMonthly,
    housingName: home?.item?.name ?? "не найдено",
    housingMonthly,
    totalMonthly: foodMonthly + housingMonthly
  };
}

/**
 * Служебная метка на предмете: {service:"trauma"|"reo", tier, monthly}.
 * Предметы из компендиума модуля несут её сами, поэтому их не нужно
 * называть особым образом — можно переименовывать как угодно.
 */
export function serviceTag(item) {
  const tag = foundry.utils.getProperty(item ?? {}, `flags.${MODULE_ID}.service`);
  if (!tag?.service) return null;
  return {
    service: String(tag.service),
    tier: String(tag.tier ?? "").trim(),
    monthly: Number(tag.monthly) || 0
  };
}

/** Подписка на службу: ищем носимую вещь, где есть и служба, и слово «подписка». */
export function findMembership(actor, service) {
  // Сначала предметы с меткой — это надёжно и не зависит от названия.
  const tagged = [...(actor?.items ?? [])]
    .filter(item => carriedGear(item) && serviceTag(item)?.service === service)
    .sort((a, b) => serviceTag(b).monthly - serviceTag(a).monthly);
  if (tagged[0]) {
    const tag = serviceTag(tagged[0]);
    return { item: tagged[0], tier: tag.tier || tagged[0].name, monthly: tag.monthly };
  }
  // Затем — разбор по названию, для вещей, сделанных мастером вручную.
  return findMembershipByName(actor, service);
}

function findMembershipByName(actor, service) {
  const svc = service === "trauma"
    ? ["trauma team", "травма тим", "травма-тим"]
    : ["r.e.o", "reo", "мясовоз", "р.е.о"];
  const word = ["membership", "подписк", "членств", "полис"];

  const found = [...(actor?.items ?? [])].filter(item => {
    if (!carriedGear(item)) return false;
    const name = norm(item.name);
    return svc.some(s => name.includes(norm(s))) && word.some(w => name.includes(w));
  }).sort((a, b) => (monthlyFromName(b.name) ?? marketValue(b)) - (monthlyFromName(a.name) ?? marketValue(a)));

  const item = found[0] ?? null;
  if (!item) return null;
  // Уровень подписки вытаскиваем из названия: «Травма Тим — подписка Люкс».
  const tier = String(item.name).replace(/^_+/, "").match(/(?:подписк\w*|членств\w*|полис|membership)\s*[:—–-]?\s*(.+)$/i)?.[1]?.trim() || item.name;
  return { item, tier, monthly: monthlyFromName(item.name) ?? marketValue(item) };
}

function speakerFor(actor) {
  const token = actor?.getActiveTokens?.()[0]?.document ?? null;
  return ChatMessage.getSpeaker({ scene: canvas.scene, actor, token: token ?? undefined, alias: actor?.name ?? "Агент" });
}

function serviceCard({ service, actor, coverage, eta, formula, fee, note = "", clock = now() }) {
  return `<div class="nca-card nca-card-emergency">
      <div class="nca-card-kicker"><i class="fa-solid fa-truck-medical"></i> ВЫЗОВ ЭКСТРЕННОЙ СЛУЖБЫ</div>
      <div class="nca-card-title">${esc(service)}</div>
      <div class="nca-card-grid">
        <span>Вызывает</span><b>${esc(actor.name)}</b>
        <span>Место</span><b>${esc(canvas.scene?.name ?? "место не определено")}</b>
        <span>Покрытие</span><b>${esc(coverage)}</b>
        <span>Прибытие</span><b>через ${eta} раунд(ов) (${esc(formula)})</b>
        ${fee ? `<span>Плата за вызов</span><b>${esc(fee)}</b>` : ""}
      </div>
      ${note ? `<div class="nca-card-note">${esc(note)}</div>` : ""}
      ${clockHTML(clock)}
    </div>`;
}

/** Вызов «мясовозки»: без подписки медленнее и за деньги. */
export async function callREO(actor, { skipLifestyle = false } = {}) {
  if (!actor) throw new Error("Не выбран, кто вызывает");
  const life = skipLifestyle ? null : inspectLifestyle(actor);
  const total = life?.totalMonthly ?? null;
  const waived = !skipLifestyle && total > REO_FREE_ABOVE;

  if (!waived && !hasLedger(actor)) throw new Error(`У «${actor.name}» нет счёта, а вызов стоит ${REO_FEE} эдди`);

  const membership = findMembership(actor, "reo");
  const coverage = membership ? `подписка «${membership.tier}»` : "без подписки, наличными";
  const formula = membership ? "1d6+2" : "1d6+3";

  if (!waived) await adjustRaw(actor, -REO_FEE, "Вызов «мясовозки» через Агента", foundry.utils.randomID(24));
  const roll = await new Roll(formula).evaluate();
  const clock = now();

  await ChatMessage.create({
    content: serviceCard({
      service: "R.E.O. Meatwagon Inc.",
      actor, coverage, eta: roll.total, formula,
      fee: waived ? `не берётся — образ жизни ${total} эдди/мес` : `${REO_FEE} эдди списано`,
      note: "Доставка и лечение оплачиваются отдельно по условиям полиса.",
      clock
    }),
    speaker: speakerFor(actor),
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rolls: [roll],
    flags: { [MODULE_ID]: { emergency: { service: "reo", actorUuid: actor.uuid, waived }, clock: clockFlag(clock) } }
  });
  return roll.total;
}

/** Вызов «Травма Тим» — только по действующей подписке. */
export async function callTrauma(actor) {
  if (!actor) throw new Error("Не выбран, кто вызывает");
  const membership = findMembership(actor, "trauma");
  if (!membership) throw new Error(`У «${actor.name}» нет действующей подписки «Травма Тим»`);

  const roll = await new Roll("1d6").evaluate();
  const clock = now();
  await ChatMessage.create({
    content: serviceCard({
      service: "Trauma Team International",
      actor,
      coverage: `подписка «${membership.tier}»`,
      eta: roll.total, formula: "1d6",
      fee: "покрыто подпиской",
      note: "Полис подтверждён, группа выехала.",
      clock
    }),
    speaker: speakerFor(actor),
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rolls: [roll],
    flags: { [MODULE_ID]: { emergency: { service: "trauma", actorUuid: actor.uuid }, clock: clockFlag(clock) } }
  });
  return roll.total;
}

/** Городская трансляция от мастера: сеть «Зиккурат», датапул Найт-Сити. */
export async function broadcast({ headline = "", message = "" } = {}) {
  if (!game.user.isGM) throw new Error("Трансляцию в сеть даёт только мастер");
  const body = String(message ?? "").trim();
  if (!body) throw new Error("Пустую трансляцию отправлять некуда");

  const clock = now();
  await ChatMessage.create({
    content: `<div class="nca-card nca-card-network">
        <div class="nca-card-kicker"><i class="fa-solid fa-tower-broadcast"></i> ЗИККУРАТ · ДАТАПУЛ НАЙТ-СИТИ</div>
        <div class="nca-card-title">${esc(String(headline).trim() || "Экстренное сообщение сети")}</div>
        <div class="nca-card-body">${esc(body).replace(/\r\n|\r|\n/g, "<br>")}</div>
        ${clockHTML(clock)}
      </div>`,
    speaker: ChatMessage.getSpeaker({ scene: canvas.scene, alias: "Зиккурат" }),
    flags: { [MODULE_ID]: { broadcast: true, clock: clockFlag(clock) } }
  });
  return true;
}
