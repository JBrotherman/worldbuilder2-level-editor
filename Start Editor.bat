@echo off
rem Starts the WorldBuilder 2 level editor and opens it in your browser.
cd /d "%~dp0"
title WB2 Level Editor
node tools\server.js --open
if errorlevel 1 pause
