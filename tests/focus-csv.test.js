import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADER, toRow, parseRows, mergeOverlaps, headerLine, escapeField } from "../src/focus/csv.js";

const seg = (o = {}) => ({
  start: "2026-09-09T21:00:00+08:00", end: "2026-09-09T21:05:00+08:00", lectureId: 1, chapterIndex: 1, lectureIndex: 2,
  title: "Interface", watchedMs: 300000, posStart: 0, posEnd: 290.5, rate: 1, endReason: "pause",
  seekBackCount: 0, seekBackS: 0, videoDurationS: 600, extVersion: "0.5.0", ...o,
});

test("headerLine 為 BOM + 欄位名", () => {
  assert.ok(headerLine().startsWith("﻿"));
  assert.equal(headerLine().slice(1).trim(), HEADER.join(","));
});

test("escapeField：含逗號 / 引號 / 換行才加引號，引號雙寫", () => {
  assert.equal(escapeField("plain"), "plain");
  assert.equal(escapeField("a,b"), '"a,b"');
  assert.equal(escapeField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeField("l1\nl2"), '"l1\nl2"');
  assert.equal(escapeField(null), "");
  assert.equal(escapeField(3.5), "3.5");
});

test("toRow 欄位順序與 HEADER 一致，結尾 CRLF", () => {
  const row = toRow(seg({ title: "a, b" }));
  assert.ok(row.endsWith("\r\n"));
  const cols = parseRows(headerLine() + row).rows;
  assert.equal(cols.length, 1);
  assert.equal(cols[0].title, "a, b");
  assert.equal(cols[0].watchedMs, 300000);
  assert.equal(cols[0].posEnd, 290.5);
});

test("parseRows 往返恆等（含引號、換行、Unicode）", () => {
  const s = seg({ title: '講次 "A" | 第一\n行', posEnd: 12.25, seekBackCount: 2, seekBackS: 7.5 });
  const { rows, bad } = parseRows(headerLine() + toRow(s));
  assert.equal(bad, 0);
  assert.deepEqual(rows[0], s);
});

test("parseRows 容忍：無 BOM、LF、CRLF、尾端空行、欄位順序不同（以 header 為準）", () => {
  const text = "lecture_title,segment_start,segment_end,lecture_id,watched_ms,end_reason\nX,2026-09-09T21:00:00+08:00,2026-09-09T21:01:00+08:00,7,60000,pause\n\n";
  const { rows, bad } = parseRows(text);
  assert.equal(bad, 0);
  assert.equal(rows[0].lectureId, 7);
  assert.equal(rows[0].title, "X");
  assert.equal(rows[0].posStart, null); // 缺欄補 null
});

test("parseRows 壞行（欄數不夠 / 非數字）計入 bad 並跳過", () => {
  const text = headerLine() + toRow(seg()) + "garbage line\r\n" + toRow(seg({ watchedMs: "abc" }));
  const { rows, bad } = parseRows(text);
  assert.equal(rows.length, 1);
  assert.equal(bad, 2);
});

test("parseRows 空字串 / 只有 header / 非字串", () => {
  assert.deepEqual(parseRows(""), { rows: [], bad: 0 });
  assert.deepEqual(parseRows(headerLine()), { rows: [], bad: 0 });
  assert.throws(() => parseRows(null), TypeError);
});

test("parseRows 未知 header 欄位忽略、缺 segment_start 的行算壞", () => {
  const text = "segment_start,segment_end,lecture_id,watched_ms,end_reason,foo\n,2026-09-09T21:01:00+08:00,7,60000,pause,bar\n";
  const { rows, bad } = parseRows(text);
  assert.equal(rows.length, 0);
  assert.equal(bad, 1);
});

// ---------- mergeOverlaps ----------
const iv = (s, e) => ({ start: `2026-09-09T${s}:00+08:00`, end: `2026-09-09T${e}:00+08:00` });

test("mergeOverlaps 無重疊 → 各段長度相加", () => {
  assert.equal(mergeOverlaps([iv("21:00", "21:05"), iv("21:10", "21:12")]), 7 * 60000);
});

test("mergeOverlaps 部分重疊 / 完全包含 / 相接", () => {
  assert.equal(mergeOverlaps([iv("21:00", "21:05"), iv("21:03", "21:08")]), 8 * 60000);
  assert.equal(mergeOverlaps([iv("21:00", "21:10"), iv("21:02", "21:04")]), 10 * 60000);
  assert.equal(mergeOverlaps([iv("21:00", "21:05"), iv("21:05", "21:07")]), 7 * 60000);
});

test("mergeOverlaps 亂序輸入、空陣列、start==end 的點（imported / completed）不計", () => {
  assert.equal(mergeOverlaps([iv("21:10", "21:12"), iv("21:00", "21:05")]), 7 * 60000);
  assert.equal(mergeOverlaps([]), 0);
  assert.equal(mergeOverlaps([iv("21:00", "21:00")]), 0);
});

test("mergeOverlaps 無效時間字串的段跳過", () => {
  assert.equal(mergeOverlaps([{ start: "x", end: "y" }, iv("21:00", "21:01")]), 60000);
});
