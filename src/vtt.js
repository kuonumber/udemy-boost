// WebVTT parser — 純函式，無 DOM 依賴，可在 node 測試。
// 只處理 Udemy 實際會出現的子集：header、可選 cue id、時間行、多行文字、NOTE/STYLE 區塊。

export class VttParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "VttParseError";
  }
}

const TS_RE = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})$/;

/** "HH:MM:SS.mmm" 或 "MM:SS.mmm" → 秒；非法回 NaN。 */
export function parseTimestamp(s) {
  if (typeof s !== "string") return NaN;
  const m = TS_RE.exec(s.trim());
  if (!m) return NaN;
  const h = m[1] === undefined ? 0 : Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number(m[4]);
  if (min > 59 || sec > 59) return NaN;
  return h * 3600 + min * 60 + sec + ms / 1000;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "‎", rlm: "‏" };

function cleanText(raw) {
  return raw
    .replace(/<[^>]*>/g, "") // <c>, <v Name>, <b>, </v> ...
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ent in ENTITIES ? ENTITIES[ent] : whole;
    })
    .trim();
}

/**
 * @param {string} text
 * @returns {{start:number,end:number,text:string}[]} 依 start 排序
 */
export function parse(text) {
  if (typeof text !== "string") throw new VttParseError("input is not a string");
  let src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:[ \t\n]|$)/.test(src)) throw new VttParseError("missing WEBVTT header");

  const blocks = src.split(/\n{2,}/);
  const cues = [];
  for (let i = 1; i < blocks.length; i++) {
    const lines = blocks[i].split("\n").filter((l, idx, arr) => !(idx === arr.length - 1 && l === ""));
    if (lines.length === 0) continue;
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;

    let tIdx = lines.findIndex((l) => l.includes("-->"));
    if (tIdx === -1 || tIdx > 1) continue; // 沒有時間行，或 id 行多於一行 → 非 cue
    const [startRaw, rest] = lines[tIdx].split("-->");
    const endRaw = (rest ?? "").trim().split(/\s+/)[0];
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

    const body = cleanText(lines.slice(tIdx + 1).join("\n"));
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return cues;
}
