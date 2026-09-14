/** AES-GCM storage. The recovery key never enters a Foundry setting or socket. */
const bytesTo64 = bytes => btoa(String.fromCharCode(...bytes));
const from64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export const newRecoveryKey = () => bytesTo64(crypto.getRandomValues(new Uint8Array(32)));
async function keyFor(secret) {
  if (!crypto.subtle) throw Error('Для защиты данных откройте Foundry мастером через localhost или HTTPS.');
  const raw = from64(secret);
  if (raw.length !== 32) throw Error('Некорректный ключ восстановления');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), data));
  // Chunk conversion avoids stack overflow on a long campaign's history.
  let encoded = ''; for (let i = 0; i < cipher.length; i += 16384) encoded += String.fromCharCode(...cipher.subarray(i, i + 16384));
  return { format: 'nca-vault-1', iv: bytesTo64(iv), data: btoa(encoded) };
}
export async function unseal(envelope, secret) {
  if (envelope?.format !== 'nca-vault-1') throw Error('Неизвестный формат хранилища');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(envelope.iv) }, await keyFor(secret), from64(envelope.data));
  return JSON.parse(new TextDecoder().decode(data));
}
