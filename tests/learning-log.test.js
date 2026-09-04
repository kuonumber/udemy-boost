import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyLog, tick, applyCompletion, buildReport, renderMarkdown, fmtDuration, formatLocal, shouldCount,
} from "../src/learning/log.js";

const T0 = "2026-09-03T12:00:00.000Z";
const T1 = "2026-09-03T13:00:00.000Z";
const T2 = "2026-09-04T01:30:00.000Z";
const TZ = "Asia/Taipei";

const chapter = (id, idx, title) => ({ _class: "chapter", id, object_index: idx, title });
const lecture = (id, idx, title) => ({ _class: "lecture", id, object_index: idx, title });
const quiz = (id, idx, title) => ({ _class: "quiz", id, object_index: idx, title });

// ---------- fmtDuration ----------

test("fmtDuration 邊界：0 / NaN / 負 → —", () => {
  assert.equal(fmtDuration(0), "—");
  assert.equal(fmtDuration(NaN), "—");
  assert.equal(fmtDuration(-5), "—");
  assert.equal(fmtDuration(undefined), "—");
});

test("fmtDuration 秒 / 分秒 / 時分", () => {
  assert.equal(fmtDuration(999), "0s");
  assert.equal(fmtDuration(45_000), "45s");
  assert.equal(fmtDuration(60_000), "1m 00s");
  assert.equal(fmtDuration(252_000), "4m 12s");
  assert.equal(fmtDuration(3_600_000), "1h 00m");
  assert.equal(fmtDuration(3_900_000 + 59_000), "1h 05m"); // 秒捨去
  assert.equal(fmtDuration(36 * 3_600_000), "36h 00m");
});

// ---------- formatLocal ----------

test("formatLocal 以指定時區輸出 YYYY-MM-DD HH:mm", () => {
  assert.equal(formatLocal("2026-09-03T12:05:00.000Z", TZ), "2026-09-03 20:05");
  assert.equal(formatLocal("2026-09-03T17:30:00.000Z", TZ), "2026-09-04 01:30"); // 跨日
  assert.equal(formatLocal(null, TZ), "");
  assert.equal(formatLocal("not a date", TZ), "");
});

// ---------- shouldCount ----------

test("shouldCount：播放中 + 可見 + 未閒置才計", () => {
  const base = { playing: true, visible: true, idleMs: 0, idleLimitMs: 180_000 };
  assert.equal(shouldCount(base), true);
  assert.equal(shouldCount({ ...base, playing: false }), false);
  assert.equal(shouldCount({ ...base, visible: false }), false);
  assert.equal(shouldCount({ ...base, idleMs: 180_000 }), false); // 剛好 3 分鐘 → 停
  assert.equal(shouldCount({ ...base, idleMs: 179_999 }), true);
});

test("shouldCount：requireFocus 時視窗沒焦點（alt-tab 到別的 app）就停計", () => {
  const base = { playing: true, visible: true, idleMs: 0, idleLimitMs: 0, requireFocus: true };
  assert.equal(shouldCount({ ...base, focused: true }), true);
  assert.equal(shouldCount({ ...base, focused: false }), false);
  // 沒開 requireFocus → 焦點不影響
  assert.equal(shouldCount({ ...base, requireFocus: false, focused: false }), true);
  // 未提供 focused（舊呼叫端）→ 視為有焦點
  assert.equal(shouldCount({ ...base }), true);
});

test("shouldCount：idleLimitMs 為 0 或非正數表示不啟用閒置停計", () => {
  assert.equal(shouldCount({ playing: true, visible: true, idleMs: 9e9, idleLimitMs: 0 }), true);
  assert.equal(shouldCount({ playing: true, visible: true, idleMs: 9e9, idleLimitMs: -1 }), true);
});

// ---------- tick ----------

test("tick 累加 watchedMs、更新 lastSeenAt、首次設 firstSeenAt；回新物件", () => {
  const log = emptyLog(1, "C", "c");
  const a = tick(log, 10, 1000, T0);
  assert.notEqual(a, log);
  assert.deepEqual(a.lectures[10], { watchedMs: 1000, firstSeenAt: T0, lastSeenAt: T0, completedAt: null, completedBefore: false });
  const b = tick(a, 10, 500, T1);
  assert.equal(b.lectures[10].watchedMs, 1500);
  assert.equal(b.lectures[10].firstSeenAt, T0);
  assert.equal(b.lectures[10].lastSeenAt, T1);
  assert.equal(b.updatedAt, T1);
});

test("tick deltaMs <= 0 / NaN → 不變（同一物件）", () => {
  const log = tick(emptyLog(1, "C", "c"), 10, 1000, T0);
  assert.equal(tick(log, 10, 0, T1), log);
  assert.equal(tick(log, 10, -1, T1), log);
  assert.equal(tick(log, 10, NaN, T1), log);
});

