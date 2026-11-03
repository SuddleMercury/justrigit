"""Local capture server for the JustRigIt web app (and the MCP server).

Listens on 127.0.0.1 only. One job runs at a time on the GPU, each in its own Python
subprocess so a crash or out-of-memory error never takes the server down and the GPU memory
is freed after every capture.

API (JSON unless noted):
  GET  /status                       engine readiness + problems in plain English
  POST /capture?filename=&camera=&start=&duration=&smoothing=&fingers=   body = raw video bytes
  GET  /jobs/<id>                    state, progress 0..1, message, stats
  GET  /jobs/<id>/result.glb         the animation (binary)
  GET  /jobs/<id>/result.bvh         the same motion as BVH (binary)
  POST /jobs/<id>/cancel
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import __version__
from .config import DEFAULT_PORT, check_install, load_settings

MAX_UPLOAD = 2 * 1024 ** 3  # 2 GB
LOCAL_ORIGIN = re.compile(r"^(null|https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$")


class Job:
    def __init__(self, video: Path, params: dict):
        self.id = uuid.uuid4().hex[:12]
        self.video = video
        self.params = params
        self.state = "queued"
        self.progress = 0.0
        self.message = "Waiting for the GPU"
        self.stats: dict | None = None
        self.error: str | None = None
        self.proc: subprocess.Popen | None = None
        self.created = time.time()
        self.dir = video.parent

    def view(self) -> dict:
        v = {"id": self.id, "state": self.state, "progress": round(self.progress, 3), "message": self.message,
             "filename": self.params.get("filename"), "stats": self.stats, "error": self.error}
        if self.state == "done":
            v["result"] = {"glb": f"/jobs/{self.id}/result.glb", "bvh": f"/jobs/{self.id}/result.bvh"}
        return v


class Engine:
    def __init__(self, demo: bool = False):
        self.settings = load_settings()
        self.problems = [] if demo else check_install(self.settings)
        self.demo = demo or bool(self.problems)
        self.jobs: dict[str, Job] = {}
        self.q: queue.Queue[Job] = queue.Queue()
        self.work = Path(tempfile.mkdtemp(prefix="jrcapture-"))
        self.last_seen = time.time()
        self.gpu = None
        if not demo:
            try:
                import torch
                if torch.cuda.is_available():
                    self.gpu = torch.cuda.get_device_name(0)
            except Exception:  # noqa: BLE001
                pass
        threading.Thread(target=self._worker, daemon=True).start()

    def status(self) -> dict:
        return {"ok": True, "app": "JustRigIt Capture", "version": __version__,
                "engine": "demo" if self.demo else "gemx", "ready": not self.demo,
                "demo": self.demo, "problems": self.problems, "gpu": self.gpu,
                "queue": sum(1 for j in self.jobs.values() if j.state in ("queued", "running")),
                "maxSecondsPerClip": 60, "appUi": app_html_path() is not None}

    def submit(self, data_path: Path, params: dict) -> Job:
        job = Job(data_path, params)
        self.jobs[job.id] = job
        self.q.put(job)
        self._gc()
        return job

    def _gc(self):
        cutoff = time.time() - 3 * 3600
        for jid, j in list(self.jobs.items()):
            if j.created < cutoff and j.state not in ("queued", "running"):
                shutil.rmtree(j.dir, ignore_errors=True)
                del self.jobs[jid]

    def _worker(self):
        while True:
            job = self.q.get()
            if job.state == "cancelled":
                continue
            job.state = "running"
            job.message = "Starting"
            py = sys.executable
            if py.lower().endswith("pythonw.exe") and os.path.isfile(py[:-5] + ".exe"):
                py = py[:-5] + ".exe"  # pythonw → python (no console window thanks to CREATE_NO_WINDOW)
            cmd = [py, "-m", "jrcapture", "capture", str(job.video),
                   "-o", str(job.dir / "result.glb"), "--bvh", str(job.dir / "result.bvh"), "--json-progress",
                   "--camera", job.params.get("camera", "static"), "--smoothing", job.params.get("smoothing", "light")]
            for k in ("start", "duration"):
                if job.params.get(k) not in (None, ""):
                    cmd += [f"--{k}", str(float(job.params[k]))]
            if str(job.params.get("fingers", "1")) in ("0", "false", "no"):
                cmd.append("--no-fingers")
            if self.demo:
                cmd.append("--demo")
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
            try:
                job.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                            encoding="utf-8", errors="replace", env=env,
                                            cwd=str(Path(__file__).resolve().parent.parent),
                                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                tail: list[str] = []
                for line in job.proc.stdout:  # type: ignore[union-attr]
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("{"):
                        try:
                            ev = json.loads(line)
                        except json.JSONDecodeError:
                            ev = None
                        if ev:
                            if ev.get("progress", -1) >= 0:
                                job.progress = max(job.progress, float(ev["progress"]))
                            if ev.get("message"):
                                job.message = ev["message"]
                            if "stats" in ev:
                                job.stats = ev["stats"]
                            if "error" in ev:
                                job.error = ev["error"]
                            continue
                    tail = (tail + [line])[-20:]
                code = job.proc.wait()
                if job.state == "cancelled":
                    continue
                if code == 0 and (job.dir / "result.glb").exists():
                    job.state, job.progress, job.message = "done", 1.0, "Done"
                else:
                    job.state = "error"
                    job.error = job.error or ("\n".join(tail[-8:]) or f"Capture process exited with code {code}")
                    job.message = "Capture failed"
            except Exception as e:  # noqa: BLE001
                job.state, job.error, job.message = "error", str(e), "Capture failed"

    def cancel(self, job: Job):
        if job.state in ("queued", "running"):
            job.state, job.message = "cancelled", "Cancelled"
            if job.proc and job.proc.poll() is None:
                job.proc.kill()


def make_handler(engine: Engine):
    allowed = set(engine.settings.get("allowed_origins") or [])

    class H(BaseHTTPRequestHandler):
        server_version = f"JustRigItCapture/{__version__}"

        def log_message(self, fmt, *args):  # quieter console
            if os.environ.get("JRCAPTURE_VERBOSE"):
                super().log_message(fmt, *args)

        def _touch(self):
            engine.last_seen = time.time()

        def _origin_ok(self) -> str | None:
            o = self.headers.get("Origin")
            if o is None:
                return "*"  # same-machine tools (curl, MCP server) send no Origin
            if LOCAL_ORIGIN.match(o) or o in allowed:
                return o
            return None

        def _send(self, code: int, body: bytes, ctype: str = "application/json", extra: dict | None = None):
            o = self._origin_ok()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if o:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj: dict):
            self._send(code, json.dumps(obj).encode())

        def do_OPTIONS(self):  # CORS preflight (+ Chrome's Private Network Access)
            o = self._origin_ok()
            self.send_response(204 if o else 403)
            if o:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self._touch()
            if self._origin_ok() is None:
                return self._json(403, {"error": "Origin not allowed. Add it to allowed_origins in settings.json."})
            u = urlparse(self.path)
            parts = [p for p in u.path.split("/") if p]
            if u.path in ("/", "/index.html", "/app"):
                page = app_html()
                if page and u.path != "/status":
                    return self._send(200, page, "text/html; charset=utf-8")
            if u.path in ("/", "/status"):
                return self._json(200, engine.status())
            if len(parts) >= 2 and parts[0] == "jobs":
                job = engine.jobs.get(parts[1])
                if not job:
                    return self._json(404, {"error": "No such job (the server may have restarted)."})
                if len(parts) == 2:
                    return self._json(200, job.view())
                if len(parts) == 3 and parts[2] in ("result.glb", "result.bvh") and job.state == "done":
                    f = job.dir / parts[2]
                    if f.exists():
                        stem = re.sub(r"[^A-Za-z0-9_-]+", "_", Path(job.params.get("filename") or "capture").stem) or "capture"
                        return self._send(200, f.read_bytes(), "model/gltf-binary" if f.suffix == ".glb" else "application/octet-stream",
                                          {"Content-Disposition": f'attachment; filename="{stem}{f.suffix}"'})
            return self._json(404, {"error": "Not found"})

        def do_POST(self):
            self._touch()
            if self._origin_ok() is None:
                return self._json(403, {"error": "Origin not allowed."})
            u = urlparse(self.path)
            parts = [p for p in u.path.split("/") if p]
            if u.path == "/capture":
                n = int(self.headers.get("Content-Length") or 0)
                if n <= 0:
                    return self._json(400, {"error": "Send the video file as the request body."})
                if n > MAX_UPLOAD:
                    return self._json(413, {"error": "That video is over 2 GB. Trim it first."})
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                name = Path(q.get("filename") or "video.mp4").name
                ext = Path(name).suffix.lower() or ".mp4"
                if ext not in (".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"):
                    return self._json(400, {"error": f"'{ext}' isn't a supported video type (mp4, mov, mkv, avi, webm)."})
                d = engine.work / uuid.uuid4().hex[:12]
                d.mkdir(parents=True)
                vid = d / f"input{ext}"
                with open(vid, "wb") as f:
                    left = n
                    while left > 0:
                        chunk = self.rfile.read(min(left, 1 << 20))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                q["filename"] = name
                job = engine.submit(vid, q)
                return self._json(202, job.view())
            if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel":
                job = engine.jobs.get(parts[1])
                if not job:
                    return self._json(404, {"error": "No such job."})
                engine.cancel(job)
                return self._json(200, job.view())
            return self._json(404, {"error": "Not found"})

    return H


def _own_app_path() -> Path:
    return Path(__file__).resolve().parents[2] / "dist" / "justrigit.html"


def _app_location_file() -> Path:
    from .config import home
    return home() / "app_location.txt"


def app_html_path() -> Path | None:
    """Where the JustRigIt web app is. When the engine was started by the Claude Desktop extension it
    runs from the extension's folder, so it falls back to the JustRigIt folder remembered from the
    last time Start-JustRigIt.bat ran."""
    cands = [os.environ.get("JUSTRIGIT_APP_HTML"), str(_own_app_path())]
    try:
        cands.append(_app_location_file().read_text(encoding="utf-8").strip())
    except OSError:
        pass
    for c in cands:
        if c and Path(c).is_file():
            return Path(c)
    return None


def remember_app_location() -> None:
    f = _own_app_path()
    if f.is_file():
        try:
            _app_location_file().parent.mkdir(parents=True, exist_ok=True)
            _app_location_file().write_text(str(f), encoding="utf-8")
        except OSError:
            pass


def app_html() -> bytes | None:
    """The JustRigIt web app (dist/justrigit.html), served so everything runs from one place."""
    f = app_html_path()
    try:
        return f.read_bytes() if f else None
    except OSError:
        return None


def _find_browser() -> list[str] | None:
    """Edge (always on Windows 11) or Chrome, for an app-style window without tabs/address bar."""
    cands = [shutil.which("msedge"), shutil.which("chrome")]
    for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if base:
            cands += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                      os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
    for c in cands:
        if c and os.path.isfile(c):
            return [c]
    return None


def open_app_window(url: str) -> None:
    exe = _find_browser()
    if exe:
        try:
            subprocess.Popen(exe + [f"--app={url}", "--window-size=1500,950"], close_fds=True)
            return
        except OSError:
            pass
    import webbrowser
    webbrowser.open(url)


def _running_status(port: int) -> dict | None:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1.5) as r:
            st = json.loads(r.read())
            return st if st.get("app") == "JustRigIt Capture" else None
    except Exception:  # noqa: BLE001
        return None


def _already_running(port: int) -> bool:
    return _running_status(port) is not None


def serve(port: int = DEFAULT_PORT, demo: bool = False, open_app: bool = False, exit_when_idle: float = 0):
    url = f"http://127.0.0.1:{port}/"
    remember_app_location()
    running = _running_status(port)
    if running:
        print(f"JustRigIt Capture is already running at {url}")
        if open_app:
            # An engine started by Claude (extension) may not know where the app is: open our own copy
            # as a file instead; it talks to the running engine the same way.
            if running.get("appUi") is False and _own_app_path().is_file():
                open_app_window(_own_app_path().as_uri())
            else:
                open_app_window(url)
        return
    engine = Engine(demo=demo)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(engine))
    if exit_when_idle > 0:
        def watchdog():
            while True:
                time.sleep(15)
                busy = any(j.state in ("queued", "running") for j in engine.jobs.values())
                if not busy and time.time() - engine.last_seen > exit_when_idle:
                    print("No activity — the JustRigIt window was closed. Stopping.")
                    httpd.shutdown()
                    return
        threading.Thread(target=watchdog, daemon=True).start()
    if open_app:
        threading.Timer(0.3, open_app_window, args=(url,)).start()
    st = engine.status()
    print(f"JustRigIt Capture {__version__} listening on http://127.0.0.1:{port}")
    if st["demo"]:
        print("  DEMO MODE — the GEM-X model isn't ready, captures return a sample walk.")
        for p in st["problems"]:
            print("   •", p)
    else:
        print(f"  Engine ready (NVIDIA GEM-X){' on ' + st['gpu'] if st['gpu'] else ''}.")
    print(f"  JustRigIt: {url}")
    print("  Leave this window open while you use JustRigIt. Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(engine.work, ignore_errors=True)
