// MV3 content script 不能直接 `import`；用動態 import 載入 ES module 主程式。
// 需在 manifest 的 web_accessible_resources 開放 src/*.js。
(async () => {
  try {
    await import(chrome.runtime.getURL("src/main.js"));
  } catch (e) {
    console.error("[ub] failed to load main module", e);
  }
})();
