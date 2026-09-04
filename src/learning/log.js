// 學習歷程：資料模型與報表。全部純函式（不可變），瀏覽器端的計時 / 存取在 tracker.js / store.js。
import { pad2 } from "../download/naming.js";

export function emptyLog(courseId, courseTitle, slug) {
  return { courseId, courseTitle, slug, lectures: {}, lastSyncAt: null, updatedAt: null };
}

function emptyRec() {
  return { watchedMs: 0, firstSeenAt: null, lastSeenAt: null, completedAt: null, completedBefore: false };
}

/**
 * 是否該把這一秒計入觀看時間。
 * - visible：分頁可見（切分頁 / 最小化為 false）
 * - focused：視窗有焦點（alt-tab 到別的 app 為 false，即使 Chrome 還露在螢幕上）；requireFocus 才看它
 * - idle：連續 idleLimitMs 沒有輸入活動 → 不計；idleLimitMs <= 0 表示不啟用
 */
export function shouldCount({ playing, visible, focused = true, requireFocus = false, idleMs, idleLimitMs }) {
  if (!playing || !visible) return false;
  if (requireFocus && !focused) return false;
  if (typeof idleLimitMs === "number" && idleLimitMs > 0 && idleMs >= idleLimitMs) return false;
  return true;
}

/** 累加觀看時間。deltaMs 非正數或非數字 → 回原物件。 */
export function tick(log, lectureId, deltaMs, nowIso) {
  if (typeof deltaMs !== "number" || !Number.isFinite(deltaMs) || deltaMs <= 0) return log;
  const prev = log.lectures[lectureId] ?? emptyRec();
  const rec = { ...prev, watchedMs: prev.watchedMs + deltaMs, firstSeenAt: prev.firstSeenAt ?? nowIso, lastSeenAt: nowIso };
  return { ...log, lectures: { ...log.lectures, [lectureId]: rec }, updatedAt: nowIso };
}

/**
 * 把 Udemy 的 completed_lecture_ids 套進 log。
 * - 首次同步：已完成的標 completedBefore（時間不可考）。
 * - 之後：新出現的記 completedAt = now；消失的（Udemy 端取消）清掉。
 */
export function applyCompletion(log, completedIds, nowIso, isFirstSync) {
  if (!Array.isArray(completedIds)) throw new TypeError("completedIds must be an array");
  const done = new Set(completedIds.map(String));
  const lectures = { ...log.lectures };
  for (const id of done) {
    const prev = lectures[id] ?? emptyRec();
    if (prev.completedAt || prev.completedBefore) continue;
    lectures[id] = isFirstSync ? { ...prev, completedBefore: true } : { ...prev, completedAt: nowIso };
  }
  for (const [id, rec] of Object.entries(lectures)) {
    if (!done.has(id) && (rec.completedAt || rec.completedBefore)) {
      lectures[id] = { ...rec, completedAt: null, completedBefore: false };
    }
  }
  return { ...log, lectures, lastSyncAt: nowIso, updatedAt: nowIso };
}

