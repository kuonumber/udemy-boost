// chrome.storage.sync 讀寫；options 頁與 content script 共用。

export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  fontSize: 22,
  bottomOffset: 80,
  offsetX: 0,
  zhFirst: false,
  hideNative: true,
  // Phase 2
  opencc: true,
  provider: "none", // 'none' | 'chrome' | 'libre'
  libreUrl: "http://localhost:5000",
  libreApiKey: "",
  // Phase 4
  lpEnabled: true,
  lpIdleMinutes: 3,
  lpRequireFocus: true,
  // Phase 5
  fxAutoPause: true,
  fxAutoPauseDelayS: 3,
  fxPomodoro: false,
  fxPomodoroMin: 30,
  fxRecallPrompt: true,
  fxTodayMinutes: true,
  fxAwayNotice: true,
  lpAutoExport: false,
  // GPT → Anki
  ankiProcessor: "codex", // 'codex' | 'claude'
});

const PROVIDERS = ["none", "chrome", "libre"];
const PROCESSORS = ["codex", "claude"];

function clamp(n, lo, hi, dflt) {
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export function sanitize(raw) {
  const o = { ...DEFAULT_OPTIONS, ...(raw ?? {}) };
  o.enabled = !!o.enabled;
  o.zhFirst = !!o.zhFirst;
  o.hideNative = !!o.hideNative;
  o.opencc = !!o.opencc;
  o.fontSize = clamp(Number(o.fontSize), 10, 60, DEFAULT_OPTIONS.fontSize);
  o.bottomOffset = clamp(Number(o.bottomOffset), 0, 2000, DEFAULT_OPTIONS.bottomOffset);
  o.offsetX = clamp(Number(o.offsetX), -4000, 4000, DEFAULT_OPTIONS.offsetX);
  o.provider = PROVIDERS.includes(o.provider) ? o.provider : "none";
  o.libreUrl = typeof o.libreUrl === "string" && o.libreUrl.trim() ? o.libreUrl.trim() : DEFAULT_OPTIONS.libreUrl;
  o.libreApiKey = typeof o.libreApiKey === "string" ? o.libreApiKey : "";
  o.lpEnabled = !!o.lpEnabled;
  o.lpAutoExport = !!o.lpAutoExport;
  o.lpRequireFocus = !!o.lpRequireFocus;
  o.lpIdleMinutes = clamp(Number(o.lpIdleMinutes), 0, 120, DEFAULT_OPTIONS.lpIdleMinutes);
  for (const k of ["fxAutoPause", "fxPomodoro", "fxRecallPrompt", "fxTodayMinutes", "fxAwayNotice"]) o[k] = !!o[k];
  o.fxAutoPauseDelayS = clamp(Number(o.fxAutoPauseDelayS), 0, 60, DEFAULT_OPTIONS.fxAutoPauseDelayS);
  o.fxPomodoroMin = clamp(Number(o.fxPomodoroMin), 5, 180, DEFAULT_OPTIONS.fxPomodoroMin);
  o.ankiProcessor = PROCESSORS.includes(o.ankiProcessor) ? o.ankiProcessor : DEFAULT_OPTIONS.ankiProcessor;
  return o;
}

export async function loadOptions() {
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULT_OPTIONS));
  return sanitize(raw);
}

export async function saveOptions(partial) {
  if (!partial || typeof partial !== "object") return;
  const keys = Object.keys(partial).filter((k) => k in DEFAULT_OPTIONS);
  if (keys.length === 0) return;
  // 只寫被改的 key。chrome.storage.sync.set 本身就是淺層合併，
  // 不可以「讀整包 → 合併 → 寫整包」：同時進來的變更會讀到同一份舊快照，最後一個寫入把其餘蓋掉
  // （0.5.0 的實際 bug：一次改六個「專注」欄位只有最後一個存下來）。
  // sanitize 的每個欄位彼此獨立，所以拿 DEFAULT_OPTIONS 當底清洗即可，不必讀 storage。
  const clean = sanitize({ ...DEFAULT_OPTIONS, ...partial });
  await chrome.storage.sync.set(Object.fromEntries(keys.map((k) => [k, clean[k]])));
}

export function onOptionsChanged(cb) {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "sync") return;
    loadOptions().then(cb);
  });
}