test("tick 不改原 log（不可變）", () => {
  const log = emptyLog(1, "C", "c");
  tick(log, 10, 1000, T0);
  assert.deepEqual(log.lectures, {});
});

// ---------- applyCompletion ----------

test("applyCompletion 首次同步：已完成的標 completedBefore、無時間", () => {
  const log = applyCompletion(emptyLog(1, "C", "c"), [10, 11], T0, true);
  assert.deepEqual(log.lectures[10], { watchedMs: 0, firstSeenAt: null, lastSeenAt: null, completedAt: null, completedBefore: true });
  assert.equal(log.lectures[11].completedBefore, true);
  assert.equal(log.lastSyncAt, T0);
});

test("applyCompletion 非首次：新出現的 id 記 completedAt = now", () => {
  let log = applyCompletion(emptyLog(1, "C", "c"), [10], T0, true);
  log = applyCompletion(log, [10, 12], T1, false);
  assert.equal(log.lectures[12].completedAt, T1);
  assert.equal(log.lectures[12].completedBefore, false);
  assert.equal(log.lectures[10].completedBefore, true); // 不會被改
});

test("applyCompletion 已有 completedAt 的不會被覆寫", () => {
  let log = applyCompletion(emptyLog(1, "C", "c"), [], T0, true);
  log = applyCompletion(log, [12], T1, false);
  log = applyCompletion(log, [12], T2, false);
  assert.equal(log.lectures[12].completedAt, T1);
});

test("applyCompletion Udemy 端取消完成 → 清 completedAt / completedBefore", () => {
  let log = applyCompletion(emptyLog(1, "C", "c"), [10], T0, true);
  log = tick(log, 10, 5000, T1);
  log = applyCompletion(log, [], T2, false);
  assert.equal(log.lectures[10].completedAt, null);
  assert.equal(log.lectures[10].completedBefore, false);
  assert.equal(log.lectures[10].watchedMs, 5000); // 時間保留
});

test("applyCompletion 保留已有的 watchedMs", () => {
  let log = tick(emptyLog(1, "C", "c"), 12, 4000, T0);
  log = applyCompletion(log, [12], T1, false);
  assert.equal(log.lectures[12].watchedMs, 4000);
  assert.equal(log.lectures[12].completedAt, T1);
});

test("applyCompletion 非陣列 / 空陣列", () => {
  const base = emptyLog(1, "C", "c");
  assert.throws(() => applyCompletion(base, null, T0, true), TypeError);
  assert.deepEqual(applyCompletion(base, [], T0, true).lectures, {});
});

// ---------- buildReport ----------

const CURRICULUM = [
  chapter(1, 1, "Intro"),
  lecture(10, 1, "Guide"),
  lecture(11, 2, "Install"),
  chapter(2, 2, "Modeling"),
  lecture(12, 3, "Chair"),
  quiz(13, 1, "Quiz 1"),
  lecture(14, 4, "House"),
];

function sampleLog() {
  let log = applyCompletion(emptyLog(1, "Course X", "course-x"), [11], T0, true); // 11 安裝前完成
  log = tick(log, 10, 252_000, T0);
  log = applyCompletion(log, [11, 10], T1, false); // 10 完成於 T1
  log = tick(log, 12, 725_000, T2); // 12 進行中
  return log;
}

test("buildReport 總計與章節統計", () => {
  const r = buildReport(CURRICULUM, sampleLog(), T2);
  assert.equal(r.title, "Course X");
  assert.deepEqual(r.totals, { lectures: 4, completed: 2, chapters: 2, chaptersDone: 1, watchedMs: 977_000, quizzes: 1, quizzesDone: 0 });
  assert.equal(r.chapters.length, 2);
  const [c1, c2] = r.chapters;
  assert.equal(c1.title, "01. Intro");
  assert.equal(c1.done, 2);
  assert.equal(c1.total, 2);
  assert.equal(c1.watchedMs, 252_000);
  assert.equal(c1.completedAt, T1); // 章節完成時間 = 最晚完成講次
  assert.equal(c1.partialBefore, true); // 有一講是安裝前完成
  assert.equal(c2.done, 0); // 12 進行中、14 未開始；quiz 不算講次
  assert.equal(c2.total, 2);
  assert.equal(c2.completedAt, null);
});

test("buildReport 講次狀態：done / in-progress / todo；quiz 為 kind quiz 且無時間", () => {
  const r = buildReport(CURRICULUM, sampleLog(), T2);
  const items = r.chapters.flatMap((c) => c.items);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId[10].status, "done");
  assert.equal(byId[10].completedAt, T1);
  assert.equal(byId[11].status, "done");
  assert.equal(byId[11].completedBefore, true);
  assert.equal(byId[12].status, "in-progress");
  assert.equal(byId[14].status, "todo");
  assert.equal(byId[13].kind, "quiz");
  assert.equal(byId[13].watchedMs, 0);
});

