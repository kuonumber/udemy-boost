// notes.md 的跨裝置合併（Phase 6b）。
// 筆記是手寫內容，不能像 CSV 那樣無腦聯集，也絕不能單邊覆蓋——任何情況都不准弄丟字。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotes, renderNotes, mergeNotes, noteMarker, legacyId } from "../src/sync/notes-merge.js";

const HEADER = "# 課程 — 回想筆記\n\n<!-- Udemy Boost notes; 每則以 lectureId 標記 -->\n\n";
const entry = (id, lecture, text, rev) =>
  `${noteMarker({ id, lectureId: lecture, rev })}\n## 01. 章 / 02. 講\n\n- 2026-09-10 10:00 — ${text}\n\n`;
const legacy = (lecture, text) => `<!-- lecture:${lecture} -->\n## 01. 章 / 02. 講\n\n- 2026-09-10 10:00 — ${text}\n\n`;

test("parseNotes：空字串 / null → 沒有 entry，header 為空", () => {
  for (const v of ["", null, undefined]) {
    const r = parseNotes(v);
    assert.deepEqual(r.entries, []);
  }
});

test("parseNotes：讀得出新格式的 id / lectureId / rev", () => {
  const r = parseNotes(HEADER + entry("abc", 52212451, "重點一", "2026-09-10T10:00:00Z"));
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].id, "abc");
  assert.equal(r.entries[0].lectureId, "52212451");
  assert.equal(r.entries[0].rev, "2026-09-10T10:00:00Z");
  assert.match(r.entries[0].body, /重點一/);
});

test("parseNotes：舊格式（只有 lecture 標記）也要讀得出來，id 由內容決定", () => {
  const text = HEADER + legacy(52212451, "舊筆記");
  const a = parseNotes(text).entries[0];
  const b = parseNotes(text).entries[0];
  assert.equal(a.id, b.id, "同內容跑兩次必須得到同一個 id，否則兩台機器會各自產生重複");
  assert.equal(a.id, legacyId({ lectureId: "52212451", body: a.body }));
  assert.equal(a.legacy, true);
});

test("parseNotes：header 保留，entry 之外的內容不被吃掉", () => {
  const r = parseNotes(HEADER + entry("a", 1, "x"));
  assert.match(r.header, /回想筆記/);
});

test("renderNotes(parseNotes(x)) 對新格式是還原的", () => {
  const text = HEADER + entry("a", 1, "x", "2026-09-10T10:00:00Z") + entry("b", 2, "y", "2026-09-10T11:00:00Z");
  const r = parseNotes(text);
  assert.equal(renderNotes(r.header, r.entries), text);
});

test("合併：兩台各寫一則 → 兩則都在，依時間排序", () => {
  const A = HEADER + entry("a", 1, "本機的", "2026-09-10T10:00:00Z");
  const B = HEADER + entry("b", 2, "雲端的", "2026-09-10T09:00:00Z");
  const m = mergeNotes(A, B);
  assert.equal(m.total, 2);
  assert.deepEqual(parseNotes(m.text).entries.map((e) => e.id), ["b", "a"], "依 rev 由舊到新");
  assert.equal(m.added, 1);
});

test("合併：完全相同 → 不重複，且冪等", () => {
  const A = HEADER + entry("a", 1, "同一則", "2026-09-10T10:00:00Z");
  const once = mergeNotes(A, A).text;
  assert.equal(parseNotes(once).entries.length, 1);
  assert.equal(mergeNotes(once, once).text, once);
});

test("合併：同 id 內容不同 → 取 rev 較新者，舊的不留", () => {
  const older = HEADER + entry("a", 1, "舊版本", "2026-09-10T10:00:00Z");
  const newer = HEADER + entry("a", 1, "新版本", "2026-09-10T12:00:00Z");
  for (const [x, y] of [[older, newer], [newer, older]]) {
    const m = mergeNotes(x, y);
    assert.equal(m.total, 1);
    assert.match(m.text, /新版本/);
    assert.doesNotMatch(m.text, /舊版本/);
  }
});

test("合併：同 id、rev 相同但內容不同 → 兩則都留並標記衝突（絕不丟字）", () => {
  const A = HEADER + entry("a", 1, "本機寫的", "2026-09-10T10:00:00Z");
  const B = HEADER + entry("a", 1, "雲端寫的", "2026-09-10T10:00:00Z");
  const m = mergeNotes(A, B);
  assert.equal(m.conflicts, 1);
  assert.match(m.text, /本機寫的/);
  assert.match(m.text, /雲端寫的/);
  assert.match(m.text, /ub:conflict/);
});

test("合併可交換：A∪B 與 B∪A 位元相同（否則兩台會互相上傳到天荒地老）", () => {
  const A = HEADER + entry("a", 1, "x", "2026-09-10T10:00:00Z") + entry("c", 3, "z", "2026-09-10T12:00:00Z");
  const B = HEADER + entry("b", 2, "y", "2026-09-10T11:00:00Z");
  assert.equal(mergeNotes(A, B).text, mergeNotes(B, A).text);
});

test("合併：舊格式與新格式混在一起也要處理", () => {
  const A = HEADER + legacy(1, "舊的") + entry("n1", 2, "新的", "2026-09-10T11:00:00Z");
  const B = HEADER + legacy(1, "舊的");
  const m = mergeNotes(A, B);
  assert.equal(m.total, 2, "同一則舊筆記在兩邊都有，靠內容 id 去重");
});

test("合併：單邊為空", () => {
  const A = HEADER + entry("a", 1, "只有本機", "2026-09-10T10:00:00Z");
  assert.equal(parseNotes(mergeNotes(A, "").text).entries.length, 1);
  assert.equal(parseNotes(mergeNotes("", A).text).entries.length, 1);
});

test("合併：header 以非空的那份為準", () => {
  const A = HEADER + entry("a", 1, "x", "2026-09-10T10:00:00Z");
  assert.match(mergeNotes(A, "").text, /回想筆記/);
  assert.match(mergeNotes("", A).text, /回想筆記/);
});

test("合併：沒有 rev 的 entry 不會讓排序爆掉", () => {
  const A = HEADER + entry("a", 1, "沒有 rev");
  const B = HEADER + entry("b", 2, "有 rev", "2026-09-10T10:00:00Z");
  assert.equal(parseNotes(mergeNotes(A, B).text).entries.length, 2);
});

test("非字串輸入丟 TypeError", () => {
  assert.throws(() => mergeNotes(123, ""), TypeError);
  assert.throws(() => mergeNotes("", {}), TypeError);
});

test("noteMarker 產生可被 parseNotes 讀回的標記", () => {
  const m = noteMarker({ id: "zz", lectureId: 99, rev: "2026-09-10T10:00:00Z" });
  const e = parseNotes(`${m}\n內容\n\n`).entries[0];
  assert.equal(e.id, "zz");
  assert.equal(e.lectureId, "99");
  assert.equal(e.rev, "2026-09-10T10:00:00Z");
});
