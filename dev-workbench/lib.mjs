export const STORE_KEY = 'foundry-workbench-demo-v1';
export function cleanMessage(value) {
  if (typeof value !== 'string') throw new TypeError('Message must be a string');
  const text = value.trim();
  if (!text) throw new Error('Введите сообщение');
  if (text.length > 2000) throw new Error('Максимум 2000 символов');
  return text;
}
export function motionDuration(mode, reduced = false) {
  if (reduced || mode === 'off') return 0;
  return mode === 'cinematic' ? 380 : 160;
}
export function readMessages(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORE_KEY) || '[]');
    return Array.isArray(data) ? data.filter(x => typeof x === 'string' && x.length <= 2000).slice(-50) : [];
  } catch { return []; }
}
export function appendMessage(storage, text) {
  const messages = [...readMessages(storage), cleanMessage(text)].slice(-50);
  storage.setItem(STORE_KEY, JSON.stringify(messages));
  return messages;
}
export function manifestProblems(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') return ['Манифест должен быть объектом'];
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) issues.push('Некорректный id');
  if (typeof manifest.version !== 'string' || !manifest.version) issues.push('Нет версии');
  if (String(manifest.compatibility?.minimum || '').split('.')[0] !== '12') issues.push('minimum не соответствует целевой Foundry v12');
  for (const key of ['scripts', 'esmodules', 'styles']) {
    const entries = manifest[key] ?? [];
    if (!Array.isArray(entries)) { issues.push(`${key} должен быть массивом`); continue; }
    for (const p of entries) {
      if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..') || p.includes('\\') || /^[a-z]+:/i.test(p)) issues.push(`Небезопасный путь: ${String(p)}`);
    }
  }
  return issues;
}
