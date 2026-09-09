import test from "node:test";
import assert from "node:assert/strict";
import { buildStudyPackData } from "../src/anki/context.js";

test("buildStudyPackData 將目前課程單元與雙語字幕組成 localhost payload", () => {
  const result = buildStudyPackData({
    courseId: 42,
    courseTitle: " Blender ",
    courseSlug: "blender",
    lectureId: 12,
    pageUrl: "https://www.udemy.com/course/blender/learn/lecture/12",
    curriculum: [{ _class: "chapter", title: "介面" }, { _class: "lecture", id: 12, title: "Viewport", object_index: 2 }],
    tracks: { en: [{ start: 0, end: 1, text: "Hello" }], zh: [{ start: 0, end: 1, text: "你好" }] },
  });
  assert.equal(result.course.id, "42");
  assert.equal(result.unit.chapterTitle, "介面");
  assert.deepEqual(result.subtitles.en[0], { start: 0, end: 1, text: "Hello" });
});

test("buildStudyPackData 拒絕找不到單元、兩軌皆空與非 Udemy URL", () => {
  const base = {
    courseId: 42, courseTitle: "Course", courseSlug: "course", lectureId: 12,
    pageUrl: "https://www.udemy.com/course/course/learn/lecture/12",
    curriculum: [{ _class: "lecture", id: 12, title: "Unit" }],
    tracks: { en: [{ start: 0, end: 1, text: "x" }], zh: [] },
  };
  assert.throws(() => buildStudyPackData({ ...base, lectureId: 99 }), /找不到/);
  assert.throws(() => buildStudyPackData({ ...base, tracks: { en: [], zh: [] } }), /字幕/);
  assert.throws(() => buildStudyPackData({ ...base, pageUrl: "https://evil.test/x" }), /URL/);
});

test("buildStudyPackData 複製 cue 並拒絕 NaN、逆序及型別混雜", () => {
  const base = {
    courseId: "42", courseTitle: "Course", courseSlug: "course", lectureId: "12",
    pageUrl: "https://www.udemy.com/course/course/learn/lecture/12",
    curriculum: [{ _class: "lecture", id: 12, title: "Unit" }], zh: [],
  };
  for (const cue of [
    { start: NaN, end: 1, text: "x" },
    { start: 2, end: 1, text: "x" },
    { start: 0, end: 1, text: 3 },
  ]) assert.throws(() => buildStudyPackData({ ...base, tracks: { en: [cue], zh: [] } }), /cue/);
});

