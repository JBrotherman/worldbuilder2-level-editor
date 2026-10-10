@echo off
rem Plays the original (unmodified) game in a resizable window. F11 = fullscreen.
cd /d "%~dp0"
node tools\window.js "WorldBuilder2\worldbuilder2\Launcher.exe"
if errorlevel 1 pause
