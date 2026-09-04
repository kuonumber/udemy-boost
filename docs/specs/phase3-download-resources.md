# Spec: Phase 3 — 一鍵下載整門課的講師補充資源

狀態：已確認並實作（v0.3.0）。實作後修訂處以「【實作後修訂】」標示。
日期：2026-09-04
前置：Phase 1/2 已完成

## 目標

在設定 popup 提供「下載本課程所有資源」：抓整門課每個講次 Resources 下拉裡的檔案（PDF / zip / .blend / 程式碼…），
依「章節 / 講次」建資料夾存到 Chrome 預設下載目錄；外部連結（Google Drive 等）整理成一個 `links.md`。

## 非目標

- **不下載影片**（Udemy ToS 只允許 app 內離線；多數影片有 Widevine DRM）。
- 不下載字幕（Phase 4 若要再說）。
- 不做斷點續傳、不做排程；Chrome downloads API 本身的重試就夠。
- 不修改 Chrome 下載路徑設定（使用者自己在 Chrome 設定改）。

## 實測（2026-09-04，blender-start，courseId 6775439）

`GET /api-2.0/courses/{courseId}/subscriber-curriculum-items/?page_size=1400&fields[lecture]=title,object_index,supplementary_assets&fields[chapter]=title,object_index&fields[asset]=title,filename,asset_type,file_size,download_urls,external_url`

- 200，`count=70`（8 chapter + 62 lecture），`next=null`（單頁）。
- 38 個講次有資源，共 52 個 asset：`File` ×51、`ExternalLink` ×1。
- `File` 的 `download_urls.File[0].file` 是 `att-c.udemycdn.com` 帶簽章的 URL，匿名 GET 可用（Range 請求回 206）。
- `ExternalLink` 只有 `external_url`，`download_urls` 為 null。
- 以上是實測結果，非公開文件；欄位變動時壞在 `src/download/curriculum.js` 一處。

## 架構

```
manifest.json         + "downloads" permission；+ background service worker
src/background.js     # 收 content script 的下載清單 → chrome.downloads.download()，追蹤進度
src/download/
  curriculum.js       # fetch curriculum → 純函式 flatten 成 Plan（可測）
  naming.js           # 資料夾/檔名清洗（Windows 非法字元、長度、path traversal、重複）（可測）
  links.js            # ExternalLink → links.md 內容（可測）
options/options.*     # 「掃描資源」→ 顯示清單摘要（N 檔 / 總 MB / M 個外部連結）→「開始下載」→ 進度
```

### 資料流

1. popup 按「掃描資源」→ `chrome.tabs.sendMessage(activeTab, {type:'scan'})`。
2. content script（已在 learn 頁）取 `courseId`，呼叫 curriculum API（同源帶 cookie），`buildPlan()` 產出：
   ```
   Plan = { courseSlug, courseTitle, items: [{ lectureId, assetId, filename, size, url, path }], links: [{ chapter, lecture, title, url }] }
   ```
   `path` = `Udemy/<courseSlug>/<NN. chapter>/<NN. lecture>/<filename>`（NN 為 object_index 兩位數；無 chapter 的講次放 `00. (no section)`）。
3. popup 顯示摘要，使用者按「開始下載」→ 把 Plan 送 background。
4. background 逐檔 `chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false })`，同時最多 4 個進行中；
   `links.md` 以 `data:text/markdown;charset=utf-8,...` URL 下載到 `Udemy/<courseSlug>/links.md`。
5. background 用 `chrome.downloads.onChanged` 統計 complete / interrupted，popup 每秒問一次進度（`{done, failed, total, failedItems}`）。

## 契約

