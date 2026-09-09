# Udemy Boost

（原名 Udemy Dual Subtitles，0.4.2 起專案資料夾與內部前綴一併改為 udemy-boost / `ub-`。）

在 Udemy 影片上同時顯示英文與中文字幕，字幕可拖動；一鍵下載整門課的講師補充資源（不含影片）；記錄學習歷程與專注度（分心 / 專注比 / 回看 / 時段），資料直寫 `Udemy/<課程>/watch-log.csv`，每門課一份 `progress.md` 分析與 `notes.md` 回想筆記。

中文來源優先序：
1. Udemy 該講次已有的中文軌（zh_TW > zh_HK > zh_CN）；簡體軌自動以 OpenCC 轉台灣繁體。
2. 沒有中文軌時（可選）機器翻譯整份英文字幕：Chrome 內建 Translator API（Chrome 138+，本機）或自架 LibreTranslate；首選失敗自動切換，結果快取。

預設（`不翻譯`）不會把任何資料送出瀏覽器。

## 安裝（未封裝載入）

1. Chrome 開 `chrome://extensions`，右上角開「開發人員模式」。
2. 「載入未封裝項目」→ 選這個資料夾（含 `manifest.json` 的那層）。
3. 開任一 Udemy 講次頁 `https://www.udemy.com/course/*/learn/lecture/*`，字幕會自動出現。
4. 點工具列圖示可調字級、位置、中文在上、是否隱藏原生字幕、OpenCC、翻譯來源與 LibreTranslate 網址。
5. 字幕可直接在影片上拖動；Chrome Translator 第一次使用時影片上會出現「下載翻譯模型」按鈕。
6. popup「Udemy 資料夾」按「選擇資料夾」（會開新分頁）選 `Downloads/Udemy`，之後所有 md / csv 直接讀寫、舊 progress.md 自動匯入；沒選就用下載模式。
7. popup「專注」：失焦自動暫停、休息提醒、講次結束回想筆記、今日分鐘數、離開提示，各自開關。
8. popup「學習歷程」：自動記錄觀看時間與完成狀態（Udemy 勾勾為準），按「匯出 progress.md」寫到 `Udemy/<課程>/progress.md`；閒置 3 分鐘停計、可設自動更新。
9. popup「GPT → Anki」：按「匯出學習包」得到 `Udemy/<課程>/<章>/<單元>/study-pack.md`，交給 ChatGPT 產生卡片 JSON 後回來匯入；或輸入本機 anki-mcp-server 的配對 token，選 Codex / Claude 後按「送到 AI Inbox」讓本機 CLI 產卡。卡片一律逐張審核（可編輯 / 取消）後才寫進 Anki（deck `Udemy Boost::<課程>`，需要 Anki 開著並裝 AnkiConnect）。
10. 自架 LibreTranslate（含 `localhost`）第一次使用要在 popup 按一次「授權此網址」——0.6.0 起 manifest 不再帶寬鬆的 localhost 權限（ADR 0008）。
11. popup 最下方「課程補充資源」：在講次頁按「掃描資源」→ 看摘要 → 「開始下載」，檔案存到 Chrome 下載目錄的 `Udemy/<課程>/<章>/<講>/`，外部連結在 `links.md`。

## 開發

```
npm test          # 單元測試 + 靜態契約檢查（327 tests）：vtt / align / locale / udemy-api / opencc / batch / cache /
                  # fallback / drag / libre / naming / curriculum / links / learning-log / focus-* / options-* / learn-url / anki-*
npm run test:e2e  # 真瀏覽器主流程（Playwright + Chromium 載入未封裝 extension，假 Udemy 頁）

# 其餘 e2e（不在 npm test 內，各自單獨執行）
node tests/e2e/anki-popup.mjs           # GPT → Anki popup 流程（8765 / 8766 都在瀏覽器層假造）
node tests/e2e/options-persist.mjs      # 設定往返
node tests/e2e/options-tab-messaging.mjs# popup ↔ content script 訊息
node tests/e2e/away-notice.mjs          # 離開提示（此環境無法產生真的 hidden/blur → 印 AWAY SKIP）
node tests/e2e/inbox-bridge.mjs         # 跨 repo：真實 anki-mcp-server（需 ../anki-mcp-server 已 build，8766 空著）
# 容器 / CI 內若預裝瀏覽器版本與 playwright 不符：PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome node tests/e2e/...
```

不需 build step；`src/content.js` 以動態 `import()` 載入 ES module 主程式。

## 已知限制

- 講次沒有中文軌 → 只顯示英文，右上角標示「無中文軌」。
- Udemy 的 `zh_HK` 軌內容有時其實是簡體字（Udemy 端標錯），預設會過 OpenCC 轉繁。
- Chrome Translator 需要使用者點一下才能下載模型（瀏覽器限制）；行動裝置不支援。
- LibreTranslate 非 localhost 網址需在設定頁填入時授權該網域。
- Udemy API 無公開文件、前端 class 帶 hash，改版可能失效。壞掉時先看 console `[ub]` 訊息。
- 只支援 `www.udemy.com`，不含 Udemy Business 自訂網域。
- 資源下載不含影片與字幕；已下載過再跑會產生副本；Chrome 若設定「每次詢問儲存位置」會逐檔彈窗。

規格見 `docs/specs/`，決策見 `docs/adr/`。
