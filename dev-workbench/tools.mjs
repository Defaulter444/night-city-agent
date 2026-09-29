import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { manifestProblems } from './lib.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(root, '.tools');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packages = { codex: '@openai/codex', gemini: '@google/gemini-cli', claude: '@anthropic-ai/claude-code', playwright: '@playwright/mcp', devtools: 'chrome-devtools-mcp' };
function command(exe, args, options = {}) {
  const r = spawnSync(exe, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && exe.endsWith('.cmd'), ...options });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${exe}: exit ${r.status}`);
}
function toolsPackage(name) {
  const dir = path.join(toolsDir, 'node_modules', packages[name]);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin ?? {})[0];
  if (!bin) throw new Error(`Нет исполняемого файла ${name}`);
  return { manifest, entry: path.resolve(dir, bin) };
}
async function runTool(name, args) {
  if (!packages[name]) throw new Error('Выберите codex, gemini, claude, playwright или devtools');
  let entry;
  try { ({ entry } = toolsPackage(name)); }
  catch { throw new Error('Сначала выполните: node tools.mjs setup --ai'); }
  if (name === 'playwright' || name === 'devtools') {
    const { chromium } = await import('@playwright/test');
    const executable = name === 'devtools' && process.env.FWB_CHROME_PATH ? process.env.FWB_CHROME_PATH : chromium.executablePath();
    if (!fs.existsSync(executable)) throw new Error('Установите Chromium: npx playwright install chromium');
    args = name === 'playwright'
      ? ['--headless', '--isolated', '--executable-path', executable, ...args]
      : ['--headless', '--isolated', '--executablePath', executable, '--no-usage-statistics', '--no-performance-crux', ...args];
  }
  const js = /\.[cm]?js$/.test(entry);
  const child = spawn(js ? process.execPath : entry, js ? [entry, ...args] : args, { cwd: root, stdio: 'inherit' });
  child.on('error', e => { console.error(e.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
function serve() {
  const types = { '/': ['index.html','text/html; charset=utf-8'], '/index.html': ['index.html','text/html; charset=utf-8'], '/app.mjs': ['app.mjs','text/javascript'], '/lib.mjs': ['lib.mjs','text/javascript'], '/style.css': ['style.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const item = types[new URL(req.url, 'http://localhost').pathname];
    if (!item) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end(); else res.end(fs.readFileSync(path.join(root, item[0])));
  });
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  server.listen(4173, '127.0.0.1', () => console.log('UI preview: http://127.0.0.1:4173 (demo only; no Foundry server)'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
}
function audit(dir) {
  const base = fs.realpathSync(path.resolve(dir));
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'module.json'), 'utf8'));
  const issues = manifestProblems(manifest);
  if (!issues.length) for (const rel of [...(manifest.scripts || []), ...(manifest.esmodules || []), ...(manifest.styles || [])]) {
    const target = path.join(base, rel);
    if (!fs.existsSync(target)) { issues.push(`Файл не найден: ${rel}`); continue; }
    const real = fs.realpathSync(target);
    if (!real.startsWith(base + path.sep)) issues.push(`Ссылка за пределы модуля: ${rel}`);
  }
  console.log(JSON.stringify({ directory: base, id: manifest.id, version: manifest.version, issues, note: 'Статическая проверка. Не подтверждает работу в Foundry.' }, null, 2));
  if (issues.length) process.exitCode = 1;
}
async function main() {
  const [action = 'doctor', ...args] = process.argv.slice(2);
  if (action === 'serve') return serve();
  if (action === 'run') return runTool(args[0], args.slice(1));
  if (action === 'audit') {
    if (!args[0]) throw new Error('Путь обязателен: npm run audit:module -- ../');
    return audit(args[0]);
  }
  if (action === 'setup') {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 12)) throw new Error('Нужен Node.js 22.12+');
    command(npm, [fs.existsSync(path.join(root, 'package-lock.json')) ? 'ci' : 'install', '--no-fund']);
    if (args.includes('--ai')) {
      fs.mkdirSync(toolsDir, { recursive: true });
      const pkg = path.join(toolsDir, 'package.json');
      if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: 'private-ai-tools', version: '1.0.0', private: true }, null, 2));
      if (fs.existsSync(path.join(toolsDir, 'package-lock.json'))) command(npm, ['ci', '--prefix', toolsDir, '--no-fund']);
      else command(npm, ['install', '--prefix', toolsDir, '--save-exact', '--no-fund', ...Object.values(packages)]);
    }
    if (args.includes('--browser')) {
      const cli = path.join(root, 'node_modules', 'playwright', 'cli.js');
      const inContainer = !!process.env.CODESPACES || fs.existsSync('/.dockerenv');
      command(process.execPath, [cli, 'install', ...(inContainer && process.platform === 'linux' ? ['--with-deps'] : []), 'chromium']);
    }
    console.log('Пакеты установлены. Вход в аккаунты НЕ выполнен. Выполните npm run doctor.');
    return;
  }
  if (action === 'doctor') {
    console.log(`Node: ${process.versions.node}\nWorkspace: ${root}`);
    for (const p of ['vite','vitest','eslint','@playwright/test','animejs','lucide']) console.log(`${p}: ${fs.existsSync(path.join(root, 'node_modules', p)) ? 'installed' : 'not installed'}`);
    for (const name of Object.keys(packages)) {
      try { const x = toolsPackage(name); console.log(`${name}: ${x.manifest.version} (authentication NOT checked)`); }
      catch { console.log(`${name}: not installed`); }
    }
    console.log('Foundry server, license, worlds and account limits: NOT configured or changed.');
    return;
  }
  if (action === 'repos') {
    const repos = JSON.parse(fs.readFileSync(path.join(root, 'repos.json'), 'utf8'));
    const selected = args.length ? repos.filter(r => args.includes(r.name)) : repos;
    for (const name of args) if (!repos.some(r => r.name === name)) throw new Error(`Неизвестный репозиторий: ${name}`);
    fs.mkdirSync(path.join(root, 'repos'), { recursive: true });
    for (const r of selected) {
      if (![r.owner, r.name].every(x => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(x))) throw new Error('Некорректное имя репозитория');
      const dest = path.join(root, 'repos', r.name);
      if (fs.existsSync(dest)) { console.log(`Пропущен существующий каталог: ${r.name}; reset/pull не выполнялись`); continue; }
      command('git', ['clone', '--depth', '1', '--branch', r.branch, `https://github.com/${r.owner}/${r.name}.git`, dest]);
      command('git', ['-C', dest, 'rev-parse', 'HEAD']);
    }
    return;
  }
  throw new Error('Команды: setup [--ai --browser], doctor, serve, repos [name], audit <path>, run <tool>');
}
main().catch(e => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; });
