import { readState } from './store.mjs';
import { contactsFor } from './model.mjs';
import { uid } from './documents-model.mjs';
import { mailingRecipients, MAX_MAILING_RECIPIENTS } from './mailing-model.mjs';
import { sendMailing } from './socket.mjs';
import { inputDialog } from './workspace-app.mjs';
import { esc } from './clock.mjs';

export async function mailingDialog(from, selected = null) {
  const state = readState(), device = state.devices[from];
  if (!device) throw Error('Сначала выберите свой Агент');
  const contacts = game.user.isGM
    ? Object.values(state.devices).filter(d => d.num !== from).map(d => ({ num: d.num, name: device.book?.[d.num] || d.label || d.num }))
    : contactsFor(state, from).filter(c => c.num !== from && state.devices[c.num]);
  const choices = contacts.map(c => `<label class="nca-member-choice"><input type="checkbox" name="recipients" value="${esc(c.num)}" ${c.num === selected ? 'checked' : ''}><span>${esc(c.name)}<small>${esc(c.num)}</small></span></label>`).join('');
  let attempt;
  return inputDialog('Рассылка сообщения',
    `<p class="hint">С номера ${esc(from)} · до ${MAX_MAILING_RECIPIENTS} получателей. Каждый получит отдельное личное сообщение и ответит только вам.</p>
    <label>Сообщение<textarea name="text" rows="4" maxlength="2000" required placeholder="Текст для всех получателей…"></textarea></label>
    <fieldset class="nca-member-picker nca-mailing-picker"><legend>Получатели</legend>${choices || '<p class="hint">Контактов пока нет. Введите номера ниже.</p>'}</fieldset>
    <label>Дополнительные номера<input name="numbers" maxlength="1000" placeholder="2137-5581, 2137-5582"></label>
    <p class="hint">Разделяйте номера запятой или точкой с запятой. Повторяющиеся номера получат одно сообщение.</p>`,
    async fd => {
      const extra = String(fd.get('numbers') ?? '').split(/[,;\r\n]+/).map(s => s.trim()).filter(Boolean);
      const recipients = mailingRecipients([...fd.getAll('recipients'), ...extra]);
      const text = String(fd.get('text') ?? '').trim();
      const signature = JSON.stringify({ from, recipients, text });
      if (attempt?.signature !== signature) attempt = { signature, id: uid() };
      return sendMailing(from, recipients, text, attempt.id);
    }, { saveLabel: 'Отправить' });
}