### `curriculum.buildPlan(results: CurriculumItem[], course: {slug,title}): Plan`（純函式）
- 【實作後修訂】**保持 API 回傳順序**（實測即大綱順序），不依 `object_index` 排序：chapter 與 lecture 的 `object_index` 是各自獨立的序號（c1, l1…l9, c2, l10…），混合排序會把講次歸錯章。chapter 切段；lecture 的 `supplementary_assets` 逐個處理。
- `asset_type === 'File'` 且 `download_urls.File[0].file` 存在 → items；缺 URL → 進 `skipped: [{assetId, reason}]`。
- `asset_type === 'ExternalLink'` → links。其他 asset_type（`SourceCode`、`Video` 等）→ skipped，reason 帶 type。
- 同一 `assetId` 出現在多個講次 → 只保留第一個。
- 空 results → 空 Plan。非陣列丟 TypeError。

### `naming.safeSegment(s: string, max=80): string`
- 移除 Windows/macOS 非法字元 `<>:"/\|?*` 與控制字元；`.`/空白開頭結尾去掉；保留區名（`CON`、`NUL`、`COM1`…）加底線；
  超長以 code point 截斷（中文不切半）；空字串 → `_`。
- `..` 段不可能出現（清洗後至少一個非點字元）。

### `naming.uniquePaths(paths: string[]): string[]`
- 同一資料夾同檔名重複 → 第二個起加 ` (2)`, ` (3)`（Chrome `uniquify` 也會做，但清單顯示要先一致）。

### `links.render(links): string`
- Markdown：`# <course>` → `## <NN. chapter>` → `- [<title>](<url>) — <lecture>`。URL 內 `)` 與空白做 percent-encode。

### Messages（content ↔ popup ↔ background）
```
{type:'scan'}                      → {ok:true, plan} | {ok:false, error}
{type:'start', plan}               → {ok:true, jobId}
{type:'progress', jobId}           → {done, failed, total, inFlight, failedItems:[{path, error}]}
{type:'cancel', jobId}             → 對 inFlight 呼叫 chrome.downloads.cancel()
```

## 邊界條件

- 不在 learn 頁（沒有 content script）→ popup 顯示「請先開課程播放頁」。
- curriculum 分頁（`next` 非 null）→ 跟著 `next` 抓完；上限 20 頁保險。
- 簽章 URL 過期（掃描後放很久才按下載）→ interrupted 進 failed 清單，提供「重新掃描並只下載失敗項」。
- 使用者 Chrome 設定「每次詢問儲存位置」→ `saveAs:false` 仍會被覆寫成逐檔詢問；popup 事先提示。
- 單檔 > 2 GB 或 size 未知 → 照常下載，只在摘要標示。
- 同一課程重複執行 → `uniquify` 產生 ` (1)` 副本；popup 提示「已下載過會產生副本」。不做已存在檔案偵測（downloads API 查不到磁碟）。
- background service worker 會被 Chrome 30 秒閒置回收：進度狀態存 `chrome.storage.session`，`onChanged` 事件會喚醒 worker；不靠記憶體變數。

## 權限

- `permissions` += `downloads`
- 不需 `downloads.shelf`、不需 `tabs`（`sendMessage` 用 `activeTab` 即可 — popup 開啟就是 user gesture）→ `permissions` += `activeTab`

## 驗收

1. blender-start：掃描顯示 51 檔 / ~N MB / 1 外部連結 / 0 skipped；下載後目錄結構 `Udemy/blender-start/01. <章>/03. <講>/03-Navigation.blend`，`links.md` 含 Google Drive 連結。
2. 下載中按取消 → inFlight 停止、已完成的保留。
3. 斷網或 URL 過期 → failed 清單列出路徑與原因，「重試失敗項」可補齊。
4. `node --test` 新增測試：`buildPlan`（空、無資源、重複 asset、缺 URL、ExternalLink、未知 type、亂序 object_index、無 chapter）、`safeSegment`（非法字元、保留字、超長中文、空、全點）、`uniquePaths`、`links.render`（特殊字元 URL）。
5. `chrome://extensions` 無 manifest 錯誤；service worker 無 console error。

## 風險

- Udemy 若把 `download_urls` 改成需另一支 API 逐檔取，要多一輪請求；架構上只動 `curriculum.js`。
- `data:` URL 下載 `links.md` 在部分 Chrome 版本會被標為「可能有害」而擋下；退路用 `Blob` + `URL.createObjectURL`（service worker 可用）。
