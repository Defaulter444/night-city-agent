/** Голо-вызов (из Night City Map, Verlierboy, с разрешения автора): входящий вызов Агента всплывает поверх
 * экрана с портретом и номером звонящего. Ответ идёт обычной операцией callReply; разговор — в голосовом чате. */
import { isNPCDevice } from './incoming.mjs';

const MODULE_ID = 'night-city-agent';
const ROOT_ID = 'nca-holo-call';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Calls waiting for this viewer: players answer on their own devices, the GM answers for NPC devices. Oldest first. */
export function waitingCalls(state, user, users) {
  if (!state?.os?.calls || !user) return [];
  const result = [];
  for (const call of Object.values(state.os.calls)) {
    if (!call || call.status === 'ended') continue;
    for (const number of call.members ?? []) {
      if (number === call.from || call.replies?.[number] !== 'invited') continue;
      const device = state.devices?.[number];
      if (!device || !(device.owner === user.id || (user.isGM && isNPCDevice(device, users)))) continue;
      const profile = state.os.profiles?.[call.from] ?? {};
      result.push({
        id: call.id, number, from: call.from, createdAt: call.createdAt ?? 0, group: call.members.length > 2,
        name: device.book?.[call.from] || profile.name || state.devices?.[call.from]?.label || call.from,
        role: profile.role || '', target: device.label || number,
        avatar: state.os.contacts?.[number]?.[call.from]?.avatar || profile.avatar || ''
      });
    }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt);
}

export function holoCallEnabled() {
  try { return game.settings.get(MODULE_ID, 'holoCall') !== false; } catch { return true; }
}

/** Renders or removes the overlay; safe to call on every Agent update. */
export function renderHoloCall({ readState, answer, open } = {}) {
  const calls = holoCallEnabled() ? waitingCalls(readState?.(), game.user, game.users) : [];
  let root = document.getElementById(ROOT_ID);
  if (!calls.length) { root?.remove(); return; }
  const call = calls[0], key = `${call.id}:${call.number}`;
  if (root?.dataset.key === key) { root.querySelector('[data-more]').textContent = calls.length > 1 ? `Ещё входящих: ${calls.length - 1}` : ''; return; }
  root?.remove();
  root = document.createElement('aside');
  root.id = ROOT_ID; root.dataset.key = key;
  root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-label', `Входящий голо-вызов: ${call.name}`);
  const portrait = call.avatar ? `<img src="${esc(call.avatar)}" alt="">` : `<i class="fas fa-user-secret" aria-hidden="true"></i>`;
  root.innerHTML = `<div class="nca-holo__beam" aria-hidden="true"></div>
    <div class="nca-holo__portrait">${portrait}</div>
    <div class="nca-holo__body">
      <p class="nca-holo__kicker">${call.group ? 'ГРУППОВОЙ ГОЛО-ВЫЗОВ' : 'ВХОДЯЩИЙ ГОЛО-ВЫЗОВ'} · ${esc(call.target)}</p>
      <h3>${esc(call.name)}</h3>
      <p class="nca-holo__meta">${esc(call.role ? `${call.role} · ${call.from}` : call.from)}</p>
      <div class="nca-holo__actions">
        <button type="button" data-reply="accepted"><i class="fas fa-phone"></i> Принять</button>
        <button type="button" data-reply="declined"><i class="fas fa-phone-slash"></i> Отклонить</button>
        <button type="button" data-open title="Открыть «Вызовы» в Агенте"><i class="fas fa-mobile-screen"></i></button>
      </div>
      <p class="nca-holo__more" data-more>${calls.length > 1 ? `Ещё входящих: ${calls.length - 1}` : ''}</p>
    </div>`;
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    root.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      if (button.dataset.open !== undefined) { await open?.(call); root.remove(); return; }
      await answer?.(call, button.dataset.reply);
      if (button.dataset.reply === 'accepted') await open?.(call);
    } catch (error) {
      ui.notifications.error(error?.message || 'Вызов недоступен');
      root.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  });
  document.body.append(root);
}
