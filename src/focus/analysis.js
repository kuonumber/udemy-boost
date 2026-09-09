// 專注度分析。全部純函式，輸入為 csv.parseRows 產出的 segment 陣列。
import { mergeOverlaps } from "./csv.js";

const DISTRACTION = new Set(["blur", "hidden", "idle"]);
const SESSION_GAP_MIN = 30;

const isPoint = (s) => s.endReason === "imported" || s.endReason === "completed";
const ms = (iso) => Date.parse(iso);

function sortByStart(segs) {
  return [...segs].sort((a, b) => ms(a.start) - ms(b.start));
}

/** 依間隔切 session；回傳 session 數。只看真實觀看段（非點）。 */
export function sessions(segments, gapMin = SESSION_GAP_MIN) {
  const real = sortByStart(segments.filter((s) => !isPoint(s) && Number.isFinite(ms(s.start))));
  if (real.length === 0) return 0;
  let n = 1;
  let lastEnd = ms(real[0].end);
  for (const s of real.slice(1)) {
    if (ms(s.start) - lastEnd >= gapMin * 60000) n++;
    lastEnd = Math.max(lastEnd, ms(s.end));
  }
  return n;
}

function forwardSeconds(segs) {
  return segs.reduce((sum, s) => {
    if (typeof s.posStart !== "number" || typeof s.posEnd !== "number") return sum;
    return sum + Math.max(0, s.posEnd - s.posStart);
  }, 0);
}

function durationOf(segs) {
  const d = segs.map((s) => s.videoDurationS).filter((v) => typeof v === "number" && v > 0);
  return d.length ? Math.max(...d) : null;
}

/** 單一講次的所有 segment → 指標。 */
export function perLecture(segments) {
  const real = sortByStart(segments.filter((s) => !isPoint(s)));
  const imported = segments.filter((s) => s.endReason === "imported");
  const completed = segments.filter((s) => s.endReason === "completed").map((s) => s.start).sort();
  const durationS = durationOf(real); // imported / completed 是點，不帶影片資訊

  let pauses = 0;
  let longestPauseMs = 0;
  for (let i = 1; i < real.length; i++) {
    const gap = ms(real[i].start) - ms(real[i - 1].end);
    if (gap > 0 && gap < SESSION_GAP_MIN * 60000) {
      pauses++;
      longestPauseMs = Math.max(longestPauseMs, gap);
    }
  }
  const fwd = forwardSeconds(real);
  return {
    watchedMs: mergeOverlaps(real) + imported.reduce((a, s) => a + (s.watchedMs || 0), 0),
    distractions: real.filter((s) => DISTRACTION.has(s.endReason)).length,
    focusRatio: durationS ? Math.min(1, fwd / durationS) : null,
    durationS,
    seekBackCount: real.reduce((a, s) => a + (s.seekBackCount || 0), 0),
    seekBackS: real.reduce((a, s) => a + (s.seekBackS || 0), 0),
    pauses,
    longestPauseMs,
    longestFocusMs: real.reduce((m, s) => Math.max(m, s.watchedMs || 0), 0),
    sessions: sessions(real),
    completedAt: completed.length ? completed[0] : null,
    imported: imported.length > 0,
    segments: real,
  };
}

/** 多個講次指標 → 章節指標。 */
export function perChapter(lectures) {
  const weighted = lectures.filter((l) => l.focusRatio !== null && l.durationS);
  const wsum = weighted.reduce((a, l) => a + l.durationS, 0);
  return {
    watchedMs: lectures.reduce((a, l) => a + l.watchedMs, 0),
    distractions: lectures.reduce((a, l) => a + l.distractions, 0),
    focusRatio: wsum ? weighted.reduce((a, l) => a + l.focusRatio * l.durationS, 0) / wsum : null,
    seekBackCount: lectures.reduce((a, l) => a + l.seekBackCount, 0),
    seekBackS: lectures.reduce((a, l) => a + l.seekBackS, 0),
    longestFocusMs: lectures.reduce((m, l) => Math.max(m, l.longestFocusMs), 0),
    sessions: sessions(lectures.flatMap((l) => l.segments)),
  };
}

function windowStats(segs) {
  const real = segs.filter((s) => !isPoint(s));
  const watchedMs = mergeOverlaps(real);
  const distractions = real.filter((s) => DISTRACTION.has(s.endReason)).length;
  // focusRatio：以講次分組，各講 fwd/duration 再用 duration 加權
  const byLecture = new Map();
  for (const s of real) {
    if (!byLecture.has(s.lectureId)) byLecture.set(s.lectureId, []);
    byLecture.get(s.lectureId).push(s);
  }
  let wsum = 0;
  let acc = 0;
  for (const group of byLecture.values()) {
    const d = durationOf(group);
    if (!d) continue;
    acc += Math.min(1, forwardSeconds(group) / d) * d;
    wsum += d;
  }
  return {
    watchedMs,
    completed: segs.filter((s) => s.endReason === "completed").length,
    distractionsPerHour: watchedMs > 0 ? Math.round((distractions / (watchedMs / 3600000)) * 10) / 10 : 0,
    focusRatio: wsum ? acc / wsum : null,
  };
}

/** 最近 N 天（以 segment_start 落在 (now − N 天, now] 判斷）。 */
export function recentWindow(segments, days, nowIso) {
  const now = ms(nowIso);
  const from = now - days * 86400000;
  const inWin = segments.filter((s) => {
    const t = ms(s.start);
    return Number.isFinite(t) && t > from && t <= now;
  });
  return windowStats(inWin);
}

function localHour(iso, timeZone) {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).formatToParts(new Date(iso)).find((p) => p.type === "hour")?.value;
  const n = Number(h);
  return n === 24 ? 0 : n;
}

const BUCKETS = ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"];

/** 6 個 4 小時桶；best = 有觀看且 focusRatio 最高（同分取時數多者）。 */
export function byHourBucket(segments, timeZone) {
  const groups = BUCKETS.map(() => []);
  for (const s of segments) {
    if (isPoint(s) || !Number.isFinite(ms(s.start))) continue;
    groups[Math.floor(localHour(s.start, timeZone) / 4)].push(s);
  }
  const buckets = groups.map((g, i) => ({ label: BUCKETS[i], ...windowStats(g) }));
  const candidates = buckets.filter((b) => b.watchedMs > 0);
  candidates.sort((a, b) => (b.focusRatio ?? -1) - (a.focusRatio ?? -1) || b.watchedMs - a.watchedMs);
  return { buckets, best: candidates[0] ?? null };
}

/** ISO 8601 週：YYYY-Www（週一起算、含 1/4 的那週為 W01）。 */
export function isoWeek(iso, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const d = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const day = d.getUTCDay() || 7; // 週一=1 … 週日=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // 移到該週的週四
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 最近 weeks 週逐週統計（含零），最新在最後。 */
export function weekly(segments, weeks, nowIso, timeZone) {
  const labels = [];
  const now = ms(nowIso);
  for (let i = weeks - 1; i >= 0; i--) labels.push(isoWeek(new Date(now - i * 7 * 86400000).toISOString(), timeZone));
  const byWeek = new Map(labels.map((l) => [l, []]));
  for (const s of segments) {
    if (!Number.isFinite(ms(s.start))) continue;
    const w = isoWeek(s.start, timeZone);
    if (byWeek.has(w)) byWeek.get(w).push(s);
  }
  return labels.map((week) => ({ week, ...windowStats(byWeek.get(week)) }));
}
