// 靜態契約：Drive 同步的接線不能像 0.5.x 的 Anki 那樣被整檔覆寫後無聲消失。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DRIVE_SCOPE } from "../src/drive/config.js";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("manifest 具備 identity 權限與 Google API 的 host permission", async () => {
  const m = JSON.parse(await read("../manifest.json"));
  assert.ok(m.permissions.includes("identity"), "缺 identity 權限，launchWebAuthFlow 不能用");
  assert.ok(m.host_permissions.includes("https://www.googleapis.com/*"));
  assert.ok(m.host_permissions.includes("https://oauth2.googleapis.com/*"));
  assert.ok(m.web_accessible_resources[0].resources.includes("src/drive/*.js"));
  assert.ok(m.web_accessible_resources[0].resources.includes("src/sync/*.js"));
});

test("manifest 的 key 存在（extension id 必須跨電腦固定，否則 OAuth redirect 對不上）", async () => {
  const m = JSON.parse(await read("../manifest.json"));
  assert.equal(typeof m.key, "string");
  assert.ok(m.key.length > 300);
});

test("manifest 的 oauth2 設定與 config 一致，且不是佔位字串", async () => {
  const [m, cfg] = await Promise.all([read("../manifest.json").then(JSON.parse), read("../src/drive/config.js")]);
  assert.ok(m.oauth2?.client_id, "缺 oauth2.client_id，getAuthToken 會直接失敗");
  assert.doesNotMatch(m.oauth2.client_id, /TODO/, "client id 還是佔位字串");
  assert.deepEqual(m.oauth2.scopes, [DRIVE_SCOPE], "manifest 的 scope 必須只有 drive.file");
  // 兩處寫同一個 id：manifest 給 Chrome 用，config 給程式顯示與檢查，不同步就會很難查
  assert.ok(cfg.includes(m.oauth2.client_id), "config.js 的 CLIENT_ID 與 manifest.oauth2.client_id 不一致");
});

test("popup 具備 Drive 連結 / 中斷 / 狀態 / redirect 顯示的控制項", async () => {
  const html = await read("../options/options.html");
  for (const id of ["driveStatus", "driveConnectBtn", "driveDisconnectBtn", "driveRedirect", "driveSyncBtn"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `缺少 ${id}`);
  }
});

test("同步按鈕不得預設 disabled（disabled 會吞掉點擊，使用者按了完全沒反應也沒訊息）", async () => {
  const html = await read("../options/options.html");
  const tag = /<button[^>]*id="driveSyncBtn"[^>]*>/.exec(html)[0];
  assert.doesNotMatch(tag, /\bdisabled\b/, "0.6 實測踩過：HTML 留著 disabled、JS 又沒有啟用它，按鈕變成永遠不可按");
});

test("client id 寫在設定檔且不是 secret；scope 只有 drive.file", async () => {
  const cfg = await read("../src/drive/config.js");
  assert.match(cfg, /apps\.googleusercontent\.com/);
  // 原本斷言「檔案裡不得出現 client_secret 這幾個字」，但註解裡解釋「為什麼不能用 client_secret」
  // 也會被誤判。改成只擋真正的賦值與 Google secret 的字首，語意才對。
  assert.doesNotMatch(cfg, /GOCSPX-[\w-]+/, "看起來有 Google OAuth client secret");
  assert.doesNotMatch(cfg, /client_secret\s*[:=]\s*["'`]/, "不得在原始碼設定 client_secret");
  assert.equal(DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.file");
});

test("授權流程接在 background，不是 popup（popup 會在授權視窗打開時被關掉）", async () => {
  const [bg, js] = await Promise.all([read("../src/background.js"), read("../options/options.js")]);
  assert.match(bg, /createDriveAuth/, "background 必須持有 driveAuth");
  assert.match(bg, /case "drive:connect"/);
  assert.doesNotMatch(js, /createDriveAuth/, "popup 不可自己跑授權流程");
  assert.match(js, /drive:connect/);
  assert.match(js, /driveConnectBtn/);
  assert.match(bg, /case "drive:sync"/, "同步也必須在 background（需要 offscreen 檔案通道）");
  assert.match(js, /drive:sync/);
  assert.doesNotMatch(js, /尚未接上/, "按鈕還停在佔位狀態");
});
