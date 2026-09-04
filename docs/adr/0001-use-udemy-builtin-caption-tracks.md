# ADR 0001: 中文字幕來源使用 Udemy 內建字幕軌

日期：2026-09-04　狀態：已採納

## 脈絡

要在 Udemy 播放器上顯示中英對照字幕。中文文字的來源有兩條路：Udemy 該講次已有的中文軌，
或抓英文字幕後即時機器翻譯。

## 決策

第一版只用 Udemy 內建字幕軌。透過同源 API 取得該講次所有 caption 的 VTT URL，
依 zh_TW > zh_HK > zh_CN > zh_* 挑一條中文軌，與英文軌各自獨立依 currentTime 查表顯示。

## 替代方案

- 即時機器翻譯（Google Translate 非官方端點 / DeepL / LLM API）：覆蓋所有課程，但需 API key 或依賴
  不穩定端點、有延遲與費用、且字幕內容會外送第三方。
- 兩者並用（內建優先、無中文軌時翻譯）：覆蓋最好，但複雜度最高；留作第二階段。
- 改寫 Udemy 播放器自己的字幕 DOM（同時塞兩種語言）：耦合 Udemy 的 class hash，最脆弱。

## 後果

- 零外部依賴、零費用、時間軸與 Udemy 自己的字幕完全一致。
- 沒有中文軌的講次沒有中文（實測 blender-start 課程只有 zh_HK，且內容是簡體字）。
- 依賴未公開的 Udemy 內部 API，Udemy 改版時需跟著改；風險集中在 `src/udemy-api.js`。
