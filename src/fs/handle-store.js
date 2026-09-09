// FileSystemDirectoryHandle 存取（IndexedDB，extension origin）。options 頁與 offscreen 共用。

const DB = "ub-fs";
const STORE = "handles";
const KEY = "udemyRoot";

function open() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
  });
}

export async function saveHandle(handle) {
  const db = await open();
  await tx(db, "readwrite", (s) => s.put(handle, KEY));
}

export async function loadHandle() {
  const db = await open();
  return (await tx(db, "readonly", (s) => s.get(KEY))) ?? null;
}

export async function clearHandle() {
  const db = await open();
  await tx(db, "readwrite", (s) => s.delete(KEY));
}

/** 'granted' | 'prompt' | 'denied' | 'none'（沒選過） */
export async function permissionState(handle) {
  if (!handle) return "none";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}
