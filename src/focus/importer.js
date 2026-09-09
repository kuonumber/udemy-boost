// 匯入舊記錄：Phase 4 的 progress.md 與 chrome.storage log → imported / completed segment。純函式。

const OLD_HEADER = /^\|\s*#\s*\|\s*講次\s*\|\s*狀態\s*\|\s*觀看\s*\|\s*完成時間\s*\|$/;
const NEW_HEADER = /^\|\s*#\s*\|\s*講次\s*\|\s*狀態\s*\|\s*觀看\s*\|\s*專注比\s*\|/;

/** "4m 12s" / "1h 05m" / "45s" / "—" → ms；無法解析 → null。 */
export function parseDuration(s) {
  const t = (s ?? "").trim();
  if (t === "" || t === "—" || t === "-") return 0;
  let m;
  if ((m = /^(\d+)h\s+(\d+)m$/.exec(t))) return (Number(m[1]) * 60 + Number(m[2])) * 60000;
  if ((m = /^(\d+)m\s+(\d+)s$/.exec(t))) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  if ((m = /^(\d+)s$/.exec(t))) return Number(m[1]) * 1000;
  return null;
}

function splitCells(line) {
  // 以未跳脫的 | 切；\| 還原成 |
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells.slice(1, -1); // 去頭尾空白 cell
}

/**
 * @returns {{ title: string|null, rows: object[], skipped: string[], newFormat: boolean }}
 */
export function parseProgressMd(text) {
  if (typeof text !== "string") throw new TypeError("md must be a string");
  const lines = text.split(/\r?\n/);
  let title = null;
  let chapterIndex = 0;
  let inTable = false;
  let newFormat = false;
  const rows = [];
  const skipped = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("# ") && title === null) {
      title = line.slice(2).trim();
      continue;
    }
    const ch = /^##\s+(\d+)\.\s/.exec(line);
    if (ch) {
      chapterIndex = Number(ch[1]);
      inTable = false;
      continue;
    }
    if (NEW_HEADER.test(line)) {
      newFormat = true;
      inTable = false;
      continue;
    }
    if (OLD_HEADER.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\|\s*-+/.test(line)) continue; // 分隔線
    const cells = splitCells(line);
    if (cells.length !== 5) {
      skipped.push(line);
      continue;
    }
    const [idx, lecTitle, status, watched, completed] = cells;
    if (/^Q\d+$/i.test(idx)) continue; // quiz 不匯入
    const lectureIndex = Number(idx);
    const watchedMs = parseDuration(watched);
    if (!Number.isInteger(lectureIndex) || watchedMs === null) {
      skipped.push(line);
      continue;
    }
    const done = status.includes("✅");
    const completedBefore = completed.includes("安裝前");
    rows.push({
      chapterIndex,
      lectureIndex,
      title: lecTitle,
      done,
      watchedMs,
      completedAt: done && !completedBefore && completed ? completed : null,
      completedBefore,
    });
  }
  return { title, rows, skipped, newFormat };
}

export function fromPhase4Log(log) {
  if (!log?.lectures) return [];
  return Object.entries(log.lectures).map(([id, r]) => ({
    lectureId: Number(id),
    watchedMs: r.watchedMs || 0,
    completedAt: r.completedAt ?? null,
    completedBefore: !!r.completedBefore,
  }));
}

/** "YYYY-MM-DD HH:mm" 在指定時區 → ISO（UTC）。 */
export function localMinuteToIso(s, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  // 先當 UTC，再用該時區的偏移修正（兩次逼近處理 DST 邊界）
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(guess));
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
    guess += Date.UTC(y, mo - 1, d, h, mi) - shown;
  }
  return new Date(guess).toISOString();
}

/**
 * md 列（章/講索引）+ storage 列（lectureId）+ curriculum → imported / completed segments。
 */
export function toImportedSegments({ mdRows = [], storageRows = [], curriculum, timeZone, fileMtimeIso, extVersion }) {
  const byIndex = new Map(); // "chapter:lecture" → { id, title, chapterIndex, lectureIndex }
  const meta = new Map(); // id → same
  let ch = 0;
  for (const it of curriculum) {
    if (it._class === "chapter") ch = it.object_index;
    else if (it._class === "lecture") {
      const m = { id: it.id, title: it.title ?? "", chapterIndex: ch, lectureIndex: it.object_index };
      byIndex.set(`${ch}:${it.object_index}`, m);
      meta.set(it.id, m);
    }
  }
  const merged = new Map(); // id → { watchedMs, completedAt(ISO)|null, completedBefore }
  const unmatched = [];
  const upsert = (id, watchedMs, completedAtIso, completedBefore) => {
    const prev = merged.get(id) ?? { watchedMs: 0, completedAt: null, completedBefore: false };
    merged.set(id, {
      watchedMs: Math.max(prev.watchedMs, watchedMs || 0),
      completedAt: prev.completedAt ?? completedAtIso ?? null,
      completedBefore: prev.completedBefore || !!completedBefore,
    });
  };
  for (const r of mdRows) {
    const m = byIndex.get(`${r.chapterIndex}:${r.lectureIndex}`);
    if (!m) {
      unmatched.push(r);
      continue;
    }
    upsert(m.id, r.watchedMs, r.completedAt ? localMinuteToIso(r.completedAt, timeZone) : null, r.completedBefore);
  }
  for (const r of storageRows) {
    if (!meta.has(r.lectureId)) {
      unmatched.push(r);
      continue;
    }
    // storage 的時間是精確 ISO，優先：先清掉 md 的分鐘級再 upsert
    const prev = merged.get(r.lectureId);
    if (prev && r.completedAt) prev.completedAt = r.completedAt;
    upsert(r.lectureId, r.watchedMs, r.completedAt, r.completedBefore);
  }
  const segments = [];
  for (const [id, v] of merged) {
    const m = meta.get(id);
    const common = { lectureId: id, chapterIndex: m.chapterIndex, lectureIndex: m.lectureIndex, title: m.title, posStart: null, posEnd: null, rate: null, seekBackCount: 0, seekBackS: 0, videoDurationS: null, extVersion };
    if (v.watchedMs > 0) {
      const at = v.completedAt ?? fileMtimeIso;
      segments.push({ ...common, start: at, end: at, watchedMs: v.watchedMs, endReason: "imported" });
    }
    if (v.completedAt) segments.push({ ...common, start: v.completedAt, end: v.completedAt, watchedMs: 0, endReason: "completed" });
  }
  return { segments, unmatched };
}
