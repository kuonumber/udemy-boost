// Phase 5 的 progress.md：curriculum + CSV segments + Udemy 完成清單 → 報表 → Markdown。純函式。
import { fmtDuration, formatLocal } from "../learning/log.js";
import { pad2 } from "../download/naming.js";
import { perLecture, perChapter, recentWindow, byHourBucket, weekly } from "./analysis.js";

const emptyAnalysis = () => perLecture([]);

/**
 * @param {{curriculum, segments, completedIds:number[], notesIndex:Record<string,number>, now:string, timeZone:string,
 *          title:string, csvBadRows:number, importInfo:{lectures:number, unknownTime:number}|null}} o
 */
export function buildFocusReport(o) {
  const { curriculum, segments, completedIds, notesIndex = {}, now, timeZone, title, csvBadRows = 0, importInfo = null } = o;
  if (!Array.isArray(curriculum)) throw new TypeError("curriculum must be an array");
  const done = new Set((completedIds ?? []).map(String));
  const byLecture = new Map();
  for (const s of segments) {
    const k = String(s.lectureId);
    if (!byLecture.has(k)) byLecture.set(k, []);
    byLecture.get(k).push(s);
  }

  const chapters = [];
  let cur = null;
  const totals = { lectures: 0, completed: 0, chapters: 0, chaptersDone: 0, watchedMs: 0, quizzes: 0, quizzesDone: 0 };
  const seen = new Set();
  const ensure = () => {
    if (!cur) {
      cur = { title: "00. (no section)", items: [], done: 0, total: 0, completedAt: null, partialBefore: false };
      chapters.push(cur);
    }
    return cur;
  };

  for (const it of curriculum) {
    if (!it || typeof it !== "object") continue;
    if (it._class === "chapter") {
      cur = { title: `${pad2(it.object_index)}. ${it.title ?? ""}`, items: [], done: 0, total: 0, completedAt: null, partialBefore: false };
      chapters.push(cur);
      continue;
    }
    const kind = it._class === "lecture" ? "lecture" : it._class === "quiz" || it._class === "practice" ? "quiz" : null;
    if (!kind) continue;
    const ch = ensure();
    const key = String(it.id);
    seen.add(key);
    const an = kind === "lecture" ? perLecture(byLecture.get(key) ?? []) : emptyAnalysis();
    const isDone = done.has(key);
    const completedBefore = isDone && !an.completedAt;
    const status = isDone ? "done" : an.watchedMs > 0 ? "in-progress" : "todo";
    ch.items.push({
      id: it.id, index: it.object_index, title: it.title ?? "", kind, status, completedAt: isDone ? an.completedAt : null, completedBefore,
      hasNotes: (notesIndex[key] ?? 0) > 0, analysis: an,
    });
    if (kind === "lecture") {
      ch.total++;
      totals.lectures++;
      totals.watchedMs += an.watchedMs;
      if (isDone) {
        ch.done++;
        totals.completed++;
        if (completedBefore) ch.partialBefore = true;
        else if (!ch.completedAt || an.completedAt > ch.completedAt) ch.completedAt = an.completedAt;
      }
    } else {
      totals.quizzes++;
      if (isDone) totals.quizzesDone++;
    }
  }
  for (const ch of chapters) {
    ch.analysis = perChapter(ch.items.filter((i) => i.kind === "lecture").map((i) => i.analysis));
    if (ch.total > 0 && ch.done === ch.total) totals.chaptersDone++;
    else ch.completedAt = null;
  }
  totals.chapters = chapters.length;

  const removed = [...byLecture.entries()].filter(([k]) => !seen.has(k)).map(([k, segs]) => ({ id: Number(k), ...perLecture(segs) }));
  for (const r of removed) totals.watchedMs += r.watchedMs;

  return {
    title, updatedAt: now, timeZone, totals, chapters, removed, csvBadRows, importInfo,
    hasImported: segments.some((s) => s.endReason === "imported"),
    recent7: recentWindow(segments, 7, now),
    recent30: recentWindow(segments, 30, now),
    hourBuckets: byHourBucket(segments, timeZone),
    weekly: weekly(segments, 8, now, timeZone),
  };
}

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const row = (cells) => "|" + cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|") + "|";
const ratio = (r) => (r === null || r === undefined ? "—" : r.toFixed(2));
const mark = (it) => (it.status === "done" ? "✅" : it.status === "in-progress" ? "▶ 進行中" : "☐");

function completedCell(it, tz) {
  if (it.status !== "done") return "";
  return it.completedBefore ? "（安裝前）" : formatLocal(it.completedAt, tz);
}

