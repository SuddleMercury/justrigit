<#
  JustRigIt Capture - Windows installer
  ------------------------------------------------------------------
  Sets up video motion capture (NVIDIA GEM-X) on this PC:
    1. checks the NVIDIA GPU
    2. installs Python 3.12 and ffmpeg if missing (via winget)
    3. creates a private Python environment
    4. installs PyTorch with CUDA
    5. downloads GEM-X (pinned version) and installs it
    6. downloads the model files (~8 GB) from Hugging Face / OpenMMLab
    7. writes settings.json and runs a self test

  Run it by double-clicking Install-Capture.bat (in the JustRigIt folder), or:
    powershell -ExecutionPolicy Bypass -File capture\install_capture.ps1

  Options:
    -DemoOnly     only set up the engine in demo mode (no PyTorch/model, ~1 minute)
    -Cuda cu126   use a different PyTorch CUDA build (default cu128)
    -InstallDir   where to install (default %LOCALAPPDATA%\JustRigIt\capture)
  Safe to run again: it skips anything already done.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'JustRigIt\capture'),
  [ValidateSet('cu128', 'cu126', 'cu130')][string]$Cuda = 'cu128',
  [switch]$DemoOnly,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x faster without the progress bar
$GemCommit = '4aef1452e5df171deff4f293c08e643eb450981e'   # NVlabs/GEM-X, tested version
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path     # ...\justrigit\capture
$Venv = Join-Path $InstallDir 'venv'
$Py = Join-Path $Venv 'Scripts\python.exe'
$GemDir = Join-Path $InstallDir 'GEM-X'

function Step($n, $msg) { Write-Host ''; Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    OK   $msg" -ForegroundColor Green }
function Note($msg) { Write-Host "    ..   $msg" -ForegroundColor Gray }
function Warn($msg) { Write-Host "    !!   $msg" -ForegroundColor Yellow }
function Done($code) {
  try { Stop-Transcript | Out-Null } catch { }
  if (-not $NoPause) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
  exit $code
}
function Fail($msg) { Write-Host ''; Write-Host "ERROR: $msg" -ForegroundColor Red; Done 1 }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Run([string]$exe, [string[]]$argList) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $exe $($argList -join ' ')" }
}
# Runs a program just to read its last output line. Windows PowerShell 5.1 turns stderr into
# terminating errors when ErrorActionPreference is Stop, so relax it for these probes.
function Probe([string]$exe, [string[]]$argList) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & $exe @argList 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
    return ([string]($out | Select-Object -Last 1)).Trim()
  } catch { return $null } finally { $ErrorActionPreference = $old }
}
function Write-Json($obj, [string]$path) {
  $json = $obj | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}
