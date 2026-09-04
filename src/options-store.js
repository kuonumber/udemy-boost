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
  lpAutoExport: false,
});

const PROVIDERS = ["none", "chrome", "libre"];

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
  return o;
}

export async function loadOptions() {
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULT_OPTIONS));
  return sanitize(raw);
}

export async function saveOptions(partial) {
  await chrome.storage.sync.set(sanitize({ ...(await loadOptions()), ...partial }));
}

export function onOptionsChanged(cb) {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "sync") return;
    loadOptions().then(cb);
  });
}
