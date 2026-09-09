import test from "node:test";
import assert from "node:assert/strict";
import { InboxError, createInboxClient } from "../src/anki/inbox.js";

const jsonResponse = (body, { ok = true, status = 200, headers } = {}) => ({
  ok,
  status,
  headers: headers ?? { get: () => null },
  json: async () => body,
});

test("Inbox health 檢查也帶 bearer token", async () => {
  const calls = [];
  const client = createInboxClient({
    token: "pairing-token",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ status: "ok" });
    },
  });

  await client.health();

  assert.equal(calls[0].url, "http://127.0.0.1:8766/v1/health");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pairing-token");
});

test("Inbox client 拒絕超過 1 MiB 的 localhost 回應", async () => {
  const client = createInboxClient({
    token: "token",
    fetchFn: async () => jsonResponse(
      { schemaVersion: 1, itemId: "item-1", status: "pending" },
      { headers: { get: (name) => name.toLowerCase() === "content-length" ? String(1024 * 1024 + 1) : null } },
    ),
  });

  await assert.rejects(() => client.getItem("item-1"), /回應過大/);
});

test("Inbox client 以 bearer token 將單元學習包送到 localhost", async () => {
  const calls = [];
  const client = createInboxClient({
    token: "a".repeat(43),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ schemaVersion: 1, itemId: "item-1", requestId: "req-1", status: "pending", deduplicated: false });
    },
  });
  const studyPack = { course: { id: "42" }, unit: { id: "12" }, subtitles: { en: [], zh: [] } };
  const result = await client.submit(studyPack, { requestId: "req-1", createdAt: "2026-09-07T01:02:03.000Z" });
  assert.equal(result.itemId, "item-1");
  assert.equal(calls[0].url, "http://127.0.0.1:8766/v1/inbox/items");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${"a".repeat(43)}`);
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { schemaVersion: 1, requestId: "req-1", createdAt: "2026-09-07T01:02:03.000Z", studyPack });
});

test("Inbox client 帶上使用者選的處理工具，並拒絕未知工具", async () => {
  const calls = [];
  const client = createInboxClient({ token: "t", fetchFn: async (url, init) => { calls.push(JSON.parse(init.body)); return jsonResponse({ schemaVersion: 1, itemId: "item-1", requestId: "req-1", status: "pending", deduplicated: false, processor: "claude" }); } });
  const studyPack = { course: { id: "42" }, unit: { id: "12" }, subtitles: { en: [], zh: [] } };
  await client.submit(studyPack, { requestId: "req-1", createdAt: "2026-09-07T01:02:03.000Z", processor: "claude" });
  assert.equal(calls[0].processor, "claude");
  await client.submit(studyPack, { requestId: "req-2", createdAt: "2026-09-07T01:02:03.000Z" });
  assert.ok(!("processor" in calls[1]), "未指定時不送 processor 欄位");
  await assert.rejects(() => client.submit(studyPack, { requestId: "req-3", createdAt: "2026-09-07T01:02:03.000Z", processor: "gpt" }), TypeError);
  assert.equal(calls.length, 2);
});

test("Inbox client 讀取項目與 review_ready 卡片草稿", async () => {
  const client = createInboxClient({
    token: "token",
    fetchFn: async () => jsonResponse({ schemaVersion: 1, itemId: "item-1", status: "review_ready", cardsJson: { schemaVersion: 1 } }),
  });
  const item = await client.getItem("item-1");
  assert.equal(item.status, "review_ready");
  assert.deepEqual(item.cardsJson, { schemaVersion: 1 });
});

test("Inbox client 拒絕空 token、非法 itemId 與非 localhost endpoint", () => {
  assert.throws(() => createInboxClient({ token: "" }), /token/);
  assert.throws(() => createInboxClient({ token: "x", endpoint: "https://example.com" }), /localhost/);
  const client = createInboxClient({ token: "x", fetchFn: async () => jsonResponse({}) });
  assert.rejects(() => client.getItem("../secret"), /itemId/);
});

test("Inbox client 將 HTTP 狀態轉成可操作錯誤且不洩漏 token", async () => {
  for (const [status, pattern] of [[401, /配對 token/], [403, /extension/], [409, /衝突/], [413, /過大/], [422, /格式/], [500, /伺服器/]]) {
    const client = createInboxClient({ token: "super-secret", fetchFn: async () => jsonResponse({ error: "server detail" }, { ok: false, status }) });
    await assert.rejects(() => client.submit({}, { requestId: "req", createdAt: "2026-09-07T00:00:00Z" }), (error) => {
      assert.ok(error instanceof InboxError);
      assert.match(error.message, pattern);
      assert.doesNotMatch(error.message, /super-secret/);
      return true;
    });
  }
});

test("Inbox client 將 timeout、離線、壞 JSON 與錯誤 response shape 視為失敗", async () => {
  const timeoutFetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  await assert.rejects(() => createInboxClient({ token: "x", fetchFn: timeoutFetch, timeoutMs: 5 }).getItem("item-1"), /逾時/);
  await assert.rejects(() => createInboxClient({ token: "x", fetchFn: async () => { throw new Error("offline"); } }).getItem("item-1"), (error) => {
    assert.ok(error instanceof InboxError);
    assert.match(error.message, /offline/);
    // 瀏覽器對缺 CORS header 的 403（Origin 未配對）只會丟 "Failed to fetch"，訊息必須指向 Origin 設定
    assert.match(error.message, /UDEMY_EXTENSION_ORIGIN/);
    return true;
  });
  await assert.rejects(() => createInboxClient({ token: "x", fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }) }).getItem("item-1"), /JSON/);
  await assert.rejects(() => createInboxClient({ token: "x", fetchFn: async () => jsonResponse({ status: "pending" }) }).getItem("item-1"), /回應格式/);
});