export function fmtDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad2(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${pad2(m % 60)}m`;
}

/** ISO → "YYYY-MM-DD HH:mm"（指定時區）；無效 → ""。 */
export function formatLocal(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}

function isDone(rec) {
  return !!(rec && (rec.completedAt || rec.completedBefore));
}

/** curriculum + log → 結構化報表。 */
export function buildReport(curriculum, log, nowIso) {
  if (!Array.isArray(curriculum)) throw new TypeError("curriculum must be an array");
  const chapters = [];
  let cur = null;
  const seen = new Set();
  const totals = { lectures: 0, completed: 0, chapters: 0, chaptersDone: 0, watchedMs: 0, quizzes: 0, quizzesDone: 0 };

  const ensureChapter = () => {
    if (!cur) {
      cur = { index: 0, title: "00. (no section)", items: [], done: 0, total: 0, watchedMs: 0, completedAt: null, partialBefore: false };
      chapters.push(cur);
    }
    return cur;
  };

  for (const it of curriculum) {
    if (!it || typeof it !== "object") continue;
    if (it._class === "chapter") {
      cur = { index: it.object_index, title: `${pad2(it.object_index)}. ${it.title ?? ""}`, items: [], done: 0, total: 0, watchedMs: 0, completedAt: null, partialBefore: false };
      chapters.push(cur);
      continue;
    }
    const kind = it._class === "lecture" ? "lecture" : it._class === "quiz" || it._class === "practice" ? "quiz" : null;
    if (!kind) continue;
    const ch = ensureChapter();
    const rec = log.lectures[String(it.id)] ?? emptyRec();
    seen.add(String(it.id));
    const done = isDone(rec);
    const watchedMs = kind === "lecture" ? rec.watchedMs : 0;
    const status = done ? "done" : watchedMs > 0 ? "in-progress" : "todo";
    ch.items.push({
      id: it.id, index: it.object_index, title: it.title ?? "", kind, status, watchedMs,
      completedAt: rec.completedAt, completedBefore: rec.completedBefore,
    });
    if (kind === "lecture") {
      ch.total++;
      totals.lectures++;
      ch.watchedMs += watchedMs;
      totals.watchedMs += watchedMs;
      if (done) {
        ch.done++;
        totals.completed++;
        if (rec.completedBefore) ch.partialBefore = true;
        else if (!ch.completedAt || rec.completedAt > ch.completedAt) ch.completedAt = rec.completedAt;
      }
    } else {
      totals.quizzes++;
      if (done) totals.quizzesDone++;
    }
  }

  for (const ch of chapters) {
    if (ch.total > 0 && ch.done === ch.total) totals.chaptersDone++;
    else ch.completedAt = null; // 未全完成不顯示完成時間
  }
  totals.chapters = chapters.length;

  const removed = Object.entries(log.lectures)
    .filter(([id]) => !seen.has(id))
    .map(([id, rec]) => ({ id: Number(id), watchedMs: rec.watchedMs, completedAt: rec.completedAt, completedBefore: rec.completedBefore }));
  for (const r of removed) totals.watchedMs += r.watchedMs;

  return { title: log.courseTitle, updatedAt: nowIso, lastSyncAt: log.lastSyncAt, totals, chapters, removed };
}

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const row = (cells) => "|" + cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|") + "|";

function statusMark(item) {
  return item.status === "done" ? "✅" : item.status === "in-progress" ? "▶ 進行中" : "☐";
}

function completedCell(item, tz) {
  if (item.status !== "done") return "";
  return item.completedBefore ? "（安裝前）" : formatLocal(item.completedAt, tz);
}

export function renderMarkdown(report, { timeZone } = {}) {
  const t = report.totals;
  const pct = t.lectures ? Math.round((t.completed / t.lectures) * 100) : 0;
  const out = [`# ${report.title}`, ""];
  out.push(`- 更新：${formatLocal(report.updatedAt, timeZone)}`);
  let progress = `- 進度：${t.completed} / ${t.lectures} 講（${pct}%）· ${t.chapters} 章中 ${t.chaptersDone} 章完成`;
  if (t.quizzes) progress += ` · 測驗 ${t.quizzesDone} / ${t.quizzes}`;
  out.push(progress);
  out.push(`- 累計觀看：${fmtDuration(t.watchedMs)}（本 extension 安裝後起算）`);
  if (report.lastSyncAt) out.push(`- 完成狀態同步於：${formatLocal(report.lastSyncAt, timeZone)}`);
  out.push("");

  for (const ch of report.chapters) {
    const mark = ch.total > 0 && ch.done === ch.total ? "✅" : "⏳";
    let head = `## ${esc(ch.title)} ${mark} ${ch.done}/${ch.total} · ${fmtDuration(ch.watchedMs)}`;
    if (ch.done === ch.total && ch.total > 0) {
      if (ch.completedAt) head += ` · 完成於 ${formatLocal(ch.completedAt, timeZone)}`;
      if (ch.partialBefore) head += ch.completedAt ? "（部分安裝前）" : " · 完成於（安裝前）";
    }
    out.push(head, "", "| # | 講次 | 狀態 | 觀看 | 完成時間 |", "|---|------|------|------|----------|");
    for (const it of ch.items) {
      const idx = it.kind === "quiz" ? `Q${it.index}` : String(it.index);
      out.push(row([idx, esc(it.title), statusMark(it), fmtDuration(it.watchedMs), completedCell(it, timeZone)]));
    }
    out.push("");
  }

  if (report.removed.length) {
    out.push("## 已移除的講次", "", "| lectureId | 觀看 | 完成時間 |", "|---|------|----------|");
    for (const r of report.removed) {
      const c = r.completedBefore ? "（安裝前）" : formatLocal(r.completedAt, timeZone);
      out.push(row([String(r.id), fmtDuration(r.watchedMs), c]));
    }
    out.push("");
  }
  return out.join("\n");
}
