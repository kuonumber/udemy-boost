// 同步決策表：本地 / 遠端 / 上次同步狀態 → 該做什麼。純函式，不碰網路。
// 這張表錯了就會覆蓋掉別台電腦的資料，所以四種變更組合 × 有無同步狀態都要釘住。
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSync } from "../src/sync/decide.js";

const L = { exists: true, hash: "L1" };
const R = { exists: true, md5: "R1" };
const STATE = { localHash: "L1", remoteMd5: "R1" };

const act = (local, remote, state) => decideSync({ local, remote, state }).action;

test("兩邊都沒有檔案 → noop", () => {
  assert.equal(act({ exists: false }, { exists: false }, null), "noop");
});

test("只有本地有 → create（第一次上傳）", () => {
  assert.equal(act(L, { exists: false }, null), "create");
});

test("只有遠端有 → download", () => {
  assert.equal(act({ exists: false }, R, null), "download");
});

test("遠端有、本地曾經有但被刪掉（有同步狀態）→ 仍是 download，不刪遠端", () => {
  assert.equal(act({ exists: false }, R, STATE), "download");
});

test("兩邊都有、都沒變 → up-to-date", () => {
  assert.equal(act(L, R, STATE), "up-to-date");
});

test("兩邊都有、只有本地變 → upload", () => {
  assert.equal(act({ exists: true, hash: "L2" }, R, STATE), "upload");
});

test("兩邊都有、只有遠端變 → download", () => {
  assert.equal(act(L, { exists: true, md5: "R2" }, STATE), "download");
});

test("兩邊都有、兩邊都變 → merge", () => {
  assert.equal(act({ exists: true, hash: "L2" }, { exists: true, md5: "R2" }, STATE), "merge");
});

test("兩邊都有但沒有同步狀態（第一次配對）→ merge，不可直接覆蓋任何一邊", () => {
  assert.equal(act(L, R, null), "merge");
});

test("同步狀態殘缺（只有一半）→ 保守走 merge", () => {
  assert.equal(act(L, R, { localHash: "L1" }), "merge");
  assert.equal(act(L, R, { remoteMd5: "R1" }), "merge");
});

test("遠端沒有 md5（Google 對某些類型不給）→ 保守走 merge 而非 up-to-date", () => {
  assert.equal(act(L, { exists: true, md5: null }, STATE), "merge");
});

test("回傳值帶得出理由，方便在 popup 顯示", () => {
  const r = decideSync({ local: L, remote: R, state: STATE });
  assert.equal(typeof r.reason, "string");
  assert.ok(r.reason.length > 0);
});

test("非法輸入丟 TypeError", () => {
  assert.throws(() => decideSync(null), TypeError);
  assert.throws(() => decideSync({ local: null, remote: R, state: null }), TypeError);
  assert.throws(() => decideSync({ local: L, remote: undefined, state: null }), TypeError);
});
