import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, unpack, cacheKey, TranslateError } from "../src/translate/batch.js";

const cue = (text, i) => ({ start: i, end: i + 1, text });

// ---------- pack ----------

test("pack 依 maxChars 分塊，順序保留", () => {
  const cues = ["aaaa", "bbbb", "cccc", "dd"].map(cue);
  const { chunks, index } = pack(cues, 8);
  assert.deepEqual(chunks, [["aaaa", "bbbb"], ["cccc", "dd"]]);
  assert.deepEqual(index, [[0, 1], [2, 3]]);
});

test("pack 單一 cue 超過 maxChars 時獨立成塊、不截斷", () => {
  const cues = ["a", "b".repeat(20), "c"].map(cue);
  const { chunks } = pack(cues, 5);
  assert.deepEqual(chunks, [["a"], ["b".repeat(20)], ["c"]]);
});

test("pack 把 cue 內換行換成空格", () => {
  const { chunks } = pack([cue("line one\nline two", 0)], 100);
  assert.deepEqual(chunks, [["line one line two"]]);
});

test("pack 空陣列", () => {
  assert.deepEqual(pack([], 10), { chunks: [], index: [] });
});

test("pack 剛好等於 maxChars 放同一塊", () => {
  const { chunks } = pack(["abc", "de"].map(cue), 5);
  assert.deepEqual(chunks, [["abc", "de"]]);
});

test("pack maxChars <= 0 或非數字丟 RangeError", () => {
  assert.throws(() => pack([cue("a", 0)], 0), RangeError);
  assert.throws(() => pack([cue("a", 0)], -1), RangeError);
  assert.throws(() => pack([cue("a", 0)], NaN), RangeError);
});

test("pack 非陣列丟 TypeError", () => {
  assert.throws(() => pack(null, 10), TypeError);
});

// ---------- unpack ----------

test("unpack 還原成與原 cue 對應的順序", () => {
  const index = [[0, 1], [2, 3]];
  const out = unpack([["A", "B"], ["C", "D"]], index, 4);
  assert.deepEqual(out, ["A", "B", "C", "D"]);
});

test("unpack 塊長度與 index 不符丟 TranslateError（不靜默錯位）", () => {
  assert.throws(() => unpack([["A"]], [[0, 1]], 2), TranslateError);
  assert.throws(() => unpack([["A", "B", "C"]], [[0, 1]], 2), TranslateError);
});

test("unpack 塊數與 index 數不符丟 TranslateError", () => {
  assert.throws(() => unpack([["A"], ["B"]], [[0]], 1), TranslateError);
});

test("unpack 結果長度不等於 total 丟 TranslateError", () => {
  assert.throws(() => unpack([["A"]], [[0]], 2), TranslateError);
});

test("unpack 空輸入", () => {
  assert.deepEqual(unpack([], [], 0), []);
});

test("pack → unpack 往返恆等（大量 cue）", () => {
  const texts = Array.from({ length: 500 }, (_, i) => `sentence number ${i} `.repeat((i % 7) + 1).trim());
  const cues = texts.map(cue);
  const { chunks, index } = pack(cues, 300);
  const echoed = chunks.map((c) => c.map((s) => s.toUpperCase()));
  assert.deepEqual(unpack(echoed, index, cues.length), texts.map((t) => t.toUpperCase()));
});

// ---------- cacheKey ----------

test("cacheKey 對相同輸入穩定、不同輸入不同", async () => {
  const a = await cacheKey({ assetId: 1, locale: "en_US", provider: "chrome", target: "zh-Hant", dictVersion: "1.4.2" });
  const b = await cacheKey({ assetId: 1, locale: "en_US", provider: "chrome", target: "zh-Hant", dictVersion: "1.4.2" });
  const c = await cacheKey({ assetId: 1, locale: "en_US", provider: "libre", target: "zh-Hant", dictVersion: "1.4.2" });
  const d = await cacheKey({ assetId: 2, locale: "en_US", provider: "chrome", target: "zh-Hant", dictVersion: "1.4.2" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^t:[0-9a-f]{16,}$/);
});

test("cacheKey 缺欄位丟 TypeError", async () => {
  await assert.rejects(() => cacheKey({ assetId: 1 }), TypeError);
  await assert.rejects(() => cacheKey(null), TypeError);
});
