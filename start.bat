@echo off
rem Pixel Office: opens as its own app window. Starts the server automatically.
cd /d "%~dp0"
start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0app.ps1"
