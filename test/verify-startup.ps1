# ─────────────────────────────────────────────────────────────────────────────
# Startup-at-login verification against the REAL packaged app.
#
# Why this exists: testing the startup logic with the dev electron binary only
# verifies the JavaScript logic — it does NOT prove the *installed/packaged*
# app creates a startup entry that Task Manager actually shows. A stale build
# once shipped broken `reg add` code that silently failed; the dev test passed
# while the real app was broken. This harness closes that gap.
#
# Prerequisite: build the app first so dist\win-unpacked is current:
#     npx electron-builder --win --dir
#
# It launches the packaged exe for real, simulates Task Manager enable/disable
# (via the StartupApproved registry key) and in-app toggles, and asserts the
# HKCU\Run entry + persisted config after each step. Cleans up after itself.
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

$exe     = Join-Path $PSScriptRoot "..\dist\win-unpacked\AIPaper Sync.exe"
$cfgFile = "$env:APPDATA\aipapersync\config.json"
$runKey  = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$saKey   = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

$script:pass = 0; $script:fail = 0
$script:itemName = $null

function Kill-App { Get-Process "AIPaper Sync" -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; Start-Sleep -Milliseconds 800 }
function Launch-App { Start-Process $exe; Start-Sleep -Seconds 5 }
function Get-EntryName {
    $p = (Get-ItemProperty $runKey).PSObject.Properties | Where-Object { $_.Name -notlike "PS*" -and $_.Value -like "*AIPaper Sync.exe*" } | Select-Object -First 1
    if ($p) { $p.Name } else { $null }
}
# Write UTF-8 WITHOUT BOM — Set-Content -Encoding utf8 (PS 5.1) adds a BOM that
# breaks Node's JSON.parse and would corrupt the test.
function Set-SWW([bool]$v) {
    $c = Get-Content $cfgFile -Raw | ConvertFrom-Json
    $c.startWithWindows = $v
    [System.IO.File]::WriteAllText($cfgFile, ($c | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
}
function Get-SWW { (Get-Content $cfgFile -Raw | ConvertFrom-Json).startWithWindows }
function Remove-Entry { if ($script:itemName) { Remove-ItemProperty $runKey -Name $script:itemName -EA SilentlyContinue; if (Test-Path $saKey) { Remove-ItemProperty $saKey -Name $script:itemName -EA SilentlyContinue } } }
function TM-Disable { if (-not (Test-Path $saKey)) { New-Item $saKey -Force | Out-Null }; Set-ItemProperty $saKey -Name $script:itemName -Value ([byte[]](3,0,0,0,0,0,0,0,0,0,0,0)) }
function TM-Enable  { if (-not (Test-Path $saKey)) { New-Item $saKey -Force | Out-Null }; Set-ItemProperty $saKey -Name $script:itemName -Value ([byte[]](2,0,0,0,0,0,0,0,0,0,0,0)) }
function Check($label, $actual, $expected) {
    if ($actual -eq $expected) { Write-Host "  PASS  $label (=$actual)" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $label  expected=$expected actual=$actual" -ForegroundColor Red; $script:fail++ }
}
function Scenario($t) { Write-Host "`n--- $t ---" -ForegroundColor Cyan }

if (-not (Test-Path $exe)) { Write-Host "EXE INTROUVABLE: $exe`nLance d'abord: npx electron-builder --win --dir" -ForegroundColor Red; exit 99 }
if (-not (Test-Path $cfgFile)) { [System.IO.File]::WriteAllText($cfgFile, '{ "startWithWindows": true, "syncOnStartup": false }', (New-Object System.Text.UTF8Encoding($false))) }

Scenario "V1 Fresh + config ON -> packaged app creates a Task-Manager entry"
Kill-App
(Get-ItemProperty $runKey).PSObject.Properties | Where-Object { $_.Value -like "*AIPaper Sync.exe*" } | ForEach-Object { Remove-ItemProperty $runKey -Name $_.Name -EA SilentlyContinue }
Set-SWW $true; Launch-App
$script:itemName = Get-EntryName
Check "entry created (visible in Task Manager)" ([bool]$script:itemName) $true

Scenario "V2 Restart with entry present -> stays registered, config ON"
Kill-App; Launch-App
Check "entry still present" ([bool](Get-EntryName)) $true
Check "config still ON" (Get-SWW) $true

Scenario "V3 Task Manager DISABLE -> restart -> config synced OFF"
Kill-App; TM-Disable; Launch-App
Check "config synced to OFF" (Get-SWW) $false

Scenario "V4 Task Manager ENABLE -> restart -> config synced ON"
Kill-App; TM-Enable; Launch-App
Check "config synced to ON" (Get-SWW) $true

Scenario "V5 Config OFF + no entry -> launch must NOT re-create it"
Kill-App; Remove-Entry; Set-SWW $false; Launch-App
Check "no entry re-created" ([bool](Get-EntryName)) $false
Check "config stays OFF" (Get-SWW) $false

Scenario "V6 Config OFF written WITH a BOM -> app must honor it (no reset)"
Kill-App; Remove-Entry
[System.IO.File]::WriteAllText($cfgFile, '{ "startWithWindows": false, "syncOnStartup": false }', (New-Object System.Text.UTF8Encoding($true)))
Launch-App
Check "BOM config honored -> no entry re-created" ([bool](Get-EntryName)) $false
Check "BOM config honored -> stays OFF" (Get-SWW) $false

# Cleanup: remove the dev entry (points to dist\win-unpacked, not a real install)
Kill-App
(Get-ItemProperty $runKey).PSObject.Properties | Where-Object { $_.Value -like "*win-unpacked*AIPaper Sync.exe*" } | ForEach-Object {
    Remove-ItemProperty $runKey -Name $_.Name -EA SilentlyContinue
    if (Test-Path $saKey) { Remove-ItemProperty $saKey -Name $_.Name -EA SilentlyContinue }
}

Write-Host "`n=================================" -ForegroundColor Yellow
Write-Host " PACKAGED VERIFY: $script:pass passed, $script:fail failed" -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "=================================" -ForegroundColor Yellow
exit $script:fail
