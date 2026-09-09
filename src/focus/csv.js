// watch-log.csv 的序列化 / 解析（RFC 4180）與重疊區間合併。純函式。

export const HEADER = [
  "segment_start", "segment_end", "lecture_id", "chapter_index", "lecture_index", "lecture_title",
  "watched_ms", "video_pos_start_s", "video_pos_end_s", "playback_rate", "end_reason",
  "seek_back_count", "seek_back_s", "video_duration_s", "ext_version",
];

// header 欄名 → segment 物件欄名 與型別
const COLS = {
  segment_start: ["start", "str"],
  segment_end: ["end", "str"],
  lecture_id: ["lectureId", "int"],
  chapter_index: ["chapterIndex", "int"],
  lecture_index: ["lectureIndex", "int"],
  lecture_title: ["title", "str"],
  watched_ms: ["watchedMs", "int"],
  video_pos_start_s: ["posStart", "num"],
  video_pos_end_s: ["posEnd", "num"],
  playback_rate: ["rate", "num"],
  end_reason: ["endReason", "str"],
  seek_back_count: ["seekBackCount", "int"],
  seek_back_s: ["seekBackS", "num"],
  video_duration_s: ["videoDurationS", "num"],
  ext_version: ["extVersion", "str"],
};
const REQUIRED = ["segment_start", "segment_end", "lecture_id", "watched_ms", "end_reason"];

export function escapeField(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function headerLine() {
  return "﻿" + HEADER.join(",") + "\r\n";
}

export function toRow(seg) {
  return HEADER.map((h) => escapeField(seg[COLS[h][0]])).join(",") + "\r\n";
}

/** RFC 4180 tokenizer：回傳 rows（每 row 為 string[]）。 */
function tokenize(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function coerce(kind, raw) {
  if (raw === undefined || raw === "") return null;
  if (kind === "str") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new TypeError("not a number");
  return kind === "int" ? Math.trunc(n) : n;
}

/**
 * @returns {{rows: object[], bad: number}}
 */
export function parseRows(text) {
  if (typeof text !== "string") throw new TypeError("csv text must be a string");
  const src = text.replace(/^﻿/, "");
  const all = tokenize(src).filter((r) => !(r.length === 1 && r[0] === ""));
  if (all.length === 0) return { rows: [], bad: 0 };
  const header = all[0].map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = [];
  let bad = 0;
  for (const r of all.slice(1)) {
    try {
      if (REQUIRED.some((k) => idx[k] === undefined || !r[idx[k]])) throw new TypeError("missing required");
      const seg = {};
      for (const [h, [key, kind]] of Object.entries(COLS)) {
        seg[key] = idx[h] === undefined ? null : coerce(kind, r[idx[h]]);
      }
      if (!Number.isFinite(Date.parse(seg.start)) || !Number.isFinite(Date.parse(seg.end))) throw new TypeError("bad date");
      rows.push(seg);
    } catch {
      bad++;
    }
  }
  return { rows, bad };
}

/** 合併重疊的 [start,end] 區間後的總毫秒；start==end 的點與無效時間不計。 */
export function mergeOverlaps(segments) {
  const ivs = segments
    .map((s) => [Date.parse(s.start), Date.parse(s.end)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of ivs) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else if (b > cur[1]) {
      cur[1] = b;
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}
