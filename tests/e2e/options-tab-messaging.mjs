// 重現「匯出失敗：Could not establish connection. Receiving end does not exist.」並驗證修好。
//
// 兩個真實情境：
//  A. 設定頁以 ?mode=tab 開在分頁（選資料夾用的那個流程）→ active tab 是設定頁自己，
//     舊版 activeLearnTab 只看 active tab，於是找不到播放頁。
//  B. 分頁的 URL 是播放頁，但沒有 content script（extension 重新載入後的既有分頁）。
//     這裡用「先載入不符合 matches 的 URL，再 pushState 到播放頁 URL」製造出同樣狀態：
//     Chrome 依載入時的 URL 決定是否注入，pushState 之後不會補注入。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "https://www.udemy.test";
const COURSE_ID = 6775439;
const LECTURE_ID = 52212451;
const LEARN = `${HOST}/course/blender-start/learn/lecture/${LECTURE_ID}`;

function buildExt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ub-msg-"));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !/node_modules|\.git|tests|docs/.test(src) });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  mf.content_scripts[0].matches.push(`${HOST}/course/*/learn/*`);
  mf.host_permissions.push(`${HOST}/*`);
  mf.web_accessible_resources[0].matches.push(`${HOST}/*`);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 2));
  return dir;
}

const PAGE = `<!doctype html><html><head><title>fake udemy</title></head><body>
<div class="ud-app-loader" data-module-args='{"courseId":${COURSE_ID}}'></div>
<div class="video-player-module--video-container--x" style="width:320px;height:180px">
<video id="v" width="320" height="180" muted></video></div></body></html>`;

const extDir = buildExt();
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ub-msgp-"));
const ctx = await chromium.launchPersistentContext(prof, {
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
await ctx.route(`${HOST}/**`, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/api-2.0/")) return route.fulfill({ contentType: "application/json", body: "{}" });
  return route.fulfill({ contentType: "text/html", body: PAGE });
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const extId = new URL(sw.url()).host;
const results = {};

// ---------- A. 正常注入的播放頁 + 設定頁開在另一個分頁 ----------
const learnTab = await ctx.newPage();
await learnTab.goto(LEARN);
await learnTab.waitForTimeout(1500);
results.contentScriptInjected = await sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ url: "https://www.udemy.test/course/*/learn/*" });
  try {
    return (await chrome.tabs.sendMessage(t.id, { type: "ping" }))?.ok === true;
  } catch (e) {
    return "ERR " + e.message;
  }
});

const optTab = await ctx.newPage(); // 開在後面 → 它才是 active tab
const optErrs = [];
optTab.on("pageerror", (e) => optErrs.push(e.message));
await optTab.goto(`chrome-extension://${extId}/options/options.html?mode=tab`);
await optTab.waitForTimeout(900);
results.tabModeFindsLearnTab = await optTab.evaluate(async () => {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { isLearnUrl, learnPatterns } = await import("/src/learn-url.js");
  const tabs = await chrome.tabs.query({ url: learnPatterns() });
  return { activeIsOptions: !isLearnUrl(active?.url, learnPatterns()), foundLearnTabs: tabs.length };
});
// 真的按下匯出鈕（走完整 sendToLearnTab 路徑）
results.exportFromTabMode = await optTab.evaluate(async () => {
  document.getElementById("lpExportBtn").click();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const t = document.getElementById("lpHint").textContent;
    if (/已匯出|失敗/.test(t)) return t;
  }
  return "(timeout)";
});
results.optionsPageErrors = optErrs;

// ---------- B. URL 是播放頁但沒有 content script ----------
const stale = await ctx.newPage();
await stale.goto(`${HOST}/not-a-learn-page`); // 不符合 matches → 不注入
await stale.evaluate((u) => history.pushState({}, "", u), LEARN);
await stale.waitForTimeout(300);
results.staleTabUrl = stale.url();
results.staleTabRawSendMessage = await sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.udemy.test/course/*/learn/*" });
  const t = tabs.at(-1);
  try {
    await chrome.tabs.sendMessage(t.id, { type: "ping" });
    return "unexpectedly ok";
  } catch (e) {
    return e.message;
  }
});
// 關掉正常那個播放頁，讓設定頁只能挑到這個沒有 content script 的分頁
await learnTab.close();
await optTab.bringToFront();
results.recoveryFromStaleTab = await optTab.evaluate(async () => {
  document.getElementById("lpHint").textContent = "";
  document.getElementById("lpExportBtn").click();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const t = document.getElementById("lpHint").textContent;
    if (/已匯出|失敗/.test(t)) return t;
  }
  return "(timeout)";
});
// 補注入不能造成雙份 Session
results.doubleBootGuard = await sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.udemy.test/course/*/learn/*" });
  const t = tabs.at(-1);
  await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["src/content.js"] });
  await new Promise((r) => setTimeout(r, 800));
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: t.id },
    func: () => ({ booted: window.__ubBooted === true, overlays: document.querySelectorAll("#ub-overlay-root").length }),
  });
  return result;
});

console.log(JSON.stringify(results, null, 1));
await ctx.close();
fs.rmSync(extDir, { recursive: true, force: true });

const ok =
  results.contentScriptInjected === true &&
  results.tabModeFindsLearnTab.activeIsOptions === true &&
  results.tabModeFindsLearnTab.foundLearnTabs >= 1 &&
  /已匯出/.test(results.exportFromTabMode) &&
  results.optionsPageErrors.length === 0 &&
  /Receiving end does not exist|Could not establish connection/.test(results.staleTabRawSendMessage) &&
  /已匯出/.test(results.recoveryFromStaleTab) &&
  results.doubleBootGuard.booted === true &&
  results.doubleBootGuard.overlays <= 1;
console.log(ok ? "MESSAGING PASS" : "MESSAGING FAIL");
process.exit(ok ? 0 : 1);
