import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, curriculumUrl } from "../src/download/curriculum.js";

const course = { slug: "blender-start", title: "Complete Blender 2026" };
const chapter = (id, idx, title) => ({ _class: "chapter", id, object_index: idx, title });
const file = (id, filename, size = 100, url = `https://cdn/${id}`) => ({
  _class: "asset", id, asset_type: "File", filename, title: filename, file_size: size,
  download_urls: url ? { File: [{ label: "download", file: url }] } : null,
});
const link = (id, title, url) => ({ _class: "asset", id, asset_type: "ExternalLink", title, external_url: url, download_urls: null });
const lecture = (id, idx, title, assets = []) => ({ _class: "lecture", id, object_index: idx, title, supplementary_assets: assets });

test("buildPlan 基本：章 / 講 / 檔案路徑", () => {
  const plan = buildPlan(
    [chapter(1, 1, "Intro"), lecture(10, 2, "Navigation interface", [file(100, "03-Navigation.blend", 1303326)])],
    course,
  );
  assert.equal(plan.courseSlug, "blender-start");
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.items[0], {
    lectureId: 10, assetId: 100, filename: "03-Navigation.blend", size: 1303326, url: "https://cdn/100",
    path: "Udemy/Complete Blender 2026/01. Intro/02. Navigation interface/03-Navigation.blend",
  });
  assert.equal(plan.totalBytes, 1303326);
});

test("buildPlan 保持 API 順序，不依 object_index 重排（chapter / lecture 序號各自獨立）", () => {
  // 實際資料：c1, l1..l9, c2, l10 — 若拿 object_index 混合排序，l4 會被排到 c3 後面
  const plan = buildPlan(
    [chapter(1, 1, "Intro"), lecture(11, 1, "A", [file(1, "a.pdf")]), lecture(12, 4, "D", [file(4, "d.pdf")]),
     chapter(2, 2, "Modeling"), lecture(13, 5, "E", [file(5, "e.pdf")]), chapter(3, 3, "Materials")],
    course,
  );
  assert.deepEqual(plan.items.map((i) => i.path), [
    "Udemy/Complete Blender 2026/01. Intro/01. A/a.pdf",
    "Udemy/Complete Blender 2026/01. Intro/04. D/d.pdf",
    "Udemy/Complete Blender 2026/02. Modeling/05. E/e.pdf",
  ]);
});

test("buildPlan 講次在任何 chapter 之前 → 00. (no section)", () => {
  const plan = buildPlan([lecture(10, 1, "Welcome", [file(1, "w.pdf")]), chapter(2, 2, "S1")], course);
  assert.equal(plan.items[0].path, "Udemy/Complete Blender 2026/00. (no section)/01. Welcome/w.pdf");
});

test("buildPlan ExternalLink 進 links，不進 items", () => {
  const plan = buildPlan(
    [chapter(1, 1, "S"), lecture(10, 2, "L", [link(5, "Blender Library", "https://drive.google.com/x")])],
    course,
  );
  assert.equal(plan.items.length, 0);
  assert.deepEqual(plan.links, [{ chapter: "01. S", lecture: "02. L", title: "Blender Library", url: "https://drive.google.com/x" }]);
});

test("buildPlan File 缺 download url → skipped", () => {
  const plan = buildPlan([lecture(10, 1, "L", [file(1, "x.pdf", 10, null)])], course);
  assert.equal(plan.items.length, 0);
  assert.deepEqual(plan.skipped, [{ assetId: 1, lectureId: 10, reason: "no download url" }]);
});

test("buildPlan 未知 asset_type → skipped 帶 type", () => {
  const plan = buildPlan([lecture(10, 1, "L", [{ _class: "asset", id: 7, asset_type: "SourceCode", title: "code" }])], course);
  assert.deepEqual(plan.skipped, [{ assetId: 7, lectureId: 10, reason: "unsupported type SourceCode" }]);
});

test("buildPlan 同一 assetId 出現在多講次只留第一個", () => {
  const plan = buildPlan(
    [lecture(10, 1, "A", [file(1, "x.pdf")]), lecture(11, 2, "B", [file(1, "x.pdf")])],
    course,
  );
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].lectureId, 10);
});

test("buildPlan 同一講次兩個同名檔 → 第二個加 (2)", () => {
  const plan = buildPlan([lecture(10, 1, "A", [file(1, "x.pdf"), file(2, "x.pdf")])], course);
  assert.deepEqual(plan.items.map((i) => i.path.split("/").pop()), ["x.pdf", "x (2).pdf"]);
});

test("buildPlan 檔名 / 章節名含非法字元會被清洗", () => {
  const plan = buildPlan([chapter(1, 1, 'Q&A: "why?"'), lecture(10, 2, "a/b", [file(1, "re:port.pdf")])], course);
  assert.equal(plan.items[0].path, "Udemy/Complete Blender 2026/01. Q&A why/02. ab/report.pdf");
});

test("buildPlan 講次沒有 supplementary_assets 欄位 / 為 null → 忽略", () => {
  const plan = buildPlan([{ _class: "lecture", id: 1, object_index: 1, title: "x" }, { _class: "lecture", id: 2, object_index: 2, title: "y", supplementary_assets: null }], course);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped.length, 0);
});

test("buildPlan quiz / practice 等非 lecture 項目忽略", () => {
  const plan = buildPlan([{ _class: "quiz", id: 1, object_index: 1, title: "q" }, { _class: "practice", id: 2, object_index: 2 }], course);
  assert.equal(plan.items.length, 0);
});

test("buildPlan 空 results → 空 Plan", () => {
  const plan = buildPlan([], course);
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.totalBytes, 0);
});

test("buildPlan 非陣列丟 TypeError；course 缺 slug 丟 TypeError", () => {
  assert.throws(() => buildPlan(null, course), TypeError);
  assert.throws(() => buildPlan([], {}), TypeError);
});

test("buildPlan file_size 缺或非數字 → size null、totalBytes 不算它、unknownSizeCount +1", () => {
  const a = file(1, "x.pdf", 100);
  const b = { ...file(2, "y.pdf"), file_size: undefined };
  const plan = buildPlan([lecture(10, 1, "L", [a, b])], course);
  assert.equal(plan.items[1].size, null);
  assert.equal(plan.totalBytes, 100);
  assert.equal(plan.unknownSizeCount, 1);
});

test("curriculumUrl 含必要 fields 且 courseId 必為數字", () => {
  const u = curriculumUrl("6775439");
  assert.ok(u.startsWith("/api-2.0/courses/6775439/subscriber-curriculum-items/?"));
  assert.ok(u.includes("supplementary_assets"));
  assert.ok(u.includes("download_urls"));
  assert.throws(() => curriculumUrl("../x"), RangeError);
});

test("buildPlan 課程資料夾用課程名稱；沒有 title 才退 slug", () => {
  const withTitle = buildPlan([lecture(10, 1, "L", [file(1, "x.pdf")])], { slug: "blender-start", title: "Complete Blender 2026: Studio-Ready" });
  assert.equal(withTitle.root, "Udemy/Complete Blender 2026 Studio-Ready");
  const noTitle = buildPlan([lecture(10, 1, "L", [file(1, "x.pdf")])], { slug: "blender-start" });
  assert.equal(noTitle.root, "Udemy/blender-start");
  const blankTitle = buildPlan([], { slug: "blender-start", title: "   " });
  assert.equal(blankTitle.root, "Udemy/blender-start");
});
