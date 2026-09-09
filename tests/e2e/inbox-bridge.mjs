// 跨 repo 整合：Udemy Boost popup → 真實 anki-mcp-server inbox listener（127.0.0.1:8766）
//   → 自動路徑：server 以 popup 選的處理工具（此處以假 codex CLI 取代真實 `codex exec`）產生草稿
//   → 手動路徑：MCP stdio tools（本腳本扮演 Codex／Claude 對話：claim / save_draft）
//   → popup 審核 → AnkiConnect（mock）。
// 執行：node tests/e2e/inbox-bridge.mjs
// 需要：../anki-mcp-server 已 build（dist/index.js）；可用 ANKI_MCP_SERVER_DIR 指定其他路徑。8766 必須空著。
// 不需要 Udemy 帳號；不碰真實 Anki（8765 在瀏覽器層被 mock）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ROOT, LECTURE_ID, LECTURE_URL, buildTestExtension, launchWithExtension, udemyRouteHandler, mockAnkiConnect } from "./fixtures.mjs";

const SERVER_DIR = path.resolve(process.env.ANKI_MCP_SERVER_DIR ?? path.join(ROOT, "..", "anki-mcp-server"));
const SERVER_ENTRY = path.join(SERVER_DIR, "dist", "index.js");
const INBOX = "http://127.0.0.1:8766";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

