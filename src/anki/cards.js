const CLOZE = /\{\{c[1-9]\d*::[^{}]+(?:::[^{}]*)?\}\}/u;
const UDEMY_URL = /^https:\/\/(?:www\.)?udemy\.com\/course\/[^/]+\/learn\//u;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_FIELD_LENGTH = 20_000;
const object = (v, n) => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${n} 必須是物件`); return v; };
const exact = (v, keys, n) => { const unknown = Object.keys(v).filter(k => !keys.includes(k)); if (unknown.length) throw new Error(`${n} 有未知欄位：${unknown.join(", ")}`); for (const k of keys) if (!(k in v)) throw new Error(`${n} 缺少欄位 ${k}`); };
const text = (v, n, max = MAX_FIELD_LENGTH) => { if (typeof v !== "string" || !v.trim()) throw new Error(`${n} 必須是非空字串`); if (v.length > max) throw new Error(`${n} 過長`); return v.trim(); };
const time = (v, n) => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${n} 必須是非負有限數字`); return v; };

export function validateCardPackage(input, expected = {}) {
  let encoded;
  try { encoded = new TextEncoder().encode(JSON.stringify(input)); } catch { throw new Error("卡片 JSON 無法序列化"); }
  if (encoded.byteLength > MAX_PACKAGE_BYTES) throw new Error("卡片 JSON 過大");
  const top = object(input, "頂層"); exact(top, ["schemaVersion", "course", "unit", "cards", "warnings"], "頂層");
  if (top.schemaVersion !== 1) throw new Error(`未知 schemaVersion：${top.schemaVersion}`);
  const course = object(top.course, "course"); exact(course, ["id", "title", "slug"], "course");
  const unit = object(top.unit, "unit"); exact(unit, ["id", "chapterTitle", "title", "url"], "unit");
  const outCourse = { id: text(course.id,"course.id",500), title:text(course.title,"course.title",1000), slug:text(course.slug,"course.slug",500) };
  const outUnit = { id:text(unit.id,"unit.id",500), chapterTitle:text(unit.chapterTitle,"unit.chapterTitle",1000), title:text(unit.title,"unit.title",1000), url:text(unit.url,"unit.url",2000) };
  if (!UDEMY_URL.test(outUnit.url)) throw new Error("unit.url 必須是 Udemy 課程單元 URL");
  if (expected.expectedCourseId != null && String(expected.expectedCourseId) !== outCourse.id) throw new Error("課程不符");
  if (expected.expectedUnitId != null && String(expected.expectedUnitId) !== outUnit.id) throw new Error("單元不符");
  if (expected.expectedCourse) {
    const trusted = { id: String(expected.expectedCourse.id).trim(), title: String(expected.expectedCourse.title).trim(), slug: String(expected.expectedCourse.slug).trim() };
    if (JSON.stringify(outCourse) !== JSON.stringify(trusted)) throw new Error("課程 metadata 不符");
  }
  if (expected.expectedUnit) {
    const trusted = { id: String(expected.expectedUnit.id).trim(), chapterTitle: String(expected.expectedUnit.chapterTitle).trim(), title: String(expected.expectedUnit.title).trim(), url: String(expected.expectedUnit.url).trim() };
    if (JSON.stringify(outUnit) !== JSON.stringify(trusted)) throw new Error("單元 metadata 不符");
  }
  if (!Array.isArray(top.cards) || top.cards.length < 5 || top.cards.length > 10) throw new Error("cards 必須包含 5 到 10 張卡片");
  if (!Array.isArray(top.warnings)) throw new Error("warnings 必須是陣列");
  const warnings = top.warnings.map((v,i)=>text(v,`warnings[${i}]`,2000));
  const cards = top.cards.map((raw,i) => {
    const card = object(raw, `cards[${i}]`); const base=["type","sourceStartSec","sourceEndSec","reason","tags"];
    if (card.type === "basic") exact(card,[...base,"front","back"],`cards[${i}]`);
    else if (card.type === "cloze") exact(card,[...base,"text","extra"],`cards[${i}]`);
    else throw new Error(`cards[${i}].type 必須是 basic 或 cloze`);
    const start=time(card.sourceStartSec,`cards[${i}].sourceStartSec`), end=time(card.sourceEndSec,`cards[${i}].sourceEndSec`);
    if (end < start) throw new Error(`cards[${i}] sourceEndSec 不得小於 sourceStartSec`);
    if (!Array.isArray(card.tags) || !card.tags.length) throw new Error(`cards[${i}].tags 必須是非空陣列`);
    const common={ type:card.type, sourceStartSec:start, sourceEndSec:end, reason:text(card.reason,`cards[${i}].reason`,5000), tags:[...new Set(card.tags.map((v,j)=>text(v,`cards[${i}].tags[${j}]`,200)))] };
    if (card.type === "basic") return { ...common, front:text(card.front,`cards[${i}].front`), back:text(card.back,`cards[${i}].back`) };
    const clozeText=text(card.text,`cards[${i}].text`); if (!CLOZE.test(clozeText)) throw new Error(`cards[${i}] 缺少合法 cloze {{c1::...}}`);
    return { ...common, text:clozeText, extra:text(card.extra,`cards[${i}].extra`) };
  });
  return { schemaVersion:1, course:outCourse, unit:outUnit, cards, warnings };
}

export async function cardFingerprint(card, { courseId, unitId }) {
  const identity = card.type === "basic" ? {type:"basic",front:card.front.trim(),back:card.back.trim()} : {type:"cloze",text:card.text.trim(),extra:card.extra.trim()};
  const bytes = new TextEncoder().encode(JSON.stringify({courseId:String(courseId).trim(),unitId:String(unitId).trim(),...identity}));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
}

export const draftKey = (courseId, unitId) => { const c=String(courseId).trim(),u=String(unitId).trim(); if(!c||!u) throw new TypeError("courseId 與 unitId 不得為空"); return `anki:draft:${c}:${u}`; };
