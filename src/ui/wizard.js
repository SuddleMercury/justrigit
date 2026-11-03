// Capture wizard — the video-first home screen.
//   ① Your video  →  ② Your character  →  ③ Download
// Plain language only; everything technical lives under "More options".
// Uses the same Forge commands as the advanced 5-step flow and AI agents.
import { TARGETS } from '../core/targets.js';
import { NAMINGS } from '../core/naming.js';
import { CAPTURE_TIPS } from '../core/capture.js';

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|avi|webm)$/i;
const SMOOTH = [['off', 'Raw (no smoothing)'], ['light', 'Natural (recommended)'], ['medium', 'Smooth'], ['strong', 'Extra smooth']];
const ENGINES = [
  ['ue5', 'Unreal Engine 5', 'U'], ['godot', 'Godot 4', 'G'], ['unity', 'Unity', 'Un'], ['blender', 'Blender', 'B'],
];
const NAMING_PLAIN = {
  auto: 'Automatic (recommended)', ue5: 'Unreal Mannequin names', mixamo: 'Mixamo names', godot: 'Godot humanoid names', keep: 'Keep my character\'s names',
};
const WHAT_NOW = {
  ue5: ['Unzip the download.', 'In Unreal, drag the <b>SK_…glb</b> file into the Content Browser.', 'In the import window, leave <b>Skeleton</b> on <b>None</b> and click <b>Import</b>.', 'Double-click the <b>A_…</b> animation to watch it.'],
  ue4: ['Enable <b>Edit → Plugins → glTF Importer</b> once and restart Unreal.', 'Unzip the download and drag the <b>SK_…glb</b> into the Content Browser.', 'Click <b>Import</b>, then double-click the <b>A_…</b> animation.'],
  godot: ['Unzip the download.', 'Copy the <b>.glb</b> file into your Godot project folder.', 'Double-click it in the FileSystem dock and press ▶ on an animation.'],
  unity: ['Install <b>glTFast</b> once (Window → Package Manager).', 'Unzip and drag the <b>.glb</b> into your Assets folder.', 'Select it → <b>Rig</b> → Animation Type <b>Humanoid</b> → Apply.'],
  blender: ['Unzip the download.', 'In Blender: <b>File → Import → glTF 2.0</b> and pick the .glb.', 'Press Space to play the animation.'],
};

