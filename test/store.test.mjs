import assert from "node:assert/strict";
import { blankState, addDevice, pushMessage } from "../scripts/model.mjs";
import { mutate } from "../scripts/store.mjs";

let cached = blankState(), failSave = false, cloneReads = false;
globalThis.foundry = { utils: { deepClone: structuredClone } };
globalThis.game = {
  user: { isGM: true },
  settings: {
    get: () => cloneReads ? structuredClone(cached) : cached,
    set: async (_module, _key, state) => {
      await new Promise(resolve => setTimeout(resolve, 2));
      if (failSave) throw Error("save rejected");
      cached = structuredClone(state);
    }
  }
};
const results = [];
async function test(name, fn) {
  cached = blankState(); failSave = false; cloneReads = false; game.user.isGM = true;
  try { await fn(); results.push({ name, pass: true }); }
  catch (error) { process.exitCode = 1; results.push({ name, pass: false, error: error.message }); }
}
await test("failed save cannot modify the live settings cache", async () => {
  failSave = true;
  await assert.rejects(mutate(s => addDevice(s, { num: "1111-1111" })));
  assert.deepEqual(cached, blankState());
});
await test("throwing mutator cannot leak partial state", async () => {
  await assert.rejects(mutate(s => { addDevice(s, { num: "1111-1111" }); throw Error("cancel"); }));
  assert.deepEqual(cached, blankState());
});
await test("permission is checked before calling the mutator", async () => {
  game.user.isGM = false;
  let called = false;
  await assert.rejects(mutate(() => { called = true; }));
  assert.equal(called, false);
});
await test("simultaneous messages survive independent settings snapshots", async () => {
  cloneReads = true;
  await Promise.all(Array.from({ length: 20 }, (_, i) => mutate(s => pushMessage(s, "1111-1111", "2222-2222", String(i)))));
  assert.equal(cached.threads["1111-1111|2222-2222"].length, 20);
});
await test("a failed write does not poison later mutations", async () => {
  failSave = true;
  await assert.rejects(mutate(s => addDevice(s, { num: "1111-1111" })));
  failSave = false;
  await mutate(s => addDevice(s, { num: "2222-2222" }));
  assert.deepEqual(Object.keys(cached.devices), ["2222-2222"]);
});
console.log(JSON.stringify(results, null, 2));
