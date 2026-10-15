@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:4173/' -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process -FilePath (Get-Command node).Source -ArgumentList 'preview.mjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden; Start-Sleep -Seconds 1 }"
start "" "http://127.0.0.1:4173/"
