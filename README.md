# JustRigIt

**Auto-rig, motion-capture from video and export game-ready characters for Unreal, Unity, Godot and Blender, locally.**

Film yourself on a phone, drop the video in, and get that motion on your character: rigged, cleaned up and named the
way your game engine expects. Everything runs on your own computer and GPU. No accounts, no uploads, no subscription.
JustRigIt is free software, and it stays free (see [License](#license)).

## Download
Go to **[Releases](https://github.com/SuddleMercury/justrigit/releases)** and download:
- **`justrigit-vX.Y.Z.zip`**: the app. Unzip it and double-click `Start-JustRigIt.bat`.
  For video capture, run `Install-Capture.bat` once (Windows 10/11 with an NVIDIA RTX GPU, about 10 GB).
- **`JustRigIt.mcpb`** *(optional)*: lets Claude use JustRigIt for you. Double-click it with Claude Desktop installed.

## What it does
1. **Auto-rig** — drop in a mesh with no skeleton, check 8 markers (chin, wrists, elbows, knees, groin),
   press *Rig it*. Builds a 55-bone Unreal-mannequin-style skeleton (fingers included) with heat-diffusion skin weights.
2. **Destination first** — pick the engine; naming, units, root bone and guide follow from it.
3. **Health check + one-click fixes** — scale/units, floor, facing, missing root bone, duplicate bones.
4. **Animations** — 26 built-in CC0 clips (idle, walk/run in 8 directions, jumps, crouch, wave) in packs,
   or drop any animation file (Mixamo, Quaternius, Unreal, Blender): it's retargeted onto your character.
   In-place or root motion per clip.
5. **Motion capture from video** *(new in 0.3)* — film yourself on a phone, drop the video in, get the
   animation on your character. NVIDIA GEM-X runs on your own GPU (body + fingers, world motion);
   planted feet are pinned with IK (**foot locking**). See [`capture/README.md`](capture/README.md).
6. **Engine-standard skeletons** *(new in 0.3)* — exports use the bone names each engine auto-maps:
   Unreal Mannequin (`pelvis`, `thigh_l` …), **Godot SkeletonProfileHumanoid** (`Hips`, `LeftUpperLeg` …)
   or **Mixamo** (`mixamorig:Hips` …) — automatic per destination, or pick one.
7. **Export** — zip with GLB + an import guide written for those exact files (incl. a full Unreal
   8-direction Blend Space walkthrough in Blueprints) + a replayable recipe.

## Quick start (Windows)
- **`Start-JustRigIt.bat`** — opens JustRigIt in its own window. The home screen is **Video to animation**
  (drop a video → pick a character → download for Unreal/Godot/Unity/Blender). The capture engine runs hidden
  and stops by itself after you close the window (log: `%LOCALAPPDATA%\JustRigIt\capture\engine.log`).
  Rigging, the animation library and health checks are under **Rig & animate (advanced)**.
- **`Install-Capture.bat`** — one-time setup for video motion capture (~8 GB of model files).
  `Install-Capture.bat -DemoOnly` sets up a 1-minute demo version first.

## Run the web app
- Open `dist/justrigit.html` in Chrome/Edge/Firefox — it's one self-contained file.
- To host it: upload that file to any web server as `index.html`. No backend needed.

## Let Claude use JustRigIt (MCP)
JustRigIt runs on your computer, and AI assistants drive it through MCP (Model Context Protocol). The AI calls
JustRigIt's tools: load, auto-rig, capture from video, add animations, look at the result, export. Your files and GPU
stay local.

**Easiest: Claude Desktop extension (no Node.js needed).** Double-click `dist/JustRigIt.mcpb` (or Claude Desktop →
Settings → Extensions → Install Extension…), choose an export folder and click Install. Claude Desktop runs it with
its own built-in Node.js. Claude sessions that are linked to this computer through the desktop app can use it too.

| Other clients | Setup (needs Node.js 18+ and `npm install` in this folder) |
|---|---|
| Claude Desktop (manual) | Settings → Developer → Edit Config: `{"mcpServers":{"justrigit":{"command":"node","args":["C:/path/to/justrigit/src/node/mcp-server.mjs"]}}}` |
| Claude Code | `claude mcp add justrigit -- node /path/to/justrigit/src/node/mcp-server.mjs` |
| ChatGPT (developer mode), claude.ai custom connector, OpenAI Responses API | Run remotely: `npm run mcp:http -- --public-url https://rig.your-domain.com`, reverse-proxy HTTPS to port 8787, connect to `https://rig.your-domain.com/mcp` |

What the local server does for an AI:
- **Finds your files.** `find_files` searches Desktop, Downloads, Videos, Documents and Pictures (OneDrive too).
  Paths may be typed loosely: quotes, `~`, `%USERPROFILE%`, `Desktop/clip.mp4`. A wrong path gets a "did you mean…".
- **Starts the capture engine itself** if it's installed but not running (no window; it stops after 30 min idle).
- **Long captures don't time out.** Claude Desktop stops waiting for a tool after a few minutes. `capture_video` returns
  after 40 s with `state: "running"` and a `job_id`, and the AI continues with `wait_for_capture` (progress
  notifications are sent too).
- **The AI can see the character.** `get_viewport_snapshot {clip, time, views}` renders front/side/¾/back pictures
  in software (no GPU or window needed).
- **Exports go to `Documents\JustRigIt Exports`** (the extension's export folder setting or `JUSTRIGIT_EXPORT_DIR`),
  never to the server's working folder.

Remote (HTTP) mode takes `url`/`base64` input and returns a download link; files go to `./exports`. One loaded
character per MCP session; idle sessions expire after 1 hour. **The HTTP server has no authentication yet.** Put it
behind your reverse proxy's auth, or keep the URL private.
Docker: `docker build -t justrigit . && docker run -p 8787:8787 -e JUSTRIGIT_PUBLIC_URL=https://rig.your-domain.com justrigit`

In the browser the same commands are exposed as `window.justrigit.call(name, args)` and, where the browser
supports it, registered with WebMCP (`navigator.modelContext`).

## Build & test
    npm install
    npm run build            # -> dist/justrigit.html
    node scripts/mcptest.mjs # MCP over stdio + HTTP
    node scripts/m2test.mjs  # rig + library + retarget + export, headless
    node scripts/namingtest.mjs     # Unreal / Godot / Mixamo bone naming on export (no assets needed)
    node scripts/capturetest.mjs    # video capture → retarget → export (needs: python -m jrcapture serve --demo)
    node scripts/mcpcapturetest.mjs # capture tools over MCP (same)
    node scripts/mcplocaltest.mjs   # local MCP: engine auto-start, find_files, paths, async capture, snapshots (engine stopped)
    npm run mcpb                    # -> dist/JustRigIt.mcpb (Claude Desktop extension)
    python capture/tests/test_capture.py   # capture engine maths, clean-up, GLB/BVH writers
Test scripts expect Mixamo test characters in `testassets/` (Xbot.glb, Soldier.glb, Samba.fbx from the
three.js repo). They are Adobe/Mixamo assets and are **not** included — never ship them in the product.

## Layout
- `src/core/` — the engine (no UI; runs in browser and Node)
  - `forge.js` command registry (every feature = named command + JSON schema; shared by UI, window API, WebMCP, MCP)
  - `autorig.js` markers → skeleton → heat-diffusion weights · `retarget.js` rest-pose-aligned retargeting + floor guard
  - `library.js` procedural CC0 animations & packs · `profiles.js` skeleton detection
  - `health.js` / `fixes.js` checks & fixes · `clips.js` in-place / root motion · `export.js` / `guides.js`
  - `naming.js` engine bone-naming standards (renames inside the exported GLB) · `capture.js` client for the capture engine
- `capture/` — **JustRigIt Capture**, the Python engine (NVIDIA GEM-X → clean SOMA animation), its local
  server, Windows installer and tests
- `src/ui/` — wizard, viewport (incl. front-view marker placement), Markdown renderer
- `src/ai/bridge.js` — `window.justrigit`, WebMCP, DOM manifest
- `src/node/` — `mcp-server.mjs` (stdio + Streamable HTTP) and `shims.js` (texture support in Node)

## Known limits (v0.3)
- Auto-rig: humanoids in T/A-pose facing the camera. It adds 3-joint fingers and a thumb on each hand
  (UE5 names: thumb_01_l … pinky_03_r). Finger placement works best on open, spread hands; mittens or fists get
  evenly spaced guesses. Captured finger motion is retargeted onto any rig with fingers (the practice mannequin,
  auto-rigged characters, Mixamo, UE5, Godot humanoid, Reallusion, Rigify).
- Library animations are procedural — good for prototyping and blockouts; use video capture or mocap files for production.
- Video capture: one person, max 60 s per capture, NVIDIA GPU on Windows. Hidden limbs are estimated.
- Export is GLB only (Unity needs the free glTFast package). Unreal 5 and Godot 4 import GLB natively.
- Fixed in 0.3: retargeted clips no longer snap back to their first frame on the last frame (travelling clips).

## License
JustRigIt is free software by **SuddleMercury**, released under the
**[GNU Affero General Public License v3.0 or later](LICENSE)** (AGPL-3.0-or-later).

In plain words (the [LICENSE](LICENSE) file is what legally counts):
- **Use it for anything**, including commercial games and films, for free.
- **What you make with it is yours.** Characters, animations and exported files you create are not covered by this
  licence.
- **Change it, improve it, share it.** Any changed version you share, or let people use over a network
  (for example as a website or an online service), must stay under this same licence, with its full source code
  available for free. Nobody can take JustRigIt, close it up and sell it back to people as a locked product or
  subscription.

Third-party components and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Credits
- Author: **[SuddleMercury](https://github.com/SuddleMercury)**
- Developed with **[Claude](https://claude.ai)** (Anthropic) as the development tool.
- Built on three.js, NVIDIA GEM-X and SOMA-X, and the other open-source projects listed in the notices.
