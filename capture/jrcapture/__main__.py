"""Command line: python -m jrcapture <command> ...

  serve      run the local capture server JustRigIt talks to
  capture    video → GLB (+ optional BVH)
  convert    existing GEM-X result (.pt) → GLB
  demo       sample walk → GLB, no GPU needed
  selftest   check the installation, optionally run a real capture
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback


def _progress_printer(as_json: bool):
    last = [-1.0]

    def emit(p: float, msg: str):
        if as_json:
            print(json.dumps({"progress": p, "message": msg}), flush=True)
        else:
            if p >= 0:
                last[0] = p
            pct = f"{int(last[0] * 100):3d}%" if last[0] >= 0 else "   "
            print(f"[{pct}] {msg}", flush=True)
    return emit


def _opts(a):
    from .pipeline import CaptureOptions
    from .config import load_settings
    s = load_settings()
    return CaptureOptions(camera=a.camera, start=a.start or 0.0, duration=a.duration, smoothing=a.smoothing,
                          fingers=not a.no_fingers, face_forward=not a.keep_facing, recenter=not a.keep_position,
                          device=a.device or s.get("device", "cuda")), s


def main(argv=None):
    ap = argparse.ArgumentParser(prog="jrcapture", description="JustRigIt Capture — video to game animation")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("serve", help="Run the local capture server for JustRigIt")
    sp.add_argument("--port", type=int, default=8790)
    sp.add_argument("--demo", action="store_true", help="Force demo mode (no GPU model)")
    sp.add_argument("--open", action="store_true", help="Open JustRigIt in an app window")
    sp.add_argument("--exit-when-idle", type=float, default=0, help="Stop after this many seconds without the app open")
    sp.add_argument("--log", help="Write output to this file (for running without a console)")

    def common(p):
        p.add_argument("-o", "--output", required=True, help="Output .glb")
        p.add_argument("--bvh", help="Also write a .bvh")
        p.add_argument("--camera", default="static", choices=["static", "background", "vipe"],
                       help="static = tripod (best); background = handheld, estimated from the background; vipe = moving camera (needs ViPE)")
        p.add_argument("--start", type=float, help="Start time in seconds")
        p.add_argument("--duration", type=float, help="Length in seconds (max 60)")
        p.add_argument("--smoothing", default="light", choices=["off", "light", "medium", "strong"])
        p.add_argument("--no-fingers", action="store_true", help="Keep fingers relaxed instead of captured")
        p.add_argument("--keep-facing", action="store_true", help="Don't turn the performer to face forward")
        p.add_argument("--keep-position", action="store_true", help="Don't move the start to the origin")
        p.add_argument("--device", help="cuda or cpu")
        p.add_argument("--json-progress", action="store_true", help=argparse.SUPPRESS)

    sp = sub.add_parser("capture", help="Video → animation")
    sp.add_argument("video")
    common(sp)
    sp.add_argument("--demo", action="store_true", help=argparse.SUPPRESS)
    sp.add_argument("--keep-result", help="Also save GEM-X's raw result (.pt)")

    sp = sub.add_parser("convert", help="GEM-X result (.pt) → animation")
    sp.add_argument("result")
    common(sp)

    sp = sub.add_parser("demo", help="Sample walk → animation (no GPU)")
    common(sp)

    sp = sub.add_parser("selftest", help="Check the installation")
    sp.add_argument("--video", help="Also run a real capture on this short video")

    sp = sub.add_parser("download", help="Download the GEM-X model, SOMA assets and person detector")
    sp.add_argument("--gem-dir", help="GEM-X folder (default: from settings.json)")

    a = ap.parse_args(argv)
    from .config import apply_env
    apply_env()

    if a.cmd == "download":
        from .config import load_settings
        from .download import download_all
        download_all(a.gem_dir or load_settings()["gem_dir"])
        return 0

    if a.cmd == "serve":
        from .server import serve
        if a.log or sys.stdout is None:  # pythonw has no console: log to a file
            import os
            from .config import home
            path = a.log or str(home() / "engine.log")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            f = open(path, "a", encoding="utf-8", buffering=1)
            sys.stdout = sys.stderr = f
            print(f"\n==== {time.strftime('%Y-%m-%d %H:%M:%S')} ====")
        serve(a.port, demo=a.demo, open_app=a.open, exit_when_idle=a.exit_when_idle)
        return 0

    if a.cmd == "selftest":
        return selftest(a.video)

    emit = _progress_printer(getattr(a, "json_progress", False))
    try:
        from . import pipeline
        opts, settings = _opts(a)
        if a.cmd == "demo" or getattr(a, "demo", False):
            stats = pipeline.demo(a.output, out_bvh=a.bvh, opts=opts, progress=emit)
        elif a.cmd == "capture":
            stats = pipeline.capture(a.video, a.output, out_bvh=a.bvh, settings=settings, opts=opts, progress=emit,
                                     keep_result=a.keep_result)
        else:
            stats = pipeline.convert_result(a.result, a.output, out_bvh=a.bvh, settings=settings, opts=opts)
        if a.json_progress:
            print(json.dumps({"progress": 1.0, "message": "Done", "stats": stats}), flush=True)
        else:
            print(f"Wrote {a.output}" + (f" and {a.bvh}" if a.bvh else ""))
            print(json.dumps(stats, indent=2))
        return 0
    except Exception as e:  # noqa: BLE001
        msg = friendly_error(e)
        if getattr(a, "json_progress", False):
            print(json.dumps({"error": msg}), flush=True)
            traceback.print_exc(file=sys.stdout)
        else:
            traceback.print_exc()
            print("\nERROR:", msg)
        return 1


def friendly_error(e: Exception) -> str:
    s = str(e)
    low = s.lower()
    if "out of memory" in low:
        return "The GPU ran out of memory. Close other GPU-heavy apps (games, Unreal) or capture a shorter clip."
    if "at least one detected person" in low or "no person" in low:
        return "No person was found in the video. Make sure your whole body is visible and well lit."
    if "60" in s and "second" in low:
        return "GEM-X processes at most 60 seconds per capture. Set a start time and a duration of 60 s or less."
    if "ffmpeg" in low:
        return "ffmpeg is missing or failed to read the video. Install it (winget install Gyan.FFmpeg) or convert the video to MP4."
    if "vipe" in low:
        return "Moving-camera mode needs ViPE installed separately. Use Static (tripod) or Handheld mode instead."
    return s or e.__class__.__name__


def selftest(video: str | None) -> int:
    import platform
    from .config import check_install, load_settings, settings_path
    from . import __version__
    ok = True
    print(f"JustRigIt Capture {__version__} — self test")
    print(f"  Python      {platform.python_version()} ({sys.executable})")
    s = load_settings()
    print(f"  Settings    {settings_path()} {'(found)' if settings_path().exists() else '(not found — using defaults)'}")
    try:
        import torch
        print(f"  PyTorch     {torch.__version__}, CUDA {'available: ' + torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NOT available'}")
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            print(f"  GPU memory  {free / 1e9:.1f} GB free of {total / 1e9:.1f} GB")
    except Exception as e:  # noqa: BLE001
        print(f"  PyTorch     NOT importable: {e}")
    probs = check_install(s)
    for p in probs:
        print("  PROBLEM:", p)
        ok = False
    # Clean-up pipeline on synthetic data (no GPU)
    import tempfile, os
    from . import pipeline
    t = time.time()
    with tempfile.TemporaryDirectory() as d:
        st = pipeline.demo(os.path.join(d, "demo.glb"), out_bvh=os.path.join(d, "demo.bvh"))
    good = st["fkErrorCm"] < 0.01 and st["frames"] > 10
    print(f"  Clean-up    {'OK' if good else 'FAILED'} ({st['frames']} frames, rebuild error {st['fkErrorCm']} cm, {time.time() - t:.1f}s)")
    ok = ok and good
    if video and not probs:
        print(f"  Capturing   {video} (first 5 seconds)…")
        out = os.path.splitext(video)[0] + "_selftest.glb"
        opts = pipeline.CaptureOptions(duration=5.0, device=s.get("device", "cuda"))
        t = time.time()
        try:
            st = pipeline.capture(video, out, settings=s, opts=opts, progress=_progress_printer(False))
            print(f"  Capture     OK in {time.time() - t:.0f}s → {out}")
            print(f"              rebuild error {st['fkErrorCm']} cm (should be < 1), foot sliding {st['footSkateCm']} cm, travel {st['travelMeters']} m")
            if st["fkErrorCm"] > 1:
                print("  WARNING: the skeleton rebuild doesn't match SOMA closely. Please report this.")
                ok = False
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            print("  Capture     FAILED:", friendly_error(e))
            ok = False
    print("RESULT:", "ALL GOOD" if ok else "SOME PROBLEMS (see above)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
