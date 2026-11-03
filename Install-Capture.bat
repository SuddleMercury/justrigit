@echo off
title JustRigIt Capture - installer
rem Installs JustRigIt Capture (video motion capture). Safe to run again.
cd /d "%~dp0"
if not exist "%~dp0capture\install_capture.ps1" (
  echo Cannot find capture\install_capture.ps1 next to this file.
  echo Make sure you extracted the whole justrigit-v0.3.0 folder, then run this again.
  pause
  exit /b 1
)
echo Starting the installer... ^(log: %~dp0capture\install_log.txt^)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture\install_capture.ps1" %*
if errorlevel 1 (
  echo.
  echo The installer stopped with an error. The details are in capture\install_log.txt
  pause
)
