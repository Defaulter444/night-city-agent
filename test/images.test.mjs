/**
 * Тесты проверок картинок. Запуск: node test/images.test.mjs
 *
 * Проверяется то, что делает мастер, принимая картинку от игрока: тип, размер,
 * имя файла. Верить присланному нельзя — оно приходит из чужого браузера, и
 * подделать в нём можно всё, включая заявленный тип.
 */
import assert from "node:assert/strict";
import * as Img from "../scripts/images.mjs";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/** Картинка нужного размера: тело base64 из повторяющегося куска. */
function fakeImage(type, bytes) {
  const chars = Math.ceil(bytes / 3) * 4;
  return `data:${type};base64,${"A".repeat(chars)}`;
}

test("data-URL разбирается на тип и тело", () => {
  const parsed = Img.parseDataUrl("data:image/png;base64,AAAA");
  assert.equal(parsed.type, "image/png");
  assert.equal(parsed.base64, "AAAA");
});

test("не-картинка опознаётся, а не падает", () => {
  for (const junk of ["", null, undefined, "просто текст", "http://example.com/a.png",
                      "data:text/html;base64,AAAA<script>"]) {
    assert.equal(Img.imageIssue(junk), "Это не картинка", `принято: ${junk}`);
  }
});

test("размер считается по длине base64, без раскодирования", () => {
  assert.equal(Img.base64Bytes("AAAA"), 3);
  assert.equal(Img.base64Bytes("AAA="), 2);
  assert.equal(Img.base64Bytes("AA=="), 1);
  assert.equal(Img.base64Bytes(""), 0);
});

test("принимаются только знакомые форматы", () => {
  for (const type of Img.ALLOWED_TYPES) {
    assert.equal(Img.imageIssue(fakeImage(type, 1000)), null, type);
  }
  // svg не принимаем намеренно: это документ со скриптами, а не картинка.
  for (const type of ["image/svg+xml", "image/bmp", "image/tiff"]) {
    const issue = Img.imageIssue(fakeImage(type, 1000));
    assert.ok(issue?.includes(type), `${type} принят`);
  }
});

test("слишком тяжёлая картинка отклоняется", () => {
  const big = fakeImage("image/png", Img.MAX_BYTES + 1024);
  assert.match(Img.imageIssue(big), /тяжелее/);
  // На границе — принимаем: отказывать ровно в потолок было бы придиркой.
  assert.equal(Img.imageIssue(fakeImage("image/png", Img.MAX_BYTES - 10)), null);
});

test("пустой файл отклоняется", () => {
  assert.equal(Img.imageIssue("data:image/png;base64,"), "Это не картинка");
});

test("имя файла собирается своё, а не берётся у отправителя", () => {
  const name = Img.imageFileName("2137-5581", "image/webp", Date.UTC(2045, 0, 2, 3, 4, 5), () => 0.5);
  assert.match(name, /^2137-5581_2045-01-02T03-04-05_[0-9a-z]+\.webp$/);
});

test("в имени файла не остаётся ничего опасного", () => {
  // Номер приходит из состояния, но проверка дешевле доверия: путь наружу
  // папки мира не должен собираться в принципе.
  const name = Img.imageFileName("../../etc/passwd", "image/png", 0, () => 0);
  assert.ok(!name.includes("/"), name);
  assert.ok(!name.includes(".."), name);
  assert.match(name, /\.png$/);
});

test("два отправления в одну секунду не перетирают друг друга", () => {
  const now = Date.now();
  let n = 0;
  const rng = () => (n++ ? 0.9 : 0.1);
  const a = Img.imageFileName("1111-2222", "image/png", now, rng);
  const b = Img.imageFileName("1111-2222", "image/png", now, rng);
  assert.notEqual(a, b);
});

test("расширение соответствует типу", () => {
  const pairs = [
    ["image/png", "png"], ["image/jpeg", "jpg"],
    ["image/webp", "webp"], ["image/gif", "gif"]
  ];
  for (const [type, ext] of pairs) {
    assert.ok(Img.imageFileName("1-2", type, 0, () => 0).endsWith(`.${ext}`), type);
  }
});

test("картинки лежат внутри мира, а не в общем разделе", () => {
  const folder = Img.imageFolder("night-city");
  assert.equal(folder, "worlds/night-city/night-city-agent");
  assert.ok(folder.startsWith("worlds/"), folder);
});

console.log(`\nПройдено проверок: ${passed}`);
