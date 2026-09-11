// watch-log.csv 的跨裝置合併。純函式。
//
// 觀看段一旦寫出就不可變，所以整份 CSV 是一個 grow-only set：
// 合併 = 聯集，不需要「誰比較新」的判斷，也就不可能因為兩台機器同時寫而互相覆蓋。
// 身分用「正規化後的整列字串」（= toRow 的輸出），它涵蓋全部欄位且與物件的鍵順序無關；
// 規格原本寫 sha256(row)，改用標準序列化字串，效果相同但可同步呼叫、測試好寫。
import { headerLine, toRow, parseRows } from "../focus/csv.js";

/** 一列的身分。同值必同 key，任一欄位不同就不同 key。 */
export function rowKey(seg) {
  return toRow(seg).trimEnd();
}

function parseOrThrow(text, label) {
  if (typeof text !== "string") throw new TypeError(`${label} csv text must be a string`);
  return parseRows(text);
}

/**
 * 合併兩份 watch-log.csv。
 * @param {string} localText  本機內容（可為空字串）
 * @param {string} remoteText 遠端內容（可為空字串）
 * @returns {{ text: string, total: number, added: number, bad: number }}
 *          added = 遠端帶進來、本地原本沒有的列數
 */
export function mergeCsv(localText, remoteText) {
  const local = parseOrThrow(localText, "local");
  const remote = parseOrThrow(remoteText, "remote");

  const byKey = new Map();
  for (const seg of local.rows) byKey.set(rowKey(seg), seg);
  let added = 0;
  for (const seg of remote.rows) {
    const key = rowKey(seg);
    if (byKey.has(key)) continue;
    byKey.set(key, seg);
    added++;
  }

  // 依 start 排序；同時間戳以 key 決定序，確保「合併可交換」：
  // A∪B 與 B∪A 必須產生完全相同的位元組，否則兩台機器會無止盡地互相上傳。
  const rows = [...byKey.entries()].sort((a, b) => {
    const ta = Date.parse(a[1].start);
    const tb = Date.parse(b[1].start);
    if (ta !== tb) return ta - tb;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  return {
    text: headerLine() + rows.map(([, seg]) => toRow(seg)).join(""),
    total: rows.length,
    added,
    bad: local.bad + remote.bad,
  };
}
