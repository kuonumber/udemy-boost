# Spec: Phase 2 — 簡轉繁 (OpenCC) + 無中文軌時機器翻譯 (LibreTranslate / Chrome Translator API)

狀態：已確認並實作（v0.2.0）。實作後修訂處以「【實作後修訂】」標示。
日期：2026-09-04
前置：Phase 1 (`udemy-boost.md`) 已完成

【實作後修訂】Jimmy 決定：
- provider **自動 fallback**（原草稿為不 fallback）：選的 provider 不可用或失敗 → 換另一個 → 都失敗才只顯示英文。狀態列標示實際跑的 provider 與被切掉的原因。
- 新增需求：**字幕可拖動**（見末段）。

## 目標

1. 中文軌若為簡體（實測 zh_HK / zh_CN 皆為簡體），以 OpenCC 轉成台灣繁體再顯示。
2. 講次沒有任何中文軌時，把英文軌整份機器翻譯成繁中顯示。翻譯 provider 由使用者在設定頁選：
   `none`（維持 Phase 1 行為）/ `chrome`（Chrome 內建 Translator API）/ `libre`（自架 LibreTranslate）。
3. 翻譯結果快取，同一講次第二次開零延遲、零 API 呼叫。

## 非目標

- 不做逐句即時翻譯（延遲、排隊、計費都差）；一律講次載入時整份預翻。
- 不接 Google Cloud / DeepL / LLM API（未來若要加，走同一個 provider 介面）。
- 不翻譯 Udemy 頁面其他文字（標題、transcript 面板）。
- 不在 Firefox / Edge 驗證（Edge 148+ 理論上有 Translator API，不列驗收）。

## 架構變更

```
src/
  opencc.js           # 薄封裝：s2twp Converter，lazy 載入 vendor
  translate/
    provider.js       # interface: { id, available(): Promise<bool>, translateBatch(texts: string[]): Promise<string[]> }
    chrome.js         # Chrome Translator API
    libre.js          # LibreTranslate HTTP
    batch.js          # cue 合併/切回、分塊、快取 key（純函式，可測）
    cache.js          # chrome.storage.local 讀寫 + LRU 上限
vendor/
  opencc-full.esm.js  # 從 npm opencc-js dist/esm/full.js 複製；MV3 禁止遠端 script，必須 vendor
```

### 資料流（延伸 Phase 1 `loadTracks`）

```
caps = fetchCaptionList()
en   = pickEn(caps) → parse
zh   = pickZh(caps)
if zh:
    zhCues = parse(zh) → 若 options.opencc 且 locale ∉ {zh_TW}：每個 cue.text 過 opencc s2twp
else if options.provider != 'none' and en:
    key = hash(asset_id, en.locale_id, provider, 'zh-Hant', dictVersion)
    zhCues = cache.get(key) ?? translateTrack(enCues, provider) → cache.set(key, ...)
    status = `機翻 (${provider})`
```

## 輸入 / 輸出契約

### `opencc.toTW(text: string): string`
- s2twp（簡→台灣繁體含用語，如 软件→軟體、程序→程式）。
- 空字串回空字串；非字串丟 TypeError。
- 已是繁體的文字經過後不變（冪等；用 OpenCC 自身保證，測試驗證幾個常見句）。
- Converter 只建一次（模組層 lazy singleton）。

### `batch.pack(cues: Cue[], maxChars: number): { chunks: string[][], index: number[][] }`
- 把 cue 文字依序分塊，每塊總字元數 ≤ `maxChars`（單一 cue 超過 maxChars 時獨立成塊，不截斷）。
- cue 內的換行先替換為空格再送翻（機翻對斷行敏感）。
- 空陣列 → `{chunks: [], index: []}`。`maxChars <= 0` 丟 RangeError。

### `batch.unpack(chunksOut: string[][], index, total: number): string[]`
- 還原成長度 `total` 的陣列，順序對應原 cue。
- `chunksOut` 任一塊長度與 index 不符 → 丟 `TranslateError`（provider 漏句就整批視為失敗，不靜默錯位）。

### `provider.translateBatch(texts: string[]): Promise<string[]>`
- 回傳長度必須等於輸入長度、順序一致。
- 每個 provider 自行決定並行度與重試；對外只丟 `TranslateError { provider, cause }`。

#### `chrome` provider
- `Translator.availability({sourceLanguage:'en', targetLanguage:'zh-Hant'})`：
  `'unavailable'` → `available()` 回 false，設定頁顯示「此 Chrome 不支援」。
  `'downloadable'` / `'downloading'` → 需要 user activation 才能 `create()`：overlay 顯示「點此下載翻譯模型」按鈕（pointer-events 局部開啟），使用者點了才建。
- 同一個 translator 一次只能一個 `translate()` 在跑（文件原文明載）；序列化，不並行。
- 每次 `translate()` 一個 cue（不合併），避免模型把多句合併改寫；效能靠快取。
- **推論待驗證**：content script 是否拿得到 `Translator` global。若拿不到，退路是在 MAIN world 注入 bridge（`chrome.scripting` + `world: 'MAIN'`，需加 `scripting` 權限）。實作前先實測。

#### `libre` provider
- 設定：`libreUrl`（預設 `http://localhost:5000`）、`libreApiKey`（可空）。
- `POST {url}/translate` body `{ q: string[], source:'en', target:'zh-Hant', format:'text', api_key }`（LibreTranslate 支援 q 為陣列；若回 4xx 說不支援陣列，退回逐句）。
- **待驗證**：LibreTranslate 的 target 代碼是 `zh-Hant` 或 `zt`（不同版本不同）；`available()` 用 `GET {url}/languages` 查實際支援的 target 清單，找不到繁體就退 `zh` + 過 OpenCC。
- 每塊 ≤ 2000 字元、並行 3、失敗 backoff 重試 2 次。
- `host_permissions` 需加 `http://localhost/*`, `http://127.0.0.1/*`；使用者填其他網址時用 `chrome.permissions.request` 動態要（optional_host_permissions）。

