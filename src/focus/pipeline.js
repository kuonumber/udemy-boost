// content script 端的 Phase 5 流程：透過 background → offscreen 讀寫 Udemy 資料夾。
// 檔案：<課程>/watch-log.csv、<課程>/progress.md、<課程>/notes.md、<課程>/progress.<日期>.bak.md
import { safeSegment, pad2 } from "../download/naming.js";
import { fetchCurriculum } from "../download/curriculum.js";
import { fetchCompletedIds } from "../learning/tracker.js";
import { headerLine, toRow, parseRows } from "./csv.js";
import { parseProgressMd, fromPhase4Log, toImportedSegments } from "./importer.js";
import { buildFocusReport, renderFocusMarkdown, renderNoteEntry } from "./render.js";

const LOG = "[ub:fs]";
export const EXT_VERSION = chrome.runtime.getManifest().version;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- 與 background 的 fs 通道 ----------

async function fs(msg) {
  const r = await chrome.runtime.sendMessage(msg);
  if (!r) throw new Error("no response from background");
  return r;
}

/** 資料夾是否可用（已選且授權）。 */
export async function fsLinked() {
  try {
    const r = await fs({ type: "fs:status" });
    return !!(r.ok && r.linked && r.permission === "granted");
  } catch {
    return false;
  }
}

export const courseDir = (title) => safeSegment(String(title || "course"));

async function readText(path) {
  const r = await fs({ type: "fs:read", path });
  if (!r.ok) throw new Error(r.error);
  return r.text;
}
async function writeText(path, text) {
  const r = await fs({ type: "fs:write", path, text });
  if (!r.ok) throw new Error(r.error);
}
/** 追加；未連結 / 未授權時 background 會排進佇列，回 {queued:true}。 */
async function appendText(path, text, header = "") {
  return fs({ type: "fs:append", path, text, header });
}

// ---------- curriculum 中繼資料（章 / 講索引與標題） ----------

const metaCache = new Map(); // courseId → { curriculum, byLecture: Map<id, meta> }

export async function courseMeta(courseId) {
  if (!metaCache.has(courseId)) {
    const curriculum = await fetchCurriculum(courseId);
    const byLecture = new Map();
    let ch = { index: 0, title: "(no section)" };
    for (const it of curriculum) {
      if (it._class === "chapter") ch = { index: it.object_index, title: it.title ?? "" };
      else if (it._class === "lecture" || it._class === "quiz" || it._class === "practice") {
        byLecture.set(String(it.id), { chapterIndex: ch.index, chapterTitle: ch.title, lectureIndex: it.object_index, title: it.title ?? "" });
      }
    }
    metaCache.set(courseId, { curriculum, byLecture });
  }
  return metaCache.get(courseId);
}

export function lectureMeta(meta, lectureId) {
  return meta.byLecture.get(String(lectureId)) ?? { chapterIndex: 0, chapterTitle: "(no section)", lectureIndex: 0, title: "" };
}

// ---------- 寫入 ----------

export async function appendSegment(courseTitle, segment) {
  return appendText(`${courseDir(courseTitle)}/watch-log.csv`, toRow(segment), headerLine());
}

export function completedSegment(meta, lectureId, atIso) {
  const m = lectureMeta(meta, lectureId);
  return {
    start: atIso, end: atIso, lectureId: Number(lectureId), chapterIndex: m.chapterIndex, lectureIndex: m.lectureIndex, title: m.title,
    watchedMs: 0, posStart: null, posEnd: null, rate: null, endReason: "completed", seekBackCount: 0, seekBackS: 0, videoDurationS: null, extVersion: EXT_VERSION,
  };
}

export async function appendNote(courseTitle, meta, lectureId, text) {
  const m = lectureMeta(meta, lectureId);
  const entry = renderNoteEntry({
    chapter: `${pad2(m.chapterIndex)}. ${m.chapterTitle}`,
    lecture: `${pad2(m.lectureIndex)}. ${m.title}`,
    at: new Date().toISOString(),
    text,
    timeZone: tz(),
  });
  const header = `# ${courseTitle} — 回想筆記\n\n<!-- Udemy Boost notes; 每則以 lectureId 標記 -->\n\n`;
  return appendText(`${courseDir(courseTitle)}/notes.md`, `<!-- lecture:${lectureId} -->\n${entry}`, header);
}

