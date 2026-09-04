import { test } from "node:test";
import assert from "node:assert/strict";
import { providerOrder, translateWithFallback } from "../src/translate/fallback.js";
import { TranslateError } from "../src/translate/batch.js";

const cues = ["hello", "world"].map((t, i) => ({ start: i, end: i + 1, text: t }));

function fakeProvider(id, { available = true, fail = false, result } = {}) {
  const calls = [];
  return {
    id,
    calls,
    async available() {
      return available;
    },
    async translateBatch(texts, { onProgress } = {}) {
      calls.push(texts);
      if (fail) throw new TranslateError(id, new Error("boom"));
      onProgress?.(texts.length, texts.length);
      return result ?? texts.map((t) => `[${id}]${t}`);
    },
  };
}

// ---------- providerOrder ----------

test("providerOrder：選 chrome → chrome, libre；選 libre → libre, chrome；none → 空", () => {
  assert.deepEqual(providerOrder("chrome"), ["chrome", "libre"]);
  assert.deepEqual(providerOrder("libre"), ["libre", "chrome"]);
  assert.deepEqual(providerOrder("none"), []);
});

test("providerOrder 未知值視同 none", () => {
  assert.deepEqual(providerOrder("xyz"), []);
  assert.deepEqual(providerOrder(undefined), []);
});

// ---------- translateWithFallback ----------

test("首選可用且成功 → 用首選，不碰第二個", async () => {
  const a = fakeProvider("chrome");
  const b = fakeProvider("libre");
  const r = await translateWithFallback(cues, [a, b]);
  assert.equal(r.providerId, "chrome");
  assert.deepEqual(r.cues.map((c) => c.text), ["[chrome]hello", "[chrome]world"]);
  assert.equal(b.calls.length, 0);
});

test("首選不可用 → 跳過直接用第二個", async () => {
  const a = fakeProvider("chrome", { available: false });
  const b = fakeProvider("libre");
  const r = await translateWithFallback(cues, [a, b]);
  assert.equal(r.providerId, "libre");
  assert.equal(a.calls.length, 0);
});

test("首選失敗 → 自動切第二個，並回報 fallback 原因", async () => {
  const a = fakeProvider("chrome", { fail: true });
  const b = fakeProvider("libre");
  const r = await translateWithFallback(cues, [a, b]);
  assert.equal(r.providerId, "libre");
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, "chrome");
});

test("全部失敗 → 丟 TranslateError，內含每個 provider 的錯誤", async () => {
  const a = fakeProvider("chrome", { fail: true });
  const b = fakeProvider("libre", { fail: true });
  await assert.rejects(
    () => translateWithFallback(cues, [a, b]),
    (e) => e instanceof TranslateError && e.failed?.length === 2,
  );
});

test("provider 清單為空 → 丟 TranslateError", async () => {
  await assert.rejects(() => translateWithFallback(cues, []), TranslateError);
});

test("provider 回傳長度不符 → 視為該 provider 失敗，切下一個", async () => {
  const a = fakeProvider("chrome", { result: ["only one"] });
  const b = fakeProvider("libre");
  const r = await translateWithFallback(cues, [a, b]);
  assert.equal(r.providerId, "libre");
});

test("結果保留原 cue 的 start/end，只換 text", async () => {
  const a = fakeProvider("chrome");
  const r = await translateWithFallback(cues, [a]);
  assert.deepEqual(r.cues.map((c) => [c.start, c.end]), [[0, 1], [1, 2]]);
});

test("空 cues → 直接回空，不呼叫 provider", async () => {
  const a = fakeProvider("chrome");
  const r = await translateWithFallback([], [a]);
  assert.deepEqual(r.cues, []);
  assert.equal(a.calls.length, 0);
});

test("AbortSignal 已中止 → 丟 AbortError，不呼叫 provider", async () => {
  const a = fakeProvider("chrome");
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => translateWithFallback(cues, [a], { signal: ac.signal }), (e) => e.name === "AbortError");
  assert.equal(a.calls.length, 0);
});

test("onProgress 會被轉呼叫", async () => {
  const a = fakeProvider("chrome");
  const seen = [];
  await translateWithFallback(cues, [a], { onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(seen, [[2, 2]]);
});
