// MV3 content script 不能直接 `import`；用動態 import 載入 ES module 主程式。
// 需在 manifest 的 web_accessible_resources 開放 src/*.js。
//
// 這支可能被「重複注入」：extension 重新載入後，既有分頁不會自動注入 content script，
// 設定頁會用 chrome.scripting.executeScript 補注入。isolated world 的 window 是同一個，
// 用旗標擋掉第二次 import，否則會跑出兩份 Session（兩倍計時、兩份 CSV 行）。
(async () => {
  if (window.__ubBooted) return;
  window.__ubBooted = true;
  try {
    await import(chrome.runtime.getURL("src/main.js"));
  } catch (e) {
    window.__ubBooted = false; // 讓下次注入還有機會
    console.error("[ub] failed to load main module", e);
  }
})();
