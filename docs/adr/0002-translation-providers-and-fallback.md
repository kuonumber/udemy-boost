# ADR 0002: 無中文軌時的翻譯 provider、整份預翻與自動 fallback

日期：2026-09-04　狀態：已採納

## 脈絡

Phase 1 只用 Udemy 內建中文軌，沒有中文軌的講次沒有中文。要補機器翻譯，選項有：
Chrome 內建 Translator API（本機、免費、Chrome 138+）、自架 LibreTranslate（本機、免費、品質較差）、
Google Cloud Translation（每月 500k 字元免費但要綁 billing）、DeepL（Free 方案已停止新申請）、LLM API（付費）。
另外實測 Udemy 的 zh_HK / zh_CN 軌內容為簡體，需要簡轉繁。

## 決策

1. 支援兩個 provider：`chrome`（Translator API）與 `libre`（LibreTranslate，網址/API key 可設）。使用者選首選，
   失敗或不可用時**自動切另一個**；全失敗才只顯示英文，狀態列標示實際跑的 provider 與切換原因。
2. **整份預翻 + 快取**，不逐句即時翻：講次載入時把英文 VTT 全部翻完再切換顯示，結果存 `chrome.storage.local`
   （key = sha256(asset_id | locale | provider | target | dictVersion)，LRU 200 筆 / 8 MB）。
3. 簡體中文軌以 opencc-js（vendor `cn2t` build，s2twp）轉台灣繁體；zh_TW 軌不轉。
4. provider 以統一介面 `{ id, available(), translateBatch(texts) }` 實作，fallback 邏輯與 provider 解耦、可在 node 測試。

## 替代方案

- 不 fallback、只用使用者選的 provider：行為可預測，但 LibreTranslate 沒開機就沒字幕。Jimmy 選自動切。
- 逐句即時翻譯：Chrome Translator 同一 instance 一次只能一個 `translate()`（文件明載），會排隊落後；Cloud API 逐句計費也不划算。
- Google Cloud / DeepL / LLM provider：都要 key 或付費，先不做；介面已留好，加一個檔案即可。
- OpenCC 用 `full` build 或遠端 CDN：MV3 禁止遠端 script；full 比 cn2t 只多 0.1 MB 但用不到 t2cn，選 cn2t。

## 後果

- 第一次開無中文軌的講次要等翻譯（Chrome Translator 逐句約數十 ms/句，100 句數秒；LibreTranslate 看硬體），
  之後同講次零延遲。
- 擴充套件體積從 ~30 KB 變 1.3 MB（OpenCC 字典），lazy 載入，只在需要時才讀。
- 新增 `http://localhost/*`、`http://127.0.0.1/*` host permission；非 localhost 的 LibreTranslate 網址走 optional permission，
  在設定頁填網址時動態要。
- Chrome Translator 第一次需要使用者在影片上點「下載翻譯模型」（user activation 限制），無法全自動。
