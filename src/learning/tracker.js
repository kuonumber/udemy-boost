// 觀看時間計量 + Udemy 完成狀態同步。每個 lecture 一個 Tracker，講次切換時 destroy。
import { tick, applyCompletion, shouldCount } from "./log.js";

const TICK_MS = 1000;
const FLUSH_MS = 10_000;
const SYNC_MS = 30_000;
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"];

export function progressUrl(courseId) {
  if (!/^\d+$/.test(String(courseId))) throw new RangeError("courseId must be numeric");
  return `/api-2.0/users/me/subscribed-courses/${courseId}/progress/?fields[course]=completed_lecture_ids,completion_ratio,num_completed_lectures`;
}

export async function fetchCompletedIds(courseId) {
  const res = await fetch(progressUrl(courseId), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`progress API ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.completed_lecture_ids) ? j.completed_lecture_ids : [];
}

export class Tracker {
  /**
   * @param {{courseId, lectureId, courseTitle, slug, store, getVideo:()=>HTMLVideoElement|null,
   *          idleLimitMs:number, requireFocus:boolean, onCompleted?:(newIds:number[])=>void, onChange?:(log)=>void}} o
   */
  constructor(o) {
    Object.assign(this, o);
    this.log = null;
    this.isNew = false;
    this.dirty = false;
    this.dead = false;
    this.lastActivity = Date.now();
    this.onActivity = () => (this.lastActivity = Date.now());
    this.onVisibility = () => this.flush();
    this.timers = [];
  }

  async start() {
    const { log, isNew } = await this.store.get(this.courseId, this.courseTitle, this.slug);
    if (this.dead) return;
    this.log = log;
    this.isNew = isNew;
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, this.onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onVisibility);
    window.addEventListener("blur", this.onVisibility); // 失焦時先 flush，最多丟 1 秒
    this.timers.push(setInterval(() => this.tickOnce(), TICK_MS));
    this.timers.push(setInterval(() => this.flush(), FLUSH_MS));
    this.timers.push(setInterval(() => this.sync(), SYNC_MS));
    await this.sync();
  }

  tickOnce() {
    if (this.dead || !this.log) return;
    const v = this.getVideo();
    const playing = !!v && !v.paused && !v.ended && v.readyState >= 2;
    const ok = shouldCount({
      playing,
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
      requireFocus: !!this.requireFocus,
      idleMs: Date.now() - this.lastActivity,
      idleLimitMs: this.idleLimitMs,
    });
    if (!ok) return;
    this.log = tick(this.log, this.lectureId, TICK_MS, new Date().toISOString());
    this.dirty = true;
  }

  async flush() {
    if (!this.log || !this.dirty) return;
    this.dirty = false;
    await this.store.set(this.log);
    this.onChange?.(this.log);
  }

  /** 從 Udemy 抓完成清單並套進 log；回傳新完成的 lectureId 陣列。 */
  async sync() {
    if (this.dead || !this.log) return [];
    let ids;
    try {
      ids = await fetchCompletedIds(this.courseId);
    } catch (e) {
      console.warn("[ub:lp] progress sync failed", e);
      return [];
    }
    if (this.dead) return [];
    const before = new Set(Object.entries(this.log.lectures).filter(([, r]) => r.completedAt || r.completedBefore).map(([id]) => id));
    this.log = applyCompletion(this.log, ids, new Date().toISOString(), this.isNew);
    this.isNew = false;
    const newly = ids.map(String).filter((id) => !before.has(id) && this.log.lectures[id]?.completedAt);
    this.dirty = true;
    await this.flush();
    if (newly.length) this.onCompleted?.(newly.map(Number));
    return newly.map(Number);
  }

  /** 影片播完 → Udemy 會非同步標完成；多抓幾次。 */
  async onEnded() {
    for (const delay of [1500, 5000, 15000]) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.dead) return;
      const n = await this.sync();
      if (n.length) return;
    }
  }

  async destroy() {
    this.dead = true;
    for (const t of this.timers) clearInterval(t);
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, this.onActivity, { capture: true });
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onVisibility);
    window.removeEventListener("blur", this.onVisibility);
    await this.flush();
  }
}
