/**
 * Счёт персонажа: перевод эдди прямо из переписки.
 *
 * Тонкость с правами: игрок не может писать в чужой лист, поэтому деньги
 * получателю нельзя просто начислить. Приём взят у Holophone/Agent Messenger™
 * (автор Lt Atlas): если прав нет, владельцу уходит шёпот с кнопкой «Принять»,
 * и запись в журнал делает уже он сам.
 *
 * Дополнительно каждая операция несёт расписку (receipt). Владелец мог нажать
 * кнопку дважды, окно могло отрисоваться повторно — расписка гарантирует, что
 * в журнале появится ровно одна строка.
 */
import { MODULE_ID } from "./store.mjs";
import { now, clockHTML, clockFlag, esc } from "./clock.mjs";

const RECEIPTS = "transactionReceipts";
const MAX_RECEIPTS = 250;

export function hasLedger(actor) {
  return Number.isFinite(Number(actor?.system?.wealth?.value));
}

/**
 * Актёр, чей кошелёк принадлежит владельцу устройства.
 *
 * Порядок важен: сперва лист, назначенный игроку в настройках пользователя,
 * затем единственный принадлежащий ему персонаж, и только в последнюю очередь
 * выделенный токен. Требовать выделения токена было неправильно — игрок и так
 * знает, кто он, а лишний шаг перед переводом денег только мешает.
 */
export function actorForUser(userId) {
  const user = game.users.get(userId);
  if (!user) return null;
  if (user.character) return user.character;

  const owned = game.actors.filter(a => a.type === "character" && a.testUserPermission(user, "OWNER"));
  if (owned.length === 1) return owned[0];

  // Листов несколько — уточняем выделенным токеном, но только своим.
  const selected = canvas.tokens?.controlled?.[0]?.actor ?? null;
  if (selected && owned.some(a => a.id === selected.id)) return selected;

  return owned[0] ?? null;
}

/**
 * Пишет в журнал напрямую. Вызывать только когда права точно есть.
 * Возвращает false, если операция с такой распиской уже проведена.
 */
export async function adjustRaw(actor, delta, reason = "Перевод через Агента", receiptId = null) {
  if (!hasLedger(actor)) throw new Error(`У «${actor?.name ?? "актёра"}» нет счёта Cyberpunk RED`);

  if (receiptId && foundry.utils.getProperty(actor, `flags.${MODULE_ID}.${RECEIPTS}.${receiptId}`)) return false;

  const wealth = foundry.utils.deepClone(actor.system.wealth ?? {});
  const before = Number(wealth.value ?? 0) || 0;
  const change = Math.trunc(Number(delta) || 0);
  wealth.value = before + change;
  wealth.transactions ??= [];
  wealth.transactions.push([
    `${change >= 0 ? "Увеличено" : "Уменьшено"} на ${Math.abs(change)} до ${wealth.value}`,
    reason
  ]);

  const update = { "system.wealth": wealth };
  if (receiptId) {
    const receipts = foundry.utils.deepClone(foundry.utils.getProperty(actor, `flags.${MODULE_ID}.${RECEIPTS}`) ?? {});
    receipts[receiptId] = Date.now();
    // Расписки копятся вечно, поэтому держим только свежие.
    const recent = Object.entries(receipts).sort((a, b) => b[1] - a[1]).slice(0, MAX_RECEIPTS);
    update[`flags.${MODULE_ID}.${RECEIPTS}`] = Object.fromEntries(recent);
  }

  await actor.update(update);
  return true;
}

