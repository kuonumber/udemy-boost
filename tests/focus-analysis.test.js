import { test } from "node:test";
import assert from "node:assert/strict";
import { perLecture, perChapter, sessions, recentWindow, byHourBucket, weekly, isoWeek } from "../src/focus/analysis.js";

const TZ = "Asia/Taipei";
const seg = (start, end, o = {}) => ({
  start: `2026-09-09T${start}:00+08:00`, end: `2026-09-09T${end}:00+08:00`, lectureId: 1, chapterIndex: 1, lectureIndex: 1, title: "L",
  watchedMs: (Date.parse(`2026-09-09T${end}:00+08:00`) - Date.parse(`2026-09-09T${start}:00+08:00`)),
  posStart: 0, posEnd: 0, rate: 1, endReason: "pause", seekBackCount: 0, seekBackS: 0, videoDurationS: 600, extVersion: "t", ...o,
});

// ---------- perLecture ----------

test("perLecture 單段：watched / focusRatio / 無分心", () => {
  const r = perLecture([seg("21:00", "21:05", { posStart: 0, posEnd: 300 })]);
  assert.equal(r.watchedMs, 300000);
  assert.equal(r.focusRatio, 0.5); // 300 / 600
  assert.equal(r.distractions, 0);
  assert.equal(r.sessions, 1);
  assert.equal(r.longestFocusMs, 300000);
  assert.equal(r.pauses, 0);
});

test("perLecture 分心計數只算 blur / hidden / idle；focusRatio 只算正向位移且截 1", () => {
  const r = perLecture([
    seg("21:00", "21:02", { posStart: 0, posEnd: 120, endReason: "blur" }),
    seg("21:03", "21:05", { posStart: 120, posEnd: 240, endReason: "hidden" }),
    seg("21:06", "21:08", { posStart: 240, posEnd: 100, endReason: "seek" }), // 往回，不算正向
    seg("21:09", "21:20", { posStart: 100, posEnd: 700, endReason: "idle" }), // 600s 位移 → 總 840 → 截 1
  ]);
  assert.equal(r.distractions, 3);
  assert.equal(r.focusRatio, 1);
});

test("perLecture 影片長度未知 → focusRatio null", () => {
  const r = perLecture([seg("21:00", "21:01", { videoDurationS: null })]);
  assert.equal(r.focusRatio, null);
});

test("perLecture 暫停 vs session：間隔 <30 分算暫停、≥30 分切 session；longestPause 正確", () => {
  const r = perLecture([seg("21:00", "21:05"), seg("21:10", "21:15"), seg("21:45", "21:50"), seg("21:52", "21:55")]);
  assert.equal(r.sessions, 2); // 21:15 → 21:45 剛好 30 分 → 新 session
  assert.equal(r.pauses, 2); // 5 分、2 分
  assert.equal(r.longestPauseMs, 5 * 60000);
});

test("perLecture 重疊段（兩分頁）合併後不重複計時", () => {
  const r = perLecture([seg("21:00", "21:10"), seg("21:05", "21:12")]);
  assert.equal(r.watchedMs, 12 * 60000);
});

test("perLecture imported 行（start==end）用 watched_ms 直接加、不影響 session / 分心", () => {
  const r = perLecture([{ ...seg("21:00", "21:00"), watchedMs: 252000, endReason: "imported" }, seg("22:00", "22:01")]);
  assert.equal(r.watchedMs, 252000 + 60000);
  assert.equal(r.sessions, 1);
  assert.equal(r.imported, true);
});

test("perLecture completed 行給 completedAt、不計時", () => {
  const r = perLecture([{ ...seg("21:30", "21:30"), watchedMs: 0, endReason: "completed" }]);
  assert.equal(r.completedAt, "2026-09-09T21:30:00+08:00");
  assert.equal(r.watchedMs, 0);
});

test("perLecture seekBack 加總、空輸入全零", () => {
  const r = perLecture([seg("21:00", "21:01", { seekBackCount: 2, seekBackS: 30 }), seg("21:02", "21:03", { seekBackCount: 1, seekBackS: 5.5 })]);
  assert.equal(r.seekBackCount, 3);
  assert.equal(r.seekBackS, 35.5);
  const e = perLecture([]);
  assert.deepEqual([e.watchedMs, e.sessions, e.distractions, e.focusRatio, e.completedAt], [0, 0, 0, null, null]);
});

// ---------- perChapter ----------

test("perChapter：加總 / 加權平均 focusRatio / longestFocus 取 max", () => {
  const a = { watchedMs: 60000, distractions: 1, focusRatio: 1.0, durationS: 100, seekBackCount: 1, seekBackS: 5, longestFocusMs: 60000, segments: [seg("21:00", "21:01")] };
  const b = { watchedMs: 120000, distractions: 2, focusRatio: 0.5, durationS: 300, seekBackCount: 0, seekBackS: 0, longestFocusMs: 120000, segments: [seg("22:00", "22:02")] };
  const c = perChapter([a, b]);
  assert.equal(c.watchedMs, 180000);
  assert.equal(c.distractions, 3);
  assert.equal(c.focusRatio, (1.0 * 100 + 0.5 * 300) / 400);
  assert.equal(c.longestFocusMs, 120000);
  assert.equal(c.sessions, 2);
});