function notesIndexFrom(text) {
  const idx = {};
  for (const m of (text ?? "").matchAll(/<!-- lecture:(\d+) -->/g)) idx[m[1]] = (idx[m[1]] ?? 0) + 1;
  return idx;
}

// ---------- 匯入舊記錄（第一次） ----------

/**
 * 需要匯入的情況：progress.md 是 Phase 4 舊格式（或不存在但 CSV 也不存在 → 只匯 storage log）。
 * CSV 可能已被佇列補寫先建立（先播影片後才連結資料夾），所以一律「追加」匯入行而非覆寫。
 * 舊 md 備份成 progress.<YYYY-MM-DD>.bak.md。回傳 importInfo 或 null（不需匯入）。
 */
async function importLegacy(courseTitle, meta, phase4Log, mdText, csvExists) {
  const dir = courseDir(courseTitle);
  let mdRows = [];
  let skipped = [];
  if (mdText !== null) {
    const parsed = parseProgressMd(mdText);
    if (parsed.newFormat) return null; // 已是 Phase 5 格式 → 匯入過了
    mdRows = parsed.rows;
    skipped = parsed.skipped;
    const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await writeText(`${dir}/progress.${stamp}.bak.md`, mdText);
  } else if (csvExists) {
    return null; // 沒舊 md、CSV 已在 → 不是第一次
  }
  const statR = await fs({ type: "fs:stat", path: `${dir}/progress.md` });
  const fileMtimeIso = statR.ok && statR.stat ? statR.stat.mtimeIso : new Date().toISOString();
  const { segments, unmatched } = toImportedSegments({
    mdRows, storageRows: fromPhase4Log(phase4Log), curriculum: meta.curriculum, timeZone: tz(), fileMtimeIso, extVersion: EXT_VERSION,
  });
  if (segments.length) {
    const r = await appendText(`${dir}/watch-log.csv`, segments.map(toRow).join(""), headerLine());
    if (!r.ok) throw new Error(r.error ?? "append imported rows failed");
  } else if (!csvExists) {
    await writeText(`${dir}/watch-log.csv`, headerLine());
  }
  const lectures = new Set(segments.map((s) => s.lectureId)).size;
  const unknownTime = segments.filter((s) => s.endReason === "imported" && !segments.some((c) => c.endReason === "completed" && c.lectureId === s.lectureId)).length;
  console.info(LOG, `imported legacy: ${lectures} lectures, ${unmatched.length} unmatched, ${skipped.length} skipped rows`);
  return { lectures, unknownTime, unmatched: unmatched.length, skipped: skipped.length };
}

// ---------- 匯出 ----------

/**
 * 讀 CSV（沒有就先匯入舊記錄）→ 分析 → 寫 progress.md。回傳 { path, report }。
 * @param {{courseId, courseTitle, phase4Log}} o
 */
export async function exportProgressToFolder({ courseId, courseTitle, phase4Log }) {
  const meta = await courseMeta(courseId);
  const dir = courseDir(courseTitle);
  let csvText = await readText(`${dir}/watch-log.csv`);
  const mdText = await readText(`${dir}/progress.md`);
  const importInfo = await importLegacy(courseTitle, meta, phase4Log, mdText, csvText !== null);
  if (importInfo) csvText = await readText(`${dir}/watch-log.csv`);
  const { rows: segments, bad } = parseRows(csvText ?? "");
  const [completedIds, notesText] = await Promise.all([fetchCompletedIds(courseId).catch(() => []), readText(`${dir}/notes.md`).catch(() => null)]);
  const report = buildFocusReport({
    curriculum: meta.curriculum, segments, completedIds, notesIndex: notesIndexFrom(notesText),
    now: new Date().toISOString(), timeZone: tz(), title: courseTitle, csvBadRows: bad, importInfo,
  });
  await writeText(`${dir}/progress.md`, renderFocusMarkdown(report));
  return { path: `Udemy/${dir}/progress.md`, report };
}
