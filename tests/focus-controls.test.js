// FocusControls 的介入行為。這裡測的是「實際壞掉的那段接線」——
// 0.5.2 的 bug 不在純函式，而在 onSample 用 end_reason 判斷離開，
// 被 fxAutoPause 造成的 paused 狀態帶偏。用假的 document / overlay 在 node 重現整條時間線。
import { test } from "node:test";
import assert from "node:assert/strict";

// controls.js 的 constructor / destroy 會碰 window 與 document，先架好再 import
function installDom() {
  const listeners = [];
  const state = { visibilityState: "visible", focused: true };
  globalThis.window = {
    addEventListener: (t, f) => listeners.push(["w", t, f]),
    removeEventListener: (t, f) => {
      const i = listeners.findIndex((l) => l[1] === t && l[2] === f);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  globalThis.document = {
    get visibilityState() {
      return state.visibilityState;
    },
    hasFocus: () => state.focused,
    addEventListener: (t, f) => listeners.push(["d", t, f]),
    removeEventListener: (t, f) => {
      const i = listeners.findIndex((l) => l[1] === t && l[2] === f);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  return { listeners, state };
}
const dom = installDom();
const { FocusControls } = await import("../src/focus/controls.js");

const OPTS = {
  fxAutoPause: true, fxAutoPauseDelayS: 3, fxPomodoro: false, fxPomodoroMin: 30,
  fxRecallPrompt: true, fxTodayMinutes: false, fxAwayNotice: true, lpRequireFocus: true,
};

function harness(opts = {}) {
  const toasts = [];
  const auxes = [];
  const overlay = { setToast: (t) => toasts.push(t), setAux: (t) => auxes.push(t) };
  const video = { paused: false, pause() { this.paused = true; } };
  const c = new FocusControls({
    getVideo: () => video,
    overlay,
    options: { ...OPTS, ...opts },
    getToday: async () => 0,
  });
  let t = 0;
  /** 送一秒的 sample。away=true 表示分頁隱藏（同時失焦，就像切到別的分頁 / 別的 app）。 */
  const tick = async ({ away = false, idleMs = 0, seconds = 1 } = {}) => {
    for (let i = 0; i < seconds; i++) {
      t += 1000;
      const visible = !away;
      const focused = !away;
      const playing = !video.paused;
      const counting = playing && visible && focused && idleMs < c.options.lpIdleMinutes * 60000;
      await c.onSample({
        counting, video, now: new Date(t), visible, focused, idleMs,
        requireFocus: c.options.lpRequireFocus, idleLimitMs: 180000,
      });
    }
  };
  return { c, video, toasts, auxes, tick, at: () => t };
}

test("離開 40 秒回來 → 顯示「離開 40s」（fxAutoPause 已把影片暫停也不受影響：本次回歸的核心）", async () => {
  const h = harness();
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ seconds: 2 });
  assert.equal(h.video.paused, false);
  // 離開：前 3 秒 fxAutoPause 的 timer 還沒到，之後影片被暫停
  await h.tick({ away: true, seconds: 3 });
  h.video.pause(); // 模擬 fxAutoPause 的 setTimeout 觸發（在真瀏覽器是它做的）
  assert.equal(h.video.paused, true);
  await h.tick({ away: true, seconds: 37 }); // 舊版就是在這裡把離開起點清掉
  assert.deepEqual(h.toasts, [], "還沒回來就不該顯示");
  await h.tick({ seconds: 1 }); // 回來
  assert.equal(h.toasts.length, 1);
  // 離開起點是第一個 away sample（第 3 秒），回來是第 43 秒 → 40s
  assert.match(h.toasts[0], /^離開 40s$/);
});

test("離開未達 30 秒 → 不顯示", async () => {
  const h = harness();
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ away: true, seconds: 20 });
  await h.tick({ seconds: 1 });
  assert.deepEqual(h.toasts, []);
});

test("fxAwayNotice 關閉 → 不顯示（但離開狀態照樣追蹤）", async () => {
  const h = harness({ fxAwayNotice: false });
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ away: true, seconds: 40 });
  await h.tick({ seconds: 1 });
  assert.deepEqual(h.toasts, []);
});

test("離開超過一分鐘 → 用 m/s 格式", async () => {
  const h = harness();
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ away: true, seconds: 95 });
  await h.tick({ seconds: 1 });
  assert.match(h.toasts[0], /^離開 1m 35s$/); // 第 1 秒離開、第 96 秒回來
});

test("連續兩次離開各自回報", async () => {
  const h = harness();
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ away: true, seconds: 35 });
  await h.tick({ seconds: 1 });
  await h.tick({ away: true, seconds: 50 });
  await h.tick({ seconds: 1 });
  assert.equal(h.toasts.length, 2);
  assert.match(h.toasts[0], /^離開 35s$/);
  assert.match(h.toasts[1], /^離開 50s$/);
});

test("閒置超時也算離開（人在畫面前但沒動作）", async () => {
  const h = harness();
  h.c.options.lpIdleMinutes = 3;
  // 可見且有焦點，但閒置超過 3 分鐘
  for (let i = 0; i < 40; i++) await h.tick({ idleMs: 200000, seconds: 1 });
  await h.tick({ idleMs: 0, seconds: 1 });
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0], /^離開 40s$/);
});

test("fxAutoPause：離開後才排暫停，回來就取消；閒置不暫停", async () => {
  const h = harness();
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ seconds: 1 });
  assert.equal(h.c.autoPauseTimer, 0, "沒離開不該排 timer");
  await h.tick({ away: true, seconds: 1 });
  assert.notEqual(h.c.autoPauseTimer, 0, "離開後應排 timer");
  await h.tick({ seconds: 1 }); // 回來
  assert.equal(h.c.autoPauseTimer, 0, "回來要取消 timer");
  // 閒置不排 timer
  await h.tick({ idleMs: 200000, seconds: 1 });
  assert.equal(h.c.autoPauseTimer, 0, "閒置不該自動暫停");
  h.c.destroy();
});

test("fxAutoPause 關閉 → 不排 timer，但離開仍會回報", async () => {
  const h = harness({ fxAutoPause: false });
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ away: true, seconds: 35 });
  assert.equal(h.c.autoPauseTimer, 0);
  await h.tick({ seconds: 1 });
  assert.equal(h.toasts.length, 1);
});

test("Pomodoro：連續計時達門檻提示一次；休息 5 分鐘後歸零可再提示", async () => {
  const h = harness({ fxPomodoro: true, fxPomodoroMin: 1, fxAwayNotice: false });
  h.c.options.lpIdleMinutes = 3;
  await h.tick({ seconds: 59 });
  assert.deepEqual(h.toasts, []);
  await h.tick({ seconds: 1 });
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0], /^已連續觀看 1m 00s，休息一下$/);
  await h.tick({ seconds: 30 }); // 繼續看不再重複提示
  assert.equal(h.toasts.length, 1);
  await h.tick({ away: true, seconds: 5 * 60 }); // 休息 5 分鐘 → 歸零
  await h.tick({ seconds: 60 });
  assert.equal(h.toasts.length, 2);
});

test("destroy 會移除所有事件監聽（不留 leak）", async () => {
  const before = dom.listeners.length;
  const h = harness();
  assert.ok(dom.listeners.length > before, "constructor 應註冊監聽");
  h.c.destroy();
  assert.equal(dom.listeners.length, before, "destroy 應全部移除");
});