// 最小 MCP stdio client：newline-delimited JSON-RPC，只實作 initialize 與 tools/call
class McpStdioClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const waiter = message.id != null ? this.pending.get(message.id) : null;
        if (!waiter) continue;
        this.pending.delete(message.id);
        message.error ? waiter.reject(new Error(`${message.error.code}: ${message.error.message}`)) : waiter.resolve(message.result);
      }
    });
  }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`MCP ${method} timeout`)); }, 15000);
    });
  }
  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
  async initialize() {
    const result = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "udemy-boost-e2e", version: "0" } });
    this.notify("notifications/initialized");
    return result;
  }
  async callTool(name, args) {
    const result = await this.request("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  }
}

// 假的 codex CLI：吃 stdin prompt、寫到 -o 檔；不打任何真實模型。5 張卡含 1 張 cloze，讓 Anki 端兩種 model 都走到。
const FAKE_CARDS = [
  ...Array.from({ length: 4 }, (_v, i) => ({ type: "basic", front: `Fake Q${i + 1}`, back: `Fake A${i + 1}`, sourceStartSec: 4.28, sourceEndSec: 5.96, reason: "fake codex", tags: ["e2e", "auto"] })),
  { type: "cloze", text: "Blender 的 {{c1::interface}} 是本單元重點。", extra: "fake codex", sourceStartSec: 6.76, sourceEndSec: 9, reason: "fake codex", tags: ["e2e"] },
];
function writeFakeCli(dir) {
  const file = path.join(dir, "fake-codex.mjs");
  fs.writeFileSync(file, `import fs from "node:fs";
const prompt = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.PROMPT_CAPTURE, prompt);
fs.writeFileSync(process.argv[process.argv.indexOf("-o") + 1], "\\n\`\`\`json\\n" + JSON.stringify(${JSON.stringify(FAKE_CARDS)}) + "\\n\`\`\`\\n");
`);
  return file;
}

// 用 cwd ≠ data dir 啟動 server，順便驗證 ANKI_MCP_DATA_DIR 生效（Codex 啟動 MCP 時 cwd 不一定是 server repo）
function startServer({ extensionOrigin, dataDir, cwd, extraEnv = {} }) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    env: { ...process.env, UDEMY_EXTENSION_ORIGIN: extensionOrigin, ANKI_MCP_DATA_DIR: dataDir, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return { child, stderr: () => stderr.join("") };
}

async function main() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(`找不到 ${SERVER_ENTRY}；請先在 anki-mcp-server 執行 build（node_modules/.bin/tsup），或設定 ANKI_MCP_SERVER_DIR。`);
    process.exit(2);
  }
  if (!(await portFree(8766))) {
    console.error("127.0.0.1:8766 已被占用（可能是正在跑的 anki-mcp-server）；請先關閉再執行整合測試。");
    process.exit(2);
  }

  const extDir = buildTestExtension();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ub-inbox-data-"));
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ub-inbox-cwd-"));
  const { ctx, userData, extensionId } = await launchWithExtension(extDir);
  const origin = `chrome-extension://${extensionId}`;
  const fakeCli = writeFakeCli(serverCwd);
  const promptCapture = path.join(serverCwd, "prompt-capture.txt");
  const server = startServer({
    extensionOrigin: origin, dataDir, cwd: serverCwd,
    extraEnv: { UDEMY_PROCESSOR_CODEX_CMD: JSON.stringify([process.execPath, fakeCli, "-o", "{output}"]), PROMPT_CAPTURE: promptCapture },
  });
  const cleanup = async () => {
    server.child.kill();
    await ctx.close().catch(() => {});
    for (const dir of [extDir, userData, dataDir, serverCwd]) fs.rmSync(dir, { recursive: true, force: true });
  };

  try {
    // ---- server 啟動：token 檔落在 data dir，而不是 cwd ----
    const tokenPath = path.join(dataDir, "inbox", "pairing-token.txt");
    for (let i = 0; i < 100 && !(fs.existsSync(tokenPath) && /running on stdio/.test(server.stderr())); i++) await sleep(100);
    if (!fs.existsSync(tokenPath)) throw new Error(`server 未在 10 秒內啟動：\n${server.stderr()}`);
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    check("pairing token 建立於 ANKI_MCP_DATA_DIR", /^[0-9a-f]{64}$/.test(token) && !fs.existsSync(path.join(serverCwd, "inbox")), { dataDir, serverCwd });
    check("stderr 只印 token 路徑、不印 token", server.stderr().includes(tokenPath) && !server.stderr().includes(token));

    // ---- HTTP 邊界（直接從 node 打，不經瀏覽器）----
    const health = (headers) => fetch(`${INBOX}/v1/health`, { headers });
    const auth = { Authorization: `Bearer ${token}` };
    check("health：配對 Origin + token → 200", (await health({ ...auth, Origin: origin })).status === 200);
    check("health：錯 Origin → 403", (await health({ ...auth, Origin: "chrome-extension://evil" })).status === 403);
    check("health：無 Origin → 403", (await health(auth)).status === 403);
    check("health：錯 token → 401", (await health({ Authorization: "Bearer nope", Origin: origin })).status === 401);

    // ---- MCP stdio（扮演 Codex）----
    const mcp = new McpStdioClient(server.child);
    const init = await mcp.initialize();
    check("MCP initialize", typeof init?.protocolVersion === "string", init?.serverInfo);
    const before = await mcp.callTool("udemy_inbox_list", { status: "pending" });
    check("送出前 inbox 為空", Array.isArray(before.items) && before.items.length === 0);

    // ---- 瀏覽器：假 Udemy 頁 + popup 送出 ----
    const ankiCalls = await mockAnkiConnect(ctx);
    const page = await ctx.newPage();
    await page.route("https://www.udemy.com/**", udemyRouteHandler());
    await page.goto(LECTURE_URL);
    await page.waitForSelector("#ub-overlay-root", { timeout: 10000 });
    await page.waitForTimeout(2500);

    const popup = await ctx.newPage();
    const popupLog = [];
    popup.on("console", (message) => popupLog.push(`[console.${message.type()}] ${message.text()}`));
    popup.on("pageerror", (error) => popupLog.push(`[pageerror] ${error.message}`));
    popup.on("requestfailed", (request) => popupLog.push(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    popup.on("response", (response) => { if (response.url().startsWith(INBOX)) popupLog.push(`[response] ${response.request().method()} ${response.url()} ${response.status()}`); });
    await popup.goto(`chrome-extension://${extensionId}/options/options.html`);
    await popup.locator("#ankiOrigin").filter({ hasText: "chrome-extension://" }).waitFor({ timeout: 10000 });
    check("popup 顯示 Extension Origin", (await popup.locator("#ankiOrigin").textContent()) === origin);
    await popup.locator("#ankiToken").fill(token);
    await popup.locator("#ankiConnectBtn").click();
    try {
      await popup.locator("#ankiStatus").filter({ hasText: "已連線" }).waitFor({ timeout: 10000 });
      check("popup 測試 Inbox 連線成功", true);
    } catch {
      check("popup 測試 Inbox 連線成功", false, { status: await popup.locator("#ankiStatus").textContent(), popupLog });
      throw new Error("Inbox 連線失敗，中止後續流程");
    }
    check("popup 處理工具預設 Codex，且有 Claude 選項", (await popup.locator("#ankiProcessor").inputValue()) === "codex" && (await popup.locator("#ankiProcessor option").allTextContents()).some((text) => /Claude/.test(text)));
    await popup.locator("#ankiSendBtn").click();
    await popup.locator("#ankiStatus").filter({ hasText: /Codex 處理|卡片草稿|已載入/ }).waitFor({ timeout: 10000 });

    // ---- 自動路徑：server 用 popup 選的 CLI（這裡是假 codex）產生草稿，popup 輪詢後收到 ----
    await popup.locator(".anki-card").nth(4).waitFor({ timeout: 20000 });
    const listedAll = await mcp.callTool("udemy_inbox_list", {});
    check("MCP list 看到 1 個 item 且 processor=codex", listedAll.items?.length === 1 && listedAll.items[0].processor === "codex" && !("request" in listedAll.items[0]), listedAll.items?.[0]?.status);
    const itemId = listedAll.items[0].itemId;
    const item = await mcp.callTool("udemy_inbox_get", { itemId });
    const pack = item?.request?.studyPack;
    check("MCP get 取得完整學習包", pack?.unit?.id === String(LECTURE_ID) && pack.subtitles.en.length === 2 && pack.subtitles.zh.length === 2 && pack.course.title === "fake udemy", pack?.unit);
    const promptText = fs.existsSync(promptCapture) ? fs.readFileSync(promptCapture, "utf8") : "";
    check("假 codex 由 stdin 收到含字幕與 schema 的 prompt", promptText.includes("welcome to the blender program") && promptText.includes('"sourceStartSec"'));
    check("processor 將 item 推進到 review_ready", item.status === "review_ready" && item.cards?.length === 5);
    let conflict = null;
    try { await mcp.callTool("udemy_inbox_claim", { itemId }); } catch (error) { conflict = error.message; }
    check("已處理的 item 不能再 claim", /conflict/i.test(conflict ?? ""), conflict);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "inbox", itemId, "item.json"), "utf8"));
    check("item.json 落地且無暫存檔殘留", onDisk.status === "review_ready" && onDisk.processor === "codex" && fs.readdirSync(path.join(dataDir, "inbox", itemId)).every((name) => name === "item.json"));

    // ---- 手動路徑：沒選 processor 的 item 由 Codex／Claude 對話透過 MCP tools 處理 ----
    const post = (body) => fetch(`${INBOX}/v1/inbox/items`, { method: "POST", headers: { ...auth, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const manualCreated = await (await post({ schemaVersion: 1, requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), studyPack: pack })).json();
    check("手動 item 建立為 pending 且無 processor", manualCreated.status === "pending" && !("processor" in manualCreated), manualCreated);
    const manualId = manualCreated.itemId;
    await sleep(500);
    check("server 不會自動處理沒選 processor 的 item", (await mcp.callTool("udemy_inbox_get", { itemId: manualId })).status === "pending");
    const claimed = await mcp.callTool("udemy_inbox_claim", { itemId: manualId });
    check("MCP claim → processing", claimed.status === "processing");

    const cue = pack.subtitles.en;
    const cards = [
      ...Array.from({ length: 4 }, (_v, i) => ({ type: "basic", front: `Q${i + 1} about ${cue[i % 2].text}`, back: `A${i + 1}`, sourceStartSec: cue[i % 2].start, sourceEndSec: cue[i % 2].end, reason: "e2e 概念卡", tags: ["e2e", "blender"] })),
      { type: "cloze", text: "Blender 的 {{c1::interface}} 是本單元重點。", extra: "來自第二句字幕", sourceStartSec: cue[1].start, sourceEndSec: cue[1].end, reason: "e2e cloze", tags: ["e2e"] },
    ];
    let rejected = null;
    try { await mcp.callTool("udemy_inbox_save_draft", { itemId: manualId, cardsJson: cards.slice(0, 2) }); } catch (error) { rejected = error.message; }
    check("save_draft 拒絕少於 5 張", /5 to 10/.test(rejected ?? ""), rejected);
    const saved = await mcp.callTool("udemy_inbox_save_draft", { itemId: manualId, cardsJson: JSON.stringify(cards) });
    check("save_draft → review_ready", saved.status === "review_ready" && saved.cards?.length === 5);

    // ---- 回到 popup：自動路徑的草稿 → 人工確認 → AnkiConnect ----
    // 輪詢先顯示「卡片草稿已完成」，載入草稿後改成「已載入 N 張卡片」
    check("popup 收到 5 張草稿", (await popup.locator(".anki-card").count()) === 5 && /已載入 5 張卡片|卡片草稿已完成/.test(await popup.locator("#ankiStatus").textContent()), await popup.locator("#ankiStatus").textContent());
    check("save_draft 之前沒有任何 AnkiConnect 呼叫", ankiCalls.length === 0);
    popup.once("dialog", (dialog) => dialog.accept());
    await popup.locator("#ankiSyncBtn").click();
    await popup.locator("#ankiStatus").filter({ hasText: "同步完成" }).waitFor({ timeout: 10000 });
    const added = ankiCalls.find((call) => call.action === "addNotes")?.params?.notes ?? [];
    check("同步 5 張到 Udemy Boost::fake udemy", added.length === 5 && added.every((note) => note.deckName === "Udemy Boost::fake udemy") && added.some((note) => note.modelName === "Cloze"), added.map((note) => note.modelName));
    check("note tags 含課程／單元／內容 hash", added.every((note) => note.tags.includes(`ub-unit::${LECTURE_ID}`) && note.tags.includes("ub-course::blender-start") && note.tags.some((tag) => /^ub-id::[0-9a-f]{64}$/.test(tag))));
    check("同步後按鈕停用", await popup.locator("#ankiSyncBtn").isDisabled());

    // ---- idempotency：同 requestId 同內容 → 沿用（不會再跑一次 processor）；同 ID 不同內容 → 409 ----
    const again = await post(onDisk.request);
    const againBody = await again.json();
    check("重送相同 requestId → 200 且 deduplicated", again.status === 200 && againBody.deduplicated === true && againBody.itemId === itemId && againBody.processor === "codex");
    const mutated = structuredClone(onDisk.request);
    mutated.studyPack.unit.title = "tampered";
    check("同 requestId 不同內容 → 409", (await post(mutated)).status === 409);
    await sleep(300);
    const after = await mcp.callTool("udemy_inbox_list", {});
    check("inbox 只有自動與手動兩個 item，且 dedup 未重跑 processor", after.items?.length === 2 && fs.readFileSync(promptCapture, "utf8") === promptText);
  } catch (error) {
    console.error(error);
    console.error("--- server stderr ---\n" + server.stderr());
    checks.push({ name: "unexpected error", ok: false });
  } finally {
    await cleanup();
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(failed.length ? `INBOX BRIDGE FAIL (${failed.map((entry) => entry.name).join("; ")})` : `INBOX BRIDGE PASS (${checks.length} checks)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
