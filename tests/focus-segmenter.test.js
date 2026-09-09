import { test } from "node:test";
import assert from "node:assert/strict";
import { Segmenter } from "../src/focus/segmenter.js";

const T = (s) => `2026-09-09T21:${s}+08:00`;
const base = { lectureId: 5, chapterIndex: 1, lectureIndex: 2, title: "L", extVersion: "t" };

function make() {
  return new Segmenter(base);
}

test("idle → counting 開段；連續 tick 累加；stop(reason) 關段並回傳 segment", () => {
  const s = make();
  assert.equal(s.tick({ now: T("00:00"), counting: true, pos: 10, rate: 1, durationS: 600 }), null);
  assert.equal(s.tick({ now: T("00:01"), counting: true, pos: 11, rate: 1, durationS: 600 }), null);
  const seg = s.tick({ now: T("00:02"), counting: false, reason: "pause", pos: 12, rate: 1, durationS: 600 });
  assert.equal(seg.start, T("00:00"));
  assert.equal(seg.end, T("00:02"));
  assert.equal(seg.watchedMs, 2000);
  assert.equal(seg.posStart, 10);
  assert.equal(seg.posEnd, 12);
  assert.equal(seg.endReason, "pause");
  assert.equal(seg.lectureId, 5);
  assert.equal(seg.videoDurationS, 600);
  assert.equal(seg.rate, 1);
  assert.equal(seg.extVersion, "t");
});

test("每種 stop reason 都帶進 segment", () => {
  for (const reason of ["pause", "blur", "hidden", "idle", "seek", "lecture_switch", "page_hide", "ended"]) {
    const s = make();
    s.tick({ now: T("00:00"), counting: true, pos: 0, rate: 1, durationS: 100 });
    const seg = s.tick({ now: T("00:01"), counting: false, reason, pos: 1, rate: 1, durationS: 100 });
    assert.equal(seg.endReason, reason);
  }
});

test("未計時中收到 counting=false → 不產段（回 null）", () => {
  const s = make();
  assert.equal(s.tick({ now: T("00:00"), counting: false, reason: "pause", pos: 0, rate: 1 }), null);
});

test("close(now, reason) 在計時中強制關段；未計時回 null", () => {
  const s = make();
  assert.equal(s.close(T("00:00"), "lecture_switch"), null);
  s.tick({ now: T("00:00"), counting: true, pos: 0, rate: 1, durationS: 100 });
  const seg = s.close(T("00:05"), "lecture_switch");
  assert.equal(seg.endReason, "lecture_switch");
  assert.equal(seg.watchedMs, 5000);
});

test("播放速率取段內平均（以 tick 數加權）", () => {
  const s = make();
  s.tick({ now: T("00:00"), counting: true, pos: 0, rate: 1, durationS: 100 });
  s.tick({ now: T("00:01"), counting: true, pos: 1, rate: 2, durationS: 100 });
  s.tick({ now: T("00:02"), counting: true, pos: 3, rate: 2, durationS: 100 });
  const seg = s.tick({ now: T("00:03"), counting: false, reason: "pause", pos: 5, rate: 2, durationS: 100 });
  assert.equal(seg.rate, 1.67); // 三個 tick：1,2,2 → 平均 1.666… → 四捨五入到小數 2 位
});

test("onSeek 往回 ≥2 秒才算回看；往前不算；<2 秒不算", () => {
  const s = make();
  s.tick({ now: T("00:00"), counting: true, pos: 100, rate: 1, durationS: 600 });
  s.onSeek(100, 90); // 回 10 秒
  s.onSeek(90, 89); // 回 1 秒 → 忽略
  s.onSeek(89, 200); // 往前 → 忽略
  s.onSeek(200, 150.5); // 回 49.5
  const seg = s.tick({ now: T("00:01"), counting: false, reason: "pause", pos: 150.5, rate: 1, durationS: 600 });
  assert.equal(seg.seekBackCount, 2);
  assert.equal(seg.seekBackS, 59.5);
});

test("onSeek 在未計時時發生也會記到下一段", () => {
  const s = make();
  s.onSeek(50, 10);
  s.tick({ now: T("00:00"), counting: true, pos: 10, rate: 1, durationS: 600 });
  const seg = s.tick({ now: T("00:01"), counting: false, reason: "pause", pos: 11, rate: 1, durationS: 600 });
  assert.equal(seg.seekBackCount, 1);
});

test("段關閉後 seekBack 歸零；新段重新計", () => {
  const s = make();
  s.tick({ now: T("00:00"), counting: true, pos: 0, rate: 1, durationS: 600 });
  s.onSeek(10, 0);
  s.tick({ now: T("00:01"), counting: false, reason: "pause", pos: 0, rate: 1, durationS: 600 });
  s.tick({ now: T("00:02"), counting: true, pos: 0, rate: 1, durationS: 600 });
  const seg = s.tick({ now: T("00:03"), counting: false, reason: "pause", pos: 1, rate: 1, durationS: 600 });
  assert.equal(seg.seekBackCount, 0);
});

test("durationS 為 NaN / Infinity（直播或未載入）→ videoDurationS null", () => {
  const s = make();
  s.tick({ now: T("00:00"), counting: true, pos: 0, rate: 1, durationS: NaN });
  const seg = s.tick({ now: T("00:01"), counting: false, reason: "pause", pos: 1, rate: 1, durationS: Infinity });
  assert.equal(seg.videoDurationS, null);
});

test("pos 為非數字時 posStart/posEnd 為 null，不丟錯", () => {
  const s = make();
  s.tick({ now: T("00:00"), counting: true, pos: undefined, rate: 1, durationS: 100 });
  const seg = s.tick({ now: T("00:01"), counting: false, reason: "pause", pos: NaN, rate: 1, durationS: 100 });
  assert.equal(seg.posStart, null);
  assert.equal(seg.posEnd, null);
});