/** Шёпот владельцу с кнопкой принятия — когда своих прав не хватает. */
async function requestDeposit(actor, delta, reason) {
  const owners = game.users.players.filter(u => actor.testUserPermission?.(u, "OWNER"));
  if (!owners.length) throw new Error(`У «${actor.name}» нет игрока-владельца, перевод доставить некому`);

  const receiptId = foundry.utils.randomID(24);
  const clock = now();
  const sign = delta >= 0 ? "Зачисление" : "Списание";

  await ChatMessage.create({
    whisper: owners.map(u => u.id),
    speaker: ChatMessage.getSpeaker({ alias: "Агент" }),
    content: `<div class="nca-card nca-card-eb">
        <div class="nca-card-kicker"><i class="fa-solid fa-coins"></i> ПЕРЕВОД</div>
        <div class="nca-card-title">${esc(reason)}</div>
        <div class="nca-card-grid"><span>${sign}</span><b>${Math.abs(Math.trunc(delta))} эдди</b></div>
        <button type="button" class="nca-deposit"><i class="fa-solid fa-coins"></i> Зачислить «${esc(actor.name)}»</button>
        ${clockHTML(clock)}
      </div>`,
    flags: { [MODULE_ID]: { deposit: { receiptId, actorUuid: actor.uuid, delta: Math.trunc(delta), reason }, clock: clockFlag(clock) } }
  });
  return receiptId;
}

/** Безопасный перевод: сам, если можно, иначе через кнопку владельцу. */
export async function adjust(actor, delta, reason = "Перевод через Агента") {
  if (game.user.isGM || actor.isOwner) return adjustRaw(actor, delta, reason, foundry.utils.randomID(24));
  return requestDeposit(actor, delta, reason);
}

/**
 * Перевод от одного персонажа другому: у отправителя списываем сразу
 * (он свой лист держит), получателю — по правилам выше.
 */
export async function transfer(fromActor, toActor, amount, note = "") {
  const sum = Math.max(0, Math.trunc(Number(amount) || 0));
  if (!sum) throw new Error("Сумма перевода должна быть больше нуля");
  if (!fromActor || !toActor) throw new Error("Не найден отправитель или получатель перевода");
  if (fromActor.id === toActor.id) throw new Error("Перевод самому себе смысла не имеет");
  if (!hasLedger(fromActor)) throw new Error(`У «${fromActor.name}» нет счёта Cyberpunk RED`);

  const balance = Number(fromActor.system.wealth.value ?? 0) || 0;
  if (balance < sum) throw new Error(`На счету «${fromActor.name}» только ${balance} эдди`);

  const tail = note ? ` — ${note}` : "";
  await adjustRaw(fromActor, -sum, `Перевод через Агента для «${toActor.name}»${tail}`, foundry.utils.randomID(24));
  await adjust(toActor, +sum, `Перевод через Агента от «${fromActor.name}»${tail}`);
  return sum;
}

/** Кнопка «Зачислить» в карточке чата. Вешается один раз за сеанс. */
export function bindDepositButton() {
  if (game._ncaDepositBound) return;
  game._ncaDepositBound = true;

  Hooks.on("renderChatMessage", (message, html) => {
    const root = html?.[0] ?? html;
    const button = root?.querySelector?.(".nca-deposit");
    if (!button || button.dataset.ncaBound === "1") return;
    button.dataset.ncaBound = "1";

    button.addEventListener("click", async () => {
      const deposit = foundry.utils.getProperty(message, `flags.${MODULE_ID}.deposit`);
      if (!deposit?.actorUuid) return ui.notifications.error("В карточке перевода нет данных о счёте");

      const actor = await fromUuid(deposit.actorUuid);
      if (!actor?.isOwner) return ui.notifications.warn("Зачислить может только владелец листа");

      button.disabled = true;
      try {
        const applied = await adjustRaw(actor, deposit.delta, deposit.reason, deposit.receiptId);
        button.textContent = applied ? "Зачислено" : "Уже зачислено";
        ui.notifications.info(applied ? "Перевод зачислен" : "Этот перевод уже был зачислен");
      } catch (err) {
        button.disabled = false;
        console.error("night-city-agent | зачисление не прошло", err);
        ui.notifications.error(err.message ?? "Не удалось зачислить перевод");
      }
    });
  });
}
