# LibreTranslate 本機環境

Udemy Boost 可連到自架 LibreTranslate；預設網址為 `http://localhost:5000`。建議建立獨立 Conda environment，不要把 Python 相依混入 extension 專案。

> 官方目前要求 Python 3.8 以上。以下使用 Python 3.11，LibreTranslate 本體從 PyPI 安裝；Conda 僅負責環境隔離。

## 建立環境（Windows PowerShell）

```powershell
conda create -n libretranslate python=3.11 pip -y
conda run -n libretranslate python -m pip install --upgrade pip
conda run -n libretranslate python -m pip install libretranslate
```

確認 CLI 可執行：

```powershell
conda run -n libretranslate libretranslate --help
```

## 啟動服務

只載入此 extension 需要的英文與中文模型，可減少首次啟動時間與磁碟用量：

```powershell
conda run -n libretranslate libretranslate --load-only en,zh
```

第一次啟動會下載語言模型，需要網路連線，完成後服務預設監聽 `http://localhost:5000`。此命令需保持執行；停止服務按 `Ctrl+C`。

若要載入 LibreTranslate 可用的全部語言：

```powershell
conda run -n libretranslate libretranslate
```

更新程式或強制更新語言模型：

```powershell
conda run -n libretranslate python -m pip install --upgrade libretranslate
conda run -n libretranslate libretranslate --update-models
```

## 驗證 API

另開一個 PowerShell 視窗，先確認語言清單：

```powershell
Invoke-RestMethod -Uri 'http://localhost:5000/languages'
```

再測試英文翻中文：

```powershell
$body = @{
  q = 'Hello world'
  source = 'en'
  target = 'zh'
  format = 'text'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://localhost:5000/translate' `
  -ContentType 'application/json' `
  -Body $body
```

預期回應包含 `translatedText`。LibreTranslate 通常提供 `zh`，Udemy Boost 會再以 OpenCC 轉為台灣繁體；擴充功能也會先讀取 `/languages`，並以實際可用的目標語言代碼為準。

## 擴充功能設定

1. 開啟 Udemy Boost 擴充功能選單。
2. 翻譯來源選 `LibreTranslate`。
3. LibreTranslate 網址填 `http://localhost:5000`。
4. 本機預設模式不需要 API key；若服務啟用了 `--api-keys`，再填入對應 key。

## 已知限制

- 官方文件指出，正式服務建議使用 Gunicorn 或 Docker，以降低長時間執行時發生記憶體持續增加的風險；上述方式適合單機開發與個人使用。
- LibreTranslate 官方曾建議 Windows 使用 Docker。若直接在 Windows 透過 pip 安裝時，因缺少 C/C++ 編譯工具、預編譯套件或模型套件而失敗，不要改用未經驗證的非官方套件；請改採官方 Docker 流程。
- 不要將 LibreTranslate 直接綁定到公網介面。若必須跨機器使用，應另行設定 authentication、TLS、firewall 與 rate limit。

## 官方來源

- [LibreTranslate Installation](https://docs.libretranslate.com/guides/installation/)
- [LibreTranslate GitHub repository](https://github.com/LibreTranslate/LibreTranslate)
