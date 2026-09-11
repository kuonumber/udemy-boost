// Google Drive REST client 的邊界行為。fetch 以注入取代，完全不碰網路、不需要憑證。
// 重點在錯誤分類：哪些該重試、哪些該重新授權、哪些是衝突要重跑合併。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDriveClient, DriveError, DriveAuthError } from "../src/drive/client.js";

const json = (body, init = {}) => ({
  ok: init.status === undefined || (init.status >= 200 && init.status < 300),
  status: init.status ?? 200,
  headers: { get: (k) => (init.headers ?? {})[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const textRes = (body, init = {}) => ({
  ok: init.status === undefined || (init.status >= 200 && init.status < 300),
  status: init.status ?? 200,
  headers: { get: (k) => (init.headers ?? {})[k.toLowerCase()] ?? null },
  json: async () => {
    throw new SyntaxError("not json");
  },
  text: async () => body,
});

/** 記錄每次呼叫並依序回傳預備好的回應。 */
function stub(responses) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error(`沒有預備回應給 ${init.method ?? "GET"} ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchFn };
}

const client = (responses, opts = {}) => {
  const s = stub(responses);
  return { ...s, drive: createDriveClient({ getToken: async () => "tok", fetchFn: s.fetchFn, ...opts }) };
};

test("每個請求都帶 Bearer token", async () => {
  const { drive, calls } = client([json({ files: [] })]);
  await drive.findFile("watch-log.csv", "folder1");
  assert.equal(calls[0].headers.Authorization, "Bearer tok");
});

test("findFile 以名稱 + 父資料夾查詢，且排除垃圾桶", async () => {
  const { drive, calls } = client([json({ files: [{ id: "f1", md5Checksum: "m", modifiedTime: "t" }] })]);
  const r = await drive.findFile("watch-log.csv", "folder1");
  assert.deepEqual(r, { id: "f1", md5Checksum: "m", modifiedTime: "t" });
  const q = decodeURIComponent(new URL(calls[0].url).searchParams.get("q"));
  assert.match(q, /name = 'watch-log\.csv'/);
  assert.match(q, /'folder1' in parents/);
  assert.match(q, /trashed = false/);
});

test("findFile 找不到回 null，不丟錯", async () => {
  const { drive } = client([json({ files: [] })]);
  assert.equal(await drive.findFile("x", "folder1"), null);
});

test("findFile 對名稱中的單引號做跳脫，避免查詢語法被破壞", async () => {
  const { drive, calls } = client([json({ files: [] })]);
  await drive.findFile("Jimmy's notes.md", "folder1");
  const q = decodeURIComponent(new URL(calls[0].url).searchParams.get("q"));
  assert.match(q, /Jimmy\\'s notes\.md/);
});

test("ensureFolder 已存在就沿用，不重建", async () => {
  const { drive, calls } = client([json({ files: [{ id: "d1" }] })]);
  assert.equal(await drive.ensureFolder("Udemy Boost", "root"), "d1");
  assert.equal(calls.length, 1, "不該再送建立請求");
});

test("ensureFolder 不存在就建立", async () => {
  const { drive, calls } = client([json({ files: [] }), json({ id: "d2" })]);
  assert.equal(await drive.ensureFolder("Udemy Boost", "root"), "d2");
  assert.equal(calls[1].method, "POST");
  assert.match(JSON.parse(calls[1].body).mimeType, /application\/vnd\.google-apps\.folder/);
});

test("download 用 alt=media 取原始位元組，不做任何轉換", async () => {
  const { drive, calls } = client([textRes("a,b\r\n1,2\r\n")]);
  assert.equal(await drive.download("f1"), "a,b\r\n1,2\r\n");
  assert.match(calls[0].url, /alt=media/);
});

test("createFile 送 multipart，內容與 metadata 都在", async () => {
  const { drive, calls } = client([json({ id: "f9", md5Checksum: "m9", modifiedTime: "t9" })]);
  const r = await drive.createFile({ name: "watch-log.csv", parentId: "d1", mimeType: "text/csv", text: "hello" });
  assert.deepEqual(r, { id: "f9", md5Checksum: "m9", modifiedTime: "t9" });
  assert.match(calls[0].url, /uploadType=multipart/);
  assert.match(calls[0].body, /"name":"watch-log\.csv"/);
  assert.match(calls[0].body, /"parents":\["d1"\]/);
  assert.match(calls[0].body, /hello/);
});

test("updateFile 是 PATCH，且可帶 If-Match 做樂觀鎖", async () => {
  const { drive, calls } = client([json({ id: "f1", md5Checksum: "m", modifiedTime: "t" })]);
  await drive.updateFile("f1", "new", { mimeType: "text/csv", etag: 'W/"123"' });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].headers["If-Match"], 'W/"123"');
});

test("401 丟 DriveAuthError（要重新授權，不是重試）", async () => {
  const { drive } = client([json({ error: { message: "Invalid Credentials" } }, { status: 401 })]);
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e instanceof DriveAuthError && e.status === 401);
});

test("403 權限不足 → 不可重試", async () => {
  const { drive } = client([json({ error: { message: "Insufficient Permission" } }, { status: 403 })]);
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e instanceof DriveError && e.retryable === false);
});

test("403 rateLimitExceeded → 可重試", async () => {
  const { drive } = client([json({ error: { message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded" }] } }, { status: 403 })]);
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e.retryable === true);
});

test("412 → 衝突，呼叫端要重跑合併", async () => {
  const { drive } = client([json({ error: { message: "Precondition Failed" } }, { status: 412 })]);
  await assert.rejects(
    () => drive.updateFile("f1", "x", { etag: 'W/"old"' }),
    (e) => e instanceof DriveError && e.status === 412 && e.conflict === true,
  );
});

test("429 與 5xx 標記為可重試", async () => {
  for (const status of [429, 500, 503]) {
    const { drive } = client([json({ error: { message: "boom" } }, { status })]);
    await assert.rejects(() => drive.findFile("x", "d1"), (e) => e.retryable === true, `status ${status}`);
  }
});

test("404 不可重試", async () => {
  const { drive } = client([json({ error: { message: "File not found" } }, { status: 404 })]);
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e.status === 404 && e.retryable === false);
});

test("非 JSON 的錯誤回應（例如 HTML 錯誤頁）也給得出可讀訊息", async () => {
  const { drive } = client([textRes("<html>502 Bad Gateway</html>", { status: 502 })]);
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e instanceof DriveError && /502/.test(e.message));
});

test("網路錯誤包成 DriveError 且可重試", async () => {
  const { drive } = client([new TypeError("Failed to fetch")]);
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e instanceof DriveError && e.retryable === true);
});

test("逾時中止並丟可重試的 DriveError", async () => {
  const fetchFn = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  const drive = createDriveClient({ getToken: async () => "tok", fetchFn, timeoutMs: 10 });
  await assert.rejects(() => drive.findFile("x", "d1"), (e) => e instanceof DriveError && e.retryable === true);
});

test("getToken 失敗直接往上丟，不送任何請求", async () => {
  let sent = 0;
  const drive = createDriveClient({
    getToken: async () => {
      throw new DriveAuthError("尚未授權");
    },
    fetchFn: async () => {
      sent++;
      return json({});
    },
  });
  await assert.rejects(() => drive.findFile("x", "d1"), DriveAuthError);
  assert.equal(sent, 0);
});
