# JustRigIt Capture — video → game animation

Film yourself doing an action, drop the video into JustRigIt, get a game-ready animation on your
character for **Unreal, Godot, Unity or Blender**. Runs entirely on your own PC (NVIDIA GPU);
the video never leaves your computer.

```
your video ──► NVIDIA GEM-X (on your GPU) ──► clean-up ──► JustRigIt: retarget + foot locking ──► GLB for your engine
              body + fingers, world motion    floor, facing,   any humanoid character        Unreal / Godot / Mixamo
              contact-aware IK                smoothing,                                     bone names
                                              foot contacts
```

## Install (once)

1. Double-click **`Install-Capture.bat`** in the JustRigIt folder.
   It installs Python 3.12 and ffmpeg if needed (via winget), PyTorch with CUDA, NVIDIA GEM-X
   (pinned, tested version) and downloads the model files (~8 GB). It ends with a self test.
   Safe to run again — it skips what's done and resumes after an interrupted download.
2. Just want to try the workflow first? `Install-Capture.bat -DemoOnly` takes a minute; captures
   then return a sample walk until you install the real model.

**Needs:** Windows 10/11, NVIDIA RTX GPU with 8 GB+ VRAM (12 GB recommended), ~15 GB disk.

## Use

1. Double-click **`Start-JustRigIt.bat`** — JustRigIt opens in its own window with the capture engine
   running hidden in the background (it stops by itself ~15 minutes after you close the window).
2. **① Your video:** drop the video, say how it was filmed, press **Turn it into an animation**.
3. **② Your character:** keep the mannequin or pick your own GLB/FBX (no skeleton? it adds one).
4. **③ Download:** pick Unreal / Godot / Unity / Blender and download. Short import steps are shown right there.

`Start-Capture.bat` runs the engine in a visible console instead (handy for troubleshooting).

AI assistants can do the same through MCP: `capture_status` → `capture_video {path}`.

## Filming tips

- Camera on a tripod (or propped up). Whole body in view the entire time, feet included.
- Good, even light; 1080p at 30–60 fps; fitted clothes that contrast with the background.
- Stand still for a second at the start and end. One person in the shot.
- Side-on for walks, ~45° for fighting moves. One action per clip, max 60 s per capture
  (use Start/Length for longer videos).

## Command line

All from the JustRigIt `capture` folder, with the engine's Python
(`%LOCALAPPDATA%\JustRigIt\capture\venv\Scripts\python.exe`):

| Command | What it does |
|---|---|
| `python -m jrcapture serve` | the local server JustRigIt talks to (`http://127.0.0.1:8790`) |
| `python -m jrcapture capture my.mp4 -o my.glb --bvh my.bvh` | video → animation on the SOMA skeleton |
| `python -m jrcapture convert result.pt -o my.glb` | convert an existing `gem-infer motion-video` result |
| `python -m jrcapture demo -o walk.glb` | sample walk, no GPU |
| `python -m jrcapture selftest [--video short.mp4]` | check the install (optionally a real 5 s capture) |

Options for `capture`: `--camera static|background|vipe`, `--start S`, `--duration S`,
`--smoothing off|light|medium|strong`, `--no-fingers`, `--keep-facing`, `--keep-position`.

## Output format

GLB (glTF 2.0) with NVIDIA's 78-joint **SOMA** skeleton (body, all fingers, toes), a simple
stick-figure mesh, one animation at 30 fps. Meters, +Y up, the performer faces +Z at the start,
floor at y = 0, travel on `Hips`. Per-frame foot contacts and capture stats are stored in the
animation's `extras.jrcapture` (JustRigIt reads them for foot locking). BVH is also available.

## How it works

1. **GEM-X** (`gem.inference.body_video.run_body_video`): normalises the clip to 30 fps, tracks the
   largest person (YOLOX + ByteTrack), detects 77 SOMA keypoints, estimates camera rotation, extracts
   body-pose features and predicts temporal SOMA parameters (pose, identity, world translation) plus
   six contact logits. GEM-X's own contact/IK post-process then plants feet and aligns the ground.
2. **SOMA forward kinematics** turns the parameters into world-space joint transforms for every frame
   and for the T-pose.
3. **Clean-up** (`jrcapture/motion.py`): unit detection (cm/m), snap to the gravity axis, turn to face
   +Z, local rotations from world transforms (exact rebuild — the self test checks the error is ~0),
   floor at 0, start at origin, zero-lag One Euro smoothing (lighter on fingers), foot contacts from
   GEM-X's logits cross-checked with foot height and speed.
4. **JustRigIt** retargets onto the character (rest-pose aligned, fingers included when both rigs have
   them) and pins planted feet with analytic two-bone IK.

## Licences

| Component | Licence | Commercial use |
|---|---|---|
| JustRigIt Capture code (`jrcapture/`) | AGPL-3.0-or-later (same as JustRigIt) | yes |
| NVIDIA GEM-X code | Apache 2.0 (some files OpenMDW-1.1) | yes |
| GEM-X model weights | NVIDIA Open Model License (model card) — see note | yes |
| SOMA-X body model + assets | Apache 2.0 | yes |
| YOLOX HumanArt detector (OpenMMLab) | Apache 2.0 (check dataset terms) | yes |
| PyTorch, ffmpeg (LGPL build via winget) | BSD / LGPL | yes |

Note: GEM-X's Hugging Face card says the weights are under the NVIDIA Open Model License while the
repo's LICENSE file says Apache 2.0 (open question: github.com/NVlabs/GEM-X/issues/32). Both allow
commercial use; NVIDIA does not claim ownership of outputs. No SMPL/SMPL-X (non-commercial) files are
used anywhere in this pipeline. Users must have consent to process video of other people.
