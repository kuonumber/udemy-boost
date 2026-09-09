import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgressMd, parseDuration, fromPhase4Log, toImportedSegments } from "../src/focus/importer.js";

const MD = `# Course X

- 更新：2026-09-04 09:30
- 進度：2 / 4 講（50%）· 2 章中 1 章完成 · 測驗 0 / 1
- 累計觀看：16m 17s（本 extension 安裝後起算）

## 01. Intro ✅ 2/2 · 4m 12s · 完成於 2026-09-03 21:00（部分安裝前）

| # | 講次 | 狀態 | 觀看 | 完成時間 |
|---|------|------|------|----------|
| 1 | Guide | ✅ | 4m 12s | 2026-09-03 21:00 |
| 2 | Install | ✅ | — | （安裝前） |

## 02. Modeling ⏳ 0/2 · 12m 05s

| # | 講次 | 狀態 | 觀看 | 完成時間 |
|---|------|------|------|----------|
| 3 | Chair | ▶ 進行中 | 12m 05s | |
| Q1 | Quiz 1 | ☐ | — | |
| 4 | House | ☐ | — | |
| broken row without enough cells |
`;

test("parseDuration：Ns / Mm Ss / Hh Mm / — / 壞字串", () => {
  assert.equal(parseDuration("45s"), 45000);
  assert.equal(parseDuration("4m 12s"), 252000);
  assert.equal(parseDuration("1h 05m"), 3900000);
  assert.equal(parseDuration("—"), 0);
  assert.equal(parseDuration(""), 0);
  assert.equal(parseDuration("abc"), null);
});

test("parseProgressMd 解析每章每講：索引、標題、狀態、觀看、完成時間；quiz 跳過；壞列計 skipped", () => {
  const { rows, skipped, title } = parseProgressMd(MD);
  assert.equal(title, "Course X");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { chapterIndex: 1, lectureIndex: 1, title: "Guide", done: true, watchedMs: 252000, completedAt: "2026-09-03 21:00", completedBefore: false });
  assert.deepEqual(rows[1], { chapterIndex: 1, lectureIndex: 2, title: "Install", done: true, watchedMs: 0, completedAt: null, completedBefore: true });
  assert.equal(rows[2].chapterIndex, 2);
  assert.equal(rows[2].done, false);
  assert.equal(rows[2].watchedMs, 725000);
  assert.equal(rows[3].watchedMs, 0);
  assert.equal(skipped.length, 1);
});

test("parseProgressMd 講次標題內有跳脫的 | 會還原", () => {
  const md = "# C\n\n## 01. S ⏳ 0/1 · —\n\n| # | 講次 | 狀態 | 觀看 | 完成時間 |\n|---|---|---|---|---|\n| 1 | a \\| b | ☐ | — | |\n";
  assert.equal(parseProgressMd(md).rows[0].title, "a | b");
});

test("parseProgressMd 空 / 沒表格 / 非字串", () => {
  assert.deepEqual(parseProgressMd("# only title\n").rows, []);
  assert.deepEqual(parseProgressMd("").rows, []);
  assert.throws(() => parseProgressMd(null), TypeError);
});

test("parseProgressMd 不認 Phase 5 新表頭（多了專注比欄）— 交由呼叫端決定是否已是新格式", () => {
  const md = "# C\n\n## 01. S ⏳ 0/1 · —\n\n| # | 講次 | 狀態 | 觀看 | 專注比 | 分心 | 回看 | 完成時間 |\n|---|---|---|---|---|---|---|---|\n| 1 | a | ☐ | — | | | | |\n";
  const r = parseProgressMd(md);
  assert.equal(r.rows.length, 0);
  assert.equal(r.newFormat, true);
});

test("fromPhase4Log：storage 記錄 → 匯入列（含 completedBefore 與 completedAt）", () => {
  const log = { lectures: { 10: { watchedMs: 5000, completedAt: "2026-09-03T13:00:00.000Z", completedBefore: false }, 11: { watchedMs: 0, completedAt: null, completedBefore: true } } };
  const rows = fromPhase4Log(log);
  assert.deepEqual(rows, [
    { lectureId: 10, watchedMs: 5000, completedAt: "2026-09-03T13:00:00.000Z", completedBefore: false },
    { lectureId: 11, watchedMs: 0, completedAt: null, completedBefore: true },
  ]);
  assert.deepEqual(fromPhase4Log(null), []);
});

