/**
 * Собирает CHANGELOG.md из scripts/changelog.mjs, чтобы файл и окно справки
 * не разъезжались. Запуск: node tools/build-changelog.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHANGELOG, TYPE_LABEL } from "../scripts/changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lines = [
  "# История изменений — Агент (Найт-Сити)",
  "",
  "Файл собирается из `scripts/changelog.mjs`. Правьте список там, потом запускайте",
  "`node tools/build-changelog.mjs` — руками этот файл менять не нужно.",
  ""
];

for (const release of CHANGELOG) {
  lines.push(`## ${release.version} — ${release.date}`, "");
  for (const kind of ["add", "change", "fix"]) {
    const group = release.entries.filter(e => e.type === kind);
    if (!group.length) continue;
    lines.push(`**${TYPE_LABEL[kind][0].toUpperCase()}${TYPE_LABEL[kind].slice(1)}:**`, "");
    for (const e of group) lines.push(`- ${e.text}`);
    lines.push("");
  }
}

writeFileSync(join(root, "CHANGELOG.md"), lines.join("\n"), "utf8");
console.log(`CHANGELOG.md собран, версий: ${CHANGELOG.length}`);
