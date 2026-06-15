# ---------------------------------------------------------------------------
# Portable reinstall - no NSIS installer/uninstaller.
# Build -> wipe (install dir + AppData + registry) -> copy app -> run.
# Run:  powershell -ExecutionPolicy Bypass -File reinstall.ps1
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$project = "E:\projects\aipapersync"

# "Telechargements" built from a char code to dodge script-encoding issues.
$e          = [char]0xE9
$dl         = "E:\T${e}l${e}chargements\hghg"
$installDir = Join-Path $dl "AIPaper Sync"
$src        = Join-Path $project "dist\win-unpacked"

function Step($n, $m) { Write-Host "`n=== [$n] $m ===" -ForegroundColor Cyan }

Write-Host "Dossier d'installation cible: $installDir" -ForegroundColor DarkGray

# 0. Close the app
Step 0 "Fermeture de l'app"
Get-Process "AIPaper Sync" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# 1. Build fresh code into dist\win-unpacked
Step 1 "Build (--dir)"
Set-Location $project
& npx electron-builder --win --dir
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD ECHOUE (code $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $src "AIPaper Sync.exe"))) { Write-Host "win-unpacked introuvable" -ForegroundColor Red; exit 1 }

# 2. Wipe install folders (target + old "AIPaper")
Step 2 "Nettoyage des dossiers d'installation"
foreach ($d in @((Join-Path $dl "AIPaper"), $installDir)) {
    if (Test-Path $d) { Remove-Item -Recurse -Force $d; Write-Host "  supprime: $d" }
}

# 3. Wipe AppData (full reset of settings/history/logs)
Step 3 "Nettoyage des donnees AppData"
foreach ($d in @("$env:APPDATA\aipapersync", "$env:APPDATA\AIPaper Sync")) {
    if (Test-Path $d) { Remove-Item -Recurse -Force $d; Write-Host "  supprime: $d" }
}

# 4. Wipe registry (startup entries + leftover uninstall entry)
Step 4 "Nettoyage du registry"
$runKey = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$saKey  = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
(Get-ItemProperty $runKey).PSObject.Properties |
    Where-Object { $_.Name -notlike 'PS*' -and ($_.Name -like '*AIPaper*' -or $_.Name -like '*aipaper*' -or $_.Value -like '*AIPaper Sync*') } |
    ForEach-Object { Remove-ItemProperty $runKey -Name $_.Name -ErrorAction SilentlyContinue; Write-Host "  Run supprime: $($_.Name)" }
if (Test-Path $saKey) {
    (Get-ItemProperty $saKey).PSObject.Properties |
        Where-Object { $_.Name -notlike 'PS*' -and ($_.Name -like '*AIPaper*' -or $_.Name -like '*aipaper*') } |
        ForEach-Object { Remove-ItemProperty $saKey -Name $_.Name -ErrorAction SilentlyContinue; Write-Host "  StartupApproved supprime: $($_.Name)" }
}
$unRoot = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
if (Test-Path $unRoot) {
    Get-ChildItem $unRoot | ForEach-Object {
        $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        if ($p.DisplayName -like '*AIPaper*') { Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "  Uninstall key supprimee: $($p.DisplayName)" }
    }
}

# 5. Copy the fresh app into the install dir
Step 5 "Copie de l'app dans $installDir"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $installDir -Recurse -Force
$exe = Join-Path $installDir "AIPaper Sync.exe"
if (-not (Test-Path $exe)) { Write-Host "  ECHEC: exe absent apres copie" -ForegroundColor Red; exit 1 }
Write-Host "  Copie OK"

# 6. Run
Step 6 "Lancement"
Start-Process $exe

Write-Host "`nTermine - l'app tourne dans le system tray. A toi de tester." -ForegroundColor Green