test("perChapter 全部 focusRatio null → null；空 → 全零", () => {
  assert.equal(perChapter([{ watchedMs: 1, distractions: 0, focusRatio: null, durationS: null, seekBackCount: 0, seekBackS: 0, longestFocusMs: 1, segments: [] }]).focusRatio, null);
  assert.equal(perChapter([]).watchedMs, 0);
});

// ---------- sessions ----------

test("sessions：30 分邊界、亂序、單段、空", () => {
  assert.equal(sessions([seg("21:00", "21:05"), seg("21:34", "21:40")], 30), 1); // 29 分 → 同 session
  assert.equal(sessions([seg("21:00", "21:05"), seg("21:35", "21:40")], 30), 2); // 剛好 30 → 新
  assert.equal(sessions([seg("22:00", "22:01"), seg("21:00", "21:01")], 30), 2);
  assert.equal(sessions([seg("21:00", "21:01")], 30), 1);
  assert.equal(sessions([], 30), 0);
});

// ---------- recentWindow ----------

test("recentWindow 只算窗內的段；completed 行算完成講數；分心/小時", () => {
  const now = "2026-09-09T23:00:00+08:00";
  const segs = [
    seg("20:00", "21:00", { endReason: "blur", posStart: 0, posEnd: 600 }),
    { ...seg("20:30", "20:30"), watchedMs: 0, endReason: "completed", lectureId: 1 },
    { ...seg("21:00", "22:00"), start: "2026-09-01T21:00:00+08:00", end: "2026-09-01T22:00:00+08:00" }, // 8 天前，排除
    { ...seg("21:00", "21:00"), start: "2026-08-01T00:00:00+08:00", end: "2026-08-01T00:00:00+08:00", watchedMs: 0, endReason: "completed", lectureId: 2 },
  ];
  const r = recentWindow(segs, 7, now);
  assert.equal(r.watchedMs, 3600000);
  assert.equal(r.completed, 1);
  assert.equal(r.distractionsPerHour, 1);
  assert.equal(r.focusRatio, 1); // 600/600
});

test("recentWindow 空 → 零、null", () => {
  const r = recentWindow([], 7, "2026-09-09T23:00:00+08:00");
  assert.deepEqual([r.watchedMs, r.completed, r.distractionsPerHour, r.focusRatio], [0, 0, 0, null]);
});

// ---------- byHourBucket ----------

test("byHourBucket 依時區把 segment_start 分到 6 個 4 小時桶、標最佳桶", () => {
  const segs = [
    seg("21:00", "22:00", { posStart: 0, posEnd: 600 }), // 20–24 桶，ratio 1
    seg("09:00", "09:30", { posStart: 0, posEnd: 150 }), // 08–12 桶，ratio 0.25
    { ...seg("00:00", "00:00"), start: "2026-09-09T23:30:00+08:00", end: "2026-09-10T00:30:00+08:00", watchedMs: 3600000 }, // 起點 23:30 → 20–24
  ];
  const r = byHourBucket(segs, TZ);
  assert.equal(r.buckets.length, 6);
  assert.equal(r.buckets[5].label, "20–24");
  assert.equal(r.buckets[5].watchedMs, 2 * 3600000);
  assert.equal(r.buckets[2].watchedMs, 30 * 60000);
  assert.equal(r.best.label, "20–24");
});

test("byHourBucket 時區不同結果不同（UTC 下 21:00+08 = 13:00 → 12–16）", () => {
  const r = byHourBucket([seg("21:00", "22:00")], "UTC");
  assert.equal(r.buckets[3].watchedMs, 3600000);
});

test("byHourBucket 空 → best null、各桶 0", () => {
  const r = byHourBucket([], TZ);
  assert.equal(r.best, null);
  assert.ok(r.buckets.every((b) => b.watchedMs === 0));
});

// ---------- weekly / isoWeek ----------

test("isoWeek：跨年邊界（2026-01-01 是 2026-W01；2027-01-01 是 2026-W53）", () => {
  assert.equal(isoWeek("2026-09-09T12:00:00+08:00", TZ), "2026-W37");
  assert.equal(isoWeek("2026-01-01T12:00:00+08:00", TZ), "2026-W01");
  assert.equal(isoWeek("2027-01-01T12:00:00+08:00", TZ), "2026-W53");
  assert.equal(isoWeek("2026-01-04T12:00:00+08:00", TZ), "2026-W01"); // 週日仍是 W01
  assert.equal(isoWeek("2026-01-05T12:00:00+08:00", TZ), "2026-W02"); // 週一 → W02
});

test("weekly 最近 N 週逐週列出（含零的週）、最新在最後", () => {
  const now = "2026-09-09T23:00:00+08:00";
  const segs = [
    seg("21:00", "22:00", { endReason: "blur" }),
    { ...seg("21:00", "22:00"), start: "2026-08-25T21:00:00+08:00", end: "2026-08-25T22:00:00+08:00" }, // W35
  ];
  const w = weekly(segs, 4, now, TZ);
  assert.deepEqual(w.map((x) => x.week), ["2026-W34", "2026-W35", "2026-W36", "2026-W37"]);
  assert.equal(w[3].watchedMs, 3600000);
  assert.equal(w[3].distractionsPerHour, 1);
  assert.equal(w[1].watchedMs, 3600000);
  assert.equal(w[0].watchedMs, 0);
});
