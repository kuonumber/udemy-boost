import test from "node:test";
import assert from "node:assert/strict";
import { findUnitContext, formatTimestamp, renderStudyPack } from "../src/anki/study-pack.js";

const course = { id: "42", title: "Blender 基礎", slug: "blender-basic" };
const unit = { id: "12", chapterTitle: "介面", title: "Viewport", url: "https://www.udemy.com/course/blender-basic/learn/lecture/12" };
const cue = (start, end, text) => ({ start, end, text });

test("formatTimestamp 將零與小時格式化為固定三位毫秒", () => {
  assert.equal(formatTimestamp(0), "00:00:00.000");
  assert.equal(formatTimestamp(3661.005), "01:01:01.005");
});

test("formatTimestamp 對負數、NaN 與非數字丟 TypeError", () => {
  for (const value of [-1, NaN, Infinity, "1"]) assert.throws(() => formatTimestamp(value), TypeError);
});

test("findUnitContext 依課綱順序找出單元與所屬章節", () => {
  const items = [
    { _class: "chapter", title: "開始", object_index: 1 },
    { _class: "lecture", id: 11, title: "安裝", object_index: 1 },
    { _class: "chapter", title: "介面", object_index: 2 },
    { _class: "lecture", id: 12, title: "Viewport", object_index: 2 },
  ];
  assert.deepEqual(findUnitContext(items, "12"), { id: "12", chapterTitle: "介面", title: "Viewport", objectIndex: 2 });
});

test("findUnitContext 對章節前的單元使用未分類名稱", () => {
  assert.equal(findUnitContext([{ _class: "lecture", id: 1, title: "Welcome", object_index: 1 }], 1).chapterTitle, "未分類");
});

test("findUnitContext 找不到單元時回 null，非法課綱丟 TypeError", () => {
  assert.equal(findUnitContext([], 9), null);
  assert.throws(() => findUnitContext(null, 1), TypeError);
});

test("renderStudyPack 產生 metadata、GPT 規則、schema 與雙語時間戳字幕", () => {
  const md = renderStudyPack({
    course,
    unit,
    enCues: [cue(0, 1.25, "Hello")],
    zhCues: [cue(0, 1.25, "你好")],
    generatedAt: "2026-09-07T01:02:03.000Z",
  });
  assert.match(md, /# Udemy Boost GPT 學習包/);
  assert.match(md, /課程：Blender 基礎/);
  assert.match(md, /章節：介面/);
  assert.match(md, /單元：Viewport/);
  assert.match(md, /5–10 張/);
  assert.match(md, /"schemaVersion": 1/);
  assert.match(md, /\[00:00:00\.000 --> 00:00:01\.250\] Hello/);
  assert.match(md, /\[00:00:00\.000 --> 00:00:01\.250\] 你好/);
});

test("renderStudyPack 支援只有英文或只有中文的單語字幕", () => {
  assert.match(renderStudyPack({ course, unit, enCues: [cue(0, 1, "Only EN")], zhCues: [] }), /Only EN/);
  assert.match(renderStudyPack({ course, unit, enCues: [], zhCues: [cue(0, 1, "只有中文")] }), /只有中文/);
});

test("renderStudyPack 兩種字幕皆空時拒絕匯出", () => {
  assert.throws(() => renderStudyPack({ course, unit, enCues: [], zhCues: [] }), /沒有可匯出的字幕/);
});

test("renderStudyPack 保留字幕特殊字元與超長文字，不靜默截斷", () => {
  const text = "| <tag> & 中文\n第二行 " + "x".repeat(10000);
  const md = renderStudyPack({ course, unit, enCues: [cue(0, 2, text)], zhCues: [] });
  assert.ok(md.includes(text));
  assert.ok(md.length > 10000);
});

test("renderStudyPack 拒絕缺少必要 metadata 或髒 cue", () => {
  assert.throws(() => renderStudyPack({ course: {}, unit, enCues: [cue(0, 1, "x")], zhCues: [] }), /course/);
  assert.throws(() => renderStudyPack({ course, unit, enCues: [cue(NaN, 1, "x")], zhCues: [] }), /cue/);
  assert.throws(() => renderStudyPack({ course, unit, enCues: [cue(2, 1, "x")], zhCues: [] }), /cue/);
});
