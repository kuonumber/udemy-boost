// 介入層：失焦自動暫停、Pomodoro、離開提示、今日分鐘數。瀏覽器端，每秒由 tracker 的 onSample 餵狀態。
// 回想筆記（recall prompt）在 main.js 的 Session 內處理，因為要接檔案寫入。
import { fmtDuration } from "../learning/log.js";
import { isAway, AwayTracker, DEFAULT_AWAY_MIN_MS } from "./away.js";

const REST_RESET_MS = 5 * 60000; // 停計 ≥5 分鐘視為休息，Pomodoro 歸零

export class FocusControls {
  /**
   * @param {{ getVideo:()=>HTMLVideoElement|null, overlay:{setToast,setAux}|null, options:object, getToday:()=>Promise<number> }} o
   */
  constructor(o) {
    this.getVideo = o.getVideo;
    this.overlay = o.overlay;
    this.options = o.options;
    this.getToday = o.getToday;
    this.streakMs = 0; // 連續計時（Pomodoro）
    this.notCountingMs = 0;
    this.pomodoroShown = false;
    this.away = new AwayTracker({ minMs: DEFAULT_AWAY_MIN_MS });
    this.autoPauseTimer = 0;
    // 分頁隱藏時 setInterval 會被節流到約每分鐘一次，所以離開起點用事件立刻定住
    this.onLeave = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) this.away.mark(Date.now());
    };
    for (const ev of ["blur", "pagehide"]) window.addEventListener(ev, this.onLeave);
    document.addEventListener("visibilitychange", this.onLeave);
    this.todayBase = 0;
    this.todayLive = 0;
    this.lastTodayRefresh = 0;
  }

  setOverlay(ov) {
    this.overlay = ov;
    this.renderAux();
  }

  setOptions(opts) {
    this.options = opts;
    if (!opts.fxTodayMinutes) this.overlay?.setAux("");
    if (!opts.fxAutoPause) this.cancelAutoPause();
  }

  /** 每秒由 tracker 呼叫。離開判定用 visible / focused / idle，不看影片狀態。 */
  async onSample({ counting, video, now, visible, focused, idleMs, requireFocus, idleLimitMs }) {
    const o = this.options;
    // ---- Pomodoro 連續計時
    if (counting) {
      this.streakMs += 1000;
      this.notCountingMs = 0;
      if (o.fxPomodoro && !this.pomodoroShown && this.streakMs >= o.fxPomodoroMin * 60000) {
        this.pomodoroShown = true;
        this.overlay?.setToast(`已連續觀看 ${fmtDuration(this.streakMs)}，休息一下`, 15000);
      }
    } else {
      this.notCountingMs += 1000;
      if (this.notCountingMs >= REST_RESET_MS) {
        this.streakMs = 0;
        this.pomodoroShown = false;
      }
    }
    // ---- 離開 / 回來（只看可見 / 焦點 / 閒置，與影片是否播放無關）
    const gone = isAway({ visible, focused, requireFocus, idleMs, idleLimitMs });
    const returnedAfterMs = this.away.sample(gone, now.getTime());
    if (returnedAfterMs !== null && o.fxAwayNotice) {
      this.overlay?.setToast(`離開 ${fmtDuration(returnedAfterMs)}`, 6000);
    }

    // ---- 失焦自動暫停（閒置不暫停：人可能只是沒動滑鼠在看）
    const shouldPause = !visible || (requireFocus && !focused);
    if (shouldPause) {
      if (o.fxAutoPause && video && !video.paused && !this.autoPauseTimer) {
        this.autoPauseTimer = setTimeout(() => {
          this.autoPauseTimer = 0;
          const v = this.getVideo();
          const stillAway = document.visibilityState !== "visible" || (this.options.lpRequireFocus && !document.hasFocus());
          if (v && !v.paused && stillAway) v.pause();
        }, Math.max(0, o.fxAutoPauseDelayS) * 1000);
      }
    } else {
      this.cancelAutoPause();
    }
    // ---- 今日分鐘數（每 30 秒從 storage 校正一次，其餘本地累加）
    if (o.fxTodayMinutes) {
      if (counting) this.todayLive += 1000;
      if (now.getTime() - this.lastTodayRefresh > 30000) {
        this.lastTodayRefresh = now.getTime();
        this.todayBase = await this.getToday();
        this.todayLive = 0;
      }
      this.renderAux();
    }
  }

  renderAux() {
    if (!this.options.fxTodayMinutes) return;
    const ms = this.todayBase + this.todayLive;
    this.overlay?.setAux(`今日 ${ms < 60000 ? "0m" : fmtDuration(ms).replace(/ \d+s$/, "")}`);
  }

  cancelAutoPause() {
    if (this.autoPauseTimer) clearTimeout(this.autoPauseTimer);
    this.autoPauseTimer = 0;
  }

  destroy() {
    this.cancelAutoPause();
    for (const ev of ["blur", "pagehide"]) window.removeEventListener(ev, this.onLeave);
    document.removeEventListener("visibilitychange", this.onLeave);
  }
}
