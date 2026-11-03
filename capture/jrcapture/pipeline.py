"""End-to-end capture: video → GEM-X → SOMA transforms → clean MotionClip → GLB/BVH."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from . import __version__
from .gltf import write_bvh, write_glb
from .motion import MotionClip, detect_contacts, foot_skate_cm, from_world_transforms, smooth, trim
from .skeleton import GEM_CONTACT_JOINTS

Progress = Callable[[float, str], None]


@dataclass
class CaptureOptions:
    camera: str = "static"            # static | background | vipe
    start: float = 0.0                # seconds into the video
    duration: float | None = None     # seconds (GEM-X handles up to 60 s per clip)
    smoothing: str = "light"          # off | light | medium | strong
    fingers: bool = True              # False = keep fingers relaxed (rest pose)
    face_forward: bool = True         # turn the performer to face +Z at the start
    recenter: bool = True             # start at the origin
    device: str = "cuda"
    extras: dict = field(default_factory=dict)


def finish(clip: MotionClip, opts: CaptureOptions, gem_logits=None) -> MotionClip:
    """Clean-up shared by real captures and the demo."""
    if not opts.fingers:
        for j, n in enumerate(clip.names):
            if "Hand" in n and n not in ("LeftHand", "RightHand"):
                clip.rot[:, j] = clip.rest_rot[j]
    smooth(clip, opts.smoothing)
    detect_contacts(clip, gem_logits, GEM_CONTACT_JOINTS if gem_logits is not None else None)
    clip.meta["footSkateCm"] = round(foot_skate_cm(clip), 1)
    return clip


def write_outputs(clip: MotionClip, out_glb: str, out_bvh: str | None, name: str, info: dict) -> dict:
    stats = {
        "frames": clip.frames, "fps": clip.fps, "seconds": round(clip.duration, 3),
        "fkErrorCm": round(float(clip.meta.get("fkErrorCm", 0)), 3),
        "footSkateCm": clip.meta.get("footSkateCm"),
        "contactFrames": {k: int(v.sum()) for k, v in clip.contacts.items()},
        "travelMeters": round(float(np.linalg.norm((clip.hips_pos[-1] - clip.hips_pos[0])[[0, 2]])), 2),
        "engine": info.get("engine"), "engineVersion": __version__,
    }
    write_glb(clip, out_glb, name=name, extras={**info, "stats": stats})
    if out_bvh:
        write_bvh(clip, out_bvh)
    return stats


MAX_SECONDS = 60.0


def video_seconds(video: str) -> float | None:
    """Video length via ffprobe (None if unknown)."""
    import shutil
    import subprocess
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
                             capture_output=True, text=True, timeout=60,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return float(out.stdout.strip().splitlines()[0])
    except Exception:  # noqa: BLE001
        return None


def clamp_duration(video: str, start: float, duration: float | None) -> float | None:
    """GEM-X takes at most 60 s and fails if start+duration runs past the end: clamp both."""
    length = video_seconds(video)
    if length is None:
        return min(duration, MAX_SECONDS) if duration else duration
    avail = length - (start or 0.0)
    if avail <= 0.1:
        raise ValueError(f"The start time ({start:.1f} s) is at or after the end of the video ({length:.1f} s).")
    want = duration if duration else avail
    return round(min(want, avail - 0.05, MAX_SECONDS), 3) if (duration or avail > MAX_SECONDS) else None


def run_gem(video: str, settings: dict, opts: CaptureOptions, progress: Progress) -> dict:
    """Runs NVIDIA GEM-X on the video (in this process) and returns its result dict."""
    from gem.inference.body_video import load_body_video_config, run_body_video
    from gem.inference.postprocess import postprocess_motion_result

    stages = {
        "Normalizing": (0.05, "Preparing the video (30 fps)"),
        "Estimating camera poses": (0.10, "Estimating camera movement (ViPE)"),
        "Detecting and tracking": (0.15, "Finding and tracking the performer"),
        "Extracting native77": (0.30, "Detecting body keypoints in every frame"),
        "Estimating camera rotation": (0.50, "Estimating camera rotation"),
        "Extracting frozen body": (0.55, "Reading body pose features"),
        "Predicting native temporal": (0.80, "Solving 3D motion over time"),
    }

    def on_msg(m: str):
        for k, (p, nice) in stages.items():
            if m.startswith(k):
                progress(p, nice)
                return
        progress(-1, m)

    duration = clamp_duration(video, opts.start, opts.duration)
    config = load_body_video_config(settings["config"])
    config.setdefault("camera", {})["mode"] = opts.camera
    if opts.camera == "vipe" and settings.get("vipe_executable"):
        config["camera"].setdefault("vipe", {})["executable"] = settings["vipe_executable"]
    result = run_body_video(video, config, device=opts.device, start=opts.start, duration=duration, progress=on_msg)
    progress(0.88, "Planting feet and fixing ground contact (GEM-X contact/IK)")
    result = postprocess_motion_result(result, soma_assets=settings["soma_assets"], device=opts.device)
    return result


def gem_to_clip(result: dict, settings: dict, opts: CaptureOptions) -> tuple[MotionClip, np.ndarray | None]:
    """Evaluate SOMA forward kinematics for every frame and convert to a MotionClip."""
    import torch
    from gem.common.soma import SomaFixedGs1BodyAdapter, SomaRuntimeConfig
    from gem.inference.timing import prediction_fps

    from .skeleton import SOMA_NAMES, SOMA_PARENTS

    params = result["pred_soma_params_global"]
    dev = opts.device if (opts.device != "cuda" or torch.cuda.is_available()) else "cpu"
    adapter = SomaFixedGs1BodyAdapter(SomaRuntimeConfig(
        data_root=settings["soma_assets"], device=dev, lod="xlo", apply_correctives=False,  # same LOD as GEM-X contact/IK
        enable_procedural_transforms=True, procedural_reference="runtime"))
    p = {k: torch.as_tensor(params[k]).float().to(dev) for k in ("global_orient", "body_pose", "identity_coeffs", "scale_params", "transl")}
    with torch.inference_mode():
        out = adapter(**p, pose2rot=True, apply_correctives=False, return_joints_only=True)
        world = out["transforms"]
        if world is None:
            raise RuntimeError("SOMA returned no joint transforms — unexpected SOMA version.")
        world = world.reshape(-1, *world.shape[-3:])  # (T,78,4,4)
        ident = p["identity_coeffs"].mean(1, keepdim=True) if p["identity_coeffs"].ndim == 3 else p["identity_coeffs"]
        scale = p["scale_params"].mean(1, keepdim=True) if p["scale_params"].ndim == 3 else p["scale_params"]
        rest = adapter(global_orient=torch.zeros_like(p["global_orient"][:, :1]),
                       body_pose=torch.zeros_like(p["body_pose"][:, :1]),
                       identity_coeffs=ident, scale_params=scale,
                       transl=torch.zeros_like(p["transl"][:, :1]),
                       pose2rot=True, apply_correctives=False, return_joints_only=True)["transforms"]
        rest = rest.reshape(-1, *rest.shape[-3:])[0]
    world = world.detach().cpu().numpy().astype(np.float64)
    rest = rest.detach().cpu().numpy().astype(np.float64)

    rt = adapter.runtime
    names = list(getattr(rt, "public_joint_names", SOMA_NAMES))
    parents = getattr(rt, "output_joint_parent_ids", None)
    parents = np.asarray(parents.detach().cpu() if hasattr(parents, "detach") else (parents if parents is not None else SOMA_PARENTS), dtype=np.int64)
    if len(names) != world.shape[1] or len(parents) != world.shape[1]:
        names, parents = SOMA_NAMES, SOMA_PARENTS
    if parents.min() >= 0:  # some versions store the root's parent as itself
        parents = parents.copy()
        parents[0] = -1
    fps = float(prediction_fps(result))
    clip = from_world_transforms(names, parents, rest, world, fps, face_forward=opts.face_forward, recenter=opts.recenter)
    logits = result.get("static_conf_logits")
    if logits is not None:
        logits = np.asarray(torch.as_tensor(logits).float().cpu()).reshape(-1, np.asarray(torch.as_tensor(logits)).shape[-1])
        if logits.shape[0] != clip.frames:
            logits = None
    return clip, logits


def capture(video: str, out_glb: str, *, out_bvh: str | None = None, settings: dict, opts: CaptureOptions,
            progress: Progress = lambda p, m: None, keep_result: str | None = None) -> dict:
    t0 = time.time()
    progress(0.01, "Loading the motion capture model")
    result = run_gem(video, settings, opts, progress)
    if keep_result:
        import torch
        torch.save(result, keep_result)
    progress(0.92, "Building the skeleton animation")
    clip, logits = gem_to_clip(result, settings, opts)
    progress(0.96, "Smoothing and detecting foot contacts")
    finish(clip, opts, logits)
    name = Path(video).stem
    info = {"engine": "NVIDIA GEM-X", "video": Path(video).name, "camera": opts.camera,
            "start": opts.start, "smoothing": opts.smoothing, "seconds": round(time.time() - t0, 1), **opts.extras}
    stats = write_outputs(clip, out_glb, out_bvh, name, info)
    progress(1.0, "Done")
    return stats


def convert_result(pt_path: str, out_glb: str, *, out_bvh: str | None, settings: dict, opts: CaptureOptions) -> dict:
    """Convert an existing GEM-X result file (.pt from gem-infer motion-video) without re-running the model."""
    import torch
    result = torch.load(pt_path, map_location="cpu", weights_only=False)
    if "pred_soma_params_global" not in result:
        raise ValueError(f"{pt_path} is not a GEM-X Motion result (no pred_soma_params_global).")
    clip, logits = gem_to_clip(result, settings, opts)
    finish(clip, opts, logits)
    return write_outputs(clip, out_glb, out_bvh, Path(pt_path).stem, {"engine": "NVIDIA GEM-X", "video": Path(pt_path).name})


def demo(out_glb: str, *, out_bvh: str | None = None, opts: CaptureOptions | None = None,
         progress: Progress = lambda p, m: None, seconds: float = 4.0) -> dict:
    """No-GPU stand-in: a synthetic walk through the exact same clean-up and export path."""
    from .synthetic import make_walk
    opts = opts or CaptureOptions()
    for p, m in ((0.15, "Demo mode: no model installed — generating a sample walk"), (0.5, "Building the skeleton animation"), (0.9, "Smoothing and detecting foot contacts")):
        progress(p, m)
        time.sleep(0.3)
    names, parents, rest, world, fps = make_walk(seconds=seconds)
    clip = from_world_transforms(names, parents, rest, world, fps, face_forward=opts.face_forward, recenter=opts.recenter)
    if opts.start or opts.duration:
        trim(clip, opts.start, (opts.start + opts.duration) if opts.duration else None)
    finish(clip, opts)
    stats = write_outputs(clip, out_glb, out_bvh, "Demo_Walk", {"engine": "demo (synthetic)", "video": "demo", **opts.extras})
    progress(1.0, "Done")
    return stats
