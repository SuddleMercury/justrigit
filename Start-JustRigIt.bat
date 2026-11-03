@echo off
rem Opens JustRigIt in its own window.
rem If video capture is installed, its engine runs hidden in the background and
rem stops by itself about 15 minutes after you close the JustRigIt window.
cd /d "%~dp0"
if not exist "%~dp0dist\justrigit.html" (
  echo Cannot find dist\justrigit.html. Make sure you extracted the whole JustRigIt folder.
  pause
  exit /b 1
)
set "JRC=%LOCALAPPDATA%\JustRigIt\capture\venv\Scripts"
if exist "%JRC%\pythonw.exe" (
  set "PYTHONPATH=%~dp0capture"
  start "" /d "%~dp0capture" "%JRC%\pythonw.exe" -m jrcapture serve --open --exit-when-idle 900
  exit /b 0
)
echo Video capture is not installed yet - JustRigIt opens without it.
echo Run Install-Capture.bat to add it.
timeout /t 5 >nul
start "" "%~dp0dist\justrigit.html"
