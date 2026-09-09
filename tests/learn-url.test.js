// content script 的 match pattern → 判斷某個分頁 URL 是不是「課程播放頁」。
// 0.5.1 的 bug：options.js 自己硬寫 www.udemy.com 的正則，跟 manifest 的 matches 兩份會漂移；
// 而且設定頁在分頁模式時 active tab 是自己，於是四個按鈕全部找不到分頁。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchPatternToRegExp, isLearnUrl } from "../src/learn-url.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const PATTERNS = manifest.content_scripts[0].matches;

test("matchPatternToRegExp：路徑的 * 可跨 /", () => {
  const re = matchPatternToRegExp("https://www.udemy.com/course/*/learn/*");
  assert.ok(re.test("https://www.udemy.com/course/blender-start/learn/lecture/52212451"));
  assert.ok(re.test("https://www.udemy.com/course/a/learn/lecture/1?x=1#overview"));
  assert.ok(!re.test("https://www.udemy.com/course/blender-start/"));
  assert.ok(!re.test("https://www.udemy.com/"));
});

test("matchPatternToRegExp：scheme 與 host 必須完全相符", () => {
  const re = matchPatternToRegExp("https://www.udemy.com/course/*/learn/*");
  assert.ok(!re.test("http://www.udemy.com/course/a/learn/b"));
  assert.ok(!re.test("https://evil.com/course/a/learn/b"));
  assert.ok(!re.test("https://www.udemy.com.evil.com/course/a/learn/b"));
  assert.ok(!re.test("https://udemy.com/course/a/learn/b")); // 沒有 www
});

test("matchPatternToRegExp：*.host 子網域、<all_urls>、正則特殊字元", () => {
  assert.ok(matchPatternToRegExp("https://*.udemy.com/*").test("https://www.udemy.com/x"));
  assert.ok(matchPatternToRegExp("https://*.udemy.com/*").test("https://udemy.com/x"));
  assert.ok(!matchPatternToRegExp("https://*.udemy.com/*").test("https://udemy.com.evil/x"));
  assert.ok(matchPatternToRegExp("<all_urls>").test("https://anything/x"));
  assert.ok(matchPatternToRegExp("*://*/*").test("http://a/b"));
  // host 內的點不能被當成正則的任意字元
  assert.ok(!matchPatternToRegExp("https://www.udemy.com/*").test("https://wwwXudemy.com/x"));
});

test("isLearnUrl 用 manifest 的 matches 判斷真實 URL", () => {
  assert.equal(isLearnUrl("https://www.udemy.com/course/blender-start/learn/lecture/52212451#overview", PATTERNS), true);
  assert.equal(isLearnUrl("https://www.udemy.com/course/blender-start/", PATTERNS), false);
  assert.equal(isLearnUrl("chrome-extension://abc/options/options.html?mode=tab", PATTERNS), false);
  assert.equal(isLearnUrl(undefined, PATTERNS), false);
  assert.equal(isLearnUrl("https://www.udemy.com/course/a/learn/lecture/1", []), false);
});

test("manifest 的 content_scripts.matches 與 host_permissions 一致（不然 tabs.query / executeScript 會被拒）", () => {
  for (const p of PATTERNS) {
    const host = /^\w+\*?:\/\/([^/]+)\//.exec(p)?.[1] ?? "";
    const covered = manifest.host_permissions.some((h) => matchPatternToRegExp(h).test(p.replace(/\*$/, "probe")));
    assert.ok(covered, `${p}（host ${host}）沒有對應的 host_permissions`);
  }
});

test("注入 content script 需要 scripting 權限", () => {
  assert.ok(manifest.permissions.includes("scripting"), "manifest.permissions 缺少 scripting");
});
