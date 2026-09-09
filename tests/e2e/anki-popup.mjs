// E2E：popup 的「GPT → Anki」區塊接線（0.6.0 重接後的驗證）。
// 不需要 anki-mcp-server：127.0.0.1:8766 由瀏覽器層 route 假造（health / submit / getItem），
// 127.0.0.1:8765 沿用 mockAnkiConnect，真實 Anki 不會被碰到。
// 涵蓋：Extension Origin 顯示、配對、匯出學習包、JSON 匯入、Inbox 送出 → 輪詢 → 草稿、審核後同步。
// 執行：node tests/e2e/anki-popup.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LECTURE_ID, LECTURE_URL, buildTestExtension, launchWithExtension, udemyRouteHandler, mockAnkiConnect } from "./fixtures.mjs";

const COURSE = { id: "6775439", title: "fake udemy", slug: "blender-start" };
const UNIT = { id: String(LECTURE_ID), chapterTitle: "Intro: Getting Started", title: "Interface and settings", url: LECTURE_URL };
const TOKEN = "a".repeat(64);

const cards = (prefix) => [
  ...Array.from({ length: 4 }, (_v, i) => ({ type: "basic", front: `${prefix} Q${i + 1}`, back: `${prefix} A${i + 1}`, sourceStartSec: 4.28, sourceEndSec: 5.96, reason: "e2e", tags: ["e2e"] })),
  { type: "cloze", text: "Blender 的 {{c1::interface}} 是本單元重點。", extra: `${prefix} extra`, sourceStartSec: 6.76, sourceEndSec: 9, reason: "e2e", tags: ["e2e"] },
];

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

/** 假 Inbox：POST 建立 item，前兩次 GET 回 processing，之後回 review_ready + 卡片。 */
async function mockInbox(ctx, { origin }) {
  const calls = [];
  let gets = 0;
  await ctx.route("http://127.0.0.1:8766/**", async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": request.headers().origin ?? origin,
      "Access-Control-Allow-Headers": "authorization,content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Content-Type": "application/json",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers, body: "" });
    const url = new URL(request.url());
    calls.push({ method: request.method(), path: url.pathname, auth: request.headers().authorization, body: request.method() === "POST" ? request.postDataJSON() : null });
    if (url.pathname === "/v1/health") return route.fulfill({ headers, body: JSON.stringify({ status: "ok" }) });
    if (url.pathname === "/v1/inbox/items" && request.method() === "POST") {
      return route.fulfill({ headers, body: JSON.stringify({ schemaVersion: 1, itemId: "item-1", requestId: request.postDataJSON().requestId, status: "pending", deduplicated: false, processor: request.postDataJSON().processor }) });
    }
    if (url.pathname === "/v1/inbox/items/item-1") {
      gets += 1;
      const ready = gets > 1;
      return route.fulfill({ headers, body: JSON.stringify({ schemaVersion: 1, itemId: "item-1", status: ready ? "review_ready" : "processing", ...(ready ? { cards: cards("inbox"), warnings: [] } : {}) }) });
    }
    return route.fulfill({ status: 404, headers, body: "{}" });
  });
  return calls;
}

