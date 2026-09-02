/**
 * Тесты доменной логики. Запуск: node test/model.test.mjs
 * Foundry для этого не нужен — model.mjs не знает про игру ничего.
 */
import assert from "node:assert/strict";
import * as M from "../scripts/model.mjs";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// Детерминированный «случай», чтобы номера были предсказуемы.
function seeded(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

test("номер выдаётся в формате NNNN-NNNN и не повторяется", () => {
  const st = M.blankState();
  const rng = seeded(7);
  const nums = new Set();
  for (let i = 0; i < 200; i++) {
    const d = M.addDevice(st, {}, rng);
    assert.match(d.num, /^[1-9]\d{3}-\d{4}$/);
    assert.equal(d.num.replace("-", "").length, 8, `в номере ${d.num} не восемь цифр`);
    assert.equal(nums.has(d.num), false, `номер ${d.num} выдан дважды`);
    nums.add(d.num);
  }
});

test("номер можно задать вручную", () => {
  const st = M.blankState();
  const d = M.addDevice(st, { num: "1234-5678", owner: "u1", label: "Ласточка" });
  assert.equal(d.num, "1234-5678");
  assert.equal(st.devices["1234-5678"].label, "Ласточка");
});

test("введённый номер приводится к единому виду", () => {
  assert.equal(M.normalizeNumber("12345678"), "1234-5678");
  assert.equal(M.normalizeNumber("1234 5678"), "1234-5678");
  assert.equal(M.normalizeNumber("(1234) 56-78"), "1234-5678");
  assert.equal(M.normalizeNumber("1234-5678"), "1234-5678");
  assert.equal(M.normalizeNumber("5550142"), "555-0142", "семизначные тоже приводятся");
  assert.equal(M.normalizeNumber("  "), "");
});

test("кривой номер отклоняется с понятной ошибкой", () => {
  const st = M.blankState();
  assert.throws(() => M.addDevice(st, { num: "12" }), /не похоже на номер/);
  assert.throws(() => M.addDevice(st, { num: "телефон" }), /не похоже на номер/);
  assert.equal(Object.keys(st.devices).length, 0, "битое устройство не должно создаваться");
});

test("занятый номер вручную не занять повторно", () => {
  const st = M.blankState();
  M.addDevice(st, { num: "1234-5678", label: "Французик" });
  assert.throws(() => M.addDevice(st, { num: "1234-5678" }), /уже занят.*Французик/);
  assert.throws(() => M.addDevice(st, { num: "12345678" }), /уже занят/, "и в другой записи тоже");
  assert.equal(Object.keys(st.devices).length, 1);
});

test("пустой номер означает случайный", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { num: "" });
  const b = M.addDevice(st, { num: "   " });
  const c = M.addDevice(st, { num: null });
  for (const d of [a, b, c]) assert.match(d.num, /^[1-9]\d{3}-\d{4}$/);
  assert.equal(Object.keys(st.devices).length, 3);
});

test("занятый номер повторно не выдаётся", () => {
  const st = M.blankState();
  // Забиваем весь диапазон одного «префикса» и проверяем, что генератор его обходит.
  for (let t = 0; t < 10000; t++) {
    st.devices[`1000-${String(t).padStart(4, "0")}`] = { num: `1000-${String(t).padStart(4, "0")}` };
  }
  let calls = 0;                             // первые попытки метят в занятый префикс 1000
  const rngMixed = () => (calls++ < 2 ? 0.0001 : 0.5);
  const d = M.addDevice(st, {}, rngMixed);
  assert.equal(st.devices[d.num].num, d.num);
  assert.equal(d.num.startsWith("1000-"), false, "выдан уже занятый номер");
});

test("старые семизначные номера продолжают работать", () => {
  const st = M.blankState();
  const old = M.addDevice(st, { num: "555-0142", owner: "u1" });
  const fresh = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, old.num, fresh.num, "проверка", 1000);
  assert.equal(M.thread(st, old.num, fresh.num).length, 1);
  assert.equal(M.ownsDevice(st, "u1", "555-0142"), true);
});

