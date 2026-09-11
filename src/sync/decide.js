// 同步決策：本地狀態 × 遠端狀態 × 上次同步記錄 → 動作。純函式，不碰網路也不碰檔案。
//
// 唯一的安全準則：不確定的時候一律 merge。
// 「覆蓋」只有在確定另一邊沒變過（有上次同步記錄可比對）時才允許。

/** @typedef {"noop"|"create"|"download"|"upload"|"merge"|"up-to-date"} SyncAction */

function requireObject(v, name) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new TypeError(`${name} 必須是物件`);
  return v;
}

/**
 * @param {{
 *   local:  { exists: boolean, hash?: string|null },
 *   remote: { exists: boolean, md5?: string|null },
 *   state:  { localHash?: string|null, remoteMd5?: string|null } | null
 * }} o
 * @returns {{ action: SyncAction, reason: string }}
 */
export function decideSync(o) {
  requireObject(o, "decideSync 參數");
  const local = requireObject(o.local, "local");
  const remote = requireObject(o.remote, "remote");
  const state = o.state == null ? null : requireObject(o.state, "state");

  if (!local.exists && !remote.exists) return { action: "noop", reason: "兩邊都沒有這個檔案" };
  if (local.exists && !remote.exists) return { action: "create", reason: "遠端還沒有，第一次上傳" };
  if (!local.exists && remote.exists) return { action: "download", reason: "本機沒有，從遠端取回" };

  // 兩邊都有：要靠上次同步記錄才知道誰動過
  const known = state && state.localHash != null && state.remoteMd5 != null;
  if (!known) return { action: "merge", reason: "沒有上次同步記錄，保守合併" };
  if (remote.md5 == null) return { action: "merge", reason: "遠端沒有 md5 可比對，保守合併" };

  const localChanged = local.hash !== state.localHash;
  const remoteChanged = remote.md5 !== state.remoteMd5;

  if (!localChanged && !remoteChanged) return { action: "up-to-date", reason: "兩邊都沒變" };
  if (localChanged && !remoteChanged) return { action: "upload", reason: "只有本機變動" };
  if (!localChanged && remoteChanged) return { action: "download", reason: "只有遠端變動" };
  return { action: "merge", reason: "兩邊都有變動" };
}
