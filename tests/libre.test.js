import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTarget, buildTranslateBody, normalizeBaseUrl, isLocalhost } from "../src/translate/libre.js";

const langs = (targets) => [{ code: "en", name: "English", targets }, { code: "zh", name: "Chinese", targets: ["en"] }];

test("pickTarget 優先 zh-Hant，其次 zt / zh-TW，最後 zh（需 OpenCC）", () => {
  assert.deepEqual(pickTarget(langs(["zh", "zh-Hant", "zt"])), { code: "zh-Hant", needsOpenCC: false });
  assert.deepEqual(pickTarget(langs(["zh", "zt"])), { code: "zt", needsOpenCC: false });
  assert.deepEqual(pickTarget(langs(["zh-TW"])), { code: "zh-TW", needsOpenCC: false });
  assert.deepEqual(pickTarget(langs(["zh", "ja"])), { code: "zh", needsOpenCC: true });
});

test("pickTarget 大小寫容忍", () => {
  assert.equal(pickTarget(langs(["ZH-HANT"])).code, "ZH-HANT");
});

test("pickTarget 沒有 en 來源或沒有任何中文 target → null", () => {
  assert.equal(pickTarget(langs(["ja", "ko"])), null);
  assert.equal(pickTarget([{ code: "ja", targets: ["zh"] }]), null);
  assert.equal(pickTarget([]), null);
  assert.equal(pickTarget(null), null);
});

test("pickTarget 舊版 /languages 沒有 targets 欄位 → 以 code 清單推斷", () => {
  const old = [{ code: "en", name: "English" }, { code: "zh", name: "Chinese" }, { code: "zt", name: "Chinese (traditional)" }];
  assert.deepEqual(pickTarget(old), { code: "zt", needsOpenCC: false });
});

test("buildTranslateBody 陣列 q、含 api_key 只在有值時", () => {
  assert.deepEqual(buildTranslateBody(["a", "b"], "zh-Hant", ""), { q: ["a", "b"], source: "en", target: "zh-Hant", format: "text" });
  assert.deepEqual(buildTranslateBody(["a"], "zt", "k1"), { q: ["a"], source: "en", target: "zt", format: "text", api_key: "k1" });
});

test("buildTranslateBody 空陣列丟 RangeError", () => {
  assert.throws(() => buildTranslateBody([], "zh-Hant", ""), RangeError);
});

test("normalizeBaseUrl 去尾斜線、補 http://、拒絕非 http(s)", () => {
  assert.equal(normalizeBaseUrl("http://localhost:5000/"), "http://localhost:5000");
  assert.equal(normalizeBaseUrl("localhost:5000"), "http://localhost:5000");
  assert.equal(normalizeBaseUrl("https://lt.example.com/api/"), "https://lt.example.com/api");
  assert.throws(() => normalizeBaseUrl("ftp://x"), TypeError);
  assert.throws(() => normalizeBaseUrl(""), TypeError);
  assert.throws(() => normalizeBaseUrl(null), TypeError);
});

test("isLocalhost 判斷 localhost / 127.0.0.1 / [::1]", () => {
  assert.equal(isLocalhost("http://localhost:5000"), true);
  assert.equal(isLocalhost("http://127.0.0.1:5000"), true);
  assert.equal(isLocalhost("http://[::1]:5000"), true);
  assert.equal(isLocalhost("http://192.168.1.10:5000"), false);
  assert.equal(isLocalhost("https://lt.example.com"), false);
});
