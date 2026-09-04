import { test } from "node:test";
import assert from "node:assert/strict";
import { safeSegment, uniquePaths, pad2 } from "../src/download/naming.js";

test("safeSegment 移除 Windows 非法字元與控制字元", () => {
  assert.equal(safeSegment('a<b>c:d"e/f\\g|h?i*j'), "abcdefghij");
  assert.equal(safeSegment("x\u0001y\u001fz"), "xyz");
  assert.equal(safeSegment("Navigation interface"), "Navigation interface"); // 空白保留
});

test("safeSegment 去掉開頭結尾的點與空白，中間保留", () => {
  assert.equal(safeSegment("  .hidden. "), "hidden");
  assert.equal(safeSegment("a. b"), "a. b");
  assert.equal(safeSegment("file.tar.gz"), "file.tar.gz");
});

test("safeSegment 全是點或空白 → _", () => {
  assert.equal(safeSegment("..."), "_");
  assert.equal(safeSegment("   "), "_");
  assert.equal(safeSegment(""), "_");
});

test("safeSegment Windows 保留字加底線（含帶副檔名）", () => {
  assert.equal(safeSegment("CON"), "CON_");
  assert.equal(safeSegment("con"), "con_");
  assert.equal(safeSegment("NUL.txt"), "NUL_.txt");
  assert.equal(safeSegment("COM1"), "COM1_");
  assert.equal(safeSegment("LPT9.blend"), "LPT9_.blend");
  assert.equal(safeSegment("CONSOLE"), "CONSOLE"); // 不是保留字
});

test("safeSegment 超長以 code point 截斷，不切半個中文", () => {
  const s = "中".repeat(100);
  const out = safeSegment(s, 10);
  assert.equal([...out].length, 10);
  assert.equal(out, "中".repeat(10));
});

test("safeSegment 超長時保留副檔名", () => {
  const out = safeSegment("a".repeat(100) + ".blend", 20);
  assert.ok(out.endsWith(".blend"));
  assert.ok([...out].length <= 20);
});

test("safeSegment 非字串丟 TypeError", () => {
  assert.throws(() => safeSegment(null), TypeError);
  assert.throws(() => safeSegment(5), TypeError);
});

test("safeSegment 結果不會是 '..'（path traversal）", () => {
  assert.notEqual(safeSegment(".."), "..");
  assert.notEqual(safeSegment("../x"), "../x");
  assert.equal(safeSegment("../x"), "x");
});

test("pad2 兩位數補零", () => {
  assert.equal(pad2(3), "03");
  assert.equal(pad2(12), "12");
  assert.equal(pad2(123), "123");
  assert.equal(pad2(0), "00");
  assert.equal(pad2(undefined), "00");
});

test("uniquePaths 同路徑重複加 (2)、(3)，保留副檔名", () => {
  const out = uniquePaths(["a/b/x.pdf", "a/b/x.pdf", "a/b/x.pdf", "a/b/y.pdf"]);
  assert.deepEqual(out, ["a/b/x.pdf", "a/b/x (2).pdf", "a/b/x (3).pdf", "a/b/y.pdf"]);
});

test("uniquePaths 大小寫不同視為同檔（Windows）", () => {
  assert.deepEqual(uniquePaths(["A/x.PDF", "a/X.pdf"]), ["A/x.PDF", "a/X (2).pdf"]);
});

test("uniquePaths 無副檔名", () => {
  assert.deepEqual(uniquePaths(["a/readme", "a/readme"]), ["a/readme", "a/readme (2)"]);
});

test("uniquePaths 空陣列", () => {
  assert.deepEqual(uniquePaths([]), []);
});
