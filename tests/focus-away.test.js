// 「離開多久」的狀態機。
// 0.5.2 的 bug：離開判定是從 tracker 的 end_reason 推出來的（hidden/blur/idle），
// 但 fxAutoPause 預設開著，離開 3 秒後影片被自動暫停 → reason 變成 "pause"
// → 判定成「已回來」→ 離開計時在 4 秒就被清掉（<30s 門檻不顯示），
// 真的回來時已經沒有起點，於是永遠不會顯示。
// 所以離開判定必須只看「分頁可見 / 視窗焦點 / 閒置」，與影片是否播放無關。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAway, AwayTracker } from "../src/focus/away.js";

const S = (o = {}) => ({ visible: true, focused: true, requireFocus: true, idleMs: 0, idleLimitMs: 180000, ...o });

// ---------- isAway ----------

test("isAway：分頁隱藏 / 視窗失焦 / 閒置超時 都算離開", () => {
  assert.equal(isAway(S()), false);
  assert.equal(isAway(S({ visible: false })), true);
  assert.equal(isAway(S({ focused: false })), true);
  assert.equal(isAway(S({ idleMs: 180000 })), true);
  assert.equal(isAway(S({ idleMs: 179999 })), false);
});

test("isAway：requireFocus 關閉時，單純失焦不算離開", () => {
  assert.equal(isAway(S({ focused: false, requireFocus: false })), false);
  assert.equal(isAway(S({ focused: false, requireFocus: false, visible: false })), true);
});

test("isAway：idleLimitMs <= 0 表示不啟用閒置判定", () => {
  assert.equal(isAway(S({ idleMs: 9e9, idleLimitMs: 0 })), false);
  assert.equal(isAway(S({ idleMs: 9e9, idleLimitMs: -1 })), false);
});

test("isAway 不看影片是否播放——自動暫停後仍然算離開（本次回歸的核心）", () => {
  // 情境：alt-tab → 3 秒後 fxAutoPause 把影片暫停 → 影片 paused 但人還沒回來
  assert.equal(isAway(S({ visible: false })), true, "分頁隱藏＋影片已暫停 仍須算離開");
  assert.equal(isAway(S({ focused: false })), true, "視窗失焦＋影片已暫停 仍須算離開");
  // isAway 的簽章裡根本沒有 playing / paused / reason，結構上就不可能再回歸
  assert.ok(!("playing" in S()) && !("reason" in S()));
});

// ---------- AwayTracker ----------

test("離開再回來，超過門檻 → 回傳離開毫秒數", () => {
  const t = new AwayTracker({ minMs: 30000 });
  assert.equal(t.sample(true, 1000), null);
  assert.equal(t.sample(false, 61000), 60000);
});

test("離開時間未達門檻 → 不回報", () => {
  const t = new AwayTracker({ minMs: 30000 });
  t.sample(true, 1000);
  assert.equal(t.sample(false, 20000), null);
});

test("持續離開期間多次 sample 不會重設起點（自動暫停那一秒也不會）", () => {
  const t = new AwayTracker({ minMs: 30000 });
  t.sample(true, 0); // 剛 alt-tab
  for (let ms = 1000; ms <= 120000; ms += 1000) assert.equal(t.sample(true, ms), null);
  assert.equal(t.sample(false, 121000), 121000);
});

test("從未離開 → 一直是 null", () => {
  const t = new AwayTracker({ minMs: 30000 });
  for (const ms of [0, 1000, 99999]) assert.equal(t.sample(false, ms), null);
});

test("回來之後再離開，重新計時", () => {
  const t = new AwayTracker({ minMs: 30000 });
  t.sample(true, 0);
  assert.equal(t.sample(false, 40000), 40000);
  t.sample(true, 50000);
  assert.equal(t.sample(false, 100000), 50000);
});

test("mark() 讓 blur / visibilitychange 事件立刻定住起點（分頁隱藏時 setInterval 會被節流到約每分鐘一次）", () => {
  const t = new AwayTracker({ minMs: 30000 });
  t.mark(0); // 事件當下
  // 節流：下一個 tick 60 秒後才來
  assert.equal(t.sample(true, 60000), null);
  assert.equal(t.sample(false, 70000), 70000); // 從事件時間算，不是從第一個 tick
});

test("mark() 重複呼叫不會延後起點", () => {
  const t = new AwayTracker({ minMs: 30000 });
  t.mark(0);
  t.mark(5000);
  t.mark(9000);
  assert.equal(t.sample(false, 40000), 40000);
});

test("awaySince 供外部查詢目前是否在離開狀態", () => {
  const t = new AwayTracker({ minMs: 30000 });
  assert.equal(t.awaySince, null);
  t.mark(1234);
  assert.equal(t.awaySince, 1234);
  t.sample(false, 99999);
  assert.equal(t.awaySince, null);
});

test("minMs 為 0 → 任何長度的離開都回報", () => {
  const t = new AwayTracker({ minMs: 0 });
  t.sample(true, 0);
  assert.equal(t.sample(false, 500), 500);
});
