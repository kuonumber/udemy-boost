# Spec: Udemy Boost (Chrome Extension, MV3)

狀態：草稿，待確認
日期：2026-09-04

## 目標

在 Udemy 課程播放頁 (`https://www.udemy.com/course/*/learn/lecture/*`) 的影片上，同時顯示
英文與中文字幕，兩行對照、與影片時間軸同步。中文來源為 Udemy 該講次已有的字幕軌
（zh-TW 優先，無則退 zh-CN），不呼叫任何外部翻譯服務。

## 非目標

- 不做機器翻譯（無中文軌的講次只顯示英文，並在 overlay 角落標示「無中文軌」）。
- 不做簡轉繁（zh-CN 原樣顯示）。
- 不下載/匿存字幕檔到磁碟，不外送任何資料。
- 不支援 Udemy Business 的自訂網域（`*.udemy.com` 以外）；第一版只處理 `www.udemy.com`。
- 不支援 Firefox / Safari。

## 架構

```
manifest.json (MV3)
src/
  content.js        # 進入點：偵測 lecture 切換、取字幕、掛 overlay、同步
  udemy-api.js      # 取 courseId / lectureId、呼叫 Udemy API 取 caption 清單
  vtt.js            # WebVTT parser (純函式，可在 node 測試)
  align.js          # 依 currentTime 找 cue、雙語配對 (純函式)
  locale.js         # 中文軌選擇邏輯 (純函式)
  overlay.js        # DOM 渲染、樣式、拖曳/字級
  options.html/js   # 設定頁 (字級、位置、是否隱藏原生字幕、是否顯示中文優先)
tests/              # node:test，不需瀏覽器
docs/specs, docs/worklog, docs/adr
```

### 資料流

1. `content.js` 監聽 URL 變化（Udemy 為 SPA，用 `history.pushState` hook + `popstate`），解析 `lectureId`。
2. `courseId` 取自頁面（候選：`document.body.dataset.clpCourseId`、或 `<div class="ud-app-loader" data-module-args>` 內的 JSON）。**實作前需在真實頁面驗證，這是原文未載的推論。**
3. 呼叫（帶 cookie、同源，不需額外權限）：
   `GET /api-2.0/users/me/subscribed-courses/{courseId}/lectures/{lectureId}/?fields[lecture]=asset&fields[asset]=captions`
   預期回傳 `asset.captions[]`，每筆含 `locale_id`（如 `en_US`、`zh_TW`、`zh_CN`）、`url`（VTT，S3 signed URL）。
   **端點與欄位名同樣需在真實頁面驗證；若不存在，退路 B：在 MAIN world hook `fetch`/`XMLHttpRequest`，攔截播放器自己抓的 `.vtt` 請求。**
4. 平行 fetch 英文軌與中文軌 → `vtt.parse()` → 兩組 `Cue[]`。
5. 找 `<video>`，用 `timeupdate` + `requestAnimationFrame`（timeupdate 只有 ~4Hz，會慢半拍）取 `currentTime`，`align.pick()` 找出當前英/中 cue，寫進 overlay。
6. 可選：把原生字幕容器（`.captions-display--captions-container--*` 之類，class 帶 hash，用前綴比對）設為 `visibility:hidden`。

## 輸入 / 輸出契約

### `vtt.parse(text: string): Cue[]`
- `Cue = { start: number, end: number, text: string }`，秒為單位、浮點。
- 支援 `HH:MM:SS.mmm` 與 `MM:SS.mmm` 兩種時間格式；支援 cue id 行、多行文字、`NOTE` 區塊略過、BOM、CRLF。
- 移除 `<c>`、`<v>`、`<b>` 等 VTT inline tag，保留純文字；`&amp;` 等 entity 解碼。
- 非法輸入（無 `WEBVTT` header、時間格式錯）→ 丟 `VttParseError`，不靜默回空陣列。
- 個別 cue 時間錯亂（end < start）→ 丟掉該 cue、其餘照常。
- 回傳依 `start` 排序。

