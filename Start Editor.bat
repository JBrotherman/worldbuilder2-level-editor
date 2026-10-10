@echo off
rem Starts the WorldBuilder 2 level editor and opens it in your browser.
cd /d "%~dp0"
title WB2 Level Editor
where node >nul 2>nul
if errorlevel 1 goto nonode
node tools\server.js --open
if errorlevel 1 pause
exit /b

:nonode
echo The level editor needs Node.js, which is not installed (or not on the PATH).
echo.
echo 1. Download the "LTS" version from https://nodejs.org/
echo 2. Install it with the default options.
echo 3. Double-click "Start Editor.bat" again.
echo.
pause
exit /b 1