test("buildReport 講次在第一個 chapter 之前 → 00. (no section)", () => {
  const r = buildReport([lecture(1, 1, "Welcome"), chapter(9, 1, "S")], emptyLog(1, "C", "c"), T0);
  assert.equal(r.chapters[0].title, "00. (no section)");
  assert.equal(r.chapters[1].title, "01. S");
});

test("buildReport 沒有任何 log → 全部 todo、watchedMs 0", () => {
  const r = buildReport(CURRICULUM, emptyLog(1, "C", "c"), T0);
  assert.equal(r.totals.completed, 0);
  assert.equal(r.totals.watchedMs, 0);
  assert.ok(r.chapters.flatMap((c) => c.items).every((i) => i.status === "todo"));
});

test("buildReport 全部完成 → chaptersDone = chapters", () => {
  let log = applyCompletion(emptyLog(1, "C", "c"), [10, 11, 12, 14], T0, true);
  const r = buildReport(CURRICULUM, log, T1);
  assert.equal(r.totals.chaptersDone, 2);
  assert.equal(r.chapters[1].completedAt, null); // 全是安裝前 → 無時間
  assert.equal(r.chapters[1].partialBefore, true);
});

test("buildReport 課綱已沒有、但 log 有的講次 → removed 段，時間仍計入總計", () => {
  let log = tick(emptyLog(1, "C", "c"), 999, 60_000, T0);
  const r = buildReport(CURRICULUM, log, T1);
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].id, 999);
  assert.equal(r.totals.watchedMs, 60_000);
});

test("buildReport 空課綱 / 非陣列", () => {
  const r = buildReport([], emptyLog(1, "C", "c"), T0);
  assert.deepEqual(r.chapters, []);
  assert.equal(r.totals.lectures, 0);
  assert.throws(() => buildReport(null, emptyLog(1, "C", "c"), T0), TypeError);
});

test("buildReport 帶 lastSyncAt 供 md 標示完成狀態更新時間", () => {
  const r = buildReport(CURRICULUM, sampleLog(), T2);
  assert.equal(r.lastSyncAt, T1);
});

// ---------- renderMarkdown ----------

test("renderMarkdown 快照（Asia/Taipei）", () => {
  const md = renderMarkdown(buildReport(CURRICULUM, sampleLog(), T2), { timeZone: TZ });
  const expected = [
    "# Course X",
    "",
    "- 更新：2026-09-04 09:30",
    "- 進度：2 / 4 講（50%）· 2 章中 1 章完成 · 測驗 0 / 1",
    "- 累計觀看：16m 17s（本 extension 安裝後起算）",
    "- 完成狀態同步於：2026-09-03 21:00",
    "",
    "## 01. Intro ✅ 2/2 · 4m 12s · 完成於 2026-09-03 21:00（部分安裝前）",
    "",
    "| # | 講次 | 狀態 | 觀看 | 完成時間 |",
    "|---|------|------|------|----------|",
    "| 1 | Guide | ✅ | 4m 12s | 2026-09-03 21:00 |",
    "| 2 | Install | ✅ | — | （安裝前） |",
    "",
    "## 02. Modeling ⏳ 0/2 · 12m 05s",
    "",
    "| # | 講次 | 狀態 | 觀看 | 完成時間 |",
    "|---|------|------|------|----------|",
    "| 3 | Chair | ▶ 進行中 | 12m 05s | |",
    "| Q1 | Quiz 1 | ☐ | — | |",
    "| 4 | House | ☐ | — | |",
    "",
  ].join("\n");
  assert.equal(md, expected);
});

test("renderMarkdown 講次標題含 | 會跳脫", () => {
  const md = renderMarkdown(buildReport([lecture(1, 1, "a | b")], emptyLog(1, "C", "c"), T0), { timeZone: TZ });
  assert.ok(md.includes("| 1 | a \\| b | ☐ | — | |"));
});

test("renderMarkdown 有 removed 段", () => {
  const log = tick(emptyLog(1, "C", "c"), 999, 60_000, T0);
  const md = renderMarkdown(buildReport(CURRICULUM, log, T1), { timeZone: TZ });
  assert.ok(md.includes("## 已移除的講次"));
  assert.ok(md.includes("| 999 |"));
});

test("renderMarkdown 沒有 lastSyncAt 時不輸出同步行", () => {
  const md = renderMarkdown(buildReport(CURRICULUM, emptyLog(1, "C", "c"), T0), { timeZone: TZ });
  assert.ok(!md.includes("完成狀態同步於"));
});
