// Google Drive REST v3 client。fetch 與 token 取得都以注入提供，方便測試也方便換 auth 實作。
// 只用 drive.file scope 能做的事：查、建、下載、更新「本 app 建立的檔案」。

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,md5Checksum,modifiedTime";
const RETRYABLE_403 = new Set(["rateLimitExceeded", "userRateLimitExceeded", "sharingRateLimitExceeded"]);

export class DriveError extends Error {
  constructor(message, { status = null, retryable = false, conflict = false, cause } = {}) {
    super(message, { cause });
    this.name = "DriveError";
    this.status = status;
    this.retryable = retryable;
    this.conflict = conflict;
  }
}

/** token 無效 / 未授權。呼叫端應該要求使用者重新授權，而不是重試。 */
export class DriveAuthError extends DriveError {
  constructor(message, opts = {}) {
    super(message, { ...opts, retryable: false });
    this.name = "DriveAuthError";
  }
}

/** Drive 查詢語法的字串字面值：單引號與反斜線要跳脫，否則檔名含 ' 會讓 query 解析失敗。 */
const quote = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function readBody(res) {
  try {
    return await res.json();
  } catch {
    try {
      return { _text: await res.text() };
    } catch {
      return null;
    }
  }
}

function errorFor(res, body) {
  const status = res.status;
  const apiErr = body && typeof body === "object" ? body.error : null;
  const message = apiErr?.message ?? (body?._text ? String(body._text).slice(0, 200) : "unknown error");
  const reasons = new Set((apiErr?.errors ?? []).map((e) => e.reason));
  const detail = `Drive HTTP ${status}：${message}`;
  if (status === 401) return new DriveAuthError(detail, { status });
  if (status === 412) return new DriveError(detail, { status, conflict: true });
  if (status === 403) {
    const retryable = [...reasons].some((r) => RETRYABLE_403.has(r));
    return new DriveError(detail, { status, retryable });
  }
  if (status === 429 || status >= 500) return new DriveError(detail, { status, retryable: true });
  return new DriveError(detail, { status });
}

/**
 * @param {{ getToken: () => Promise<string>, fetchFn?: typeof fetch, timeoutMs?: number }} o
 */
export function createDriveClient({ getToken, fetchFn = fetch, timeoutMs = 20000 } = {}) {
  if (typeof getToken !== "function") throw new TypeError("getToken 必須是函式");

  async function request(url, { method = "GET", headers = {}, body, raw = false } = {}) {
    const token = await getToken(); // 失敗直接往上拋，不送請求
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") throw new DriveError(`Drive 請求逾時（${timeoutMs}ms）`, { retryable: true, cause: e });
      throw new DriveError(`無法連線 Drive：${e?.message ?? String(e)}`, { retryable: true, cause: e });
    } finally {
      clearTimeout(timer);
    }
    if (!res?.ok) throw errorFor(res, await readBody(res));
    if (raw) return res.text();
    return res.json();
  }

  const multipart = (metadata, text, mimeType) => {
    const boundary = `ub${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${text}\r\n` +
      `--${boundary}--\r\n`;
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  };

  return Object.freeze({
    /** @returns {Promise<{id:string,md5Checksum?:string,modifiedTime?:string}|null>} */
    async findFile(name, parentId) {
      const q = `name = '${quote(name)}' and '${quote(parentId)}' in parents and trashed = false`;
      const url = `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`files(${FIELDS})`)}&pageSize=10`;
      const r = await request(url);
      const f = r?.files?.[0];
      return f ? { id: f.id, md5Checksum: f.md5Checksum ?? null, modifiedTime: f.modifiedTime ?? null } : null;
    },

    /** 找不到就建立，回傳資料夾 id。 */
    async ensureFolder(name, parentId = "root") {
      const q = `name = '${quote(name)}' and '${quote(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
      const found = await request(`${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id)")}&pageSize=10`);
      if (found?.files?.[0]?.id) return found.files[0].id;
      const created = await request(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      return created.id;
    },

    /** 原始位元組，不經任何 Google 格式轉換。 */
    async download(fileId) {
      return request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { raw: true });
    },

    async createFile({ name, parentId, mimeType = "text/plain", text = "" }) {
      const { body, contentType } = multipart({ name, parents: [parentId], mimeType }, text, mimeType);
      return request(`${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
    },

    /** etag 有給就帶 If-Match：遠端在我們讀取後又被改過時會回 412（conflict）。 */
    async updateFile(fileId, text, { mimeType = "text/plain", etag } = {}) {
      return request(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${encodeURIComponent(FIELDS)}`, {
        method: "PATCH",
        headers: { "Content-Type": `${mimeType}; charset=UTF-8`, ...(etag ? { "If-Match": etag } : {}) },
        body: text,
      });
    },
  });
}
