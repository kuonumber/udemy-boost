import { test } from "node:test";
import assert from "node:assert/strict";
import { pick, pairText } from "../src/align.js";

const cues = [
  { start: 1, end: 2, text: "a" },
  { start: 3, end: 5, text: "b" },
  { start: 4, end: 6, text: "c" }, // 與 b 重疊
  { start: 10, end: 11, text: "d" },
];

// ---------- pick ----------

test("pick 命中區間內的 cue", () => {
  assert.equal(pick(cues, 1.5).text, "a");
  assert.equal(pick(cues, 10.999).text, "d");
});

test("pick 邊界：start 含、end 不含", () => {
  assert.equal(pick(cues, 1).text, "a");
  assert.equal(pick(cues, 2), null);
  assert.equal(pick(cues, 3).text, "b");
});

test("pick 空隙回傳 null", () => {
  assert.equal(pick(cues, 0), null);
  assert.equal(pick(cues, 2.5), null);
  assert.equal(pick(cues, 7), null);
  assert.equal(pick(cues, 100), null);
});

test("pick 重疊時取 start 最大者", () => {
  assert.equal(pick(cues, 4.5).text, "c");
  assert.equal(pick(cues, 3.5).text, "b");
});

test("pick 空陣列回傳 null", () => {
  assert.equal(pick([], 1), null);
});

test("pick 單一 cue", () => {
  const one = [{ start: 0, end: 1, text: "x" }];
  assert.equal(pick(one, 0).text, "x");
  assert.equal(pick(one, 0.5).text, "x");
  assert.equal(pick(one, 1), null);
});

test("pick 非法時間回傳 null", () => {
  assert.equal(pick(cues, NaN), null);
  assert.equal(pick(cues, -1), null);
  assert.equal(pick(cues, Infinity), null);
  assert.equal(pick(cues, -Infinity), null);
  assert.equal(pick(cues, undefined), null);
});

test("pick 非陣列輸入回傳 null", () => {
  assert.equal(pick(null, 1), null);
  assert.equal(pick(undefined, 1), null);
});

test("pick 大量 cue 仍正確（binary search 路徑）", () => {
  const many = Array.from({ length: 10000 }, (_, i) => ({ start: i, end: i + 0.9, text: String(i) }));
  assert.equal(pick(many, 5000.5).text, "5000");
  assert.equal(pick(many, 5000.95), null);
  assert.equal(pick(many, 9999.1).text, "9999");
});

test("pick 零長度 cue（start == end）永不命中", () => {
  assert.equal(pick([{ start: 1, end: 1, text: "z" }], 1), null);
});

// ---------- pairText ----------

test("pairText 兩邊都有", () => {
  assert.deepEqual(pairText({ text: "en" }, { text: "zh" }), { en: "en", zh: "zh" });
});

test("pairText 缺一邊給空字串", () => {
  assert.deepEqual(pairText({ text: "en" }, null), { en: "en", zh: "" });
  assert.deepEqual(pairText(null, { text: "zh" }), { en: "", zh: "zh" });
});

test("pairText 兩邊都缺", () => {
  assert.deepEqual(pairText(null, null), { en: "", zh: "" });
  assert.deepEqual(pairText(undefined, undefined), { en: "", zh: "" });
});
