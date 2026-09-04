import { test } from "node:test";
import assert from "node:assert/strict";
import { pickZh, pickEn, normalizeLocale } from "../src/locale.js";

const cap = (locale_id, extra = {}) => ({ locale_id, url: `https://x/${locale_id}.vtt`, ...extra });

// ---------- normalizeLocale ----------

test("normalizeLocale 統一為小寫、底線", () => {
  assert.equal(normalizeLocale("zh_TW"), "zh_tw");
  assert.equal(normalizeLocale("zh-TW"), "zh_tw");
  assert.equal(normalizeLocale("ZH-tw"), "zh_tw");
  assert.equal(normalizeLocale(" en_US "), "en_us");
});

test("normalizeLocale 非字串回空字串", () => {
  assert.equal(normalizeLocale(null), "");
  assert.equal(normalizeLocale(undefined), "");
  assert.equal(normalizeLocale(123), "");
});

// ---------- pickZh ----------

test("pickZh 優先序 zh_TW > zh_HK > zh_CN", () => {
  const caps = [cap("zh_CN"), cap("zh_HK"), cap("zh_TW"), cap("en_US")];
  assert.equal(pickZh(caps).locale_id, "zh_TW");
  assert.equal(pickZh([cap("zh_CN"), cap("zh_HK")]).locale_id, "zh_HK");
  assert.equal(pickZh([cap("zh_CN"), cap("en_US")]).locale_id, "zh_CN");
});

test("pickZh 只有 zh_HK（blender-start 課程實況）", () => {
  const caps = [cap("nl_NL"), cap("zh_HK"), cap("en_US"), cap("ja_JP")];
  assert.equal(pickZh(caps).locale_id, "zh_HK");
});

test("pickZh 容忍分隔符與大小寫變體", () => {
  assert.equal(pickZh([cap("zh-tw")]).locale_id, "zh-tw");
  assert.equal(pickZh([cap("ZH_CN")]).locale_id, "ZH_CN");
});

test("pickZh 未知中文變體（zh、zh_SG）當最後退路", () => {
  assert.equal(pickZh([cap("zh_SG"), cap("en_US")]).locale_id, "zh_SG");
  assert.equal(pickZh([cap("zh")]).locale_id, "zh");
  // 已知變體優先於未知變體
  assert.equal(pickZh([cap("zh_SG"), cap("zh_CN")]).locale_id, "zh_CN");
});

test("pickZh 無中文軌回 null", () => {
  assert.equal(pickZh([cap("en_US"), cap("ja_JP")]), null);
  assert.equal(pickZh([]), null);
});

test("pickZh 非陣列或髒資料回 null / 忽略壞項", () => {
  assert.equal(pickZh(null), null);
  assert.equal(pickZh(undefined), null);
  assert.equal(pickZh([null, {}, { locale_id: 5 }, cap("zh_TW")]).locale_id, "zh_TW");
});

test("pickZh 不會被 'zho' 以外的前綴誤判（例如 'azh_XX'）", () => {
  assert.equal(pickZh([cap("azh_XX")]), null);
});

test("pickZh 同一 locale 多筆取第一筆（穩定）", () => {
  const a = cap("zh_TW", { id: 1 });
  const b = cap("zh_TW", { id: 2 });
  assert.equal(pickZh([a, b]).id, 1);
});

// ---------- pickEn ----------

test("pickEn 優先序 en_US > en_GB > en*", () => {
  assert.equal(pickEn([cap("en_GB"), cap("en_US")]).locale_id, "en_US");
  assert.equal(pickEn([cap("en_AU"), cap("en_GB")]).locale_id, "en_GB");
  assert.equal(pickEn([cap("en_AU")]).locale_id, "en_AU");
  assert.equal(pickEn([cap("en")]).locale_id, "en");
});

test("pickEn 無英文軌回 null", () => {
  assert.equal(pickEn([cap("zh_TW")]), null);
  assert.equal(pickEn([]), null);
  assert.equal(pickEn(null), null);
});