test("владение устройством проверяется по владельцу", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "userA" });
  assert.equal(M.ownsDevice(st, "userA", a.num), true);
  assert.equal(M.ownsDevice(st, "userB", a.num), false);
});

test("ключ треда не зависит от направления", () => {
  assert.equal(M.threadKey("300-0001", "900-0002"), M.threadKey("900-0002", "300-0001"));
});

test("переписка копится и читается с обеих сторон", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, a.num, b.num, "жду у Клауда", 1000);
  M.pushMessage(st, b.num, a.num, "буду через час", 2000);
  assert.equal(M.thread(st, a.num, b.num).length, 2);
  assert.equal(M.thread(st, b.num, a.num).length, 2);
});

test("непрочитанное считается только для входящих и сбрасывается", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, b.num, a.num, "первое", 1000);
  M.pushMessage(st, b.num, a.num, "второе", 2000);
  M.pushMessage(st, a.num, b.num, "своё", 3000);
  assert.equal(M.unreadCount(st, a.num, b.num), 2, "у получателя два непрочитанных");
  assert.equal(M.unreadCount(st, b.num, a.num), 1, "у отправителя одно входящее");
  M.markRead(st, a.num, b.num, 2500);
  assert.equal(M.unreadCount(st, a.num, b.num), 0);
});

test("незнакомый номер остаётся номером, записанный — именем", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  assert.equal(M.contactLabel(st, a.num, b.num), b.num);
  M.setBookName(st, a.num, b.num, "Ласточка");
  assert.equal(M.contactLabel(st, a.num, b.num), "Ласточка");
  M.setBookName(st, a.num, b.num, "   ");
  assert.equal(M.contactLabel(st, a.num, b.num), b.num, "пустое имя стирает запись");
});

test("адресная книга у каждого устройства своя", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  const c = M.addDevice(st, { owner: "u3" });
  M.setBookName(st, a.num, c.num, "Каптёр");
  assert.equal(M.bookName(st, b.num, c.num), "", "чужая книга не видит запись");
});

test("список собеседников сортируется по свежести и включает записанных", () => {
  const st = M.blankState();
  const me = M.addDevice(st, { owner: "u1" });
  const x = M.addDevice(st, { owner: "u2" });
  const y = M.addDevice(st, { owner: "u3" });
  const z = M.addDevice(st, { owner: "u4" });
  M.pushMessage(st, x.num, me.num, "раз", 1000);
  M.pushMessage(st, y.num, me.num, "два", 5000);
  M.setBookName(st, me.num, z.num, "Норма");

  const list = M.contactsFor(st, me.num);
  assert.equal(list[0].num, y.num, "свежая переписка сверху");
  assert.equal(list[1].num, x.num);
  assert.ok(list.some(c => c.num === z.num), "контакт из книги без переписки тоже в списке");
  assert.equal(list.some(c => c.num === me.num), false, "себя в списке быть не должно");
});

test("внутренний агент без хирона проговаривает всё вслух", () => {
  const st = M.blankState();
  const pocket = M.addDevice(st, { kind: M.KIND.POCKET, owner: "u1" });
  const inner = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u1", audioOnly: true });
  const withChyron = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u2", audioOnly: false });
  assert.equal(M.speaksAloud(st.devices[pocket.num]), false);
  assert.equal(M.speaksAloud(st.devices[inner.num]), true);
  assert.equal(M.speaksAloud(st.devices[withChyron.num]), false, "с хироном вслух не читает");
});

test("надиктованное с безхиронного помечается как прозвучавшее", () => {
  const st = M.blankState();
  const inner = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u1", audioOnly: true });
  const pocket = M.addDevice(st, { kind: M.KIND.POCKET, owner: "u2" });

  const spoken = M.pushMessage(st, inner.num, pocket.num, "встречаемся у Клауда", 1000);
  const silent = M.pushMessage(st, pocket.num, inner.num, "понял", 2000);
  assert.equal(spoken.a, 1, "надиктованное вслух должно быть помечено");
  assert.equal(silent.a, undefined, "с карманного метки быть не должно");
});

