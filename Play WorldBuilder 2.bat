@echo off
rem Plays the original (unmodified) game in a resizable window. F11 = fullscreen.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node tools\window.js
if errorlevel 1 pause
exit /b

:nonode
echo This needs Node.js, which is not installed (or not on the PATH).
echo.
echo 1. Download the "LTS" version from https://nodejs.org/
echo 2. Install it with the default options.
echo 3. Double-click this file again.
echo.
pause
exit /b 1
