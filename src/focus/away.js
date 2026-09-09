// 「離開多久」的判定與狀態機。純函式 / 無 DOM，可在 node 測試。
//
// 重要：離開判定只看「分頁可見 / 視窗焦點 / 閒置」，刻意不看影片是否播放。
// 0.5.2 的 bug 就是拿 tracker 的 end_reason 當判定依據——fxAutoPause 在離開 3 秒後
// 把影片暫停，reason 隨即變成 "pause"，於是被誤判成「已回來」，離開起點被清掉。

export const DEFAULT_AWAY_MIN_MS = 30_000;

/**
 * @param {{visible:boolean, focused:boolean, requireFocus:boolean, idleMs:number, idleLimitMs:number}} s
 */
export function isAway(s) {
  if (!s.visible) return true;
  if (s.requireFocus && !s.focused) return true;
  if (s.idleLimitMs > 0 && s.idleMs >= s.idleLimitMs) return true;
  return false;
}

export class AwayTracker {
  constructor({ minMs = DEFAULT_AWAY_MIN_MS } = {}) {
    this.minMs = minMs;
    this.since = null;
  }

  get awaySince() {
    return this.since;
  }

  /** 立刻定住離開起點。分頁隱藏時 setInterval 會被節流到約每分鐘一次，所以 blur /
   *  visibilitychange 事件要直接呼叫這個，不能等下一個 tick。重複呼叫不會延後起點。 */
  mark(nowMs) {
    if (this.since === null) this.since = nowMs;
  }

  /**
   * @param {boolean} away 由 isAway() 算出
   * @returns {number|null} 剛回來且離開時間 ≥ minMs → 離開毫秒數；其餘 null
   */
  sample(away, nowMs) {
    if (away) {
      this.mark(nowMs);
      return null;
    }
    if (this.since === null) return null;
    const elapsed = nowMs - this.since;
    this.since = null;
    return elapsed >= this.minMs ? elapsed : null;
  }
}