test("внутренний агент писать умеет — запрета на текст нет", () => {
  const st = M.blankState();
  const inner = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u1", audioOnly: true });
  const other = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, inner.num, other.num, "продиктовано голосом", 1000);
  assert.equal(M.thread(st, inner.num, other.num).length, 1);
});

test("вживлённый агент нельзя передать, карманный можно", () => {
  const st = M.blankState();
  const pocket = M.addDevice(st, { kind: M.KIND.POCKET, owner: "u1" });
  const inner = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u1" });

  assert.equal(M.canTransfer(st.devices[pocket.num]), true);
  assert.equal(M.canTransfer(st.devices[inner.num]), false);

  M.transferDevice(st, pocket.num, "u2");
  assert.equal(st.devices[pocket.num].owner, "u2");

  assert.throws(() => M.transferDevice(st, inner.num, "u2"), /нельзя передать/);
  assert.equal(st.devices[inner.num].owner, "u1", "владелец не должен смениться");
});

test("переназначение вживлённого на того же владельца не ошибка", () => {
  const st = M.blankState();
  const inner = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u1" });
  assert.doesNotThrow(() => M.transferDevice(st, inner.num, "u1"));
});

test("вживлённый агент мастер всё же может удалить", () => {
  const st = M.blankState();
  const inner = M.addDevice(st, { kind: M.KIND.INTERNAL, owner: "u1" });
  const other = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, inner.num, other.num, "…", 1000);
  M.removeDevice(st, inner.num);
  assert.equal(st.devices[inner.num], undefined);
  assert.equal(Object.keys(st.threads).length, 0);
});

test("флаг «только звук» игнорируется для карманного агента", () => {
  const st = M.blankState();
  const d = M.addDevice(st, { kind: M.KIND.POCKET, audioOnly: true });
  assert.equal(d.audioOnly, false);
});

test("передача устройства меняет владельца, переписка остаётся", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, b.num, a.num, "компромат", 1000);
  M.transferDevice(st, a.num, "u3");
  assert.equal(st.devices[a.num].owner, "u3");
  assert.equal(M.thread(st, a.num, b.num).length, 1, "новый владелец читает старую переписку");
});

test("изъятие устройства уносит его переписку и отметки", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, a.num, b.num, "стереть", 1000);
  M.markRead(st, a.num, b.num, 1000);
  M.removeDevice(st, a.num);
  assert.equal(st.devices[a.num], undefined);
  assert.equal(Object.keys(st.threads).length, 0);
  assert.equal(Object.keys(st.read).length, 0);
});

test("изъятие снимает отметки о прочтении с обеих сторон", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, a.num, b.num, "привет", 1000);
  M.markRead(st, a.num, b.num, 1100);   // отметка со стороны A
  M.markRead(st, b.num, a.num, 1200);   // и со стороны B
  M.removeDevice(st, a.num);
  assert.equal(Object.keys(st.read).length, 0,
    `осталась отметка: ${Object.keys(st.read).join(", ")}`);
});

test("prune убирает ссылки на несуществующие устройства", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  st.read[`${a.num}|9999-0000`] = 123;      // собеседника уже нет
  st.threads[`${a.num}|9999-0000`] = [{ f: a.num, t: "9999-0000", x: "…", ts: 1 }];
  st.devices[a.num].book["9999-0000"] = "Призрак";

  const removed = M.prune(st);
  assert.equal(removed, 3);
  assert.deepEqual(st.read, {});
  assert.deepEqual(st.threads, {});
  assert.deepEqual(st.devices[a.num].book, {});
});