### `cache`
- `chrome.storage.local`，key = `t:${sha1(asset_id|locale|provider|zh-Hant|dictVersion)}`，value = `{ ts, cues: [{start,end,text}] }`。
- 上限 200 筆或 8 MB（先到者），LRU 淘汰；設定頁有「清除翻譯快取」按鈕。

### Options 新增
```
opencc: true, provider: 'none'|'chrome'|'libre', libreUrl: 'http://localhost:5000', libreApiKey: ''
```

## 邊界條件

- 翻譯進行中（第一次開講次、Chrome 模型下載中）：先顯示英文，overlay 狀態列顯示進度 `翻譯中 37/109`；翻完整批才切換，不逐句冒出。
- 翻譯途中換講次 → `AbortController` 取消，不寫快取。
- provider 失敗 → 【實作後修訂】自動切到另一個 provider（`translate/fallback.js`）；全部失敗才只顯示英文並在狀態列列出每個 provider 的錯誤。provider 回傳長度不符也視為失敗切換。Chrome 模型尚未下載時 `available()` 為 false（跳過），全失敗後 overlay 出現「下載 Chrome 翻譯模型」按鈕，點了下載完自動重跑。
- OpenCC 對 zh_TW 軌不套用（避免 twp 用語轉換改動原本就正確的台灣用語）。
- 快取 key 含 `dictVersion`（opencc-js 版本）與 provider，換 provider 不會撿到舊結果。

## 權限變更

- `host_permissions` += `http://localhost/*`, `http://127.0.0.1/*`
- `optional_host_permissions`: `["http://*/*", "https://*/*"]`（只在使用者填非 localhost 的 LibreTranslate 網址時 request）
- 可能需 `scripting`（僅 Chrome provider 退路用到，實測後決定）

## 驗收標準

1. `blender-start` 講次（zh_HK 簡體）→ 顯示繁體台灣用語（「程序」→「程式」、「界面」→「介面」）。
2. 關閉 `opencc` 選項 → 恢復簡體原文。
3. 找一個沒有中文軌的講次（若你手上沒有，我用 mock caption list 測）：
   - provider=`chrome`：第一次顯示下載提示 → 點了下載 → 翻完顯示繁中，狀態列 `機翻 (chrome)`；第二次開同講次直接命中快取。
   - provider=`libre`：對你自架的 LibreTranslate 跑同樣流程。
   - provider=`none`：與 Phase 1 相同。
4. LibreTranslate 關掉時選 `libre` → 狀態列顯示連線失敗，英文正常。
5. `node --test` 全綠，新增測試涵蓋 `opencc.toTW`（空/非字串/冪等/常見用語）、`batch.pack/unpack`（空、單一、超長 cue、長度不符丟錯）、cache key 穩定性、LRU 淘汰。
6. 擴充套件總大小 < 5 MB（opencc-js full dict 大小待量；超過就改用 `dist/esm/cn2t.js` 之類的子集）。

## 實作前必做的驗證

- [ ] `Translator` 在 content script isolated world 是否存在（在你的 Chrome 版本上）。
- [ ] 你的 LibreTranslate 版本 `GET /languages` 對 `en` 的 targets 有沒有 `zh-Hant`/`zt`。
- [ ] opencc-js `dist/esm/full.js` 實際大小。

## 【實作後修訂】字幕拖動

- 拖動目標：字幕兩行的容器（`.ub-lines`，`pointer-events:auto; cursor:move`）；overlay 其餘區域維持 `pointer-events:none`，不擋播放器點擊。
- 位置模型：`offsetX`（相對容器水平中心的 px，0 = 置中）、`bottomOffset`（距容器底部 px）。存 `chrome.storage.sync`，跨講次、跨裝置沿用。
- 純函式 `drag.js`：`applyDrag(startPos, startPointer, curPointer, bounds)`、`clampPosition(pos, bounds)`；不能拖出容器；字幕比容器寬時固定置中；容器尚未 layout（尺寸 0）時不除以零。
- `pointerdown` 上 `preventDefault + stopPropagation`，`click / dblclick` 也吃掉，避免拖完觸發播放器的播放/暫停或全螢幕。
- 設定頁有「位置重設」按鈕（回到置中、距底 80px）。
- 驗收：實測拖 (+100, −50) px 後 `onPositionChange` 收到 `{offsetX:100, bottom:130}`、DOM 位移一致、影片 `paused` 狀態不變。

## 實作前驗證結果（2026-09-04，Jimmy 的 Chrome 152）

- `typeof Translator === 'function'`，`availability({en → zh-Hant}) === 'downloadable'`。content script 端可否取用未直接驗證（推論：Web API global 在 isolated world 也存在）；載入 extension 後看狀態列即可確認。
- `http://localhost:5000/languages` 打不到（LibreTranslate 未在跑）→ 繁中代碼由 `/languages` 動態判斷，`zh-Hant / zt / zh-TW` 直接用，只有 `zh` 時翻完過 OpenCC。
- opencc-js 1.4.2 `dist/esm/cn2t.js` 1.1 MB，vendor 至 `vendor/opencc-cn2t.esm.js`。擴充套件總大小 1.3 MB。

## 需要你提供

- LibreTranslate 網址（預設 `http://localhost:5000`）與是否有 API key。
- 一個沒有中文軌的講次 URL（可選；沒有我用 mock）。