function Find-Python312 {
  if (Has 'py') {
    $p = Probe 'py' @('-3.12', '-c', 'import sys;print(sys.executable)')
    if ($p) { return $p }
  }
  foreach ($c in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:ProgramFiles\Python312\python.exe")) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$LogFile = Join-Path $Here 'install_log.txt'
try { Start-Transcript -Path $LogFile -Force | Out-Null } catch { }
Write-Host '==============================================================' -ForegroundColor DarkCyan
Write-Host '  JustRigIt Capture - installer' -ForegroundColor White
Write-Host "  Log file: $LogFile"
Write-Host "  Install folder: $InstallDir"
Write-Host '==============================================================' -ForegroundColor DarkCyan
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

try {
  # ---------------------------------------------------------------- 1. GPU
  Step 1 'Checking the NVIDIA graphics card'
  if (Has 'nvidia-smi') {
    $gpu = Probe 'nvidia-smi' @('--query-gpu=name,memory.total,driver_version', '--format=csv,noheader')
    if ($gpu) { Ok "GPU: $gpu" } else { Warn 'nvidia-smi found but reported nothing.' }
  } else {
    Warn 'nvidia-smi not found. Capture needs an NVIDIA RTX GPU with a recent driver (https://www.nvidia.com/drivers).'
    if (-not $DemoOnly) { Warn 'Continuing anyway - the self test at the end will confirm whether CUDA works.' }
  }

  # ---------------------------------------------------------------- 2. Python + ffmpeg
  Step 2 'Checking Python 3.12 and ffmpeg'
  $sysPy = Find-Python312
  if (-not $sysPy) {
    if (-not (Has 'winget')) { Fail 'Python 3.12 is not installed and winget is unavailable. Install Python 3.12 from https://www.python.org/downloads/ (tick "Add to PATH"), then run this again.' }
    Note 'Installing Python 3.12 (winget)...'
    & winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements --silent | Out-Host
    Refresh-Path
    $sysPy = Find-Python312
    if (-not $sysPy) { Fail 'Python 3.12 installation did not complete. Install it from python.org and run this again.' }
  }
  Ok "Python: $sysPy"

  $ffmpegDir = $null
  if (-not (Has 'ffmpeg')) {
    if (Has 'winget') {
      Note 'Installing ffmpeg (winget)...'
      & winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements --silent | Out-Host
      Refresh-Path
    }
  }
  if (Has 'ffmpeg') {
    $ffmpegDir = Split-Path -Parent (Get-Command ffmpeg).Source
    Ok "ffmpeg: $ffmpegDir"
  } else {
    $found = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $ffmpegDir = $found.DirectoryName; Ok "ffmpeg: $ffmpegDir" }
    else { Warn 'ffmpeg not found. Install it with:  winget install Gyan.FFmpeg   (needed to read videos)' }
  }

  # ---------------------------------------------------------------- 3. venv
  Step 3 'Creating the private Python environment'
  if (-not (Test-Path $Py)) { Run $sysPy @('-m', 'venv', $Venv) }
  Run $Py @('-m', 'pip', 'install', '--upgrade', '--quiet', 'pip', 'wheel')
  Run $Py @('-m', 'pip', 'install', '--quiet', 'numpy>=1.26,<3')
  Ok $Venv

  $settings = [ordered]@{
    gem_dir     = $GemDir
    config      = (Join-Path $GemDir 'weights\body_video_native77.yaml')
    soma_assets = (Join-Path $GemDir 'assets\soma')
    device      = 'cuda'
    python      = $Py
    engine_dir  = $Here
    ffmpeg_dir  = $ffmpegDir
    allowed_origins = @()
  }
  $settingsPath = Join-Path $InstallDir 'settings.json'

  if ($DemoOnly) {
    Write-Json $settings $settingsPath
    Write-Host ''
    Ok 'Demo setup finished. Start-JustRigIt.bat will run the engine in demo mode (sample walk).'
    Note 'Run this installer again without -DemoOnly to install the real model.'
    Done 0
  }

  # ---------------------------------------------------------------- 4. PyTorch
  Step 4 "Installing PyTorch with CUDA ($Cuda) - about 3 GB, a few minutes"
  $cudaProbe = @('-c', 'import torch;print(torch.cuda.is_available())')
  $haveCuda = Probe $Py $cudaProbe
  if ($haveCuda -ne 'True') {
    Run $Py @('-m', 'pip', 'install', '--upgrade', 'torch>=2.10,<3', 'torchvision', '--index-url', "https://download.pytorch.org/whl/$Cuda")
    $haveCuda = Probe $Py $cudaProbe
    if ($haveCuda -ne 'True' -and $Cuda -ne 'cu126') {
      Warn "CUDA not available with $Cuda - trying the cu126 build."
      Run $Py @('-m', 'pip', 'install', '--force-reinstall', 'torch>=2.10,<3', 'torchvision', '--index-url', 'https://download.pytorch.org/whl/cu126')
      $haveCuda = Probe $Py $cudaProbe
    }
  }
  $tinfo = Probe $Py @('-c', "import torch;print(torch.__version__, torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO CUDA')")
  if ($haveCuda -eq 'True') { Ok "PyTorch $tinfo" } else { Warn "PyTorch installed but CUDA is NOT available ($tinfo). Update your NVIDIA driver and run this again." }

  # ---------------------------------------------------------------- 5. GEM-X
  Step 5 'Installing NVIDIA GEM-X (motion capture model code)'
  $stamp = Join-Path $GemDir '.jr_commit'
  if (-not (Test-Path $stamp) -or ((Get-Content $stamp -Raw).Trim() -ne $GemCommit)) {
    $zip = Join-Path $InstallDir 'gemx.zip'
    Note "Downloading GEM-X $($GemCommit.Substring(0,7)) from GitHub..."
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/NVlabs/GEM-X/archive/$GemCommit.zip" -OutFile $zip
    $tmp = Join-Path $InstallDir 'gemx_tmp'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
    # keep already-downloaded model files when upgrading
    $keepW = Join-Path $GemDir 'weights'; $keepA = Join-Path $GemDir 'assets\soma'
    $parkW = Join-Path $InstallDir 'weights_keep'; $parkA = Join-Path $InstallDir 'soma_keep'
    if (Test-Path $keepW) { Move-Item $keepW $parkW -Force }
    if (Test-Path $keepA) { Move-Item $keepA $parkA -Force }
    if (Test-Path $GemDir) { Remove-Item -Recurse -Force $GemDir }
    Move-Item $src.FullName $GemDir
    if (Test-Path $parkW) { Move-Item $parkW (Join-Path $GemDir 'weights') -Force }
    if (Test-Path $parkA) { New-Item -ItemType Directory -Force (Join-Path $GemDir 'assets') | Out-Null; Move-Item $parkA $keepA -Force }
    Remove-Item -Recurse -Force $tmp, $zip -ErrorAction SilentlyContinue
    Set-Content -Path $stamp -Value $GemCommit
  }
  Run $Py @('-m', 'pip', 'install', '--quiet', '-e', "$GemDir[video]", 'huggingface_hub>=0.34')
  Ok "GEM-X installed in $GemDir"

  # ---------------------------------------------------------------- 6. model files
  Step 6 'Downloading model files (~8 GB) - this is the long part'
  $env:PYTHONPATH = $Here
  $env:JRCAPTURE_HOME = $InstallDir
  Run $Py @('-m', 'jrcapture', 'download', '--gem-dir', $GemDir)
  Ok 'Model files ready'

  # ---------------------------------------------------------------- 7. settings + self test
  Step 7 'Saving settings and running the self test'
  Write-Json $settings $settingsPath
  Ok "Settings: $settingsPath"
  & $Py -m jrcapture selftest
  $code = $LASTEXITCODE
  Write-Host ''
  if ($code -eq 0) {
    Write-Host 'All set! Double-click Start-JustRigIt.bat to capture motion from video.' -ForegroundColor Green
  } else {
    Write-Host 'Installed, but the self test reported problems (see above).' -ForegroundColor Yellow
    Write-Host 'Fix them and run this installer again - it skips what is already done.'
  }
  Done $code
}
catch {
  Fail "$($_.Exception.Message)`nRun the installer again after fixing this - it resumes where it stopped."
}