test("prune не трогает исправное состояние", () => {
  const st = M.blankState();
  const a = M.addDevice(st, { owner: "u1" });
  const b = M.addDevice(st, { owner: "u2" });
  M.pushMessage(st, a.num, b.num, "цело", 1000);
  M.setBookName(st, a.num, b.num, "Ласточка");
  M.markRead(st, a.num, b.num, 1100);
  assert.equal(M.prune(st), 0);
  assert.equal(M.thread(st, a.num, b.num).length, 1);
});

test("normalize чинит битое состояние", () => {
  const st = M.normalize(null);
  assert.deepEqual(st, { v: 1, devices: {}, threads: {}, read: {} });
  const half = M.normalize({ devices: { "300-0001": {} } });
  assert.deepEqual(half.threads, {});
});

test("сводка переписок для перехвата отсортирована по свежести", () => {
  const st = M.blankState();
  const a = M.addDevice(st, {});
  const b = M.addDevice(st, {});
  const c = M.addDevice(st, {});
  M.pushMessage(st, a.num, b.num, "старое", 1000);
  M.pushMessage(st, a.num, c.num, "новое", 9000);
  const all = M.allThreads(st);
  assert.equal(all.length, 2);
  assert.equal(all[0].preview, "новое");
});

/* ------------------------------- деньги и помехи (слияние с Holophone) ---- */

test("сумма перевода запоминается в сообщении", () => {
  const st = M.blankState();
  const a = M.addDevice(st, {});
  const b = M.addDevice(st, {});
  const msg = M.pushMessage(st, a.num, b.num, "[перевод] 500 эдди", 1000, { eb: 500 });
  assert.equal(msg.eb, 500);
  const plain = M.pushMessage(st, a.num, b.num, "просто текст", 1001);
  assert.equal("eb" in plain, false, "обычное сообщение не должно нести сумму");
});

test("порча текста бережёт пробелы и длину", () => {
  const rng = seeded(3);
  const src = "встреча у Тотентанца в полночь";
  const out = M.garble(src, 1, rng);
  assert.equal(out.length, src.length);
  for (let i = 0; i < src.length; i++) {
    if (/\s/.test(src[i])) assert.equal(out[i], src[i], "пробел сдвинулся");
  }
  assert.notEqual(out, src, "при доле 1 текст обязан измениться");
});

test("порча с долей 0 ничего не трогает", () => {
  assert.equal(M.garble("чистый текст", 0, seeded(5)), "чистый текст");
});

test("испорченное сообщение восстанавливается дословно", () => {
  const st = M.blankState();
  const a = M.addDevice(st, {});
  const b = M.addDevice(st, {});
  M.pushMessage(st, a.num, b.num, "координаты сброса", 1000);
  const spoiled = M.corruptMessage(st, a.num, b.num, 0, 1, seeded(11));
  assert.equal(spoiled.c, 1);
  assert.notEqual(spoiled.x, "координаты сброса");
  assert.equal(spoiled.o, "координаты сброса", "исходник обязан сохраниться");

  const back = M.restoreMessage(st, a.num, b.num, 0);
  assert.equal(back.x, "координаты сброса");
  assert.equal("o" in back, false);
  assert.equal("c" in back, false);
});

test("повторная порча идёт от исходника, а не от уже испорченного", () => {
  const st = M.blankState();
  const a = M.addDevice(st, {});
  const b = M.addDevice(st, {});
  M.pushMessage(st, a.num, b.num, "точка входа", 1000);
  M.corruptMessage(st, a.num, b.num, 0, 1, seeded(2));
  const twice = M.corruptMessage(st, a.num, b.num, 0, 0, seeded(2));
  assert.equal(twice.x, "точка входа", "при доле 0 должен вернуться исходный текст");
});

