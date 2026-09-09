import { findUnitContext } from "./study-pack.js";

const UDEMY_UNIT_URL = /^https:\/\/(?:www\.)?udemy\.com\/course\/[^/]+\/learn\/.*lecture\/\d+/u;

function requiredText(value, name) {
  const result = String(value ?? "").trim();
  if (!result) throw new TypeError(`${name} 不得為空`);
  return result;
}

function copyCues(items, label) {
  if (!Array.isArray(items)) throw new TypeError(`${label} cue 必須是陣列`);
  return items.map((cue, index) => {
    if (!cue || typeof cue.text !== "string" || !cue.text.trim()) throw new TypeError(`${label} cue[${index}] 文字無效`);
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end < cue.start) throw new TypeError(`${label} cue[${index}] 時間無效`);
    return { start: cue.start, end: cue.end, text: cue.text };
  });
}

export function buildStudyPackData({ courseId, courseTitle, courseSlug, lectureId, pageUrl, curriculum, tracks }) {
  const unitContext = findUnitContext(curriculum, lectureId);
  if (!unitContext) throw new Error(`課程目錄找不到單元 ${lectureId}`);
  if (!UDEMY_UNIT_URL.test(pageUrl)) throw new Error("目前頁面不是有效的 Udemy 單元 URL");
  const en = copyCues(tracks?.en ?? [], "英文");
  const zh = copyCues(tracks?.zh ?? [], "中文");
  if (en.length === 0 && zh.length === 0) throw new Error("目前單元沒有可用字幕");
  return {
    course: { id: requiredText(courseId, "courseId"), title: requiredText(courseTitle, "courseTitle"), slug: requiredText(courseSlug, "courseSlug") },
    unit: { id: unitContext.id, chapterTitle: unitContext.chapterTitle, title: unitContext.title, url: pageUrl },
    subtitles: { en, zh },
  };
}