test("toImportedSegments：md 列用 (章, 講) 對到 curriculum 的 lectureId；storage 列直接用 id；同講取 watched 較大者；產 imported + completed 行", () => {
  const curriculum = [
    { _class: "chapter", id: 1, object_index: 1, title: "Intro" },
    { _class: "lecture", id: 10, object_index: 1, title: "Guide" },
    { _class: "lecture", id: 11, object_index: 2, title: "Install" },
  ];
  const mdRows = [
    { chapterIndex: 1, lectureIndex: 1, title: "Guide", done: true, watchedMs: 252000, completedAt: "2026-09-03 21:00", completedBefore: false },
    { chapterIndex: 1, lectureIndex: 2, title: "Install", done: true, watchedMs: 0, completedAt: null, completedBefore: true },
    { chapterIndex: 9, lectureIndex: 9, title: "Ghost", done: false, watchedMs: 1, completedAt: null, completedBefore: false }, // 對不到
  ];
  const storageRows = [{ lectureId: 10, watchedMs: 300000, completedAt: "2026-09-03T13:00:00.000Z", completedBefore: false }];
  const { segments, unmatched } = toImportedSegments({ mdRows, storageRows, curriculum, timeZone: "Asia/Taipei", fileMtimeIso: "2026-09-04T01:30:00.000Z", extVersion: "0.5.0" });
  assert.equal(unmatched.length, 1);
  const imp = segments.filter((s) => s.endReason === "imported");
  const comp = segments.filter((s) => s.endReason === "completed");
  assert.equal(imp.length, 1); // Install watched 0 → 不產 imported 行
  assert.equal(imp[0].lectureId, 10);
  assert.equal(imp[0].watchedMs, 300000); // 取較大者
  assert.equal(imp[0].start, imp[0].end);
  assert.equal(comp.length, 1); // Install 安裝前完成 → 無時間 → 不產 completed 行（交由 Udemy 清單處理）
  assert.equal(comp[0].lectureId, 10);
  assert.equal(comp[0].start, "2026-09-03T13:00:00.000Z"); // storage 的精確時間優先於 md 的分鐘級
  assert.ok(segments.every((s) => s.extVersion === "0.5.0" && s.chapterIndex === 1));
});

test("toImportedSegments：只有 md 分鐘級時間 → 以 timeZone 轉 ISO", () => {
  const curriculum = [{ _class: "lecture", id: 10, object_index: 1, title: "Guide" }];
  const mdRows = [{ chapterIndex: 0, lectureIndex: 1, title: "Guide", done: true, watchedMs: 1000, completedAt: "2026-09-03 21:00", completedBefore: false }];
  const { segments } = toImportedSegments({ mdRows, storageRows: [], curriculum, timeZone: "Asia/Taipei", fileMtimeIso: "2026-09-04T01:30:00.000Z", extVersion: "t" });
  const comp = segments.find((s) => s.endReason === "completed");
  assert.equal(Date.parse(comp.start), Date.parse("2026-09-03T13:00:00Z"));
  const imp = segments.find((s) => s.endReason === "imported");
  assert.equal(Date.parse(imp.start), Date.parse("2026-09-03T13:00:00Z")); // 有完成時間 → imported 行也放在完成時間
  // 沒完成時間（進行中）→ 用檔案 mtime
  const r2 = toImportedSegments({ mdRows: [{ chapterIndex: 0, lectureIndex: 1, title: "Guide", done: false, watchedMs: 1000, completedAt: null, completedBefore: false }], storageRows: [], curriculum, timeZone: "Asia/Taipei", fileMtimeIso: "2026-09-04T01:30:00.000Z", extVersion: "t" });
  assert.equal(r2.segments[0].start, "2026-09-04T01:30:00.000Z");
  assert.equal(r2.segments.length, 1);
});
