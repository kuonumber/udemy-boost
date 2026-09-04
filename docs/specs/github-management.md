# GitHub 管控 Udemy Boost

## 目標

- 將目前 `udemy-boost` Chrome extension 納入 Git 與 GitHub 版本控制。
- 建立可追溯的初始版本、日後功能分支與正式 release 流程。
- 在提交或發版前，自動執行既有單元測試與 e2e 測試。

## 非目標

- 不改變 extension 功能、manifest 權限或發版到 Chrome Web Store。
- 不納入 Udemy 帳號資料、瀏覽紀錄、下載內容或任何憑證。
- 不新增 npm/conda 相依套件；CI 使用 Node 原生測試命令。

## 輸入與輸出契約

| 項目 | 契約 |
| --- | --- |
| GitHub repository | 由使用者指定帳號或 organization、repository 名稱與公開性。預設建議：私有 `udemy-boost`。 |
| 追蹤內容 | 原始碼、測試、`manifest.json`、文件、`package.json`、vendor 內已使用且可再散布的 OpenCC 檔與其 LICENSE。 |
| 排除內容 | `.env`、金鑰、Chrome profile、測試產物、coverage、log、下載資料與 OS/IDE 暫存檔。 |
| CI 成功條件 | `npm test` 與 `npm run test:e2e` 均退出碼 0。 |
| release | 每次公開版本以 manifest 版本建立 annotated tag `vX.Y.Z`；發版 zip 為可載入 extension 的檔案集合，排除 `.git`、測試與開發文件。 |

## 實作範圍

1. 新增 `.gitignore`，明確排除敏感與產生檔。
2. 執行測試，確認目前版本可作為 baseline。
3. `git init -b main`，建立首次 commit（訊息：`chore: bootstrap Udemy Boost v0.4.2`）。
4. 建立 GitHub repository、設定 `origin`，push `main`。這兩項為外部狀態變更，僅在使用者提供目標與明確同意後執行。
5. 新增 GitHub Actions workflow：pull request / push 至 `main` 時，使用 Node LTS 執行兩組測試。
6. 建立 `v0.4.2` annotated tag，並 push tag；不建立 GitHub Release，除非使用者另行要求。
7. 更新 worklog，記錄實際 repository URL、commit、測試證據與未解項目。

## 分支與版本策略

- `main`：可回溯、可載入的穩定版本。
- 功能使用 `feat/<slug>`，修正使用 `fix/<slug>`；完成後以 PR 合併至 `main`。
- manifest 與 CHANGELOG 採 Semantic Versioning：功能為 minor、修正為 patch、破壞性變更為 major。
- 不允許直接將 `.env`、token、cookie、個人下載資料提交；若誤提交，立即撤銷憑證並另行處理 Git 歷史。

## 邊界條件

- GitHub CLI 未登入或缺少建立 repository 權限時，只完成本機 Git 與可複製的 `git remote add` 指令，不嘗試繞過登入。
- e2e 依賴本機瀏覽器環境；CI 若無法可靠執行，workflow 必須明確失敗，不得 `continue-on-error` 或跳過。
- vendor 授權或檔案來源不明時，先保留 LICENSE 並在推送前人工確認。

## 驗收標準

- `git status --short --branch` 顯示 `main`，且首次 commit 包含全部應追蹤檔案。
- `.gitignore` 阻擋上述排除內容，但不排除 `vendor/LICENSE.opencc-js`。
- 本機 `npm test`、`npm run test:e2e` 成功；CI 對相同命令成功。
- `origin` 指向使用者指定的 GitHub repository，`main` 與 `v0.4.2` tag 均可在遠端查到。