export function renderFocusMarkdown(r) {
  const tz = r.timeZone;
  const t = r.totals;
  const pct = t.lectures ? Math.round((t.completed / t.lectures) * 100) : 0;
  const out = [`# ${r.title}`, ""];
  out.push(`- 更新：${formatLocal(r.updatedAt, tz)}`);
  let progress = `- 進度：${t.completed} / ${t.lectures} 講（${pct}%）· ${t.chapters} 章中 ${t.chaptersDone} 章完成`;
  if (t.quizzes) progress += ` · 測驗 ${t.quizzesDone} / ${t.quizzes}`;
  out.push(progress);
  out.push(`- 累計觀看：${fmtDuration(t.watchedMs)}（來源：watch-log.csv${r.hasImported ? "，含匯入的舊記錄" : ""}）`);
  const w7 = r.recent7;
  out.push(`- 最近 7 天：${fmtDuration(w7.watchedMs)} · 完成 ${w7.completed} 講 · 專注比 ${ratio(w7.focusRatio)} · 分心 ${w7.distractionsPerHour} 次/小時`);
  const w30 = r.recent30;
  out.push(`- 最近 30 天：${fmtDuration(w30.watchedMs)} · 完成 ${w30.completed} 講 · 專注比 ${ratio(w30.focusRatio)} · 分心 ${w30.distractionsPerHour} 次/小時`);
  const best = r.hourBuckets.best;
  out.push(best ? `- 最佳時段：${best.label} 時（專注比 ${ratio(best.focusRatio)}，共 ${fmtDuration(best.watchedMs)}）` : "- 最佳時段：—");
  if (r.importInfo) out.push(`- 匯入舊記錄 ${r.importInfo.lectures} 講，其中 ${r.importInfo.unknownTime} 講時間不可考`);
  if (r.csvBadRows) out.push(`- CSV 有 ${r.csvBadRows} 行無法解析，已略過`);
  out.push("");

  for (const ch of r.chapters) {
    const all = ch.total > 0 && ch.done === ch.total;
    let head = `## ${esc(ch.title)} ${all ? "✅" : "⏳"} ${ch.done}/${ch.total} · ${fmtDuration(ch.analysis.watchedMs)}`;
    if (all) {
      if (ch.completedAt) head += ` · 完成於 ${formatLocal(ch.completedAt, tz)}`;
      if (ch.partialBefore) head += ch.completedAt ? "（部分安裝前）" : " · 完成於（安裝前）";
    }
    const a = ch.analysis;
    const seek = a.seekBackCount ? `回看 ${a.seekBackCount} 次 (${fmtDuration(a.seekBackS * 1000)})` : "回看 0 次";
    out.push(head, `分析：專注比 ${ratio(a.focusRatio)} · 分心 ${a.distractions} 次 · ${seek} · 最長連續 ${fmtDuration(a.longestFocusMs)} · ${a.sessions} 個 session`, "");
    out.push("| # | 講次 | 狀態 | 觀看 | 專注比 | 分心 | 回看 | 完成時間 |", "|---|------|------|------|--------|------|------|----------|");
    for (const it of ch.items) {
      const an = it.analysis;
      const idx = it.kind === "quiz" ? `Q${it.index}` : String(it.index);
      const title = esc(it.title) + (it.hasNotes ? " 📝" : "");
      if (it.kind === "quiz") out.push(row([idx, title, mark(it), "—", "—", "", "", completedCell(it, tz)]));
      else out.push(row([idx, title, mark(it), fmtDuration(an.watchedMs), ratio(an.focusRatio), String(an.distractions), String(an.seekBackCount), completedCell(it, tz)]));
    }
    out.push("");
  }

  if (r.removed.length) {
    out.push("## 已移除的講次", "", "| lectureId | 觀看 | 完成時間 |", "|---|------|----------|");
    for (const x of r.removed) out.push(row([String(x.id), fmtDuration(x.watchedMs), x.completedAt ? formatLocal(x.completedAt, tz) : ""]));
    out.push("");
  }

  out.push("## 週趨勢", "", "| 週 | 時數 | 完成講 | 專注比 | 分心/h |", "|---|------|--------|--------|--------|");
  for (const w of r.weekly) out.push(row([w.week, fmtDuration(w.watchedMs), String(w.completed), ratio(w.focusRatio), String(w.distractionsPerHour)]));
  out.push("", "## 時段分布", "", "| 時段 | 時數 | 專注比 |", "|------|------|--------|");
  for (const b of r.hourBuckets.buckets) out.push(row([b.label, fmtDuration(b.watchedMs), ratio(b.focusRatio)]));
  out.push("");
  return out.join("\n");
}

/** notes.md 的一則筆記。 */
export function renderNoteEntry({ chapter, lecture, at, text, timeZone }) {
  const body = String(text ?? "").trim();
  if (!body) throw new RangeError("note text is empty");
  const lines = body.split(/\r?\n/);
  const first = lines[0];
  const rest = lines.slice(1).map((l) => `  ${l}`).join("\n");
  return `## ${chapter} / ${lecture}\n\n- ${formatLocal(at, timeZone)} — ${first}${rest ? "\n" + rest : ""}\n\n`;
}
