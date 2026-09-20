const open = new Set();
const key = (number, id) => `${number}|${id}`;
export const isConferenceOpen = (number, id) => open.has(key(number, id));
export const openConferenceView = (number, id) => open.add(key(number, id));
export const closeConferenceView = (number, id) => open.delete(key(number, id));
