# Spec: GPT 學習包與 AnkiConnect 同步

狀態：已實作（extension 端 UI 於 0.6.0 接線完成，見 CHANGELOG 0.6.0 與 ADR 0008）。
日期：2026-09-07

## 目標

建立「單一課程單元字幕 → 匯出 GPT 學習包 → ChatGPT 產生 JSON → 人工審核 → AnkiConnect 同步」流程，讓使用者把課程內容轉成少量、可追溯來源的主動回想卡片。

## 非目標

- 不把字幕或卡片自動上傳到 ChatGPT 或其他雲端服務。
- 不保存 AI API key，不直接呼叫 LLM API。
- 不做單元測驗、圖片卡、整章／整課匯出或自建複習排程。
- 不自動 commit 或 push。

## 使用流程

1. 使用者在 Udemy 課程單元頁開啟擴充功能選單，按「匯出 GPT 學習包」。
2. extension 匯出 `Downloads/Udemy/<課程>/<章節>/<單元>/study-pack.md`，內容含課程脈絡、有時間戳的中英文字幕、卡片品質規則與 JSON schema。
3. 使用者自行把檔案交給 ChatGPT，下載回傳的 `anki-cards.json`。
4. 在擴充功能選單選取 JSON。通過完整驗證後，逐張預覽並可編輯、勾選或取消。
5. 使用者按「確認同步到 Anki」後，extension 才連線 `http://127.0.0.1:8765`。
6. 建立或沿用 `Udemy Boost::<課程名稱>` deck，查重後只新增未存在且經勾選的卡片。

## 學習包契約

- 範圍固定為目前課程單元；不得暗中擴大到整章或整課。
- metadata：course id/title/slug、chapter title、unit id/title/url、匯出時間。
- 字幕：英文與中文各自按時間排序；格式 `[HH:MM:SS.mmm --> HH:MM:SS.mmm] text`。缺一種語言仍可匯出；兩者皆空則拒絕。
- prompt 要求 5–10 張卡，每張只測一個概念，優先因果、比較、步驟、判斷條件與常見錯誤；不得補寫字幕無法支持的內容。

## JSON 契約

```json
{
  "schemaVersion": 1,
  "course": { "id": "string", "title": "string", "slug": "string" },
  "unit": {
    "id": "string",
    "chapterTitle": "string",
    "title": "string",
    "url": "https://www.udemy.com/course/.../learn/lecture/..."
  },
  "cards": [
    {
      "type": "basic",
      "front": "string",
      "back": "string",
      "sourceStartSec": 0,
      "sourceEndSec": 1,
      "reason": "string",
      "tags": ["string"]
    },
    {
      "type": "cloze",
      "text": "{{c1::answer}}",
      "extra": "string",
      "sourceStartSec": 0,
      "sourceEndSec": 1,
      "reason": "string",
      "tags": ["string"]
    }
  ],
  "warnings": []
}
```

- `schemaVersion` 只接受整數 `1`；cards 數量必須為 5–10。
- 所有字串 trim 後不可為空；tags 必須為非空字串陣列並去重。
- `sourceStartSec` / `sourceEndSec` 必須為有限非負數，且 end ≥ start。
- basic 只接受 front/back；cloze 只接受 text/extra，text 至少含一個 `{{cN::...}}`。
- course/unit 必須與目前頁面相符，避免把別課卡片送進錯誤 deck。
- 未知欄位拒絕，避免 schema 漂移被靜默忽略。

## AnkiConnect 契約

- endpoint 固定 `http://127.0.0.1:8765`，request `{action, version: 6, params}`，response 必須同時含 `result` 與 `error`。
- timeout 預設 5 秒；網路錯誤、timeout、HTTP 非 2xx、JSON 格式錯誤、AnkiConnect error 均回明確錯誤。
- 同步順序：`version` → `deckNames` / `createDeck` → `modelNames` → `findNotes` 查穩定 tag → `canAddNotes` → `addNotes`。
- deck：`Udemy Boost::<課程名稱>`；note model 使用 Anki 內建 `Basic` 與 `Cloze`，缺少時整批停止，不自動建立同名 model。
- tags 固定加入 `udemy-boost`、`ub-course::<slug>`、`ub-unit::<id>`、`ub-id::<sha256>`；使用 `ub-id` 查重。
- Basic fields：Front / Back；Cloze fields：Text / Back Extra。卡片背面附來源 URL、時間範圍與 reason。
- 同步採逐張可追蹤結果；已存在回 `duplicate`，不可新增回 `rejected`，成功回 note id，失敗不得清除匯入草稿。

## UI 與本機狀態

- 擴充功能選單新增「GPT → Anki」區塊：匯出學習包、JSON file input、卡片預覽、全選／全不選、確認同步、狀態摘要。
- 編輯欄位依卡片類型顯示；使用者修改後重新驗證並重新計算內容 hash。
- 匯入草稿存 `chrome.storage.local`，key 以目前 course/unit 組合，成功或失敗後皆保留，只有使用者明確清除才刪除。
- 同步按鈕前顯示即將寫入的 deck 與張數；`confirm()` 是最後人工 gate。

## 測試與驗收

- exporter：正常雙語、單語、空字幕、時間格式、排序、特殊字元、超長字幕。
- validator：Basic/Cloze、邊界 5/10、0/1/11、未知版本／欄位、NaN、型別混雜、非法 cloze、重複 tags。
- AnkiConnect：正常流程、版本不符、timeout、HTTP/JSON/API error、deck/model 狀態、查重、部分 addNotes 失敗。
- e2e：模擬匯出、JSON 匯入、修改、取消一張、人工確認、同步與再次同步不重複。
- 原有 175 個單元測試與所有新增測試全綠；真實 AnkiConnect 測試另列為人工驗證，不以 mock 結果宣稱實機可用。

## 實作註記（0.6.0）

- popup 的「GPT → Anki」區塊 id 契約由 `tests/e2e/../../tests/anki-ui-contract.test.js` 釘住；
  0.5.x 曾因整檔覆寫 manifest / options 而讓這一段接線消失（模組與測試都還在，但功能是死的），
  該測試就是為了讓這類「模組活著、接線斷掉」在 `npm test` 就紅。
- AnkiConnect 從 popup 直接呼叫，需要 `http://127.0.0.1:8765/*` host permission；
  Inbox（8766）刻意不給 host permission，走標準 CORS 以保留 server 端的 Origin 配對檢查。ADR 0008。
- 逐張審核的編輯經 `editDraftCard` → `validateCardPackage` 重新驗證並重算 fingerprint；驗證失敗時還原輸入框並顯示原因。
