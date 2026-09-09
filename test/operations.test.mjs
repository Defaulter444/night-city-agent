import assert from "node:assert/strict";
import { callREO, callTrauma, findMembership, inspectLifestyle } from "../scripts/services.mjs";
import { hasLedger, actorForUser, actorForDevice } from "../scripts/wealth.mjs";
import { registerSocket } from "../scripts/socket.mjs";
import { blankState, addDevice, transferDevice } from "../scripts/model.mjs";
import { mutate } from "../scripts/store.mjs";

const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
const gm = { id: "gm", isGM: true }, player = { id: "player", isGM: false };
const users = [gm, player]; users.get = id => users.find(u => u.id === id); users.players = [player]; users.activeGM = gm;
let cached, failRoll, failMessage, nextId = 0, messages, formulas, notifications, upload;
globalThis.foundry = {
  utils: { deepClone: structuredClone, getProperty: get, randomID: () => `receipt${++nextId}` },
  applications: {
    api: { ApplicationV2: class {}, HandlebarsApplicationMixin: x => x,
      DialogV2: { prompt: async () => ({ sum: 10, note: "test" }) } },
    apps: { FilePicker: { createDirectory: async () => {}, upload: async () => upload() } }
  }
};
globalThis.game = { user: gm, users, actors: [], modules: new Map(), world: { id: "test" },
  settings: { get: (_m, key) => key === "state" ? cached : undefined,
    set: async (_m, _key, state) => { cached = structuredClone(state); } } };
