// 翻譯結果快取。storage 介面注入（chrome.storage.local 或測試用記憶體），LRU by 最後存取時間。
// index 存在 `t:index`：{ [key]: { ts, bytes } }。

const INDEX_KEY = "t:index";

export function createCache(storage, { maxEntries = 200, maxBytes = 8 * 1024 * 1024, now = () => Date.now() } = {}) {
  let indexPromise = null;

  async function loadIndex() {
    if (!indexPromise) {
      indexPromise = storage.get(INDEX_KEY).then((r) => r[INDEX_KEY] ?? {});
    }
    return indexPromise;
  }

  async function saveIndex(index) {
    indexPromise = Promise.resolve(index);
    await storage.set({ [INDEX_KEY]: index });
  }

  function totalBytes(index) {
    return Object.values(index).reduce((s, e) => s + e.bytes, 0);
  }

  /** 淘汰直到 entries ≤ maxEntries 且 bytes ≤ maxBytes。回傳被刪的 key。 */
  async function evict(index) {
    const keys = Object.keys(index).sort((a, b) => index[a].ts - index[b].ts); // 最舊在前
    const removed = [];
    while (keys.length > 0 && (keys.length > maxEntries || totalBytes(index) > maxBytes)) {
      const k = keys.shift();
      delete index[k];
      removed.push(k);
    }
    if (removed.length) await storage.remove(removed);
    return removed;
  }

  return {
    async get(key) {
      const index = await loadIndex();
      const r = await storage.get(key);
      const entry = r[key];
      if (!entry) {
        if (index[key]) {
          delete index[key];
          await saveIndex(index); // index 與資料不一致 → 自我修復
        }
        return null;
      }
      index[key] = { ...(index[key] ?? { bytes: JSON.stringify(entry).length }), ts: now() };
      await saveIndex(index);
      return entry.cues;
    },

    async set(key, cues) {
      if (!Array.isArray(cues)) throw new TypeError("cues must be an array");
      const entry = { ts: now(), cues };
      const bytes = JSON.stringify(entry).length;
      if (bytes > maxBytes) return; // 單筆就超過上限：不寫、不丟錯
      const index = await loadIndex();
      index[key] = { ts: entry.ts, bytes };
      await evict(index);
      if (!index[key]) return; // 理論上不會（新的 ts 最大），保險
      await storage.set({ [key]: entry });
      await saveIndex(index);
    },

    async clear() {
      const index = await loadIndex();
      await storage.remove([...Object.keys(index), INDEX_KEY]);
      indexPromise = Promise.resolve({});
    },

    async stats() {
      const index = await loadIndex();
      return { entries: Object.keys(index).length, bytes: totalBytes(index) };
    },
  };
}

/** 瀏覽器端預設 instance。 */
export function createChromeCache(opts) {
  return createCache(chrome.storage.local, opts);
}
