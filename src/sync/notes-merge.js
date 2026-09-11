// notes.md 的跨裝置合併（Phase 6b）。純函式。
//
// 筆記是手寫內容，規則只有一條：任何情況都不准弄丟字。
// - 每則筆記要有穩定 id。新寫的把 uuid 寫進標記；舊格式（只有 <!-- lecture:N -->）用內容
//   決定性地算出 id——兩台機器對同一則舊筆記必須算出同一個 id，否則合併後會變成兩則。
// - 同 id：rev 較新者勝。rev 相同但內容不同 → 兩則都留並標 ub:conflict，交給人決定。
// - 排序以 (rev, id) 為鍵，確保 A∪B 與 B∪A 產生完全相同的位元組（否則兩台會互相上傳不止）。
import { hashText } from "./orchestrator.js";

const MARK = /<!--\s*ub:note\s+([^>]*?)-->/;
const LEGACY = /<!--\s*lecture:(\d+)\s*-->/;
const SPLIT = /(?=<!--\s*(?:ub:note|lecture:)\s)/;

export function noteMarker({ id, lectureId, rev }) {
  const parts = [`id=${id}`, `lecture=${lectureId}`];
  if (rev) parts.push(`rev=${rev}`);
  return `<!-- ub:note ${parts.join(" ")} -->`;
}

/** 舊格式筆記的 id：由 lectureId + 內容決定，同輸入必得同輸出。 */
export function legacyId({ lectureId, body }) {
  return `L${hashText(`${lectureId} ${String(body).trim()}`).replace(/[^a-z0-9]/gi, "")}`;
}

function attrs(raw) {
  const out = {};
  for (const m of String(raw).matchAll(/(\w+)=([^\s]+)/g)) out[m[1]] = m[2];
  return out;
}

/**
 * @returns {{ header: string, entries: Array<{id,lectureId,rev,body,legacy}> }}
 */
export function parseNotes(text) {
  if (text === null || text === undefined) return { header: "", entries: [] };
  if (typeof text !== "string") throw new TypeError("notes text must be a string");
  const entries = [];
  let header = "";
  for (const chunk of text.split(SPLIT)) {
    if (!chunk) continue;
    const mark = MARK.exec(chunk);
    const legacyMark = LEGACY.exec(chunk);
    if (!mark && !legacyMark) {
      header += chunk;
      continue;
    }
    const markerLine = (mark ?? legacyMark)[0];
    const body = chunk.slice(chunk.indexOf(markerLine) + markerLine.length).replace(/^\r?\n/, "");
    if (mark) {
      const a = attrs(mark[1]);
      entries.push({ id: a.id, lectureId: a.lecture ?? null, rev: a.rev ?? null, body, legacy: false });
    } else {
      const lectureId = legacyMark[1];
      entries.push({ id: legacyId({ lectureId, body }), lectureId, rev: null, body, legacy: true });
    }
  }
  return { header, entries };
}

export function renderNotes(header, entries) {
  return (
    header +
    entries
      .map((e) =>
        e.legacy
          ? `<!-- lecture:${e.lectureId} -->\n${e.body}`
          : `${noteMarker({ id: e.id, lectureId: e.lectureId, rev: e.rev })}\n${e.body}`,
      )
      .join("")
  );
}

const sortKey = (e) => [e.rev ?? "", e.id];

/**
 * 合併兩份 notes.md。
 * @returns {{ text: string, total: number, added: number, conflicts: number }}
 */
export function mergeNotes(localText, remoteText) {
  const local = parseNotes(localText);
  const remote = parseNotes(remoteText);

  const byId = new Map();
  let conflicts = 0;
  let added = 0;

  for (const e of local.entries) byId.set(e.id, e);
  for (const e of remote.entries) {
    const mine = byId.get(e.id);
    if (!mine) {
      byId.set(e.id, e);
      added++;
      continue;
    }
    if (mine.body === e.body) continue;
    const a = mine.rev ?? "";
    const b = e.rev ?? "";
    if (b > a) {
      byId.set(e.id, e); // 遠端較新
      continue;
    }
    if (a > b) continue; // 本機較新
    // rev 相同、內容不同：兩則都留，不替使用者挑
    conflicts++;
    const cid = `${e.id}#conflict`;
    byId.set(cid, {
      ...e,
      id: cid,
      body: `<!-- ub:conflict 與 ${e.id} 版本衝突，請人工處理 -->\n${e.body}`,
    });
  }

  const entries = [...byId.values()].sort((x, y) => {
    const [xa, xb] = sortKey(x);
    const [ya, yb] = sortKey(y);
    if (xa !== ya) return xa < ya ? -1 : 1;
    return xb < yb ? -1 : xb > yb ? 1 : 0;
  });

  return {
    text: renderNotes(local.header || remote.header, entries),
    total: entries.length,
    added,
    conflicts,
  };
}
