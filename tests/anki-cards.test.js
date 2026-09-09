import test from "node:test";
import assert from "node:assert/strict";
import { cardFingerprint, draftKey, validateCardPackage } from "../src/anki/cards.js";

const basic = (n = 1) => ({
  type: "basic",
  front: `Question ${n}`,
  back: `Answer ${n}`,
  sourceStartSec: n,
  sourceEndSec: n + 1,
  reason: "核心概念",
  tags: ["concept", "important"],
});
const cloze = () => ({
  type: "cloze",
  text: "The {{c1::viewport}} shows the scene.",
  extra: "Blender UI",
  sourceStartSec: 3,
  sourceEndSec: 4,
  reason: "術語",
  tags: ["term"],
});
const pkg = (cards = [basic(1), basic(2), basic(3), basic(4), cloze()]) => ({
  schemaVersion: 1,
  course: { id: "42", title: " Blender 基礎 ", slug: "blender-basic" },
  unit: { id: "12", chapterTitle: "介面", title: "Viewport", url: "https://www.udemy.com/course/blender-basic/learn/lecture/12" },
  cards,
  warnings: [],
});

test("validateCardPackage 正規化字串與 tags 並接受 5 張 Basic/Cloze", () => {
  const out = validateCardPackage(pkg(), { expectedCourseId: "42", expectedUnitId: "12" });
  assert.equal(out.course.title, "Blender 基礎");
  assert.equal(out.cards.length, 5);
  assert.deepEqual(out.cards[0].tags, ["concept", "important"]);
});

test("validateCardPackage 接受上限 10 張", () => {
  assert.equal(validateCardPackage(pkg(Array.from({ length: 10 }, (_, i) => basic(i + 1)))).cards.length, 10);
});

test("validateCardPackage 拒絕 0、1、4 與 11 張", () => {
  for (const n of [0, 1, 4, 11]) assert.throws(() => validateCardPackage(pkg(Array.from({ length: n }, (_, i) => basic(i + 1)))), /5 到 10/);
});

test("validateCardPackage 拒絕未知或非整數 schemaVersion", () => {
  for (const v of [0, 2, 1.5, "1"]) assert.throws(() => validateCardPackage({ ...pkg(), schemaVersion: v }), /schemaVersion/);
});

test("validateCardPackage 拒絕缺欄位、未知欄位與型別混雜", () => {
  const missing = pkg(); delete missing.course.slug;
  assert.throws(() => validateCardPackage(missing), /course/);
  assert.throws(() => validateCardPackage({ ...pkg(), extra: true }), /未知欄位/);
  assert.throws(() => validateCardPackage({ ...pkg(), warnings: [1] }), /warnings/);
});

test("validateCardPackage 拒絕空白字串與空 tags，並將重複 tags 去重", () => {
  const empty = pkg(); empty.cards[0].front = "   ";
  assert.throws(() => validateCardPackage(empty), /front/);
  const noTags = pkg(); noTags.cards[0].tags = [];
  assert.throws(() => validateCardPackage(noTags), /tags/);
  const dup = pkg(); dup.cards[0].tags = ["a", "a", " b "];
  assert.deepEqual(validateCardPackage(dup).cards[0].tags, ["a", "b"]);
});

test("validateCardPackage 拒絕未知卡片類型及類型不符欄位", () => {
  const unknown = pkg(); unknown.cards[0].type = "image";
  assert.throws(() => validateCardPackage(unknown), /type/);
  const extra = pkg(); extra.cards[0].text = "wrong";
  assert.throws(() => validateCardPackage(extra), /未知欄位/);
});

test("validateCardPackage 拒絕沒有合法 cloze 的文字", () => {
  for (const text of ["plain", "{{c0::x}}", "{{c1::}}", "{{c1:x}}"] ) {
    const value = pkg(); value.cards[4].text = text;
    assert.throws(() => validateCardPackage(value), /cloze/);
  }
});

test("validateCardPackage 拒絕 NaN、負數與 end 小於 start", () => {
  for (const [start, end] of [[NaN, 1], [-1, 1], [2, 1], [0, Infinity]]) {
    const value = pkg(); value.cards[0].sourceStartSec = start; value.cards[0].sourceEndSec = end;
    assert.throws(() => validateCardPackage(value), /source/);
  }
});

test("validateCardPackage 驗證目前 course/unit，避免匯入錯誤頁面", () => {
  assert.throws(() => validateCardPackage(pkg(), { expectedCourseId: "99" }), /課程不符/);
  assert.throws(() => validateCardPackage(pkg(), { expectedUnitId: "99" }), /單元不符/);
});

test("validateCardPackage 相同 ID 但偽造課程、單元 metadata 時拒絕", () => {
  const expected = { expectedCourse: pkg().course, expectedUnit: pkg().unit };
  for (const mutate of [
    (value) => { value.course.title = "ATTACKER::DECK"; },
    (value) => { value.course.slug = "attacker"; },
    (value) => { value.unit.chapterTitle = "Other"; },
    (value) => { value.unit.title = "Other"; },
    (value) => { value.unit.url = "https://www.udemy.com/course/other/learn/lecture/12"; },
  ]) {
    const value = pkg();
    mutate(value);
    assert.throws(() => validateCardPackage(value, expected), /不符/);
  }
});

test("validateCardPackage 拒絕過長卡片欄位與過大的完整 JSON", () => {
  const longField = pkg();
  longField.cards[0].front = "x".repeat(20_001);
  assert.throws(() => validateCardPackage(longField), /過長/);
  const huge = pkg();
  huge.warnings = Array.from({ length: 100 }, () => "x".repeat(20_000));
  assert.throws(() => validateCardPackage(huge), /過大|過長/);
});

test("validateCardPackage 拒絕非 Udemy HTTPS 單元 URL", () => {
  for (const url of ["http://www.udemy.com/course/x/learn/lecture/12", "https://evil.test/course/x/learn/lecture/12", "not-url"]) {
    const value = pkg(); value.unit.url = url;
    assert.throws(() => validateCardPackage(value), /url/);
  }
});

test("cardFingerprint 對相同正規化內容穩定、內容或單元不同時不同", async () => {
  const a = await cardFingerprint(pkg().cards[0], { courseId: "42", unitId: "12" });
  const b = await cardFingerprint({ ...pkg().cards[0], front: " Question 1 " }, { courseId: 42, unitId: 12 });
  const c = await cardFingerprint({ ...pkg().cards[0], front: "Different" }, { courseId: "42", unitId: "12" });
  const d = await cardFingerprint(pkg().cards[0], { courseId: "42", unitId: "13" });
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test("draftKey 以 course/unit 組合且拒絕空值", () => {
  assert.equal(draftKey("42", "12"), "anki:draft:42:12");
  assert.throws(() => draftKey("", "12"), TypeError);
});
