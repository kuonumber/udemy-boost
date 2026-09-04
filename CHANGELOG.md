# Changelog

## 0.1.0 - 2026-09-04

- 首版：Udemy 講次頁顯示英文 + 中文（Udemy 內建軌，zh_TW > zh_HK > zh_CN）對照字幕。
- 設定：啟用開關、字級、距底部、中文在上、隱藏原生字幕。

## 0.2.0 - 2026-09-04

- 簡體中文軌（zh_HK / zh_CN）自動轉台灣繁體（OpenCC s2twp），可在設定關閉。
- 無中文軌時可用機器翻譯：Chrome 內建 Translator API 或自架 LibreTranslate，首選失敗自動切換；結果快取。
- 字幕可在影片上直接拖動，位置跨講次保存；設定頁有「位置重設」。
- 狀態列顯示中文來源（內建軌 / 轉繁 / 機翻 provider / 快取）與翻譯進度。

## 0.3.0 - 2026-09-04

- 新增「課程補充資源」一鍵下載：掃描整門課 Resources（PDF / zip / .blend…）→ 顯示摘要 → 確認後存到 `Udemy/<課程>/<章>/<講>/`，外部連結整理成 `links.md`。不含影片。
- 修正：OpenCC 轉繁失敗不再把整個字幕標成「載入失敗」；錯誤訊息帶原因。
- 新增 e2e 測試（Playwright 載入未封裝 extension）。

## 0.3.1 - 2026-09-04

- 修正：下載的檔案沒有進子目錄（Chrome 在 Windows 上忽略 `download()` 的 filename、改用 CDN 檔名）。改在 `onDeterminingFilename` 強制指定路徑。
- 課程資料夾改用課程名稱（原為 URL slug）：`Udemy/<課程名稱>/<章>/<講>/`。

## 0.3.2 - 2026-09-04

- 改名 Udemy Boost（功能已不只字幕）。資料夾與內部 `ub-` 前綴沿用。

## 0.4.0 - 2026-09-04

- 新增「學習歷程」：記錄每講觀看時間（播放中 + 分頁可見 + 3 分鐘內有操作才計）、同步 Udemy 完成狀態並記下完成時間；popup 顯示本課摘要，可匯出 `Udemy/<課程>/progress.md`（章節完成度 / 累計時間 / 完成於 / 講次表格），可選每次完成講次自動更新。
- 修正：background 對未知訊息不回應導致呼叫端卡住。

## 0.4.1 - 2026-09-04

- 學習歷程新增「不在頁面上就停計」（預設開）：視窗失焦（alt-tab 到別的 app、切到別的視窗）即停止累加，即使 Chrome 仍露在螢幕上。原本只看分頁是否可見（`visibilityState`），切到別的 app 時 Chrome 分頁仍算「可見」。

## 0.4.2 - 2026-09-04

- 專案資料夾改名 `udemy-boost`，內部 CSS / log 前綴 `uds-` → `ub-`，Phase 1 規格檔改名 `phase1-dual-subtitles.md`。功能無變動。**需在 chrome://extensions 移除舊的、從新資料夾重新「載入未封裝項目」。**
