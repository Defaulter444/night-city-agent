export function isNPCDevice(device, users) {
  return Boolean(device && (!device.owner || users.get(device.owner)?.isGM));
}
/** Called with the authenticated sender id supplied by the GM, never client-provided identity. */
export function npcIncoming(state, users, viewer, senderId, from, recipients) {
  const sender = users.get(senderId);
  if (!viewer?.isGM || !sender || sender.isGM) return [];
  return [...new Set(recipients)].filter(n => n !== from && isNPCDevice(state.devices[n], users));
}
export function incomingLabel(state, from, to) {
  const name = state.devices[to]?.book?.[from] || state.devices[from]?.label || from;
  return `Агент: ${name} (${from}) → НПС ${state.devices[to]?.label || to} (${to})`;
}
