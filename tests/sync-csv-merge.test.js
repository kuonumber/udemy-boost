// watch-log.csv 的跨裝置合併：grow-only set，以正規化後的整列為身分。
// 這是 Phase 6a 的核心——兩台電腦各自追加列，合併後不得重複、不得遺失、順序必須決定性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowKey, mergeCsv } from "../src/sync/csv-merge.js";
import { headerLine, toRow, parseRows } from "../src/focus/csv.js";

const seg = (o = {}) => ({
  start: "2026-09-10T01:00:00.000Z",
  end: "2026-09-10T01:05:00.000Z",
  lectureId: 52212451,
  chapterIndex: 1,
  lectureIndex: 2,
  title: "Interface and settings",
  watchedMs: 300000,
  posStart: 0,
  posEnd: 300,
  rate: 1,
  endReason: "pause",
  seekBackCount: 0,
  seekBackS: 0,
  videoDurationS: 600,
  extVersion: "0.6.0",
  ...o,
});

const csv = (...segs) => headerLine() + segs.map(toRow).join("");

test("rowKey 對同一列穩定，對任一欄位不同的列不同", () => {
  const a = seg();
  assert.equal(rowKey(a), rowKey(seg()));
  assert.notEqual(rowKey(a), rowKey(seg({ watchedMs: 300001 })));
  assert.notEqual(rowKey(a), rowKey(seg({ start: "2026-09-10T01:00:00.001Z" })));
  assert.notEqual(rowKey(a), rowKey(seg({ title: "Interface and settings " })));
});

test("rowKey 不受欄位物件順序影響（只看正規化後的值）", () => {
  const a = seg();
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(rowKey(reordered), rowKey(a));
});

test("兩邊都空 → 只有 header", () => {
  const r = mergeCsv("", "");
  assert.equal(r.text, headerLine());
  assert.deepEqual([r.added, r.total, r.bad], [0, 0, 0]);
});

test("單邊有資料 → 全部保留", () => {
  const a = seg({ start: "2026-09-10T01:00:00.000Z" });
  assert.equal(parseRows(mergeCsv(csv(a), "").text).rows.length, 1);
  assert.equal(parseRows(mergeCsv("", csv(a)).text).rows.length, 1);
});

test("完全重疊 → 不重複（同一份 CSV 合併自己）", () => {
  const text = csv(seg(), seg({ start: "2026-09-10T02:00:00.000Z" }));
  const r = mergeCsv(text, text);
  assert.equal(parseRows(r.text).rows.length, 2);
  assert.equal(r.added, 0, "遠端沒有本地缺的列");
});

test("部分重疊 → 聯集且依 start 排序", () => {
  const s1 = seg({ start: "2026-09-10T01:00:00.000Z" });
  const s2 = seg({ start: "2026-09-10T02:00:00.000Z" });
  const s3 = seg({ start: "2026-09-10T03:00:00.000Z" });
  const r = mergeCsv(csv(s1, s2), csv(s2, s3));
  const rows = parseRows(r.text).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((x) => x.start), [s1.start, s2.start, s3.start]);
  assert.equal(r.added, 1, "只有 s3 是遠端新增的");
});

test("亂序輸入 → 輸出仍依時間排序", () => {
  const s1 = seg({ start: "2026-09-10T01:00:00.000Z" });
  const s2 = seg({ start: "2026-09-10T02:00:00.000Z" });
  const s3 = seg({ start: "2026-09-10T03:00:00.000Z" });
  const rows = parseRows(mergeCsv(csv(s3, s1), csv(s2)).text).rows;
  assert.deepEqual(rows.map((x) => x.start), [s1.start, s2.start, s3.start]);
});

test("同一時間戳的不同列都保留，且順序決定性（交換輸入結果相同）", () => {
  const a = seg({ lectureId: 1 });
  const b = seg({ lectureId: 2 });
  const ab = mergeCsv(csv(a), csv(b)).text;
  const ba = mergeCsv(csv(b), csv(a)).text;
  assert.equal(ab, ba, "合併必須可交換，否則兩台機器會互相覆寫");
  assert.equal(parseRows(ab).rows.length, 2);
});

test("合併是冪等的：再合併一次結果不變", () => {
  const once = mergeCsv(csv(seg()), csv(seg({ start: "2026-09-10T02:00:00.000Z" }))).text;
  assert.equal(mergeCsv(once, once).text, once);
});

test("壞行被計數且不進輸出，好行不受影響", () => {
  const broken = headerLine() + "not,a,valid,row\r\n" + toRow(seg());
  const r = mergeCsv(broken, "");
  assert.equal(parseRows(r.text).rows.length, 1);
  assert.ok(r.bad >= 1, "壞行要被回報，不能靜默吞掉");
});

test("缺 header 的遠端內容不會污染輸出", () => {
  // 只有資料列、沒有 header：parseRows 會把第一列當 header，資料就不該被誤認
  const r = mergeCsv(csv(seg()), toRow(seg({ start: "2026-09-10T05:00:00.000Z" })));
  const rows = parseRows(r.text).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, "2026-09-10T01:00:00.000Z");
});

test("輸出一律帶 BOM header 與 CRLF，Excel 開得動", () => {
  const text = mergeCsv(csv(seg()), "").text;
  assert.ok(text.startsWith("﻿"), "缺 BOM，Excel 會把中文顯示成亂碼");
  assert.ok(text.includes("\r\n"));
  assert.ok(text.endsWith("\r\n"));
});

test("不同 extVersion 的相同觀看段視為不同列（保留兩者，不臆測哪個對）", () => {
  const r = mergeCsv(csv(seg({ extVersion: "0.5.3" })), csv(seg({ extVersion: "0.6.0" })));
  assert.equal(parseRows(r.text).rows.length, 2);
});

test("含逗號與引號的標題能無損往返", () => {
  const s = seg({ title: 'A, "B" and C' });
  const rows = parseRows(mergeCsv(csv(s), "").text).rows;
  assert.equal(rows[0].title, 'A, "B" and C');
});

test("非字串輸入丟 TypeError", () => {
  assert.throws(() => mergeCsv(null, ""), TypeError);
  assert.throws(() => mergeCsv("", undefined), TypeError);
});
