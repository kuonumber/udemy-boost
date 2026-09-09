// 以 FileSystemDirectoryHandle 為根的檔案操作。路徑用 "/" 分段，相對於根（Udemy 資料夾）。
// 只在有 DOM 的 extension 頁（offscreen / options）使用；service worker 不保證有 createWritable。

function splitPath(path) {
  const parts = String(path).split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === "..")) throw new RangeError(`bad path: ${path}`);
  return parts;
}

async function dirFor(root, parts, create) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

async function fileHandle(root, path, create) {
  const parts = splitPath(path);
  const dir = await dirFor(root, parts.slice(0, -1), create);
  return dir.getFileHandle(parts.at(-1), { create });
}

export async function exists(root, path) {
  try {
    await fileHandle(root, path, false);
    return true;
  } catch (e) {
    if (e?.name === "NotFoundError") return false;
    throw e;
  }
}

/** 讀文字；不存在回 null。 */
export async function readText(root, path) {
  try {
    const fh = await fileHandle(root, path, false);
    return await (await fh.getFile()).text();
  } catch (e) {
    if (e?.name === "NotFoundError") return null;
    throw e;
  }
}

export async function stat(root, path) {
  try {
    const f = await (await fileHandle(root, path, false)).getFile();
    return { size: f.size, mtimeIso: new Date(f.lastModified).toISOString() };
  } catch (e) {
    if (e?.name === "NotFoundError") return null;
    throw e;
  }
}

export async function writeText(root, path, text) {
  const fh = await fileHandle(root, path, true);
  const w = await fh.createWritable(); // 截斷重寫
  await w.write(text);
  await w.close();
}

/**
 * 追加；檔案不存在時先寫 header（若有給）。
 * 用 keepExistingData + seek 到檔尾，避免整檔重寫。
 */
export async function appendText(root, path, text, header = "") {
  const existed = await exists(root, path);
  const fh = await fileHandle(root, path, true);
  const size = existed ? (await fh.getFile()).size : 0;
  const w = await fh.createWritable({ keepExistingData: true });
  await w.seek(size);
  await w.write((existed || !header ? "" : header) + text);
  await w.close();
}

export async function copyFile(root, from, to) {
  const text = await readText(root, from);
  if (text === null) return false;
  await writeText(root, to, text);
  return true;
}