### `align.pick(cues: Cue[], t: number): Cue | null`
- 回傳 `start <= t < end` 的 cue；多個重疊時取 start 最大者；沒有則 `null`。
- 用 binary search，`cues` 必須已排序。
- `t` 為 `NaN`、負數、`Infinity` → `null`。

### `align.pairText(en: Cue|null, zh: Cue|null): { en: string, zh: string }`
- 英文與中文軌 cue 邊界不一定對齊（自動翻譯軌通常對齊，人工軌不一定）。第一版**各自獨立查表**，不做 cue 合併；兩軌各按自己的時間軸顯示，缺哪邊就顯示空字串。

### `locale.pickZh(captions: {locale_id: string}[]): Caption | null`
- 優先序：`zh_TW` > `zh_HK` > `zh_CN` > `zh`(前綴比對)。大小寫、`-`/`_` 皆容忍。
- 沒有任何中文軌 → `null`。

### `locale.pickEn(captions): Caption | null`
- `en_US` > `en_GB` > `en*`。沒有英文軌 → `null`（此時 overlay 只顯示中文，並標示）。

### Options（`chrome.storage.sync`）
```
{ fontSize: 22, zhFirst: false, hideNative: true, bottomOffset: 80, enabled: true }
```

## 邊界條件

- 講次切換（SPA 不 reload）→ 必須重新取字幕、清掉舊 overlay 與 listener（避免 leak 與殘影）。
- 同一講次 `<video>` 元素會被播放器重建（換畫質、全螢幕）→ 用 `MutationObserver` 重新綁定。
- 全螢幕模式 overlay 要跟著進 fullscreen element（掛在 video 的父容器內，不掛 body）。
- 字幕 URL 為 signed URL 有時效；重新播放超過時效 → refetch 一次，再失敗顯示錯誤。
- API 401/403（未登入、非訂閱課程）→ overlay 顯示「無法取得字幕」，不重試轟炸（exponential backoff 最多 3 次）。
- 講次無影片（文章、測驗）→ 不啟動。
- 非 lecture 頁（課程簡介、Q&A）→ 不注入。

## 權限（最小化）

- `permissions`: `["storage"]`
- `host_permissions`: `["https://www.udemy.com/*"]`（content script 同源 fetch 用 cookie 即可，不需 `cookies` 權限）
- 不用 `webRequest`、不用 background service worker（除非退路 B 需要）。

## 驗收標準

1. 打開任一有 zh-TW 軌的講次，影片上同時出現英文與中文兩行，落後影片不超過 ~250ms（人眼看不出）。
2. 只有 zh-CN 軌的講次 → 顯示英 + 簡中。
3. 完全無中文軌 → 只顯示英文，角落標示「無中文軌」。
4. 切講次不 reload → 字幕自動換，舊字幕不殘留。
5. 全螢幕、換畫質、快轉、拖進度條後字幕仍正確。
6. 關閉 extension 開關 → overlay 移除、原生字幕恢復。
7. `node --test tests/` 全綠；`vtt.js` / `align.js` / `locale.js` 覆蓋：正常路徑、空輸入、單一 cue、重疊 cue、非法格式、NaN/負數時間、CRLF/BOM、locale 大小寫與分隔符變體。
8. `chrome://extensions` 載入未封裝目錄無 manifest 錯誤與 console error。

## 實作前必做的驗證（會用你的 Chrome 分頁查，不動你的帳號設定）

- [ ] 確認 `courseId` 在 learn 頁的實際位置。
- [ ] 確認 caption API 端點、`locale_id` 值格式、`url` 欄位名。
- [ ] 確認原生字幕容器與 `<video>` 的 DOM 結構、class 前綴。

若以上任一與本規格不符，停下來回報，由你決定改規格或改做法。

## 已知風險

- Udemy 前端 class 名帶 hash、API 無公開文件，隨時可能改版；這是所有同類擴充套件的共同風險。
- Chrome Web Store 已有同類擴充套件（我不確定確切名稱與現況，不列舉）；自寫的好處是可控、不外送資料。
