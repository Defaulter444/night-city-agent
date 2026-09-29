import { appendMessage, readMessages, motionDuration, STORE_KEY } from './lib.mjs';
const $ = selector => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let timer;
function animate(element) {
  const duration = motionDuration($('#motion').value, reduced.matches);
  if (duration && typeof element.animate === 'function') element.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration, easing: 'ease-out' });
}
function notify(text) {
  clearTimeout(timer); $('#toast').textContent = text; animate($('#toast'));
  timer = setTimeout(() => { $('#toast').textContent = ''; }, 2400);
}
function render() {
  const messages = $('#messages'); messages.replaceChildren();
  const first = document.createElement('div'); first.className = 'message'; first.textContent = 'Найтлайт: канал открыт. Проверим новый интерфейс?'; messages.append(first);
  for (const text of readMessages(localStorage)) {
    const bubble = document.createElement('div'); bubble.className = 'message self'; bubble.textContent = text; messages.append(bubble);
  }
  messages.scrollTop = messages.scrollHeight;
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b === button));
  for (const panel of document.querySelectorAll('main > section')) { panel.hidden = panel.id !== button.dataset.tab; if (!panel.hidden) animate(panel); }
});
$('#message-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    appendMessage(localStorage, $('#message').value); $('#message').value = ''; $('#form-error').textContent = '';
    render(); animate($('#messages').lastElementChild); notify('Тестовое сообщение сохранено'); $('#message').focus();
  } catch (e) { $('#form-error').textContent = e.message; }
});
$('#scan').addEventListener('click', () => {
  const node = $('#net-node'); node.classList.remove('unknown'); node.textContent = 'ФАЙЛ / ДОСТУПЕН';
  const detail = document.createElement('small'); detail.textContent = 'Состояние тестового узла раскрыто'; node.append(detail); animate(node); notify('Узел раскрыт — демонстрация');
});
$('#event').addEventListener('click', () => {
  $('#events-count').textContent = String(Number($('#events-count').textContent) + 1); animate($('#events-count')); notify('Добавлено тестовое событие');
});
$('#clear').addEventListener('click', () => { localStorage.removeItem(STORE_KEY); render(); notify('Очищены только сообщения этого стенда'); });
$('#motion').addEventListener('change', () => {
  for (const animation of document.getAnimations()) animation.cancel();
  notify(reduced.matches ? 'Системная настройка запрещает анимации' : 'Режим анимации изменён');
});
reduced.addEventListener('change', event => { if (event.matches) for (const animation of document.getAnimations()) animation.cancel(); });
window.addEventListener('pagehide', () => { clearTimeout(timer); for (const animation of document.getAnimations()) animation.cancel(); });
render();
