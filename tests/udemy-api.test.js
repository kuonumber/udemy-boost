import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLectureId, parseCourseIdFromModuleArgs, buildCaptionsUrl } from "../src/udemy-api.js";

test("parseLectureId 從 learn 頁 URL 取 lecture id", () => {
  assert.equal(parseLectureId("https://www.udemy.com/course/blender-start/learn/lecture/52212451#overview"), "52212451");
  assert.equal(parseLectureId("/course/x/learn/lecture/1/"), "1");
  assert.equal(parseLectureId("https://www.udemy.com/course/x/learn/lecture/99?start=15"), "99");
});

test("parseLectureId 非 lecture 頁回 null", () => {
  assert.equal(parseLectureId("https://www.udemy.com/course/blender-start/"), null);
  assert.equal(parseLectureId("https://www.udemy.com/course/x/learn/quiz/123"), null);
  assert.equal(parseLectureId("https://www.udemy.com/course/x/learn/practice/5"), null);
  assert.equal(parseLectureId(""), null);
  assert.equal(parseLectureId(null), null);
});

test("parseCourseIdFromModuleArgs 取 courseId 為字串", () => {
  assert.equal(parseCourseIdFromModuleArgs('{"courseId":6775439,"other":1}'), "6775439");
  assert.equal(parseCourseIdFromModuleArgs('{"courseId":"123"}'), "123");
});

test("parseCourseIdFromModuleArgs 壞 JSON / 缺欄位 / 非數字 回 null", () => {
  assert.equal(parseCourseIdFromModuleArgs("not json"), null);
  assert.equal(parseCourseIdFromModuleArgs("{}"), null);
  assert.equal(parseCourseIdFromModuleArgs('{"courseId":"abc"}'), null);
  assert.equal(parseCourseIdFromModuleArgs('{"courseId":0}'), null);
  assert.equal(parseCourseIdFromModuleArgs(null), null);
});

test("buildCaptionsUrl 產生同源 API 路徑", () => {
  assert.equal(
    buildCaptionsUrl("6775439", "52212451"),
    "/api-2.0/users/me/subscribed-courses/6775439/lectures/52212451/?fields[lecture]=asset&fields[asset]=captions",
  );
});

test("buildCaptionsUrl 拒絕非數字 id（避免 path injection）", () => {
  assert.throws(() => buildCaptionsUrl("../x", "1"), RangeError);
  assert.throws(() => buildCaptionsUrl("1", ""), RangeError);
  assert.throws(() => buildCaptionsUrl("1", "2?x=1"), RangeError);
});