globalThis.canvas = { scene: { name: "Test" }, tokens: { controlled: [] } };
globalThis.CONST = { CHAT_MESSAGE_TYPES: { ROLL: 5 } };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; this.total = 3; }
  async evaluate() { formulas.push(this.formula); if (failRoll) throw Error("roll failed"); return this; }
};
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async data => {
  if (failMessage) throw Error("chat failed"); messages.push(data); return data;
} };
globalThis.ui = { notifications: Object.fromEntries(["warn", "info", "error"].map(kind => [kind, text => notifications.push({ kind, text })])) };
const handlers = new Map();
globalThis.socketlib = { registerModule: () => ({
  register: (name, handler) => handlers.set(name, handler),
  executeForUsers: async () => {},
  executeAsGM: async () => { throw Error("signal lost"); }
}) };
registerSocket();
const { AgentApp } = await import("../scripts/app-agent.mjs");
function actor(name, value = 100, owners = ["player"]) {
  const a = { name, id: name, uuid: `Actor.${name}`, type: "character", items: [], flags: {}, system: { wealth: { value, transactions: [] } },
    testUserPermission: u => u.isGM || owners.includes(u.id), getActiveTokens: () => [],
    async update(update) { for (const [path, value] of Object.entries(update)) {
      const parts = path.split("."); let ref = this;
      for (const part of parts.slice(0, -1)) ref = ref[part] ??= {};
      ref[parts.at(-1)] = value;
    } }
  }; return a;
}
function gear(name, flags = {}, equipped = "carried") {
  return { name, type: "gear", flags: { "night-city-agent": flags }, system: { amount: 1, equipped } };
}
const results = [];
async function test(name, fn) {
  cached = blankState(); failRoll = false; failMessage = false; messages = []; formulas = []; notifications = [];
  game.user = gm; game.actors = []; canvas.tokens.controlled = []; player.character = null;
  try { await fn(); results.push({ name, pass: true }); }
  catch (error) { process.exitCode = 1; results.push({ name, pass: false, error: error.message }); }
}
await test("REO roll failure leaves the wallet untouched", async () => {
  const a = actor("a"); failRoll = true;
  await assert.rejects(callREO(a)); assert.equal(a.system.wealth.value, 100);
  assert.equal(a.system.wealth.transactions.length, 0);
});
await test("REO chat failure refunds the fee", async () => {
  const a = actor("a"); failMessage = true;
  await assert.rejects(callREO(a)); assert.equal(a.system.wealth.value, 100);
});
await test("a completed REO call charges exactly one fee", async () => {
  const a = actor("a"); await callREO(a);
  assert.equal(a.system.wealth.value, 95); assert.equal(a.system.wealth.transactions.length, 1);
  assert.deepEqual(formulas, ["1d6+3"]); assert.equal(messages.length, 1);
});
await test("REO membership and existing lifestyle waiver remain functional", async () => {
  const a = actor("a"); a.items = [gear("renamed", { service: { service: "reo", tier: "custom" } }),
    gear("home", { lifestyle: { kind: "housing", monthly: 1000 } })];
  await callREO(a); assert.deepEqual(formulas, ["1d6+2"]); assert.equal(a.system.wealth.value, 100);
  assert.equal(inspectLifestyle(a).totalMonthly, 1000);
});
await test("Trauma Team rolls 1d6 for a carried renamed tagged membership", async () => {
  const a = actor("a"); a.items = [gear("renamed", { service: { service: "trauma", tier: "Silver", monthly: 500 } })];
  await callTrauma(a); assert.deepEqual(formulas, ["1d6"]); assert.equal(a.system.wealth.value, 100);
  assert.equal(findMembership(a, "trauma").tier, "Silver");
});
await test("stored and depleted memberships do not authorize a Trauma call", async () => {
  const a = actor("a"); const x = gear("x", { service: { service: "trauma" } }, "stored");
  const y = gear("y", { service: { service: "trauma" } }); y.system.amount = 0; a.items = [x, y];
  await assert.rejects(callTrauma(a)); assert.equal(formulas.length, 0);
});
await test("missing and malformed wealth is not a zero balance", async () => {
  for (const value of [null, undefined, "", " ", false, NaN, Infinity]) {
    const a = actor("a"); a.system.wealth.value = value;
    assert.equal(hasLedger(a), false, String(value));
  }
  for (const value of [0, "0", 150]) assert.equal(hasLedger(actor("a", value)), true);
});
await test("ambiguous owned characters do not select an arbitrary wallet", async () => {
  const a = actor("a"), b = actor("b"); game.actors = [a, b];
  assert.equal(actorForUser("player"), null);
  canvas.tokens.controlled = [{ actor: b }]; assert.equal(actorForUser("player"), b);
  player.character = a; assert.equal(actorForUser("player"), a);
});
await test("owned devices never fall back to an unrelated selected actor", async () => {
  const stranger = actor("stranger", 100, []); canvas.tokens.controlled = [{ actor: stranger }];
  assert.equal(actorForDevice({ owner: "player" }), null);
  assert.equal(actorForDevice({ owner: null }), stranger);
  game.user = player; assert.equal(actorForDevice({ owner: null }), null);
});
await test("failed transfer notification reports money sent instead of failed transfer", async () => {
  const a = actor("a"), b = actor("b"); player.character = a;
  const recipient = { id: "recipient", isGM: false, character: b }; users.push(recipient);
  addDevice(cached, { num: "1111-1111", owner: "player" }); addDevice(cached, { num: "2222-2222", owner: "recipient" });
  await AgentApp.DEFAULT_OPTIONS.actions.payEb.call({ num: "1111-1111", other: "2222-2222", render() {} });
  assert.equal(a.system.wealth.value, 90); assert.equal(b.system.wealth.value, 110);
  assert.ok(notifications.some(x => x.kind === "warn" && x.text.includes("Повторять перевод не нужно")));
  assert.ok(!notifications.some(x => x.kind === "error")); users.pop();
});
await test("upload finishing after device transfer cannot send as its previous owner", async () => {
  addDevice(cached, { num: "1111-1111", owner: "player" }); addDevice(cached, { num: "2222-2222" });
  let release, started; const uploading = new Promise(resolve => { started = resolve; });
  upload = () => { started(); return new Promise(resolve => { release = () => resolve({ path: "worlds/test/night-city-agent/test.png" }); }); };
  const pending = handlers.get("sendImage").call({ socketdata: { userId: "player" } },
    { from: "1111-1111", to: "2222-2222", image: "data:image/png;base64,aGVsbG8=", text: "pending" });
  await uploading; await mutate(s => transferDevice(s, "1111-1111", "gm")); release();
  await assert.rejects(pending, /не ваше устройство/); assert.deepEqual(cached.threads, {});
});
await test("ordinary text send preserves content and rejects a non-owner", async () => {
  addDevice(cached, { num: "1111-1111", owner: "player" }); addDevice(cached, { num: "2222-2222" });
  const send = handlers.get("send"), payload = { from: "1111-1111", to: "2222-2222", text: " сообщение " };
  await send.call({ socketdata: { userId: "player" } }, payload);
  await assert.rejects(send.call({ socketdata: { userId: "missing" } }, payload));
  assert.equal(cached.threads["1111-1111|2222-2222"].length, 1);
  assert.equal(cached.threads["1111-1111|2222-2222"][0].x, "сообщение");
});
console.log(JSON.stringify(results, null, 2));
