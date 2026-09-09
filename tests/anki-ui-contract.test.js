import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Udemy Boost popup 包含 MCP 配對、送出、狀態、JSON 匯入與 Anki 審核控制項", async () => {
  const html = await readFile(new URL("../options/options.html", import.meta.url), "utf8");
  for (const id of ["ankiOrigin", "ankiToken", "ankiProcessor", "ankiConnectBtn", "ankiSendBtn", "ankiStatus", "ankiJsonInput", "ankiCards", "ankiSyncBtn", "ankiClearBtn"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `缺少 ${id}`);
  }
  // 處理工具是使用者的選擇：Codex 與 Claude 必須各是一個獨立選項
  assert.match(html, /<select id="ankiProcessor">.*<option value="codex">.*<option value="claude">/su);
});

test("manifest 將 anki modules 暴露給 Udemy content script 且 localhost 權限維持最小範圍", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.web_accessible_resources[0].resources.includes("src/anki/*.js"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:8765/*"));
  // 8766（MCP Inbox）刻意不給 host permission：有 host permission 時 Chrome 對 GET 不送 Origin header，
  // server 端的 Origin 配對檢查會回 403；改走標準 CORS，由 server 以 exact extension origin 放行。
  assert.ok(!manifest.host_permissions.includes("http://127.0.0.1:8766/*"));
  assert.ok(!manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(!manifest.host_permissions.includes("http://localhost/*"));
});

test("Inbox token 使用 trusted-only session storage，不保存於 content script 可讀的 local storage", async () => {
  const [options, background] = await Promise.all([
    readFile(new URL("../options/options.js", import.meta.url), "utf8"),
    readFile(new URL("../src/background.js", import.meta.url), "utf8"),
  ]);
  assert.match(options, /chrome\.storage\.session\.get\(\[ANKI_TOKEN_KEY/);
  assert.match(options, /chrome\.storage\.session\.set\(\{ \[ANKI_TOKEN_KEY\]/);
  assert.doesNotMatch(options, /chrome\.storage\.local\.set\(\{ \[ANKI_TOKEN_KEY\]/);
  assert.match(background, /setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
});
