// 把每秒的「有沒有在計時」+ 影片狀態切成 segment。純狀態機，無 DOM。

const TICK_MS = 1000;
const SEEK_BACK_MIN_S = 2;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export class Segmenter {
  /** @param {{lectureId:number, chapterIndex:number, lectureIndex:number, title:string, extVersion:string}} meta */
  constructor(meta) {
    this.meta = meta;
    this.cur = null; // { start, posStart, ticks, rateSum, durationS }
    this.seekBackCount = 0;
    this.seekBackS = 0;
    this.lastPos = null;
  }

  get counting() {
    return this.cur !== null;
  }

  /** seeked：新位置比舊位置早 ≥2 秒算回看。 */
  onSeek(fromPos, toPos) {
    const a = num(fromPos);
    const b = num(toPos);
    if (a === null || b === null) return;
    if (a - b >= SEEK_BACK_MIN_S) {
      this.seekBackCount++;
      this.seekBackS += a - b;
    }
  }

  /**
   * 每秒呼叫。counting=true 開始/延續段；counting=false 且正在計時 → 關段回傳 segment。
   * @param {{now:string, counting:boolean, reason?:string, pos:number, rate:number, durationS:number}} s
   */
  tick({ now, counting, reason, pos, rate, durationS }) {
    const p = num(pos);
    if (counting) {
      if (!this.cur) this.cur = { start: now, posStart: p, ticks: 0, rateSum: 0, durationS: null };
      this.cur.ticks++;
      this.cur.rateSum += num(rate) ?? 1;
      const d = num(durationS);
      if (d && d > 0) this.cur.durationS = d;
      this.lastPos = p;
      return null;
    }
    if (!this.cur) return null;
    return this._close(now, reason ?? "pause", p);
  }

  close(now, reason) {
    if (!this.cur) return null;
    return this._close(now, reason, this.lastPos);
  }

  _close(now, reason, posEnd) {
    const c = this.cur;
    this.cur = null;
    const watchedMs = Math.max(TICK_MS, Date.parse(now) - Date.parse(c.start)) || c.ticks * TICK_MS;
    const seg = {
      start: c.start,
      end: now,
      lectureId: this.meta.lectureId,
      chapterIndex: this.meta.chapterIndex,
      lectureIndex: this.meta.lectureIndex,
      title: this.meta.title,
      watchedMs,
      posStart: c.posStart,
      posEnd: posEnd ?? this.lastPos,
      rate: c.ticks ? Math.round((c.rateSum / c.ticks) * 100) / 100 : null,
      endReason: reason,
      seekBackCount: this.seekBackCount,
      seekBackS: Math.round(this.seekBackS * 100) / 100,
      videoDurationS: c.durationS,
      extVersion: this.meta.extVersion,
    };
    this.seekBackCount = 0;
    this.seekBackS = 0;
    return seg;
  }
}
