import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDrag, clampPosition } from "../src/drag.js";

// 位置模型：offsetX = 相對容器水平中心的 px（0 = 置中），bottom = 距容器底部 px。
const bounds = { width: 1000, height: 600, boxWidth: 400, boxHeight: 60 };

test("applyDrag：滑鼠往右下移，offsetX 增加、bottom 減少", () => {
  const start = { offsetX: 0, bottom: 80 };
  const out = applyDrag(start, { x: 100, y: 100 }, { x: 150, y: 130 }, bounds);
  assert.deepEqual(out, { offsetX: 50, bottom: 50 });
});

test("applyDrag：沒有移動回原位置", () => {
  const start = { offsetX: 10, bottom: 20 };
  assert.deepEqual(applyDrag(start, { x: 5, y: 5 }, { x: 5, y: 5 }, bounds), start);
});

test("clampPosition：不能拖出容器左右邊界", () => {
  // 容器 1000 寬、字幕 400 寬 → offsetX 可用範圍 ±300
  assert.equal(clampPosition({ offsetX: 999, bottom: 80 }, bounds).offsetX, 300);
  assert.equal(clampPosition({ offsetX: -999, bottom: 80 }, bounds).offsetX, -300);
});

test("clampPosition：不能拖出容器上下邊界", () => {
  // 600 高、字幕 60 高 → bottom 範圍 0..540
  assert.equal(clampPosition({ offsetX: 0, bottom: -50 }, bounds).bottom, 0);
  assert.equal(clampPosition({ offsetX: 0, bottom: 9999 }, bounds).bottom, 540);
});

test("clampPosition：字幕比容器還寬時固定置中", () => {
  const b = { width: 300, height: 600, boxWidth: 400, boxHeight: 60 };
  assert.equal(clampPosition({ offsetX: 120, bottom: 80 }, b).offsetX, 0);
});

test("clampPosition：NaN / 非數字視為預設 (0, 80)", () => {
  assert.deepEqual(clampPosition({ offsetX: NaN, bottom: undefined }, bounds), { offsetX: 0, bottom: 80 });
  assert.deepEqual(clampPosition(null, bounds), { offsetX: 0, bottom: 80 });
});

test("clampPosition：bounds 為 0（容器尚未 layout）時不除以零、原值保留在合理範圍", () => {
  const b = { width: 0, height: 0, boxWidth: 0, boxHeight: 0 };
  const out = clampPosition({ offsetX: 50, bottom: 80 }, b);
  assert.deepEqual(out, { offsetX: 0, bottom: 0 });
});

test("applyDrag 結果會經過 clamp", () => {
  const out = applyDrag({ offsetX: 0, bottom: 80 }, { x: 0, y: 0 }, { x: 5000, y: -5000 }, bounds);
  assert.deepEqual(out, { offsetX: 300, bottom: 540 });
});