test("картинка хранится путём, а не содержимым", () => {
  const st = M.blankState();
  const a = M.addDevice(st, {}, seeded(1)).num;
  const b = M.addDevice(st, {}, seeded(2)).num;

  const msg = M.pushMessage(st, a, b, "смотри", 1000, { img: "worlds/w/night-city-agent/a.webp" });
  assert.equal(msg.p, "worlds/w/night-city-agent/a.webp");
  // Содержимого в состоянии быть не должно: оно уходит каждому клиенту целиком.
  assert.ok(!JSON.stringify(st).includes("base64"));

  // Картинку можно послать и без подписи.
  const bare = M.pushMessage(st, a, b, "", 1001, { img: "worlds/w/night-city-agent/b.webp" });
  assert.equal(bare.x, "");
  assert.equal(bare.p, "worlds/w/night-city-agent/b.webp");

  // А обычное сообщение поля картинки не получает вовсе.
  const plain = M.pushMessage(st, a, b, "просто текст", 1002);
  assert.equal(plain.p, undefined);
  // Пустая строка вместо пути — тоже не картинка.
  assert.equal(M.pushMessage(st, a, b, "x", 1003, { img: "" }).p, undefined);

  // Четыре: с подписью, без подписи, обычное и то, где путь пустой.
  assert.equal(M.thread(st, a, b).length, 4);
});

test("список используемых картинок собирается по всем перепискам", () => {
  const st = M.blankState();
  const a = M.addDevice(st, {}, seeded(1)).num;
  const b = M.addDevice(st, {}, seeded(2)).num;
  const c = M.addDevice(st, {}, seeded(3)).num;

  M.pushMessage(st, a, b, "", 1, { img: "worlds/w/night-city-agent/one.webp" });
  M.pushMessage(st, a, b, "текст", 2);
  // Одну и ту же картинку могли переслать дальше — она нужна обеим перепискам.
  M.pushMessage(st, a, c, "", 3, { img: "worlds/w/night-city-agent/one.webp" });
  M.pushMessage(st, b, c, "", 4, { img: "worlds/w/night-city-agent/two.png" });

  const used = M.usedImages(st);
  assert.equal(used.size, 2);
  assert.ok(used.has("worlds/w/night-city-agent/one.webp"));
  assert.ok(used.has("worlds/w/night-city-agent/two.png"));

  // Изъятие устройства уносит его переписки — и картинка перестаёт быть нужной.
  M.removeDevice(st, b);
  const after = M.usedImages(st);
  assert.ok(after.has("worlds/w/night-city-agent/one.webp"), "переписка a-c уцелела");
  assert.ok(!after.has("worlds/w/night-city-agent/two.png"), "картинка из b-c осиротела");

  assert.equal(M.usedImages(M.blankState()).size, 0);
  assert.equal(M.usedImages(undefined).size, 0);
});

test("картинка не пропадает из превью списков", () => {
  // Раньше превью брало текст сообщения как есть. У картинки без подписи текста
  // нет вовсе, и строка в списке контактов и в перехвате у мастера молчала —
  // сообщение было, а по списку этого было не понять.
  assert.equal(M.previewOf(undefined), "");
  assert.equal(M.previewOf({ x: "привет" }), "привет");
  assert.equal(M.previewOf({ x: "", p: "worlds/w/night-city-agent/a.webp" }), "[картинка]");
  assert.equal(M.previewOf({ x: "смотри", p: "worlds/w/night-city-agent/a.webp" }),
    "[картинка] смотри");

  const st = M.blankState();
  const a = M.addDevice(st, {}, seeded(11)).num;
  const b = M.addDevice(st, {}, seeded(12)).num;
  M.pushMessage(st, a, b, "", 5, { img: "worlds/w/night-city-agent/a.webp" });

  // Список контактов у владельца.
  const contact = M.contactsFor(st, a).find(c => c.num === b);
  assert.equal(contact.preview, "[картинка]");

  // Перехват у мастера.
  const thread = M.allThreads(st)[0];
  assert.equal(thread.preview, "[картинка]");

  // Обычное сообщение поверх — превью снова текстовое.
  M.pushMessage(st, b, a, "ага", 6);
  assert.equal(M.allThreads(st)[0].preview, "ага");
});

console.log(`\n${passed} проверок пройдено`);
