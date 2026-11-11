@echo off
rem Pixel Office installer - explains what it will do, then asks before changing anything.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
