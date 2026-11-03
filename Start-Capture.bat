@echo off
rem Starts the JustRigIt Capture engine (keep this window open while you use JustRigIt).
setlocal
title JustRigIt Capture
set "JRC_PY=%LOCALAPPDATA%\JustRigIt\capture\venv\Scripts\python.exe"
if not exist "%JRC_PY%" (
  echo JustRigIt Capture is not installed yet.
  echo   Double-click Install-Capture.bat first.
  echo   ^(For a 1-minute demo setup without the model: Install-Capture.bat -DemoOnly^)
  pause
  exit /b 1
)
cd /d "%~dp0capture"
set "PYTHONPATH=%~dp0capture"
"%JRC_PY%" -m jrcapture serve %*
echo.
echo The capture engine stopped. If this was unexpected, copy the text above.
pause
