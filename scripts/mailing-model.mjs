import { normalizeNumber, NUMBER_RE, pushMessage } from './model.mjs';

export const MAX_MAILING_RECIPIENTS = 32;
export function mailingRecipients(values) {
  if (!Array.isArray(values)) throw Error('Выберите получателей');
  const recipients = [...new Set(values.map(value => {
    if (typeof value !== 'string') throw Error('Некорректный номер получателя');
    const number = normalizeNumber(value);
    if (!NUMBER_RE.test(number)) throw Error(`«${value}» не похоже на номер Агента`);
    return number;
  }))].sort();
  if (!recipients.length || recipients.length > MAX_MAILING_RECIPIENTS) throw Error(`Выберите от 1 до ${MAX_MAILING_RECIPIENTS} получателей`);
  return recipients;
}

/** Validate the complete mailing before writing any personal thread. Called inside mutate(). */
export function createMailing(state, { from, recipients: values, text, operationId }, user, now = Date.now()) {
  if (!user || !state.devices[from] || (!user.isGM && state.devices[from].owner !== user.id)) throw Error('Это не ваше устройство');
  const recipients = mailingRecipients(values);
  if (recipients.includes(from)) throw Error('Уберите номер отправителя из получателей');
  text = String(text ?? '').trim().slice(0, 2000);
  if (!text) throw Error('Введите сообщение');
  if (typeof operationId !== 'string' || !/^[a-f0-9]{32}$/.test(operationId)) throw Error('Некорректный идентификатор рассылки');

  const previous = state.mailingReceipts?.[operationId];
  if (previous) {
    if (previous.by !== user.id || previous.from !== from || previous.text !== text || JSON.stringify(previous.recipients) !== JSON.stringify(recipients)) {
      throw Error('Эта рассылка уже отправлена с другим содержимым. Создайте новую.');
    }
    return { recipients, count: recipients.length, replayed: true };
  }
  for (const number of recipients) if (!state.devices[number]) throw Error(`Номер ${number} не отвечает. Сообщение никому не отправлено.`);

  for (const number of recipients) pushMessage(state, from, number, text, now);
  // Durable receipts survive GM reconnects and retries after a lost socket response.
  // Player projections never include this list or the other recipients of a mailing.
  (state.mailingReceipts ??= {})[operationId] = { by: user.id, from, recipients, text, ts: now };
  return { recipients, count: recipients.length, replayed: false };
}
