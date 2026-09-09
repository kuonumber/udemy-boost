import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFocusReport, renderFocusMarkdown, renderNoteEntry } from "../src/focus/render.js";

const TZ = "Asia/Taipei";
const NOW = "2026-09-09T23:00:00+08:00";
const curriculum = [
  { _class: "chapter", id: 1, object_index: 1, title: "Intro" },
  { _class: "lecture", id: 10, object_index: 1, title: "Guide" },
  { _class: "lecture", id: 11, object_index: 2, title: "Install" },
  { _class: "chapter", id: 2, object_index: 2, title: "Modeling" },
  { _class: "lecture", id: 12, object_index: 3, title: "Chair" },
  { _class: "quiz", id: 13, object_index: 1, title: "Quiz 1" },
];
const seg = (lectureId, start, end, o = {}) => ({
  start: `2026-09-09T${start}:00+08:00`, end: `2026-09-09T${end}:00+08:00`, lectureId, chapterIndex: 0, lectureIndex: 0, title: "",
  watchedMs: Date.parse(`2026-09-09T${end}:00+08:00`) - Date.parse(`2026-09-09T${start}:00+08:00`),
  posStart: 0, posEnd: 0, rate: 1, endReason: "pause", seekBackCount: 0, seekBackS: 0, videoDurationS: 600, extVersion: "t", ...o,
});
const segments = [
  seg(10, "20:00", "20:05", { posStart: 0, posEnd: 300, endReason: "blur" }),
  seg(10, "20:06", "20:10", { posStart: 300, posEnd: 600, seekBackCount: 1, seekBackS: 20 }),
  { ...seg(10, "20:10", "20:10"), watchedMs: 0, endReason: "completed" },
  { ...seg(11, "00:00", "00:00"), watchedMs: 0, endReason: "imported" }, // 安裝前完成（無時間）：由 completedIds 判斷
  seg(12, "21:00", "21:12", { posStart: 0, posEnd: 700 }),
];
const completedIds = [10, 11];
const notesIndex = { 12: 1 }; // lectureId → 筆記數

test("buildFocusReport：章節 / 講次數值正確；quiz 無時間；completedBefore 由 Udemy 清單但無 completed 行推得", () => {
  const r = buildFocusReport({ curriculum, segments, completedIds, notesIndex, now: NOW, timeZone: TZ, title: "Course X", csvBadRows: 0, importInfo: null });
  assert.equal(r.totals.lectures, 3);
  assert.equal(r.totals.completed, 2);
  assert.equal(r.totals.watchedMs, 9 * 60000 + 12 * 60000);
  const [c1, c2] = r.chapters;
  assert.equal(c1.done, 2);
  assert.equal(c1.analysis.distractions, 1);
  assert.equal(c1.analysis.focusRatio, (1.0 * 600 + 0) / 600); // Install 沒有 duration → 不加權
  assert.equal(c1.analysis.seekBackCount, 1);
  const guide = c1.items[0];
  assert.equal(guide.status, "done");
  assert.equal(guide.completedAt, "2026-09-09T20:10:00+08:00");
  assert.equal(guide.analysis.focusRatio, 1);
  const install = c1.items[1];
  assert.equal(install.status, "done");
  assert.equal(install.completedBefore, true);
  assert.equal(c2.items[0].status, "in-progress");
  assert.equal(c2.items[0].hasNotes, true);
  assert.equal(c2.items[1].kind, "quiz");
  assert.equal(r.recent7.watchedMs, 21 * 60000);
  assert.equal(r.hourBuckets.best.label, "20–24");
  assert.equal(r.weekly.length, 8);
});

test("renderFocusMarkdown 關鍵行", () => {
  const r = buildFocusReport({ curriculum, segments, completedIds, notesIndex, now: NOW, timeZone: TZ, title: "Course X", csvBadRows: 2, importInfo: { lectures: 5, unknownTime: 3 } });
  const md = renderFocusMarkdown(r);
  const lines = md.split("\n");
  assert.equal(lines[0], "# Course X");
  assert.ok(md.includes("- 進度：2 / 3 講（67%）· 2 章中 1 章完成 · 測驗 0 / 1"));
  assert.ok(md.includes("- 累計觀看：21m 00s（來源：watch-log.csv，含匯入的舊記錄）"));
  assert.ok(md.includes("- 最近 7 天：21m 00s · 完成 1 講 · 專注比 1.00 · 分心 2.9 次/小時"));
  assert.ok(md.includes("- 最佳時段：20–24 時"));
  assert.ok(md.includes("- 匯入舊記錄 5 講，其中 3 講時間不可考"));
  assert.ok(md.includes("- CSV 有 2 行無法解析，已略過"));
  assert.ok(md.includes("## 01. Intro ✅ 2/2 · 9m 00s · 完成於 2026-09-09 20:10（部分安裝前）"));
  assert.ok(md.includes("分析：專注比 1.00 · 分心 1 次 · 回看 1 次 (20s) · 最長連續 5m 00s · 1 個 session"));
  assert.ok(md.includes("| # | 講次 | 狀態 | 觀看 | 專注比 | 分心 | 回看 | 完成時間 |"));
  assert.ok(md.includes("| 1 | Guide | ✅ | 9m 00s | 1.00 | 1 | 1 | 2026-09-09 20:10 |"));
  assert.ok(md.includes("| 2 | Install | ✅ | — | — | 0 | 0 | （安裝前） |"));
  assert.ok(md.includes("| 3 | Chair 📝 | ▶ 進行中 | 12m 00s | 1.00 | 0 | 0 | |"));
  assert.ok(md.includes("| Q1 | Quiz 1 | ☐ | — | — | | | |"));
  assert.ok(md.includes("## 週趨勢"));
  assert.ok(md.includes("| 2026-W37 | 21m 00s | 1 | 1.00 | 2.9 |"));
  assert.ok(md.includes("## 時段分布"));
  assert.ok(md.includes("| 20–24 | 21m 00s | 1.00 |"));
});

test("renderFocusMarkdown 沒有分析資料時：分析行顯示 —、沒有匯入 / 壞行註記", () => {
  const r = buildFocusReport({ curriculum, segments: [], completedIds: [], notesIndex: {}, now: NOW, timeZone: TZ, title: "C", csvBadRows: 0, importInfo: null });
  const md = renderFocusMarkdown(r);
  assert.ok(md.includes("## 01. Intro ⏳ 0/2 · —"));
  assert.ok(md.includes("分析：專注比 — · 分心 0 次 · 回看 0 次 · 最長連續 — · 0 個 session"));
  assert.ok(!md.includes("匯入舊記錄"));
  assert.ok(!md.includes("無法解析"));
  assert.ok(md.includes("- 最佳時段：—"));
});

test("renderNoteEntry：章 / 講標題 + 時間 + 內容，內容多行縮排；空內容丟 RangeError", () => {
  const s = renderNoteEntry({ chapter: "01. Intro", lecture: "02. Install", at: "2026-09-09T21:30:00+08:00", text: "第一行\n第二行", timeZone: TZ });
  assert.equal(s, "## 01. Intro / 02. Install\n\n- 2026-09-09 21:30 — 第一行\n  第二行\n\n");
  assert.throws(() => renderNoteEntry({ chapter: "a", lecture: "b", at: "2026-09-09T21:30:00+08:00", text: "   ", timeZone: TZ }), RangeError);
});
