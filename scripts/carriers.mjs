export function isStorageItem(item, actor) {
  const names = [item.name, item.flags?.babele?.originalName].map(n => String(n ?? '').trim().toLowerCase());
  if (!item.flags?.['night-city-agent']?.dataCarrier && !names.some(n => ['memory chip','щепка памяти','чип памяти','карта памяти'].includes(n))) return false;
  if (item.type === 'gear') return Number(item.system.amount ?? 1) > 0 && ['carried','equipped'].includes(item.system.equipped);
  if (item.type === 'cyberware') return actor.items.some(i => i.system?.installedItems?.list?.includes(item.id));
  return false;
}
export function carrierAccess(doc, user) {
  if (!doc?.carriers?.length || !globalThis.game?.actors) return false;
  return game.actors.some(actor => actor.testUserPermission(user, 'OWNER') && actor.items.some(item =>
    doc.carriers.includes(item.uuid) && item.flags?.['night-city-agent']?.documents?.includes(doc.id) && isStorageItem(item, actor)));
}
