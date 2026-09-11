# Udemy Boost 安裝／啟動腳本共用函式。
# 輸出契約：[ok] / [skip] / [warn] / [fail] <步驟> — <細節>，結尾印摘要。
# 規則：外部命令一律檢查 $LASTEXITCODE，不吞錯；不印 token / 金鑰內容，只印路徑。

Set-StrictMode -Version Latest

$script:Results = New-Object System.Collections.ArrayList
$script:NextSteps = New-Object System.Collections.ArrayList

function Add-Result {
    param(
        [Parameter(Mandatory)][string]$Chain,
        [Parameter(Mandatory)][ValidateSet('ok', 'skip', 'warn', 'fail')][string]$Status,
        [Parameter(Mandatory)][string]$Name,
        [string]$Detail = ''
    )
    [void]$script:Results.Add([pscustomobject]@{ Chain = $Chain; Status = $Status; Name = $Name; Detail = $Detail })
    $color = @{ ok = 'Green'; skip = 'DarkGray'; warn = 'Yellow'; fail = 'Red' }[$Status]
    $line = "[$Status] $Name"
    if ($Detail) { $line += " — $Detail" }
    Write-Host $line -ForegroundColor $color
}

function Add-NextStep {
    param([Parameter(Mandatory)][string]$Text)
    [void]$script:NextSteps.Add($Text)
}

function Test-Cmd {
    param([Parameter(Mandatory)][string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

<#
 執行外部命令。-DryRunMode 時只印出「將執行」而不執行，回傳 $true。
 失敗（非 0 離開碼）回傳 $false，並把原始命令與離開碼寫進結果，不丟例外——
 由呼叫端決定該鏈路要不要繼續。
#>
function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Chain,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$File,
        [string[]]$Arguments = @(),
        [string]$WorkDir,
        [hashtable]$EnvVars,
        [switch]$DryRunMode
    )
    $shown = "$File $($Arguments -join ' ')"
    if ($WorkDir) { $shown = "(cd $WorkDir) $shown" }
    if ($DryRunMode) {
        Add-Result -Chain $Chain -Status 'skip' -Name $Name -Detail "DryRun：將執行 $shown"
        return $true
    }
    $oldLocation = $null
    $oldEnv = @{}
    try {
        if ($WorkDir) { $oldLocation = Get-Location; Set-Location $WorkDir }
        if ($EnvVars) {
            foreach ($k in $EnvVars.Keys) {
                $oldEnv[$k] = [Environment]::GetEnvironmentVariable($k)
                [Environment]::SetEnvironmentVariable($k, $EnvVars[$k])
            }
        }
        & $File @Arguments
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            Add-Result -Chain $Chain -Status 'fail' -Name $Name -Detail "離開碼 $code：$shown"
            return $false
        }
        Add-Result -Chain $Chain -Status 'ok' -Name $Name -Detail $shown
        return $true
    }
    catch {
        Add-Result -Chain $Chain -Status 'fail' -Name $Name -Detail "$($_.Exception.Message)：$shown"
        return $false
    }
    finally {
        foreach ($k in $oldEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $oldEnv[$k]) }
        if ($oldLocation) { Set-Location $oldLocation }
    }
}

<# 回傳 $null（沒人聽）或 "<process 名稱> (PID <id>)"。取不到擁有者時回傳 "unknown"。 #>
function Get-PortOwner {
    param([Parameter(Mandatory)][int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    }
    catch { return $null }
    if (-not $conn) { return $null }
    try {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction Stop
        return "$($proc.ProcessName) (PID $($proc.Id))"
    }
    catch { return "unknown (PID $($conn.OwningProcess))" }
}

<# 等待 HTTP endpoint 可用；成功回傳 response，逾時回傳 $null。 #>
function Wait-HttpOk {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [int]$TimeoutSec = 60,
        [hashtable]$Headers,
        [int]$IntervalMs = 1000
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $params = @{ Uri = $Uri; TimeoutSec = 5; ErrorAction = 'Stop' }
            if ($Headers) { $params['Headers'] = $Headers }
            return Invoke-RestMethod @params
        }
        catch { Start-Sleep -Milliseconds $IntervalMs }
    }
    return $null
}

function Get-NodeVersion {
    if (-not (Test-Cmd 'node')) { return $null }
    try {
        $raw = (& node --version) 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        return [version](($raw -replace '^v', '').Trim())
    }
    catch { return $null }
}

function Find-Chrome {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

<# 摘要表 + 下一步人工動作。回傳建議的離開碼（有 fail 就是 1）。 #>
function Show-Summary {
    param([string]$Title = '摘要')
    Write-Host ''
    Write-Host "===== $Title =====" -ForegroundColor Cyan
    $script:Results |
        Group-Object Chain |
        ForEach-Object {
            $chain = $_.Name
            $fail = @($_.Group | Where-Object Status -eq 'fail').Count
            $warn = @($_.Group | Where-Object Status -eq 'warn').Count
            $done = @($_.Group | Where-Object Status -eq 'ok').Count
            $state = if ($fail -gt 0) { 'FAIL' } elseif ($warn -gt 0) { 'WARN' } elseif ($done -eq 0) { 'SKIP' } else { 'OK' }
            $color = @{ FAIL = 'Red'; WARN = 'Yellow'; OK = 'Green'; SKIP = 'DarkGray' }[$state]
            Write-Host ("{0,-22} {1}" -f $chain, $state) -ForegroundColor $color
            foreach ($r in $_.Group | Where-Object { $_.Status -in @('fail', 'warn') }) {
                Write-Host ("    [{0}] {1} — {2}" -f $r.Status, $r.Name, $r.Detail)
            }
        }
    if ($script:NextSteps.Count -gt 0) {
        Write-Host ''
        Write-Host '===== 下一步（人工） =====' -ForegroundColor Cyan
        $i = 1
        foreach ($s in $script:NextSteps) { Write-Host ("{0}. {1}" -f $i, $s); $i++ }
    }
    $failed = @($script:Results | Where-Object Status -eq 'fail').Count
    Write-Host ''
    if ($failed -gt 0) { Write-Host "$failed 個步驟失敗。" -ForegroundColor Red; return 1 }
    Write-Host '全部步驟通過。' -ForegroundColor Green
    return 0
}
