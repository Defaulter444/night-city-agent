/**
 * Собирает night-city-agent.zip для релиза.
 *
 * Файлы берутся из git, но читаются с диска: так в архив попадает ровно то, что
 * лежит в репозитории, а черновики и временное — нет.
 *
 * Отсутствующий файл — остановка, а не пропуск. Компендиум Foundry это папка
 * LevelDB, и потеря одного файла из неё даёт базу, которая открывается как ни в
 * чём не бывало, только без части записей. Молчаливый пропуск такое прячет.
 *
 * `ls-files -z` обязателен: без него git экранирует имена с не-ASCII символами,
 * и такой файл в архив не попадёт.
 *
 *   node tools/make-release.mjs
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import zlib from "zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "night-city-agent.zip");

/** Минимальный писатель zip: тянуть зависимость ради одного архива незачем. */
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const dosTime = () => {
    const now = new Date();
    const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const date =
      (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    return { time, date };
  };

  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);
    const { time, date } = dosTime();

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Бит 11 — имена в UTF-8. Без него кириллица в путях читается как мусор.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, deflated);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + deflated.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}

/** CRC-32 на случай старой ноды без zlib.crc32. */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf-8" })
  .split("\0")
  .filter(Boolean);

const missing = files.filter((name) => !fs.existsSync(path.join(ROOT, name)));
if (missing.length) {
  console.error("Файлы числятся в репозитории, но их нет на диске:");
  for (const name of missing) console.error(`  ${name}`);
  console.error("\nСоберите пак и закоммитьте его.");
  process.exit(1);
}

if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
const zip = makeZip(files.map((name) => [name, fs.readFileSync(path.join(ROOT, name))]));
fs.writeFileSync(OUT, zip);

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf-8")).version;
console.log(`Версия ${version}: файлов ${files.length}, размер ${(zip.length / 1024).toFixed(0)} КБ`);
console.log(`Архив: ${OUT}`);
