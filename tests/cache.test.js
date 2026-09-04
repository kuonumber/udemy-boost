import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../src/translate/cache.js";

/** 模擬 chrome.storage.local 的最小介面（get/set/remove 皆為 async、以物件為單位）。 */
function memStorage() {
  const data = new Map();
  return {
    data,
    async get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of arr) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

const cues = (n) => Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, text: `t${i}` }));

test("set 後 get 拿得到同樣的 cues", async () => {
  const c = createCache(memStorage(), { maxEntries: 10, maxBytes: 1e6, now: () => 1 });
  await c.set("t:a", cues(3));
  assert.deepEqual(await c.get("t:a"), cues(3));
});

test("get 不存在的 key 回 null", async () => {
  const c = createCache(memStorage(), { maxEntries: 10, maxBytes: 1e6 });
  assert.equal(await c.get("t:nope"), null);
});

test("超過 maxEntries 淘汰最久未用（LRU：get 會更新時間）", async () => {
  let t = 0;
  const c = createCache(memStorage(), { maxEntries: 2, maxBytes: 1e6, now: () => ++t });
  await c.set("t:a", cues(1));
  await c.set("t:b", cues(1));
  await c.get("t:a"); // a 變成最近使用
  await c.set("t:c", cues(1)); // 應淘汰 b
  assert.notEqual(await c.get("t:a"), null);
  assert.equal(await c.get("t:b"), null);
  assert.notEqual(await c.get("t:c"), null);
});

test("超過 maxBytes 淘汰直到低於上限", async () => {
  let t = 0;
  const s = memStorage();
  const c = createCache(s, { maxEntries: 100, maxBytes: 600, now: () => ++t });
  await c.set("t:a", cues(5)); // 每筆約 30–40 bytes JSON
  await c.set("t:b", cues(5));
  await c.set("t:c", cues(5));
  await c.set("t:d", cues(5));
  const idx = await c.stats();
  assert.ok(idx.bytes <= 600, `bytes=${idx.bytes}`);
  assert.equal(await c.get("t:a"), null); // 最舊的先走
});

test("單筆本身就超過 maxBytes 時不寫入、不丟錯", async () => {
  const c = createCache(memStorage(), { maxEntries: 10, maxBytes: 50 });
  await c.set("t:big", cues(50));
  assert.equal(await c.get("t:big"), null);
});

test("clear 清空所有 t:* 與 index", async () => {
  const s = memStorage();
  const c = createCache(s, { maxEntries: 10, maxBytes: 1e6 });
  await c.set("t:a", cues(1));
  await c.set("t:b", cues(1));
  await c.clear();
  assert.equal(await c.get("t:a"), null);
  assert.equal((await c.stats()).entries, 0);
  assert.equal(s.data.size, 0);
});

test("index 與實際資料不一致（資料被外部刪掉）時 get 回 null 並自我修復", async () => {
  const s = memStorage();
  const c = createCache(s, { maxEntries: 10, maxBytes: 1e6 });
  await c.set("t:a", cues(1));
  s.data.delete("t:a");
  assert.equal(await c.get("t:a"), null);
  assert.equal((await c.stats()).entries, 0);
});

test("set 非法 cues（非陣列）丟 TypeError", async () => {
  const c = createCache(memStorage(), { maxEntries: 10, maxBytes: 1e6 });
  await assert.rejects(() => c.set("t:a", null), TypeError);
  await assert.rejects(() => c.set("t:a", "x"), TypeError);
});

test("set 覆寫同 key 不會讓 entries 重複計數", async () => {
  const c = createCache(memStorage(), { maxEntries: 10, maxBytes: 1e6 });
  await c.set("t:a", cues(1));
  await c.set("t:a", cues(2));
  assert.equal((await c.stats()).entries, 1);
  assert.equal((await c.get("t:a")).length, 2);
});
