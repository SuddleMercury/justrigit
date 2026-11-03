"""Downloads the GEM-X model files, the SOMA body assets and the YOLOX person detector.

    python -m jrcapture download --gem-dir <GEM-X folder>

Everything comes from the official sources named in GEM-X's docs/PRETRAINED_MODELS.md:
  nvidia/GEM-X (Hugging Face)             body pose, ViTPose observations, motion model
  nvidia/SOMA-X @ v0.3.3 (Hugging Face)   SOMA body rig and shape data
  download.openmmlab.com                  YOLOX-X HumanArt person detector (ONNX)
"""
from __future__ import annotations

import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

GEM_REPO = "nvidia/GEM-X"
GEM_FILES = ["body_s240000.ckpt", "vitpose.pth", "motion_native77_e774_s292175.ckpt",
             "motion_stats_raw.npz", "body_video_native77.yaml", "motion_native77.yaml", "body_config.json"]
SOMA_REPO, SOMA_REV = "nvidia/SOMA-X", "v0.3.3"
SOMA_FILES = ["SOMA_neutral.npz", "SOMA_template_rig.usda", "SOMA_procedural_transforms.json", "correctives_model.pt"]
YOLOX_URL = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_x_8xb8-300e_humanart-a39d44ed.zip"

OPTIONAL = {"body_config.json", "motion_native77.yaml", "correctives_model.pt"}


def _hf(repo: str, name: str, dest: Path, revision: str | None = None) -> None:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError
    try:
        hf_hub_download(repo_id=repo, filename=name, revision=revision, local_dir=str(dest))
    except GatedRepoError as e:
        raise SystemExit(
            f"\n{repo} asks you to accept its license before downloading.\n"
            f"  1. Open https://huggingface.co/{repo} in your browser, sign in and accept the terms.\n"
            f"  2. Create a read token at https://huggingface.co/settings/tokens\n"
            f"  3. Run:  \"{sys.executable}\" -m huggingface_hub.commands.huggingface_cli login   (or: hf auth login)\n"
            f"  4. Run the installer again.\n({e.__class__.__name__})") from e
    except RepositoryNotFoundError as e:
        raise SystemExit(f"Hugging Face says {repo} doesn't exist or isn't accessible: {e}") from e


def download_all(gem_dir: str | Path, *, log=print) -> None:
    gem = Path(gem_dir)
    weights = gem / "weights"
    soma = gem / "assets" / "soma"
    weights.mkdir(parents=True, exist_ok=True)
    soma.mkdir(parents=True, exist_ok=True)
    for f in GEM_FILES:
        if (weights / f).exists():
            log(f"  have  {f}")
            continue
        log(f"  get   {f}  (from {GEM_REPO}; large files take a while)")
        try:
            _hf(GEM_REPO, f, weights)
        except Exception as e:  # noqa: BLE001
            if f in OPTIONAL:
                log(f"  skip  {f} (optional): {e}")
            else:
                raise
    for f in SOMA_FILES:
        if (soma / f).exists():
            log(f"  have  SOMA {f}")
            continue
        log(f"  get   SOMA {f}  ({SOMA_REPO} @ {SOMA_REV})")
        try:
            _hf(SOMA_REPO, f, soma, revision=SOMA_REV)
        except Exception as e:  # noqa: BLE001
            if f in OPTIONAL:
                log(f"  skip  SOMA {f} (optional): {e}")
            else:
                raise
    onnx = weights / "yolox_humanart.onnx"
    if onnx.exists():
        log("  have  yolox_humanart.onnx")
    else:
        log("  get   YOLOX person detector (OpenMMLab)")
        z = weights / "yolox_humanart.zip"
        with urllib.request.urlopen(YOLOX_URL, timeout=120) as r, open(z, "wb") as out:
            shutil.copyfileobj(r, out)
        with zipfile.ZipFile(z) as archive:
            member = next(n for n in archive.namelist() if n.endswith("/end2end.onnx") or n == "end2end.onnx")
            with archive.open(member) as src, open(onnx, "wb") as dst:
                shutil.copyfileobj(src, dst)
        z.unlink(missing_ok=True)
    log("  all model files present.")
