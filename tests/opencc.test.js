import { test } from "node:test";
import assert from "node:assert/strict";
import { toTW, convertCues, needsOpenCC, DICT_VERSION } from "../src/opencc.js";

test("toTW 簡體 → 台灣繁體含用語（程序→程式、界面→介面、软件→軟體）", async () => {
  assert.equal(await toTW("现在让我们来看一下程序的界面。"), "現在讓我們來看一下程式的介面。");
  assert.equal(await toTW("软件 内存 鼠标"), "軟體 記憶體 滑鼠");
});

test("toTW 對已是繁體的句子冪等", async () => {
  const s = "現在讓我們來看一下程式的介面。";
  assert.equal(await toTW(s), s);
  assert.equal(await toTW(await toTW("软件")), await toTW("软件"));
});

test("toTW 空字串回空字串；英文與數字不動", async () => {
  assert.equal(await toTW(""), "");
  assert.equal(await toTW("Blender 4.2 OK"), "Blender 4.2 OK");
});

test("toTW 保留換行與空白", async () => {
  assert.equal(await toTW("第一行\n第二行"), "第一行\n第二行");
});

test("toTW 非字串丟 TypeError", async () => {
  await assert.rejects(() => toTW(null), TypeError);
  await assert.rejects(() => toTW(123), TypeError);
});

test("convertCues 回新陣列、不改原物件、時間不變", async () => {
  const src = [{ start: 1, end: 2, text: "软件" }];
  const out = await convertCues(src);
  assert.notEqual(out, src);
  assert.equal(src[0].text, "软件");
  assert.deepEqual(out, [{ start: 1, end: 2, text: "軟體" }]);
});

test("convertCues 空陣列", async () => {
  assert.deepEqual(await convertCues([]), []);
});

test("needsOpenCC：zh_TW 不轉，其他中文軌都轉", () => {
  assert.equal(needsOpenCC("zh_TW"), false);
  assert.equal(needsOpenCC("zh-tw"), false);
  assert.equal(needsOpenCC("zh_HK"), true);
  assert.equal(needsOpenCC("zh_CN"), true);
  assert.equal(needsOpenCC("zh"), true);
  assert.equal(needsOpenCC(null), false);
});

test("DICT_VERSION 是非空字串（快取 key 用）", () => {
  assert.equal(typeof DICT_VERSION, "string");
  assert.ok(DICT_VERSION.length > 0);
});
