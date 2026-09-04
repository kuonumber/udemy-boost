# Udemy Boost

在 Udemy 影片上同時顯示英文與中文字幕，字幕可拖動；一鍵下載整門課的講師補充資源（不含影片）；記錄學習歷程並匯出每門課的 `progress.md`。

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
6. popup「學習歷程」：自動記錄觀看時間與完成狀態（Udemy 勾勾為準），按「匯出 progress.md」寫到 `Udemy/<課程>/progress.md`；閒置 3 分鐘停計、可設自動更新。
7. popup 最下方「課程補充資源」：在講次頁按「掃描資源」→ 看摘要 → 「開始下載」，檔案存到 Chrome 下載目錄的 `Udemy/<課程>/<章>/<講>/`，外部連結在 `links.md`。

## 開發

```
npm test          # 單元測試（純函式）：vtt / align / locale / udemy-api / opencc / batch / cache / fallback / drag / libre / naming / curriculum / links
npm run test:e2e  # Playwright + headless Chromium 載入未封裝 extension，跑假 Udemy 頁的完整流程（需 playwright 套件）
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