export function createWizard(ctx) {
  const { forge, run, toast, busy, esc, renderMarkdown } = ctx;
  const w = {
    step: 'video', file: null, url: null, seconds: null, camera: 'static', smoothing: 'light', fingers: true,
    start: '', duration: '', status: null, running: null, motion: 'inplace', naming: 'auto', split: false,
    lastDownload: null, guideOpen: false,
  };

  const st = () => forge.status();
  const isDemoChar = (s) => !!(s.character && /^Demo_Mannequin/i.test(s.character.source || ''));
  const captureClips = (s) => s.clips.filter((c) => forge.captures.some((cp) => cp.clipName === c.name));
  const fmt = (x) => (x == null ? '' : `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`);

  async function ensureCharacter() {
    if (!forge.doc) {
      await forge.call('load_character', { demo: true }, 'you');
      if (forge.target !== 'ue5') await forge.call('set_target', { engine: 'ue5' }, 'you');
    }
  }

  async function refreshStatus() {
    w.status = await forge.call('capture_status', {}, 'you').catch(() => ({ online: false }));
    ctx.render();
  }

  // ---------------------------------------------------------------- views
  function stepsBar() {
    const s = st();
    const have = forge.captures.length > 0;
    const items = [['video', 'Your video'], ['character', 'Your character'], ['download', 'Download']];
    const idx = items.findIndex(([id]) => id === w.step);
    return `<ol class="wzsteps">${items.map(([id, label], i) => {
      const enabled = id === 'video' || have;
      return `<li><button class="${w.step === id ? 'on' : ''} ${i < idx || (id !== 'video' && have && i < idx) ? 'done' : ''}" data-wstep="${id}" ${enabled ? '' : 'disabled'}>
        <span>${i < idx ? '✓' : i + 1}</span>${label}</button></li>`;
    }).join('')}</ol>${s.character ? '' : ''}`;
  }

  function engineLine() {
    const s = w.status;
    if (!s) return `<div class="wzeng"><span class="capdot"></span>Checking the capture engine…</div>`;
    if (!s.online) {
      return `<div class="wzeng off"><span class="capdot off"></span><div><b>The capture engine isn't running.</b><br>
        Close this window and open JustRigIt with <b>Start-JustRigIt.bat</b>. First time? Run <b>Install-Capture.bat</b> once.
        <br><a href="#" data-act="recheck">Check again</a></div></div>`;
    }
    if (s.demo) {
      return `<div class="wzeng demo"><span class="capdot demo"></span><div><b>Practice mode.</b> The AI model isn't installed yet, so you'll get a sample walk.
        Run <b>Install-Capture.bat</b> for real captures.</div></div>`;
    }
    return `<div class="wzeng on"><span class="capdot on"></span><div><b>Ready.</b> Runs on your ${esc(s.gpu || 'graphics card')} — your video never leaves this computer.</div></div>`;
  }

  function progressCard() {
    const r = w.running;
    const pct = Math.round(Math.max(0, Math.min(1, r.p || 0)) * 100);
    return `<div class="wzprog">
      <div class="spin"></div>
      <b id="wzmsg">${esc(r.msg || 'Working…')}</b>
      <div class="bar"><i id="wzbar" style="width:${pct}%"></i></div>
      <small><span id="wzpct">${pct}%</span> · The first capture takes 1–3 minutes while the AI loads. Keep this window open.</small>
    </div>`;
  }

  function viewVideo() {
    const s = st();
    const ready = w.status && w.status.online;
    const long = w.seconds && w.seconds > 60 && !w.duration;
    const caps = captureClips(s);
    const fileBox = w.file ? `
      <div class="wzfile">
        ${w.url ? `<video src="${w.url}" muted playsinline controls preload="metadata"></video>` : ''}
        <div class="row"><b>🎞 ${esc(w.file.name)}</b><span class="muted small">${w.seconds ? fmt(w.seconds) : ''}</span></div>
        <label class="link small"><input type="file" id="wzvid" accept="video/*,.mp4,.mov,.m4v,.mkv,.avi,.webm" hidden>Choose a different video</label>
      </div>
      ${long ? `<div class="wznote">Your video is ${fmt(w.seconds)} long. One capture can be up to 60 seconds, so we'll use the first minute. To pick a different part, open <b>More options</b>.</div>` : ''}`
      : `<label class="wzdrop">
          <input type="file" id="wzvid" accept="video/*,.mp4,.mov,.m4v,.mkv,.avi,.webm" hidden>
          <div class="big">🎥</div>
          <b>Drop your video here</b>
          <span>or click to choose a file</span>
          <small>A phone video (MP4 or MOV) is perfect · one person · whole body in view</small>
        </label>`;
    return `
      <h2>Turn a video into an animation</h2>
      <p class="lead">Film yourself doing a move, drop the video here, and get a game-ready animation.</p>
      ${engineLine()}
      ${w.running ? progressCard() : `
        ${fileBox}
        ${w.file ? `
          <div class="wzq">How did you film it?</div>
          <div class="seg">
            <button class="${w.camera === 'static' ? 'on' : ''}" data-cam="static"><b>📱 Phone on a stand</b><small>Tripod, shelf, propped up. <em>Best results.</em></small></button>
            <button class="${w.camera === 'background' ? 'on' : ''}" data-cam="background"><b>🤳 Someone held it</b><small>The camera moved a little.</small></button>
          </div>
          <details class="wzmore"><summary>More options</summary>
            <div class="row3">
              <label class="field small">Start at (seconds)<input id="wzstart" type="number" min="0" step="0.1" value="${esc(w.start)}" placeholder="0"></label>
              <label class="field small">Length (seconds)<input id="wzdur" type="number" min="1" max="60" step="0.1" value="${esc(w.duration)}" placeholder="${w.seconds ? Math.min(60, w.seconds).toFixed(1) : 'whole video'}"></label>
              <label class="field small">Smoothness<select id="wzsmooth">${SMOOTH.map(([v, l]) => `<option value="${v}" ${w.smoothing === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            </div>
            <label class="check"><input type="checkbox" id="wzfingers" ${w.fingers ? 'checked' : ''}> Capture finger movement</label>
            <label class="check"><input type="checkbox" id="wzfollow" ${w.camera === 'vipe' ? 'checked' : ''}> The camera followed me around <span class="muted">(needs the optional ViPE add-on)</span></label>
          </details>
          <button class="btn primary wide big" data-act="capture" ${ready ? '' : 'disabled'}>${!ready ? 'Start the capture engine first' : w.status.demo ? '✨ Try it (practice mode)' : '✨ Turn it into an animation'}</button>` : ''}
        <details class="help"><summary>How to film for the best result</summary><ul>${CAPTURE_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>
        ${caps.length ? `
          <h3 class="sub">Your animations <span class="tag">${caps.length}</span></h3>
          ${clipList(caps, false)}
          <div class="nav"><button class="btn primary" data-wstep="character">Next: choose a character →</button></div>` : ''}`}`;
  }

  function clipList(clips, editable) {
    return `<ul class="clips">${clips.map((c) => `
      <li class="${forge.playing === c.name ? 'playing' : ''}">
        <button class="play" data-play="${esc(c.name)}" title="Play">${forge.playing === c.name ? '■' : '▶'}</button>
        ${editable ? `<input class="cname" value="${esc(c.name)}" data-rename="${esc(c.name)}" spellcheck="false" aria-label="Animation name">` : `<span class="cname">${esc(c.name)}</span>`}
        <span class="dur">${c.duration.toFixed(1)}s</span>
        ${editable ? `<button class="x" data-remove="${esc(c.name)}" title="Remove">×</button>` : ''}
      </li>`).join('')}</ul>`;
  }

  function viewCharacter() {
    const s = st();
    const demo = isDemoChar(s);
    const caps = captureClips(s);
    const who = s.character ? (demo ? 'the practice mannequin' : `<b>${esc(s.character.name)}</b>`) : 'the mannequin';
    const rigBox = s.needsRig ? `
      <div class="wznote warn">
        <b>${esc(s.character.name)} has no skeleton yet.</b> A skeleton is the set of invisible "bones" that animations move.
        JustRigIt can add one automatically.
        <button class="btn primary wide" data-act="autorig">🦴 Add a skeleton automatically</button>
        <a href="#" data-act="manual-rig" class="small">I'd rather place the joints myself (advanced)</a>
      </div>` : '';
    return `
      <h2>Pick the character</h2>
      <p class="lead">${s.needsRig ? 'Almost there.' : `Your animation is playing on ${who}.`} Keep it, or put the animation on your own character.</p>
      <div class="wzchoice">
        <button class="wzcard ${demo ? 'sel' : ''}" data-act="use-mannequin"><b>🧍 Use the mannequin</b><small>Good for testing, or if you'll move the animation onto a character inside your engine.</small></button>
        <label class="wzcard ${!demo && s.character ? 'sel' : ''}"><input type="file" id="wzchar" accept=".glb,.gltf,.fbx" hidden>
          <b>🧙 Use my own character</b><small>${!demo && s.character ? `Using ${esc(s.character.name)} — click to pick another.` : 'A GLB or FBX file. No skeleton? We\'ll add one.'}</small></label>
      </div>
      ${rigBox}
      ${caps.length && !s.needsRig ? `<h3 class="sub">Your animations <span class="tag">${caps.length}</span></h3>${clipList(caps, true)}
        <p class="muted small">Click a name to rename it — that's the name you'll see in your game engine.</p>` : ''}
      <button class="btn ghost wide" data-act="another">＋ Capture another video</button>
      <div class="nav split"><button class="btn" data-wstep="video">← Back</button>
        <button class="btn primary" data-wstep="download" ${s.needsRig || !caps.length ? 'disabled' : ''}>Next: download →</button></div>`;
  }

  function viewDownload() {
    const s = st();
    const t = TARGETS[s.target];
    const caps = captureClips(s);
    const anyMoves = caps.some((c) => c.moves);
    const done = w.lastDownload;
    return `
      <h2>Download for your game</h2>
      <div class="wzq">Where will you use it?</div>
      <div class="wztiles">${ENGINES.map(([id, label, ic]) => `
        <button class="wztile ${s.target === id ? 'sel' : ''}" data-wtarget="${id}"><span class="ic">${ic}</span>${label}</button>`).join('')}</div>
      ${anyMoves ? `
        <div class="wzq">Your animation travels across the floor. How should that work in the game?</div>
        <div class="seg">
          <button class="${w.motion === 'inplace' ? 'on' : ''}" data-wmotion="inplace"><b>Stays in place</b><small>Your game moves the character. <em>Best for walking and running loops.</em></small></button>
          <button class="${w.motion === 'rootmotion' ? 'on' : ''}" data-wmotion="rootmotion"><b>Moves like in the video</b><small>The animation carries the character. Best for attacks, dodges, cutscenes.</small></button>
        </div>` : ''}
      <details class="wzmore"><summary>More options</summary>
        <label class="field">File name<input id="wzname" value="${esc(s.options.baseName)}" spellcheck="false"></label>
        <label class="field">Bone names<select id="wznaming">${Object.entries(NAMING_PLAIN).map(([id, l]) => `<option value="${id}" ${w.naming === id ? 'selected' : ''}>${l}${id === 'auto' && s.boneNaming ? ' — ' + NAMINGS[s.boneNaming.effective].label : ''}</option>`).join('')}</select></label>
        <p class="muted small">Engines recognise a character by its bone names. "Automatic" uses the names your engine knows, so its retargeting tools work right away.</p>
        <label class="check"><input type="checkbox" id="wzsplit" ${w.split ? 'checked' : ''}> One file per animation</label>
        <label class="check"><input type="checkbox" id="wzue4" ${s.target === 'ue4' ? 'checked' : ''}> I use Unreal Engine 4</label>
      </details>
      <button class="btn primary wide big" data-act="download">⬇ Download for ${esc(t.label)}</button>
      ${done ? `<div class="card ok wzdone"><b>✓ Downloaded ${esc(done.filename)}</b>
          <ol>${(WHAT_NOW[done.target] || []).map((x) => `<li>${x}</li>`).join('')}</ol>
          <details ${w.guideOpen ? 'open' : ''} id="wzguide"><summary>Full step-by-step guide</summary><div class="md">${renderMarkdown(done.guide)}</div></details>
        </div>` : ''}
      <div class="nav split"><button class="btn" data-wstep="character">← Back</button><button class="btn ghost" data-act="another">＋ Capture another video</button></div>`;
  }

  function render() {
    const body = w.step === 'character' ? viewCharacter() : w.step === 'download' ? viewDownload() : viewVideo();
    return `<div class="wz">${stepsBar()}${body}</div>`;
  }

  // ---------------------------------------------------------------- behaviour
  function pickVideo(file) {
    if (w.url) URL.revokeObjectURL(w.url);
    w.file = file; w.seconds = null; w.start = ''; w.duration = '';
    w.url = URL.createObjectURL(file);
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { w.seconds = isFinite(v.duration) ? v.duration : null; ctx.render(); };
      v.src = w.url;
    } catch { /* length is a nicety */ }
    w.step = 'video';
    ctx.render();
  }

  async function doCapture() {
    if (!w.file) return;
    await ensureCharacter();
    const duration = w.duration !== '' ? +w.duration : (w.seconds && w.seconds > 60 ? 60 : undefined);
    const args = {
      buffer: await w.file.arrayBuffer(), filename: w.file.name, camera: w.camera, smoothing: w.smoothing, fingers: w.fingers,
      start: w.start !== '' ? +w.start : undefined, duration,
    };
    w.running = { p: 0, msg: 'Sending the video to the capture engine…' };
    ctx.render();
    const off = forge.on((type, d) => {
      if (type !== 'capture-progress' || !w.running) return;
      w.running = { p: d.progress >= 0 ? d.progress : w.running.p, msg: d.message || w.running.msg };
      const m = document.getElementById('wzmsg'), b = document.getElementById('wzbar'), p = document.getElementById('wzpct');
      const pct = Math.round(Math.max(0, Math.min(1, w.running.p)) * 100);
      if (m) m.textContent = w.running.msg;
      if (b) b.style.width = pct + '%';
      if (p) p.textContent = pct + '%';
    });
    try {
      const r = await forge.call('capture_video', args, 'you');
      w.running = null;
      w.step = 'character';
      w.lastDownload = null;
      toast(r.demo ? 'Practice capture done — this is a sample walk.' : `Done! "${r.clip}" is ready${r.footLock ? ` — foot sliding cut from ${r.footLock.skateBeforeCm} to ${r.footLock.skateAfterCm} cm` : ''}.`, r.demo ? 'warn' : 'ok');
      if (r.clip) await forge.call('play_clip', { name: r.clip }, 'you');
    } catch (e) {
      w.running = null;
      toast(friendly(e.message), 'error');
    } finally {
      off();
      ctx.render();
    }
  }

  function friendly(m) {
    if (/not running/i.test(m)) return 'The capture engine stopped. Close this window and open JustRigIt again with Start-JustRigIt.bat.';
    return m;
  }

  async function loadCharacter(file) {
    busy('Loading ' + file.name + '…');
    try {
      await run('load_character', { buffer: await file.arrayBuffer(), filename: file.name });
      if (!forge.status().needsRig) await moveCaptures();
    } finally { busy(null); ctx.render(); }
  }

  async function moveCaptures() {
    if (!forge.captures.length) return;
    busy('Moving your animations onto the character…');
    try {
      const r = await run('reapply_captures');
      if (r.added && r.added.length) {
        toast(`Your animations are now on ${forge.doc.baseName}.`);
        await forge.call('play_clip', { name: r.added[r.added.length - 1] }, 'you');
      }
    } finally { busy(null); }
  }

  async function onAction(act, el, e) {
    switch (act) {
      case 'recheck': e && e.preventDefault(); w.status = null; ctx.render(); refreshStatus(); return true;
      case 'capture': await doCapture(); return true;
      case 'another': w.step = 'video'; w.file = null; ctx.render(); return true;
      case 'use-mannequin':
        if (!isDemoChar(st())) {
          busy('Loading the mannequin…');
          try { await run('load_character', { demo: true }); await moveCaptures(); } finally { busy(null); }
        }
        ctx.render(); return true;
      case 'autorig':
        busy('Adding a skeleton…');
        try {
          await run('auto_place_markers');
          const r = await run('auto_rig');
          toast(r.message);
          await moveCaptures();
        } finally { busy(null); ctx.render(); }
        return true;
      case 'manual-rig': e && e.preventDefault(); ctx.setMode('advanced'); return true;
      case 'download': {
        const s = st();
        busy('Building your download…');
        try {
          if (s.target === 'ue5' || s.target === 'ue4') { try { await forge.call('apply_fix', { fix: 'all' }, 'you'); } catch { /* nothing to fix */ } }
          await run('set_export_options', { motion: w.motion, bone_naming: w.naming, split_clips: w.split });
          const r = await run('export_bundle', { deliver: 'download' });
          if (r.delivered === 'declined') toast('Download cancelled.', 'warn');
          else w.lastDownload = { filename: r.filename, guide: r.guide_markdown, target: forge.target };
        } finally { busy(null); ctx.render(); }
        return true;
      }
      default: return false;
    }
  }

  async function onClick(el, e) {
    const d = el.dataset;
    if (d.act) return onAction(d.act, el, e);
    if (d.wstep) { if (!el.disabled) { w.step = d.wstep; ctx.render(); } return true; }
    if (d.cam) { w.camera = d.cam; ctx.render(); return true; }
    if (d.wmotion) { w.motion = d.wmotion; ctx.render(); return true; }
    if (d.wtarget) {
      await run('set_target', { engine: d.wtarget });
      w.lastDownload = null; ctx.render(); return true;
    }
    return false;
  }

  function wire(p) {
    const vid = p.querySelector('#wzvid');
    if (vid) vid.onchange = () => vid.files[0] && pickVideo(vid.files[0]);
    const ch = p.querySelector('#wzchar');
    if (ch) ch.onchange = () => ch.files[0] && loadCharacter(ch.files[0]);
    const bind = (id, fn) => { const el = p.querySelector(id); if (el) el.onchange = () => fn(el); };
    bind('#wzstart', (el) => { w.start = el.value; ctx.render(); });
    bind('#wzdur', (el) => { w.duration = el.value; ctx.render(); });
    bind('#wzsmooth', (el) => { w.smoothing = el.value; });
    bind('#wzfingers', (el) => { w.fingers = el.checked; });
    bind('#wzfollow', (el) => { w.camera = el.checked ? 'vipe' : 'static'; ctx.render(); });
    bind('#wzname', (el) => run('set_export_options', { base_name: el.value }));
    bind('#wznaming', (el) => { w.naming = el.value; run('set_export_options', { bone_naming: el.value }).then(() => ctx.render()); });
    bind('#wzsplit', (el) => { w.split = el.checked; });
    bind('#wzue4', (el) => run('set_target', { engine: el.checked ? 'ue4' : 'ue5' }).then(() => { w.lastDownload = null; ctx.render(); }));
    const g = p.querySelector('#wzguide');
    if (g) g.ontoggle = () => { w.guideOpen = g.open; };
    p.querySelectorAll('[data-rename]').forEach((inp) => {
      inp.onkeydown = (ev) => { if (ev.key === 'Enter') inp.blur(); };
      inp.onchange = () => { if (inp.value && inp.value !== inp.dataset.rename) run('update_clip', { name: inp.dataset.rename, new_name: inp.value }); };
    });
    if (!w.status) refreshStatus();
  }

  function onDrop(file) {
    if (VIDEO_EXT.test(file.name) || (file.type || '').startsWith('video/')) { pickVideo(file); return true; }
    if (/\.(glb|gltf|fbx)$/i.test(file.name)) { w.step = 'character'; loadCharacter(file); return true; }
    return false;
  }

  async function enter() {
    await ensureCharacter();
    // Came back from advanced mode after rigging by hand: move captures onto the character.
    const s = st();
    if (forge.captures.length && s.character && !s.needsRig && forge.captures.some((cp) => !s.clips.some((c) => c.name === cp.clipName))) {
      await moveCaptures();
    }
  }

  return { render, wire, onClick, onDrop, enter, state: w, refreshStatus };
}
