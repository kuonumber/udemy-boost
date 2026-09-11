// 同步流程本體：決策 → 動作 → 更新同步狀態。
// drive / files / state 全部注入，所以整條流程可以在 node 測，不需要網路或瀏覽器。
//
// 同步狀態刻意存在 chrome.storage.local（由呼叫端提供的 state），不是使用者的 Udemy 資料夾：
// 它是「這台裝置上次看到什麼」，本來就不該跨裝置同步，放進資料夾只會自己跟自己打架。
import { decideSync } from "./decide.js";

const MAX_CONFLICT_RETRY = 3;

/**
 * 內容 hash（FNV-1a 64-bit 變體，輸出 hex）。
 * 只用來偵測「有沒有變」，不是密碼學用途；同步版本讓決策函式好寫也好測。
 * null（檔案不存在）與空字串必須不同，否則「剛被清空」會被誤判成「不存在」。
 */
export function hashText(text) {
  if (text === null || text === undefined) return "none";
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}:${text.length}`;
}

/**
 * @param {{
 *   drive: { ensureFolder, findFile, download, createFile, updateFile },
 *   files: { read(path): Promise<string|null>, write(path, text): Promise<void> },
 *   state: { get(key): Promise<object|null>, set(key, value): Promise<void> },
 *   rootFolder?: string,
 * }} deps
 */
export function createSyncer({ drive, files, state, rootFolder = "Udemy Boost" }) {
  let folderPromise = null;
  const folderId = () => (folderPromise ??= drive.ensureFolder(rootFolder));

  /**
   * 同步單一檔案。
   * @param {{ key, localPath, remoteName, mimeType?, merge?: (local, remote) => {text} }} spec
   * @returns {Promise<{action, key, retries, total?, added?}>}
   */
  async function syncFile(spec) {
    const { key, localPath, remoteName, mimeType = "text/plain", merge, localWins = false } = spec;
    const parent = await folderId();

    for (let attempt = 0; ; attempt++) {
      const localText = await files.read(localPath);
      const remote = await drive.findFile(remoteName, parent);
      const prev = await state.get(key);
      const localHash = hashText(localText);

      let { action } = decideSync({
        local: { exists: localText !== null, hash: localHash },
        remote: { exists: !!remote, md5: remote?.md5Checksum ?? null },
        state: prev,
      });

      // 衍生檔（例如 progress.md 由 watch-log.csv 算出）：合併兩份報告沒有意義，
      // 只要本機有檔就以本機為準；本機沒有才從雲端取回。
      if (localWins && localText !== null && (action === "merge" || action === "download")) action = "upload";

      const done = async (finalLocalText, meta, extra = {}) => {
        await state.set(key, { localHash: hashText(finalLocalText), remoteMd5: meta?.md5Checksum ?? null, at: new Date().toISOString() });
        return { ok: true, action, key, retries: attempt, ...extra };
      };

      try {
        if (action === "noop" || action === "up-to-date") {
          // noop = 兩邊都沒有這個檔。把找過的路徑帶回去，否則使用者只看到「沒東西」無從查起。
          return { ok: true, action, key, retries: attempt, localPath, remoteName };
        }
        if (action === "create") {
          const meta = await drive.createFile({ name: remoteName, parentId: parent, mimeType, text: localText });
          return done(localText, meta);
        }
        if (action === "download") {
          const text = await drive.download(remote.id);
          await files.write(localPath, text);
          return done(text, remote);
        }
        if (action === "upload") {
          const meta = await drive.updateFile(remote.id, localText, { mimeType });
          return done(localText, meta);
        }
        // merge：兩邊都變過（或沒有同步狀態）
        const remoteText = await drive.download(remote.id);
        if (typeof merge !== "function") throw new TypeError(`${key} 需要合併但沒有提供 merge 函式`);
        const merged = merge(localText ?? "", remoteText ?? "");
        await files.write(localPath, merged.text);
        const meta = await drive.updateFile(remote.id, merged.text, { mimeType });
        // 合併函式各自回報自己的統計（CSV: bad；notes: conflicts），一律往上帶，
        // 不然 popup 想顯示「有幾則衝突」時會拿到 undefined。
        const { text: _text, ...stats } = merged;
        return done(merged.text, meta, stats);
      } catch (e) {
        // 412：我們讀完之後遠端又被改了（另一台正在同步）→ 重跑整個流程，這次會看到新的遠端內容
        if (e?.conflict && attempt < MAX_CONFLICT_RETRY) continue;
        throw e;
      }
    }
  }

  /** 逐一同步；單檔失敗不影響其他檔，結果一律回報。 */
  async function syncAll(specs) {
    const results = [];
    for (const spec of specs) {
      try {
        results.push(await syncFile(spec));
      } catch (e) {
        results.push({ ok: false, key: spec.key, error: e?.message ?? String(e) });
      }
    }
    return { results, failed: results.filter((r) => !r.ok).length };
  }

  return Object.freeze({ syncFile, syncAll });
}
