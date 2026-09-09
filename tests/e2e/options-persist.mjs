// 真瀏覽器往返：開設定頁 → 改「專注」欄位 → 關掉 → 重開 → 值是否還在
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const EXT = process.cwd();
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ubopt-"));
const ctx = await chromium.launchPersistentContext(prof, {
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;
const URL_ = `chrome-extension://${extId}/options/options.html`;

const open = async () => { const p = await ctx.newPage(); const errs=[];
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(URL_); await p.waitForTimeout(700); p.__errs = errs; return p; };

// 1) 第一次開啟：應為 DEFAULT_OPTIONS 的值
let p = await open();
const first = await p.evaluate(() => ({
  fxAutoPause: fxAutoPause.checked, fxAutoPauseDelayS: fxAutoPauseDelayS.value,
  fxPomodoro: fxPomodoro.checked, fxPomodoroMin: fxPomodoroMin.value,
  fxRecallPrompt: fxRecallPrompt.checked, fxTodayMinutes: fxTodayMinutes.checked, fxAwayNotice: fxAwayNotice.checked,
  lpRequireFocus: lpRequireFocus.checked,
}));
console.log("open#1 (期望 = 預設值):", JSON.stringify(first));
console.log("open#1 errors:", JSON.stringify(p.__errs));

// 2) 改設定：關掉自動暫停與離開提示、開 Pomodoro 並改成 45、延遲改 10
await p.evaluate(async () => {
  const set = (el, v) => { if (typeof v === "boolean") el.checked = v; else el.value = v; el.dispatchEvent(new Event("change")); };
  set(fxAutoPause, false); set(fxAwayNotice, false);
  set(fxPomodoro, true); set(fxPomodoroMin, "45"); set(fxAutoPauseDelayS, "10");
  set(fxRecallPrompt, false);
});
await p.waitForTimeout(900);
await p.close();

// 3) 重開：值應該保留
p = await open();
const second = await p.evaluate(() => ({
  fxAutoPause: fxAutoPause.checked, fxAutoPauseDelayS: fxAutoPauseDelayS.value,
  fxPomodoro: fxPomodoro.checked, fxPomodoroMin: fxPomodoroMin.value,
  fxRecallPrompt: fxRecallPrompt.checked, fxTodayMinutes: fxTodayMinutes.checked, fxAwayNotice: fxAwayNotice.checked,
}));
const stored = await p.evaluate(() => chrome.storage.sync.get(null));
console.log("open#2 (期望 = 剛才改的):", JSON.stringify(second));
console.log("open#2 errors:", JSON.stringify(p.__errs));
console.log("storage.sync fx*:", JSON.stringify(Object.fromEntries(Object.entries(stored).filter(([k]) => k.startsWith("fx")))));
await p.close();
await ctx.close();

const expectFirst = { fxAutoPause: true, fxAutoPauseDelayS: "3", fxPomodoro: false, fxPomodoroMin: "30", fxRecallPrompt: true, fxTodayMinutes: true, fxAwayNotice: true, lpRequireFocus: true };
const expectSecond = { fxAutoPause: false, fxAutoPauseDelayS: "10", fxPomodoro: true, fxPomodoroMin: "45", fxRecallPrompt: false, fxTodayMinutes: true, fxAwayNotice: false };
const eq = (a, b) => Object.entries(b).every(([k, v]) => a[k] === v);
const ok = eq(first, expectFirst) && eq(second, expectSecond);
console.log(ok ? "PERSIST PASS" : "PERSIST FAIL");
process.exit(ok ? 0 : 1);
