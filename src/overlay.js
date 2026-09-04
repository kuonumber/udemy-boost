// Overlay DOM：掛在 video 的容器內（進全螢幕時一起進去）。支援拖動、狀態列、動作按鈕。
import { applyDrag, clampPosition } from "./drag.js";

const ROOT_ID = "ub-overlay-root";

// Udemy 原生字幕容器的 class 帶 hash，用前綴比對；找不到就略過（best effort）。
const NATIVE_CAPTION_SELECTORS = [
  '[class*="captions-display--captions-container"]',
  '[class*="captions-display--captions-cue-text"]',
  '[data-purpose="captions-cue-text"]',
];

const STYLE = `
#${ROOT_ID} {
  position: absolute; left: 50%; bottom: var(--ub-bottom, 80px);
  transform: translateX(calc(-50% + var(--ub-x, 0px)));
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  max-width: 90%; pointer-events: none; z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  text-shadow: 0 0 4px #000, 0 0 8px #000;
}
#${ROOT_ID} .ub-lines { display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: auto; cursor: move; user-select: none; }
#${ROOT_ID}.ub-dragging .ub-lines { outline: 1px dashed rgba(255,255,255,.6); outline-offset: 4px; }
#${ROOT_ID} .ub-line {
  display: inline-block; padding: 2px 10px; border-radius: 4px;
  background: rgba(0,0,0,.55); color: #fff; text-align: center; line-height: 1.35;
  white-space: pre-wrap; word-break: break-word;
}
#${ROOT_ID} .ub-line:empty { display: none; }
#${ROOT_ID} .ub-en { font-size: var(--ub-font, 22px); }
#${ROOT_ID} .ub-zh { font-size: var(--ub-font, 22px); color: #ffe082; }
#${ROOT_ID} .ub-status {
  font-size: 12px; color: #ccc; background: rgba(0,0,0,.5); padding: 1px 6px; border-radius: 3px; white-space: nowrap;
}
#${ROOT_ID} .ub-status:empty { display: none; }
#${ROOT_ID} .ub-action {
  pointer-events: auto; cursor: pointer; font-size: 12px; color: #fff; background: #5624d0;
  border: 0; border-radius: 3px; padding: 3px 10px;
}
#${ROOT_ID} .ub-action[hidden] { display: none; }
.ub-hide-native ${NATIVE_CAPTION_SELECTORS.join(", .ub-hide-native ")} { visibility: hidden !important; }
`;

export class Overlay {
  /**
   * @param {HTMLElement} container video 的父容器
   * @param {{onPositionChange?:(pos:{offsetX:number,bottom:number})=>void}} [hooks]
   */
  constructor(container, hooks = {}) {
    this.container = container;
    this.hooks = hooks;
    this.pos = { offsetX: 0, bottom: 80 };
    this.root = document.createElement("div");
    this.root.id = ROOT_ID;
    this.root.innerHTML =
      '<div class="ub-status"></div><button class="ub-action" type="button" hidden></button>' +
      '<div class="ub-lines"><div class="ub-line ub-en"></div><div class="ub-line ub-zh"></div></div>';
    this.linesEl = this.root.querySelector(".ub-lines");
    this.enEl = this.root.querySelector(".ub-en");
    this.zhEl = this.root.querySelector(".ub-zh");
    this.statusEl = this.root.querySelector(".ub-status");
    this.actionEl = this.root.querySelector(".ub-action");
    this._last = { en: "", zh: "" };
    this._action = null;

    if (!document.getElementById("ub-style")) {
      const style = document.createElement("style");
      style.id = "ub-style";
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(this.root);

    this.actionEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this._action?.();
    });
    this._bindDrag();
  }

  _bounds() {
    const c = this.container.getBoundingClientRect();
    const b = this.root.getBoundingClientRect();
    return { width: c.width, height: c.height, boxWidth: b.width, boxHeight: b.height };
  }

  _applyPos() {
    this.root.style.setProperty("--ub-x", `${this.pos.offsetX}px`);
    this.root.style.setProperty("--ub-bottom", `${this.pos.bottom}px`);
  }

  _bindDrag() {
    let startPointer = null;
    let startPos = null;
    const onMove = (e) => {
      if (!startPointer) return;
      this.pos = applyDrag(startPos, startPointer, { x: e.clientX, y: e.clientY }, this._bounds());
      this._applyPos();
    };
    const onUp = (e) => {
      if (!startPointer) return;
      startPointer = null;
      this.root.classList.remove("ub-dragging");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      e.stopPropagation();
      this.hooks.onPositionChange?.({ ...this.pos });
    };
    this.linesEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation(); // 不要觸發播放器的點擊播放/暫停
      startPointer = { x: e.clientX, y: e.clientY };
      startPos = { ...this.pos };
      this.root.classList.add("ub-dragging");
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    });
    // 吃掉 click / dblclick，避免拖完放開觸發播放器全螢幕
    for (const ev of ["click", "dblclick"]) this.linesEl.addEventListener(ev, (e) => e.stopPropagation());
  }

  applyOptions(opts) {
    this.root.style.setProperty("--ub-font", `${opts.fontSize}px`);
    this.linesEl.style.flexDirection = opts.zhFirst ? "column-reverse" : "column";
    this.container.classList.toggle("ub-hide-native", !!opts.hideNative);
    this.pos = clampPosition({ offsetX: opts.offsetX, bottom: opts.bottomOffset }, this._bounds());
    this._applyPos();
  }

  /** 只在文字變化時碰 DOM，避免每 frame reflow。 */
  render({ en, zh }) {
    if (en !== this._last.en) {
      this.enEl.textContent = en;
      this._last.en = en;
    }
    if (zh !== this._last.zh) {
      this.zhEl.textContent = zh;
      this._last.zh = zh;
    }
  }

  setStatus(text) {
    this.statusEl.textContent = text ?? "";
  }

  /** 顯示一顆動作按鈕（例如「下載翻譯模型」）；label 為空則隱藏。 */
  setAction(label, fn) {
    this._action = fn ?? null;
    this.actionEl.textContent = label ?? "";
    this.actionEl.hidden = !label;
  }

  destroy() {
    this.root.remove();
    this.container.classList.remove("ub-hide-native");
  }
}
