"""Where things live. The Windows installer writes settings.json next to the engine."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

DEFAULT_PORT = 8790


def home() -> Path:
    env = os.environ.get("JRCAPTURE_HOME")
    if env:
        return Path(env)
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "JustRigIt" / "capture"
    return Path.home() / ".justrigit" / "capture"


def settings_path() -> Path:
    return home() / "settings.json"


def load_settings() -> dict:
    h = home()
    s = {
        "gem_dir": str(h / "GEM-X"),
        "config": str(h / "GEM-X" / "weights" / "body_video_native77.yaml"),
        "soma_assets": str(h / "GEM-X" / "assets" / "soma"),
        "device": "cuda",
        "allowed_origins": [],
    }
    p = settings_path()
    if p.exists():
        try:
            s.update(json.loads(p.read_text(encoding="utf-8-sig")))  # tolerate a BOM from PowerShell
        except Exception:  # noqa: BLE001 — a broken settings file must not stop the engine
            pass
    return s


def apply_env(s: dict | None = None) -> None:
    """Put ffmpeg (recorded by the installer) on PATH for this process and its children."""
    s = s or load_settings()
    d = s.get("ffmpeg_dir")
    if d and os.path.isdir(d) and d not in os.environ.get("PATH", ""):
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


REQUIRED_WEIGHTS = ["body_s240000.ckpt", "vitpose.pth", "motion_native77_e774_s292175.ckpt",
                    "motion_stats_raw.npz", "body_video_native77.yaml", "yolox_humanart.onnx"]
REQUIRED_SOMA = ["SOMA_neutral.npz", "SOMA_template_rig.usda", "SOMA_procedural_transforms.json"]


def check_install(s: dict | None = None) -> list[str]:
    """Returns a list of plain-English problems (empty list = ready)."""
    s = s or load_settings()
    problems = []
    try:
        import torch  # noqa: F401
    except Exception:  # noqa: BLE001
        problems.append("PyTorch is not installed in this Python. Run install_capture.ps1.")
        return problems
    import torch
    if s.get("device", "cuda") == "cuda" and not torch.cuda.is_available():
        problems.append("PyTorch can't see an NVIDIA GPU (CUDA). Update the NVIDIA driver, or re-run install_capture.ps1.")
    try:
        import gem  # noqa: F401
    except Exception as e:  # noqa: BLE001
        problems.append(f"The GEM-X package isn't installed ({e}). Run install_capture.ps1.")
    w = Path(s["config"]).parent
    missing = [f for f in REQUIRED_WEIGHTS if not (w / f).exists()]
    if missing:
        problems.append(f"Model files missing in {w}: {', '.join(missing)}. Re-run install_capture.ps1.")
    sa = Path(s["soma_assets"])
    missing = [f for f in REQUIRED_SOMA if not (sa / f).exists()]
    if missing:
        problems.append(f"SOMA body files missing in {sa}: {', '.join(missing)}. Re-run install_capture.ps1.")
    if not shutil.which("ffmpeg"):
        problems.append("ffmpeg was not found on PATH. Install it (winget install Gyan.FFmpeg) and restart.")
    return problems
