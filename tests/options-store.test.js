// options-store 的儲存語意。重點是「同時改多個欄位不能互相蓋掉」——
// 0.5.0 的 saveOptions 是讀整包 → 合併 → 寫整包，六個 change 同時進來只有最後一個活下來。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OPTIONS, loadOptions, saveOptions, sanitize } from "../src/options-store.js";

/** 帶延遲的假 chrome.storage.sync，用來讓 read-modify-write 的競態穩定重現。 */
function fakeStorage({ delayMs = 5 } = {}) {
  const data = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    data,
    writes: [],
    sync: {
      async get(keys) {
        await sleep(delayMs);
        const arr = keys === null || keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of arr) if (k in data) out[k] = data[k];
        return out;
      },
      async set(obj) {
        await sleep(delayMs);
        Object.assign(data, obj); // 真實行為：只合併傳入的 key
      },
    },
  };
}

function withFake(fake, fn) {
  const prev = globalThis.chrome;
  globalThis.chrome = { storage: { sync: fake.sync } };
  return Promise.resolve(fn()).finally(() => {
    globalThis.chrome = prev;
  });
}

test("loadOptions 空 storage → 全部預設值", async () => {
  const fake = fakeStorage();
  await withFake(fake, async () => {
    assert.deepEqual(await loadOptions(), sanitize({}));
  });
});

test("saveOptions 只寫入被改的 key，不動其他 key", async () => {
  const fake = fakeStorage();
  await withFake(fake, async () => {
    fake.data.fontSize = 40; // 使用者先前的設定
    await saveOptions({ fxPomodoro: true });
    assert.deepEqual(Object.keys(fake.data).sort(), ["fontSize", "fxPomodoro"]);
    assert.equal(fake.data.fontSize, 40); // 沒被整包覆寫
    assert.equal(fake.data.fxPomodoro, true);
  });
});

test("同時儲存多個欄位不會互相蓋掉（併發）", async () => {
  const fake = fakeStorage({ delayMs: 8 });
  await withFake(fake, async () => {
    await Promise.all([
      saveOptions({ fxAutoPause: false }),
      saveOptions({ fxAwayNotice: false }),
      saveOptions({ fxPomodoro: true }),
      saveOptions({ fxPomodoroMin: 45 }),
      saveOptions({ fxAutoPauseDelayS: 10 }),
      saveOptions({ fxRecallPrompt: false }),
    ]);
    const got = await loadOptions();
    assert.equal(got.fxAutoPause, false);
    assert.equal(got.fxAwayNotice, false);
    assert.equal(got.fxPomodoro, true);
    assert.equal(got.fxPomodoroMin, 45);
    assert.equal(got.fxAutoPauseDelayS, 10);
    assert.equal(got.fxRecallPrompt, false);
  });
});

test("連續（非併發）儲存也保留先前的值", async () => {
  const fake = fakeStorage();
  await withFake(fake, async () => {
    await saveOptions({ fxPomodoro: true });
    await saveOptions({ fxPomodoroMin: 45 });
    const got = await loadOptions();
    assert.equal(got.fxPomodoro, true);
    assert.equal(got.fxPomodoroMin, 45);
  });
});

test("saveOptions 仍會清洗值：夾範圍、布林化、未知 provider 退回 none", async () => {
  const fake = fakeStorage();
  await withFake(fake, async () => {
    await saveOptions({ fxPomodoroMin: 9999, fontSize: 2, fxAutoPause: "yes", provider: "bogus" });
    assert.equal(fake.data.fxPomodoroMin, 180);
    assert.equal(fake.data.fontSize, 10);
    assert.equal(fake.data.fxAutoPause, true);
    assert.equal(fake.data.provider, "none");
  });
});

test("saveOptions 忽略不認識的 key（不寫進 storage）", async () => {
  const fake = fakeStorage();
  await withFake(fake, async () => {
    await saveOptions({ bogusKey: 1, fxPomodoro: true });
    assert.deepEqual(Object.keys(fake.data), ["fxPomodoro"]);
  });
});

test("saveOptions 空物件 / null 不丟錯也不寫入", async () => {
  const fake = fakeStorage();
  await withFake(fake, async () => {
    await saveOptions({});
    await saveOptions(null);
    assert.deepEqual(fake.data, {});
  });
});

test("每個 DEFAULT_OPTIONS 的 key 都能單獨儲存並讀回", async () => {
  const fake = fakeStorage({ delayMs: 0 });
  await withFake(fake, async () => {
    for (const [k, v] of Object.entries(DEFAULT_OPTIONS)) {
      const alt = typeof v === "boolean" ? !v : typeof v === "number" ? v + 1 : v;
      await saveOptions({ [k]: alt });
      const got = await loadOptions();
      assert.equal(got[k], sanitize({ [k]: alt })[k], `${k} 無法儲存/讀回`);
    }
  });
});
