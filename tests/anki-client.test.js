import test from "node:test";
import assert from "node:assert/strict";
import { AnkiConnectError, createAnkiClient, syncCardsToAnki } from "../src/anki/client.js";

const response = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });

test("createAnkiClient.invoke 傳送 AnkiConnect v6 request 並回傳 result", async () => {
  const calls = [];
  const client = createAnkiClient({ fetchFn: async (url, init) => { calls.push({ url, init }); return response({ result: 6, error: null }); } });
  assert.equal(await client.invoke("version"), 6);
  assert.equal(calls[0].url, "http://127.0.0.1:8765");
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "version", version: 6, params: {} });
});

test("createAnkiClient.invoke 將 HTTP、JSON、shape 與 API error 轉成明確錯誤", async () => {
  const cases = [
    async () => response({}, { ok: false, status: 500 }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }),
    async () => response({ result: 1 }),
    async () => response({ result: null, error: "boom" }),
  ];
  for (const fetchFn of cases) await assert.rejects(() => createAnkiClient({ fetchFn }).invoke("version"), AnkiConnectError);
});

test("createAnkiClient.invoke timeout 與連線失敗不偽裝成功", async () => {
  await assert.rejects(() => createAnkiClient({ fetchFn: async () => { throw new Error("offline"); } }).invoke("version"), /offline/);
  const fetchFn = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  await assert.rejects(() => createAnkiClient({ fetchFn, timeoutMs: 5 }).invoke("version"), /逾時/);
});

const packageData = {
  course: { id: "42", title: "Blender 基礎", slug: "blender-basic" },
  unit: { id: "12", chapterTitle: "介面", title: "Viewport", url: "https://www.udemy.com/course/blender-basic/learn/lecture/12" },
  cards: [
    { type: "basic", front: "Q1", back: "A1", sourceStartSec: 1, sourceEndSec: 2, reason: "why", tags: ["concept"] },
    { type: "cloze", text: "{{c1::Viewport}}", extra: "UI", sourceStartSec: 3, sourceEndSec: 4, reason: "term", tags: ["term"] },
  ],
};

function scriptedInvoke(script, calls = []) {
  return { calls, invoke: async (action, params = {}) => { calls.push({ action, params }); const next = script[action]; return typeof next === "function" ? next(params, calls) : next; } };
}

test("syncCardsToAnki 建立 deck、檢查 models、查重、canAddNotes 後新增", async () => {
  const mock = scriptedInvoke({
    version: 6, deckNames: [], createDeck: 1, modelNames: ["Basic", "Cloze"],
    findNotes: [], canAddNotes: [true, true], addNotes: [101, 102],
  });
  const result = await syncCardsToAnki(packageData, { invoke: mock.invoke });
  assert.deepEqual(result.counts, { added: 2, duplicate: 0, rejected: 0, failed: 0 });
  assert.deepEqual(result.items.map((x) => x.noteId), [101, 102]);
  assert.deepEqual(mock.calls.map((x) => x.action), ["version", "deckNames", "createDeck", "modelNames", "findNotes", "findNotes", "canAddNotes", "addNotes"]);
});

test("syncCardsToAnki 已有 deck 不重建；已存在卡片標 duplicate 且不送 addNotes", async () => {
  let findCount = 0;
  const mock = scriptedInvoke({
    version: 6, deckNames: ["Udemy Boost::Blender 基礎"], modelNames: ["Basic", "Cloze"],
    findNotes: () => (++findCount === 1 ? [77] : []), canAddNotes: [true], addNotes: [102],
  });
  const result = await syncCardsToAnki(packageData, { invoke: mock.invoke });
  assert.equal(result.items[0].status, "duplicate");
  assert.equal(result.items[1].status, "added");
  assert.ok(!mock.calls.some((x) => x.action === "createDeck"));
});

test("syncCardsToAnki 只處理 selectedIndices", async () => {
  const mock = scriptedInvoke({ version: 6, deckNames: [], createDeck: 1, modelNames: ["Basic", "Cloze"], findNotes: [], canAddNotes: [true], addNotes: [9] });
  const result = await syncCardsToAnki(packageData, { invoke: mock.invoke, selectedIndices: [1] });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].index, 1);
});

test("syncCardsToAnki AnkiConnect 版本或 model 不符時整批停止", async () => {
  await assert.rejects(() => syncCardsToAnki(packageData, { invoke: scriptedInvoke({ version: 5 }).invoke }), /版本 6/);
  await assert.rejects(
    () => syncCardsToAnki(packageData, { invoke: scriptedInvoke({ version: 6, deckNames: [], createDeck: 1, modelNames: ["Basic"] }).invoke }),
    /Cloze/,
  );
});

test("syncCardsToAnki canAddNotes false 標 rejected，addNotes null 標 failed", async () => {
  const mock = scriptedInvoke({
    version: 6, deckNames: [], createDeck: 1, modelNames: ["Basic", "Cloze"], findNotes: [],
    canAddNotes: [false, true], addNotes: [null],
  });
  const result = await syncCardsToAnki(packageData, { invoke: mock.invoke });
  assert.deepEqual(result.items.map((x) => x.status), ["rejected", "failed"]);
  assert.deepEqual(result.counts, { added: 0, duplicate: 0, rejected: 1, failed: 1 });
});

test("syncCardsToAnki 產生 Basic/Cloze fields、來源與穩定去重 tag", async () => {
  const mock = scriptedInvoke({
    version: 6, deckNames: [], createDeck: 1, modelNames: ["Basic", "Cloze"], findNotes: [], canAddNotes: [true, true], addNotes: [1, 2],
  });
  await syncCardsToAnki(packageData, { invoke: mock.invoke });
  const notes = mock.calls.find((x) => x.action === "canAddNotes").params.notes;
  assert.deepEqual(Object.keys(notes[0].fields), ["Front", "Back"]);
  assert.deepEqual(Object.keys(notes[1].fields), ["Text", "Back Extra"]);
  assert.match(notes[0].fields.Back, /https:\/\/www\.udemy\.com/);
  assert.ok(notes.every((n) => n.tags.some((t) => /^ub-id::[a-f0-9]{64}$/.test(t))));
});

test("syncCardsToAnki 空選取不呼叫 Anki", async () => {
  const calls = [];
  const result = await syncCardsToAnki(packageData, { selectedIndices: [], invoke: async (...args) => calls.push(args) });
  assert.deepEqual(result.counts, { added: 0, duplicate: 0, rejected: 0, failed: 0 });
  assert.equal(calls.length, 0);
});

test("syncCardsToAnki 支援繁體中文 Anki 的基本型／克漏字 model 與欄位", async () => {
  const mock = scriptedInvoke({
    version: 6, deckNames: [], createDeck: 1, modelNames: ["基本型", "克漏字"], findNotes: [], canAddNotes: [true, true], addNotes: [1, 2],
  });
  await syncCardsToAnki(packageData, { invoke: mock.invoke });
  const notes = mock.calls.find((call) => call.action === "canAddNotes").params.notes;
  assert.equal(notes[0].modelName, "基本型");
  assert.deepEqual(Object.keys(notes[0].fields), ["正面", "背面"]);
  assert.equal(notes[1].modelName, "克漏字");
  assert.deepEqual(Object.keys(notes[1].fields), ["文字", "背面額外內容"]);
});
