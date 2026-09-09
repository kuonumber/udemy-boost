const DEFAULT_ENDPOINT = "http://127.0.0.1:8766";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const STATUSES = new Set(["pending", "processing", "review_ready", "synced", "failed"]);
const PROCESSORS = new Set(["codex", "claude"]);

export class InboxError extends Error {
  constructor(message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = "InboxError";
    this.status = status;
  }
}

function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError("Inbox endpoint 無效"); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash) throw new TypeError("Inbox endpoint 必須是 127.0.0.1 localhost HTTP 位址");
  return url.href.replace(/\/$/u, "");
}

function validateItemId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value)) throw new TypeError("itemId 格式無效");
  return value;
}

function errorForStatus(status) {
  const messages = { 401: "Inbox 配對 token 無效，請重新配對。", 403: "此 extension 尚未配對或 Origin 不被允許。", 409: "requestId 與既有內容衝突，未覆寫原資料。", 413: "學習包過大，超過 Inbox 限制。", 422: "學習包格式不符合 Inbox 契約。" };
  return messages[status] ?? (status >= 500 ? "本機 Inbox 伺服器發生錯誤。" : `Inbox HTTP 錯誤 ${status}`);
}

function validateResponse(value, kind) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || typeof value.itemId !== "string" || !STATUSES.has(value.status)) throw new InboxError(`Inbox ${kind} 回應格式無效`);
  return value;
}

function assertResponseSize(size) {
  if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw new InboxError("Inbox 回應過大，超過 1 MiB 限制");
}

async function readJsonResponse(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  assertResponseSize(contentLength);

  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let byteLength = 0;
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new InboxError("Inbox 回應過大，超過 1 MiB 限制");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    }
    if (typeof response.text === "function") {
      const text = await response.text();
      assertResponseSize(new TextEncoder().encode(text).byteLength);
      return JSON.parse(text);
    }
    const value = await response.json();
    assertResponseSize(new TextEncoder().encode(JSON.stringify(value)).byteLength);
    return value;
  } catch (error) {
    if (error instanceof InboxError) throw error;
    throw new InboxError("Inbox 回傳的 JSON 無法解析", { cause: error });
  }
}

export function createInboxClient({ token, endpoint = DEFAULT_ENDPOINT, fetchFn = fetch, timeoutMs = 5000 } = {}) {
  if (typeof token !== "string" || !token.trim()) throw new TypeError("Inbox token 不得為空");
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn 必須是函式");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs 必須是正數");
  const base = validateEndpoint(endpoint);
  const authorization = `Bearer ${token.trim()}`;
  async function request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try { response = await fetchFn(`${base}${path}`, { ...init, signal: controller.signal }); }
    catch (error) {
      if (error?.name === "AbortError") throw new InboxError("連線本機 Inbox 逾時", { cause: error });
      throw new InboxError(`無法連線本機 Inbox：${error?.message ?? String(error)}。請確認 anki-mcp-server 已啟動，且其 UDEMY_EXTENSION_ORIGIN 與 popup 顯示的 Extension Origin 一致。`, { cause: error });
    } finally { clearTimeout(timer); }
    if (!response?.ok) throw new InboxError(errorForStatus(response?.status ?? 0), { status: response?.status ?? null });
    return readJsonResponse(response);
  }
  return Object.freeze({
    async health() {
      const value = await request("/v1/health", { method: "GET", headers: { Authorization: authorization } });
      if (value?.status !== "ok") throw new InboxError("Inbox health 回應格式無效");
      return value;
    },
    async submit(studyPack, { requestId = crypto.randomUUID(), createdAt = new Date().toISOString(), processor } = {}) {
      if (processor !== undefined && !PROCESSORS.has(processor)) throw new TypeError("processor 必須是 codex 或 claude");
      const value = await request("/v1/inbox/items", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, requestId, createdAt, ...(processor !== undefined ? { processor } : {}), studyPack }) });
      return validateResponse(value, "submit");
    },
    async getItem(itemId) {
      const value = await request(`/v1/inbox/items/${encodeURIComponent(validateItemId(itemId))}`, { method: "GET", headers: { Authorization: authorization } });
      return validateResponse(value, "item");
    },
  });
}
