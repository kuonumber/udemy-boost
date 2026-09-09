// 靜態檢查設定頁接線：DEFAULT_OPTIONS ↔ options.html 的 input id ↔ options.js 的 FIELDS。
// 0.5.0 有 bug：新增的 fx* 選項忘了加進 FIELDS，於是既不還原也不儲存（打開永遠是未勾、勾了也不存）。
// 這支測試就是為了讓那類「三處不同步」在 npm test 就紅掉。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEFAULT_OPTIONS } from "../src/options-store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(ROOT, "options/options.html"), "utf8");
const js = readFileSync(path.join(ROOT, "options/options.js"), "utf8");

// 不由表單控制的選項（由其他互動寫入）
const NOT_IN_FORM = new Set(["offsetX"]);

function parseFields() {
  const block = /const FIELDS = \{([\s\S]*?)\n\};/.exec(js);
  assert.ok(block, "options.js 找不到 FIELDS 物件");
  const out = {};
  for (const m of block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*"(checked|value)"/gm)) out[m[1]] = m[2];
  return out;
}

/** id → input 的型別（checkbox / number / text / password / select） */
function parseControls() {
  const out = {};
  for (const m of html.matchAll(/<input\s+type=(?:"|')([a-z]+)(?:"|')\s+id="([A-Za-z0-9_]+)"/g)) out[m[2]] = m[1];
  for (const m of html.matchAll(/<input\s+id="([A-Za-z0-9_]+)"\s+type=(?:"|')([a-z]+)(?:"|')/g)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<select\s+id="([A-Za-z0-9_]+)"/g)) out[m[1]] = "select";
  return out;
}

const FIELDS = parseFields();
const CONTROLS = parseControls();

test("每個可設定的選項都有 options.html 的控制項", () => {
  const missing = Object.keys(DEFAULT_OPTIONS).filter((k) => !NOT_IN_FORM.has(k) && !CONTROLS[k]);
  assert.deepEqual(missing, [], `options.html 缺少控制項：${missing.join(", ")}`);
});

test("每個可設定的選項都在 FIELDS 內（否則不會還原、也不會儲存）", () => {
  const missing = Object.keys(DEFAULT_OPTIONS).filter((k) => !NOT_IN_FORM.has(k) && !FIELDS[k]);
  assert.deepEqual(missing, [], `FIELDS 缺少：${missing.join(", ")}`);
});

test("FIELDS 內每個 key 都存在於 DEFAULT_OPTIONS 與 options.html", () => {
  const orphanOpt = Object.keys(FIELDS).filter((k) => !(k in DEFAULT_OPTIONS));
  assert.deepEqual(orphanOpt, [], `FIELDS 有不存在的選項：${orphanOpt.join(", ")}`);
  const orphanEl = Object.keys(FIELDS).filter((k) => !CONTROLS[k]);
  assert.deepEqual(orphanEl, [], `FIELDS 指向不存在的元素（init 會丟 TypeError 中斷後面所有欄位）：${orphanEl.join(", ")}`);
});

test("FIELDS 的 checked / value 與控制項型別、預設值型別一致", () => {
  for (const [key, prop] of Object.entries(FIELDS)) {
    const type = CONTROLS[key];
    const want = type === "checkbox" ? "checked" : "value";
    assert.equal(prop, want, `${key}: type=${type} 應該用 "${want}"，實際 "${prop}"`);
    if (prop === "checked") assert.equal(typeof DEFAULT_OPTIONS[key], "boolean", `${key} 預設值應為 boolean`);
    if (type === "number") assert.equal(typeof DEFAULT_OPTIONS[key], "number", `${key} 預設值應為 number`);
  }
});

test("每個 number 控制項的 min/max 與 sanitize 的夾範圍不衝突（預設值須落在 min..max）", () => {
  for (const [key, type] of Object.entries(CONTROLS)) {
    if (type !== "number" || !(key in DEFAULT_OPTIONS)) continue;
    const tag = new RegExp(`<input[^>]*id="${key}"[^>]*>`).exec(html)[0];
    const min = Number(/min="(-?\d+)"/.exec(tag)?.[1] ?? -Infinity);
    const max = Number(/max="(-?\d+)"/.exec(tag)?.[1] ?? Infinity);
    const d = DEFAULT_OPTIONS[key];
    assert.ok(d >= min && d <= max, `${key} 預設 ${d} 不在 ${min}..${max}`);
  }
});