async function main() {
  const extDir = buildTestExtension();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ub-anki-e2e-"));
  const { ctx, userData, extensionId } = await launchWithExtension(extDir);
  const origin = `chrome-extension://${extensionId}`;
  const cleanup = async () => {
    await ctx.close().catch(() => {});
    for (const dir of [extDir, userData, tmp]) fs.rmSync(dir, { recursive: true, force: true });
  };

  try {
    const ankiCalls = await mockAnkiConnect(ctx);
    const inboxCalls = await mockInbox(ctx, { origin });

    const page = await ctx.newPage();
    await page.route("https://www.udemy.com/**", udemyRouteHandler());
    await page.goto(LECTURE_URL);
    await page.waitForSelector("#ub-overlay-root", { timeout: 15000 });
    await page.waitForTimeout(2500); // 等字幕載入（content script 抓 caption list + vtt）

    const popup = await ctx.newPage();
    const log = [];
    popup.on("console", (m) => log.push(`[console.${m.type()}] ${m.text()}`));
    popup.on("pageerror", (e) => log.push(`[pageerror] ${e.message}`));
    await popup.goto(`${origin}/options/options.html`);

    await popup.locator("#ankiOrigin").filter({ hasText: "chrome-extension://" }).waitFor({ timeout: 10000 });
    check("popup 顯示 Extension Origin", (await popup.locator("#ankiOrigin").textContent()) === origin);
    check("處理工具預設 codex 且有 Claude 選項", (await popup.locator("#ankiProcessor").inputValue()) === "codex" && (await popup.locator("#ankiProcessor option").allTextContents()).some((t) => /Claude/.test(t)));

    // ---- 匯出學習包（content script anki:export → downloadText）----
    // 注意：chrome.downloads 由 Playwright/CDP 接管檔名，下載內容在此環境驗不到（同 0.3.1 的盲區）。
    // study-pack.md 的內容由 study-pack.test.js 與下方 POST body（同一份 pack）覆蓋。
    // safeSegment 會移除 Windows 非法字元，所以章節標題的 ":" 不會出現在路徑裡。
    await popup.locator("#ankiExportBtn").click();
    try {
      await popup.locator("#ankiStatus").filter({ hasText: "已匯出學習包" }).waitFor({ timeout: 15000 });
      const status = await popup.locator("#ankiStatus").textContent();
      check("匯出學習包路徑含課程／章／單元", /Udemy\/fake udemy\/01\. Intro Getting Started\/02\. Interface and settings\/study-pack\.md/.test(status), status);
    } catch {
      check("匯出學習包", false, { status: await popup.locator("#ankiStatus").textContent(), log });
    }

    // ---- JSON 匯入路徑 ----
    const jsonPath = path.join(tmp, "anki-cards.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ schemaVersion: 1, course: COURSE, unit: UNIT, cards: cards("json"), warnings: [] }));
    await popup.locator("#ankiJsonInput").setInputFiles(jsonPath);
    await popup.locator("#ankiStatus").filter({ hasText: "已載入 5 張卡片" }).waitFor({ timeout: 15000 });
    check("JSON 匯入 5 張卡片並可編輯", (await popup.locator(".anki-card").count()) === 5 && (await popup.locator(".anki-card textarea").first().inputValue()) === "json Q1");
    check("匯入後同步按鈕可用", !(await popup.locator("#ankiSyncBtn").isDisabled()));

    // 匯入內容與目前頁面不符必須被拒（course.title 改掉）
    const badPath = path.join(tmp, "bad.json");
    fs.writeFileSync(badPath, JSON.stringify({ schemaVersion: 1, course: { ...COURSE, title: "另一門課" }, unit: UNIT, cards: cards("bad"), warnings: [] }));
    await popup.locator("#ankiJsonInput").setInputFiles(badPath);
    await popup.locator("#ankiStatus").filter({ hasText: "匯入失敗" }).waitFor({ timeout: 15000 });
    check("課程不符的 JSON 被拒且保留原草稿", (await popup.locator(".anki-card textarea").first().inputValue()) === "json Q1", await popup.locator("#ankiStatus").textContent());

    // ---- Inbox 路徑：配對 → 送出 → 輪詢 → 草稿覆蓋 ----
    await popup.locator("#ankiToken").fill(TOKEN);
    await popup.locator("#ankiConnectBtn").click();
    await popup.locator("#ankiStatus").filter({ hasText: "已連線本機 Inbox" }).waitFor({ timeout: 15000 });
    check("health 帶 Bearer token", inboxCalls.some((c) => c.path === "/v1/health" && c.auth === `Bearer ${TOKEN}`));

    await popup.locator("#ankiSendBtn").click();
    await popup.locator("#ankiStatus").filter({ hasText: "已載入 5 張卡片" }).waitFor({ timeout: 30000 });
    const post = inboxCalls.find((c) => c.method === "POST");
    check("送出的 body 含 processor 與完整學習包", post?.body?.processor === "codex" && post.body.studyPack.unit.id === String(LECTURE_ID) && post.body.studyPack.subtitles.en.length === 2 && post.body.studyPack.subtitles.zh.length === 2, post?.body?.studyPack?.unit);
    check("輪詢到 review_ready 才載入草稿", inboxCalls.filter((c) => c.path === "/v1/inbox/items/item-1").length >= 2);
    check("Inbox 草稿取代 JSON 草稿", (await popup.locator(".anki-card textarea").first().inputValue()) === "inbox Q1");
    check("同步前沒有任何 AnkiConnect 呼叫", ankiCalls.length === 0);

    // ---- 審核：改一張、取消一張 → 同步 ----
    await popup.locator(".anki-card").first().locator("textarea").first().fill("Edited question");
    await popup.locator(".anki-card").first().locator("textarea").first().blur();
    await popup.locator(".anki-card").nth(1).locator('input[type="checkbox"]').uncheck();
    popup.once("dialog", (d) => d.accept());
    await popup.locator("#ankiSyncBtn").click();
    await popup.locator("#ankiStatus").filter({ hasText: "同步完成" }).waitFor({ timeout: 20000 });
    const notes = ankiCalls.find((c) => c.action === "addNotes")?.params?.notes ?? [];
    check("只同步 4 張（取消 1 張）到 Udemy Boost::fake udemy", notes.length === 4 && notes.every((n) => n.deckName === "Udemy Boost::fake udemy"), notes.map((n) => n.modelName));
    check("編輯後的內容進入 Anki", notes.some((n) => n.fields.Front === "Edited question"), notes[0]?.fields?.Front);
    check("tags 含課程／單元／內容 hash", notes.every((n) => n.tags.includes(`ub-unit::${LECTURE_ID}`) && n.tags.includes("ub-course::blender-start") && n.tags.some((t) => /^ub-id::[0-9a-f]{64}$/.test(t))));
    check("同步後按鈕停用（已成功的不重送）", await popup.locator("#ankiSyncBtn").isDisabled());

    // ---- 草稿在 popup 重開後仍在，清除後消失 ----
    await popup.reload();
    await popup.locator(".anki-card").first().waitFor({ timeout: 15000 });
    check("重開 popup 仍載入本機草稿", (await popup.locator(".anki-card").count()) === 5 && /已載入本機草稿/.test(await popup.locator("#ankiStatus").textContent()));
    popup.once("dialog", (d) => d.accept());
    await popup.locator("#ankiClearBtn").click();
    await popup.locator("#ankiStatus").filter({ hasText: "草稿已清除" }).waitFor({ timeout: 15000 });
    check("清除草稿後卡片清空且按鈕停用", (await popup.locator(".anki-card").count()) === 0 && (await popup.locator("#ankiSyncBtn").isDisabled()));
  } catch (error) {
    console.error(error);
    checks.push({ name: "unexpected error", ok: false });
  } finally {
    await cleanup();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `ANKI POPUP FAIL (${failed.map((c) => c.name).join("; ")})` : `ANKI POPUP PASS (${checks.length} checks)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
