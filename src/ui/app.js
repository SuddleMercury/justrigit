import { Forge, VERSION } from '../core/forge.js';
import { TARGETS } from '../core/targets.js';
import { GLOSSARY } from '../core/glossary.js';
import { Viewport } from './viewport.js';
import { installBridge, AGENT_PROMPT } from '../ai/bridge.js';
import { renderMarkdown } from './markdown.js';
import { MARKERS, MARKER_LABELS, MIRROR } from '../core/autorig.js';
import { catalog, PACKS } from '../core/library.js';
import { NAMINGS } from '../core/naming.js';
import { CAPTURE_TIPS } from '../core/capture.js';
import { createWizard } from './wizard.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (id, label) => `<span class="term" data-term="${id}" tabindex="0">${esc(label || GLOSSARY[id]?.term || id)}</span>`;

const STEPS = [
  { id: 'character', n: 1, label: 'Character', hint: 'Load a model' },
  { id: 'target', n: 2, label: 'Destination', hint: 'Where is it going?' },
  { id: 'check', n: 3, label: 'Health check', hint: 'Find & fix problems' },
  { id: 'animations', n: 4, label: 'Animations', hint: 'Preview & choose' },
  { id: 'export', n: 5, label: 'Export', hint: 'Download + guide' },
];

const forge = new Forge();
let viewport;
let aiStatus = { webmcp: false };
let lastExport = null;
let downloadsCap = null;
let libTab = 'packs', libCat = 'All', symmetric = true;
// video capture form state
const cap = { file: null, seconds: null, camera: 'static', smoothing: 'light', fingers: true, start: '', duration: '', status: null };
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|avi|webm)$/i;
const LIB = catalog();
// Two modes: 'capture' = the video-first wizard (home), 'advanced' = the classic 5-step rigging flow.
let mode = 'capture';
try { mode = localStorage.getItem('jri.mode') || 'capture'; } catch { /* storage unavailable */ }
let wizard = null;

// ---------- delivery (download) ----------
function initDownloads() {
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('downloads').then((d) => { downloadsCap = d; }).catch(() => {});
    }
  } catch { /* not in Claude */ }
}
forge.hooks.deliver = async (filename, bytes) => {
  if (downloadsCap) {
    try {
      const r = await downloadsCap.save({ filename, data: new Blob([bytes], { type: 'application/zip' }) });
      return r.status;
    } catch (e) {
      if (e && e.code === 'declined') return 'declined';
      toast('Download unavailable here: ' + (e?.message || e?.code || e), 'warn');
      return 'failed';
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
};

// ---------- helpers ----------
async function run(name, args = {}) {
  try {
    const r = await forge.call(name, args, 'you');
    return r;
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}
const sevIcon = { ok: '✓', info: 'i', warn: '!', error: '✕' };

// ---------- render ----------
function renderStepper() {
  const s = forge.status();
  const done = {
    character: !!s.character,
    target: !!s.character && forge.step !== 'target' && forge.step !== 'character',
    check: !!s.character && s.health && s.health.error === 0 && s.health.warn === 0,
    animations: !!s.character && ['export'].includes(forge.step),
    export: !!lastExport,
  };
  $('#stepper').innerHTML = STEPS.map((st) => {
    const locked = st.id !== 'character' && (!s.character || s.needsRig);
    let badge = '';
    if (st.id === 'check' && s.health) {
      if (s.health.error) badge = `<span class="pill error">${s.health.error}</span>`;
      else if (s.health.warn) badge = `<span class="pill warn">${s.health.warn}</span>`;
    }
    return `<button class="step ${forge.step === st.id ? 'active' : ''} ${done[st.id] ? 'done' : ''}" data-step="${st.id}" ${locked ? 'disabled' : ''}>
      <span class="num">${done[st.id] ? '✓' : st.n}</span>
      <span class="txt"><b>${st.label}</b><small>${st.hint}</small></span>${badge}
    </button>`;
  }).join('');
}

function nextBtn(step, label) {
  return `<div class="nav"><button class="btn primary" data-goto="${step}">${label} →</button></div>`;
}

const MARKER_TIPS = {
  chin: 'Bottom of the chin, on the centre line.',
  groin: 'Where the legs meet the body.',
  leftWrist: 'Where the hand meets the arm.', rightWrist: 'Where the hand meets the arm.',
  leftElbow: 'The middle of the elbow joint.', rightElbow: 'The middle of the elbow joint.',
  leftKnee: 'The middle of the knee joint.', rightKnee: 'The middle of the knee joint.',
};
const markerClass = (k) => (k.startsWith('left') ? 'L' : k.startsWith('right') ? 'R' : 'C');

function panelRig(s) {
  return `
  <h2>Step 1 · Auto-rig “${esc(s.character.name)}”</h2>
  <p class="lead">This model has no ${T('skeleton', 'skeleton')} yet. Drag the 8 circles onto the matching spots — we've guessed them already, so usually only small nudges are needed. Then press <b>Rig it</b>.</p>
  <div class="card">
    <b>Is the character facing you?</b>
    <p class="muted small" style="margin:4px 0 8px">It should look straight out of the screen. If you see its back or side, turn it:</p>
    <div class="row3"><button class="btn small" data-rotate="90">↺ 90°</button><button class="btn small" data-rotate="180">180°</button><button class="btn small" data-rotate="-90">↻ 90°</button></div>
  </div>
  <ul class="markers-list">${MARKERS.map((k) => `<li><span class="mdot ${markerClass(k)}"></span><b>${MARKER_LABELS[k]}</b><small>${MARKER_TIPS[k]}</small></li>`).join('')}</ul>
  <p class="muted small">Tip: the character faces you, so <b>its left side is on your right</b> — exactly like looking at a person.</p>
  <label class="check"><input type="checkbox" id="sym" ${symmetric ? 'checked' : ''}> Symmetry — moving one side moves the other</label>
  <button class="btn ghost wide" data-action="auto-markers">Re-guess markers</button>
  <button class="btn primary wide big" data-action="rig">Rig it!</button>
  <details class="help"><summary>What happens when I press "Rig it"?</summary>
    <p>JustRigIt builds a 25-bone skeleton named like Unreal's Manny/Quinn (root, pelvis, spine_01–05, neck_01, head, clavicles, arms, legs, feet), then calculates ${T('skinning', 'skin weights')} with <b>heat diffusion</b> — the same technique as Blender's "Automatic Weights". Takes a few seconds; nothing leaves your computer.</p>
  </details>`;
}

function panelCharacter(s) {
  if (s.needsRig) return panelRig(s);
  const c = s.character;
  return `
  <h2>Step 1 · Your character</h2>
  <p class="lead">Drop in a 3D character that already has a ${T('skeleton', 'skeleton')}. Everything stays on your computer — nothing is uploaded.</p>
  <label class="drop" id="drop">
    <input type="file" id="file" accept=".glb,.gltf,.fbx" hidden>
    <div class="drop-icon">⬇</div>
    <b>Drop a character here</b> or <u>browse</u>
    <small>Rigged or not — we'll add a skeleton if it needs one</small>
    <small>${T('glb', 'GLB')} · glTF · ${T('fbx', 'FBX')}</small>
  </label>
  <button class="btn ghost wide" data-action="demo">Use the built-in demo mannequin</button>
  ${c ? `<div class="card loaded">
      <div class="row"><b>${esc(c.source)}</b><span class="tag">${esc(c.format)}</span></div>
      <dl>
        <dt>Skeleton</dt><dd>${esc(c.skeleton)}</dd>
        <dt>Bones</dt><dd>${c.bones}</dd>
        <dt>Height</dt><dd>${c.heightMeters.toFixed(2)} m</dd>
        <dt>Animations</dt><dd>${s.clips.length}</dd>
      </dl>
    </div>${nextBtn('target', 'Next: choose destination')}` : `
  <details class="help"><summary>Where do I get a character?</summary>
    <ul>
      <li><b>Unreal:</b> right-click your character's Skeletal Mesh → <i>Asset Actions → Export</i> → FBX.</li>
      <li><b>Blender:</b> <i>File → Export → glTF 2.0</i> (choose GLB).</li>
      <li><b>Mixamo:</b> download as FBX, "With Skin".</li>
      <li>Free CC0 characters: Quaternius, Kenney.</li>
    </ul>
    <p class="muted"><b>No skeleton?</b> No problem — drop the model in anyway and JustRigIt will rig it for you (humanoid characters standing in a T-pose or A-pose work best).</p>
  </details>`}`;
}

function panelTarget(s) {
  const cards = Object.values(TARGETS).map((t) => `
    <button class="engine ${s.target === t.id ? 'sel' : ''}" data-engine="${t.id}">
      <b>${t.label}</b><small>${esc(t.blurb)}</small>
    </button>`).join('');
  return `
  <h2>Step 2 · Where is it going?</h2>
  <p class="lead">Pick your game engine first. It decides the naming, the ${T('units', 'units')}, whether you need a ${T('root_bone', 'root bone')}, and which import guide you get.</p>
  <div class="engines">${cards}</div>
  ${nextBtn('check', 'Next: health check')}`;
}

function panelCheck(s) {
  const issues = forge.issues;
  const fixable = issues.filter((i) => i.fix && (i.severity === 'warn' || i.severity === 'error'));
  const h = s.health || { ok: 0, info: 0, warn: 0, error: 0 };
  return `
  <h2>Step 3 · Health check for ${esc(s.targetLabel)}</h2>
  <p class="lead">Problems found here would otherwise show up later as a broken import in your engine. Fix them now with one click.</p>
  <div class="summary">
    <span class="pill ok">${h.ok} good</span>
    ${h.info ? `<span class="pill info">${h.info} note${h.info > 1 ? 's' : ''}</span>` : ''}
    ${h.warn ? `<span class="pill warn">${h.warn} warning${h.warn > 1 ? 's' : ''}</span>` : ''}
    ${h.error ? `<span class="pill error">${h.error} error${h.error > 1 ? 's' : ''}</span>` : ''}
  </div>
  ${fixable.length ? `<button class="btn primary wide" data-action="fix-all">Fix everything (${fixable.length})</button>` : `<div class="allgood">✓ Ready for ${esc(s.targetLabel)}</div>`}
  <ul class="issues">${issues.map((i) => `
    <li class="issue ${i.severity}">
      <span class="ico">${sevIcon[i.severity]}</span>
      <div><b>${esc(i.title)}</b>${i.term ? ` ${T(i.term, 'ⓘ')}` : ''}<p>${esc(i.detail)}</p>
      ${i.fix ? `<button class="btn small" data-fix="${i.fix.id}">${esc(i.fix.label)}</button>` : ''}</div>
    </li>`).join('')}
  </ul>
  <details class="help" id="bonemap"><summary>Advanced: bone map</summary><div id="bonemap-body" class="muted">Loading…</div></details>
  ${nextBtn('animations', 'Next: animations')}`;
}

function libraryUI(s) {
  const have = new Set(s.clips.map((c) => c.name));
  const tabs = [['packs', 'Packs'], ['browse', `Browse (${LIB.length})`], ['file', 'From a file'], ['capture', '🎥 From video']]
    .map(([id, l]) => `<button class="${libTab === id ? 'on' : ''}" data-tab="${id}">${l}</button>`).join('');
  let body = '';
  if (libTab === 'packs') {
    body = Object.values(PACKS).map((p) => {
      const n = p.clips.filter((c) => have.has(c)).length;
      return `<div class="pack"><div><b>${esc(p.label)}</b> <span class="tag">${p.clips.length} clips</span><p>${esc(p.desc)}</p></div>
        <button class="btn small ${n === p.clips.length ? '' : 'primary'}" data-pack="${p.id}">${n === p.clips.length ? '✓ Added' : n ? `Add ${p.clips.length - n} more` : 'Add pack'}</button></div>`;
    }).join('');
  } else if (libTab === 'browse') {
    const cats = ['All', ...new Set(LIB.map((e) => e.category))];
    body = `<div class="chips">${cats.map((c) => `<button class="${libCat === c ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
      <ul class="libl">${LIB.filter((e) => libCat === 'All' || e.category === libCat).map((e) => {
        const playing = forge.playing === 'library:' + e.id;
        return `<li class="${playing ? 'playing' : ''}"><button class="play" data-libplay="${e.id}" title="Preview on your character">${playing ? '■' : '▶'}</button>
          <span class="ln"><b>${e.id.replace(/_/g, ' ')}</b><small>${esc(e.desc)}${e.speed ? ` · ${e.speed} m/s` : ''}</small></span>
          ${have.has(e.id) ? '<span class="added">✓</span>' : `<button class="btn small" data-add="${e.id}">+ Add</button>`}</li>`;
      }).join('')}</ul>`;
  } else if (libTab === 'capture') {
    body = captureUI();
  } else {
    body = `<label class="drop small" id="animdrop"><input type="file" id="animfile" accept=".glb,.gltf,.fbx" hidden>
        <b>Drop an animation file</b> or <u>browse</u><small>GLB · glTF · FBX — any humanoid rig</small></label>
      <p class="muted small">Downloaded animations from Mixamo ("Without Skin" is fine), Quaternius' free Universal Animation Library, or exported from Unreal/Blender? Drop them here — JustRigIt ${T('retargeting', 'retargets')} them onto your character automatically.</p>`;
  }
  const sub = libTab === 'capture'
    ? `Film yourself, get a game-ready animation. Runs on <i>your</i> PC's graphics card — the video never leaves your computer.`
    : 'Free to use in commercial games (CC0). ▶ previews on <i>your</i> character before you add anything.';
  return `<div class="card lib"><b>Add animations</b><p class="muted small" style="margin:2px 0 8px">${sub}</p>
    <div class="tabs">${tabs}</div>${body}</div>`;
}

function captureStatusHtml(st) {
  if (!st) return `<span class="capdot"></span> Checking the capture engine…`;
  if (!st.online) return `<span class="capdot off"></span> <b>Capture engine not running.</b> Double-click <code>Start-Capture.bat</code> in the JustRigIt folder, then <a href="#" data-action="cap-recheck">check again</a>.<br><span class="muted small">First time? Run <code>capture\\install_capture.ps1</code> once (downloads the NVIDIA GEM-X model, ~10 GB).</span>`;
  if (st.demo) return `<span class="capdot demo"></span> <b>Demo mode</b> — the engine runs, but the GEM-X model isn't installed, so captures return a sample walk.${st.problems && st.problems.length ? `<br><span class="muted small">${st.problems.map(esc).join('<br>')}</span>` : ''}`;
  return `<span class="capdot on"></span> <b>Ready</b>${st.gpu ? ` on ${esc(st.gpu)}` : ''} — NVIDIA GEM-X ${T('motion_capture', 'motion capture')}.`;
}

function fmtSec(x) { return x == null ? '' : `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`; }

function captureUI() {
  const st = cap.status;
  const ready = st && st.online;
  const long = cap.seconds && cap.seconds > 60 && !cap.duration;
  const cams = [['static', 'Tripod', 'Camera doesn\'t move. Best results.'], ['background', 'Handheld', 'Camera moves a little.'], ['vipe', 'Moving', 'Camera follows you (needs ViPE).']];
  return `<div class="capstat" id="capstat">${captureStatusHtml(st)}</div>
    <label class="drop small" id="viddrop"><input type="file" id="vidfile" accept="video/*,.mp4,.mov,.m4v,.mkv,.avi,.webm" hidden>
      ${cap.file ? `<b>🎞 ${esc(cap.file.name)}</b><small>${(cap.file.size / 1048576).toFixed(1)} MB${cap.seconds ? ' · ' + fmtSec(cap.seconds) : ''} — click to choose another</small>`
        : `<b>Choose a video</b> or drop it here<small>MP4 · MOV · MKV · AVI · WebM — one person, whole body in view</small>`}</label>
    ${long ? `<div class="card warnbox small">This video is ${fmtSec(cap.seconds)} long. One capture can be up to 60 s — set a start time and length below (the first 60 s are used otherwise).</div>` : ''}
    <div class="capopts">
      <div class="lbl">Camera</div>
      <div class="seg seg3">${cams.map(([id, l, d]) => `<button class="${cap.camera === id ? 'on' : ''}" data-cam="${id}"><b>${l}</b><small>${d}</small></button>`).join('')}</div>
      <div class="row3">
        <label class="field small">Start (s)<input id="capstart" type="number" min="0" step="0.1" value="${esc(cap.start)}" placeholder="0"></label>
        <label class="field small">Length (s)<input id="capdur" type="number" min="1" max="60" step="0.1" value="${esc(cap.duration)}" placeholder="${cap.seconds ? Math.min(60, cap.seconds).toFixed(1) : 'all'}"></label>
        <label class="field small">Smoothing<select id="capsmooth">${['off', 'light', 'medium', 'strong'].map((o) => `<option ${cap.smoothing === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="capfingers" ${cap.fingers ? 'checked' : ''}> Capture fingers</label>
    </div>
    <button class="btn primary wide" data-action="capture" ${cap.file && ready ? '' : 'disabled'}>${!cap.file ? 'Choose a video first' : !ready ? 'Start the capture engine first' : st.demo ? 'Capture (demo: sample walk)' : 'Capture animation'}</button>
    <p class="muted small">The motion is ${T('retargeting', 'retargeted')} onto your character with ${T('foot_locking', 'foot locking')}, so planted feet don't slide.</p>
    ${forge.lastCapture ? `<p class="small">Raw capture (${T('soma', 'SOMA skeleton')}): <a href="#" data-action="raw-glb">GLB</a> · <a href="#" data-action="raw-bvh">BVH</a></p>` : ''}
    <details class="help"><summary>How to film for good results</summary><ul>${CAPTURE_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
}

async function refreshCaptureStatus() {
  cap.status = await forge.call('capture_status', {}, 'you').catch(() => ({ online: false }));
  if (forge.step === 'animations' && libTab === 'capture') renderPanelKeepScroll();
}

function pickVideo(file) {
  cap.file = file; cap.seconds = null; cap.start = ''; cap.duration = '';
  try {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { cap.seconds = isFinite(v.duration) ? v.duration : null; URL.revokeObjectURL(v.src); renderPanelKeepScroll(); };
    v.onerror = () => URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(file);
  } catch { /* duration is just a nicety */ }
  libTab = 'capture';
  renderPanelKeepScroll();
}

async function runCapture() {
  const f = cap.file;
  if (!f) return;
  let duration = cap.duration !== '' ? +cap.duration : (cap.seconds && cap.seconds > 60 ? 60 : undefined);
  const args = {
    buffer: await f.arrayBuffer(), filename: f.name, camera: cap.camera, smoothing: cap.smoothing, fingers: cap.fingers,
    start: cap.start !== '' ? +cap.start : undefined, duration,
  };
  busy('Uploading video…', 0);
  const off = forge.on((type, d) => { if (type === 'capture-progress') busy(d.message || 'Capturing…', Math.max(0, d.progress || 0)); });
  try {
    const r = await run('capture_video', args);
    toast(r.message, r.demo ? 'warn' : 'ok');
    if (r.clip) await run('play_clip', { name: r.clip });
  } finally { off(); busy(null); renderPanelKeepScroll(); }
}

function panelAnimations(s) {
  const t = TARGETS[s.target];
  const clips = s.clips;
  const anyMoves = clips.some((c) => c.moves);
  return `
  <h2>Step 4 · Animations</h2>
  <p class="lead">Preview, pick and fine-tune the ${T('clip', 'clips')} that go into your export.</p>
  ${libraryUI(s)}
  <h3 class="sub">Your animations <span class="tag">${clips.length}</span></h3>
  ${anyMoves ? `<div class="card">
    <b>Some clips move the character forward. How should that work?</b>
    <div class="seg">
      <button class="${s.options.motion === 'inplace' ? 'on' : ''}" data-motion="inplace"><b>In place</b><small>Walks on the spot. Your Blueprint moves the character. <em>Best for beginners${t.id.startsWith('ue') ? ', Blend Spaces and the Third Person template' : ''}.</em></small></button>
      <button class="${s.options.motion === 'rootmotion' ? 'on' : ''}" data-motion="rootmotion"><b>Root motion</b><small>The animation moves the character${t.needsRootBone ? ' via the root bone' : ''}. Best for attacks, dodges, vaults.</small></button>
    </div>
    <p class="muted">${T('in_place', 'What is in place?')} · ${T('root_motion', 'What is root motion?')}</p>
  </div>` : ''}
  ${clips.length ? `<ul class="clips">${clips.map((c) => `
    <li class="${forge.playing === c.name ? 'playing' : ''} ${c.included ? '' : 'excluded'}">
      <button class="play" data-play="${esc(c.name)}" title="Preview">${forge.playing === c.name ? '■' : '▶'}</button>
      <input class="cname" value="${esc(c.name)}" data-rename="${esc(c.name)}" spellcheck="false" aria-label="Clip name">
      <span class="dur">${c.duration.toFixed(2)}s</span>
      ${c.moves ? `<select data-mode="${esc(c.name)}" title="Movement">
          <option value="inplace" ${c.mode === 'inplace' ? 'selected' : ''}>In place</option>
          <option value="rootmotion" ${c.mode === 'rootmotion' ? 'selected' : ''}>Root motion</option>
          <option value="keep" ${c.mode === 'keep' ? 'selected' : ''}>Unchanged</option>
        </select>` : ''}
      <label class="inc" title="Include in export"><input type="checkbox" data-include="${esc(c.name)}" ${c.included ? 'checked' : ''}></label>
      <button class="x" data-remove="${esc(c.name)}" title="Remove">×</button>
    </li>`).join('')}</ul>` : `<div class="card muted">No animations yet — add a pack above, or export just the character.</div>`}
  ${nextBtn('export', 'Next: export')}`;
}

function namingUI(s) {
  const bn = s.boneNaming;
  if (!bn) return '';
  const opts = [['auto', `Automatic for ${TARGETS[s.target].short} (${NAMINGS[bn.effective].label})`], ...Object.values(NAMINGS).map((n) => [n.id, n.label])];
  return `<div class="card">
    <label class="field">${T('bone_naming', 'Skeleton naming')}<select id="naming">${opts.map(([id, l]) => `<option value="${id}" ${bn.setting === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <p class="muted small" style="margin:4px 0 0">${esc(NAMINGS[bn.effective].blurb)}${bn.renamedBones ? ` <b>${bn.renamedBones}</b> bones get renamed in the exported file.` : ''}</p>
  </div>`;
}

function panelExport(s) {
  const n = s.exportNames;
  const t = TARGETS[s.target];
  return `
  <h2>Step 5 · Export for ${esc(t.label)}</h2>
  <label class="field">Asset name<input id="basename" value="${esc(s.options.baseName)}" spellcheck="false"></label>
  <div class="card files">
    <b>You'll get one .zip containing:</b>
    <ul>
      <li><code>${esc(n.mesh)}.glb</code> <span class="muted">character${!s.options.splitClips && n.clips.length ? ' + ' + n.clips.length + ' animation' + (n.clips.length > 1 ? 's' : '') : ''}</span></li>
      ${s.options.splitClips ? n.clips.map((c) => `<li><code>${esc(c)}.glb</code></li>`).join('') : n.clips.map((c) => `<li class="sub"><code>${esc(c)}</code></li>`).join('')}
      <li><code>IMPORT_GUIDE_${t.short}.md</code> <span class="muted">step-by-step instructions for these exact files</span></li>
      <li><code>justrigit-recipe.json</code> <span class="muted">replayable record (for you or an AI)</span></li>
    </ul>
    <label class="check"><input type="checkbox" id="split" ${s.options.splitClips ? 'checked' : ''}> One file per animation <span class="muted">(not recommended for Unreal)</span></label>
  </div>
  ${namingUI(s)}
  <p class="muted small">${esc(t.format)}<br>${esc(t.unitsNote)}</p>
  ${s.health && s.health.error ? `<div class="card warnbox">⚠ ${s.health.error} unresolved error(s). <a href="#" data-goto="check">Go back to the health check</a> or export anyway.</div>` : ''}
  <button class="btn primary wide big" data-action="export">Download ${esc(n.bundle)}</button>
  <div id="guide">${lastExport ? `<div class="card ok"><b>✓ Built ${esc(lastExport.names.bundle)}</b> (${(lastExport.zip.length / 1024).toFixed(0)} KB)</div>
    <div class="guide-head"><b>Your import guide</b><button class="btn small" data-action="copy-guide">Copy</button></div>
    <div class="md">${renderMarkdown(lastExport.guide)}</div>` : `<button class="btn ghost wide" data-action="preview-guide">Preview the import guide first</button>`}</div>`;
}

function renderPanel() {
  if (mode === 'capture' && wizard) {
    $('#panel').innerHTML = wizard.render();
    wizard.wire($('#panel'));
    return;
  }
  const s = forge.status();
  const map = { character: panelCharacter, target: panelTarget, check: panelCheck, animations: panelAnimations, export: panelExport };
  const step = !s.character ? 'character' : forge.step;
  $('#panel').innerHTML = map[step](s);
  $('#panel').scrollTop = 0;
  wirePanel();
}

function renderPanelKeepScroll() {
  const sc = $('#panel').scrollTop;
  renderPanel();
  $('#panel').scrollTop = sc;
}

function renderHud() {
  const s = forge.status();
  const c = s.character;
  $('#hud').innerHTML = c ? (s.needsRig ? `<b>${esc(c.name)}</b> · ${c.heightMeters.toFixed(2)} m · <span style="color:var(--accent2)">no skeleton — place the markers</span>` : `<b>${esc(c.name)}</b> · ${c.heightMeters.toFixed(2)} m · ${esc(c.skeleton)}${c.autoRigged ? ' (auto-rigged)' : ''}${c.rootBone ? ' · root: ' + esc(c.rootBone) : ''}`) : 'No character loaded';
  const tl = $('#timeline');
  tl.hidden = !forge.playing;
  $('#tl-name').textContent = String(forge.playing || '').replace(/^library:/, 'Preview: ');
}

function renderLog() {
  const items = forge.log.slice(-60).reverse();
  $('#log-count').textContent = forge.log.length;
  $('#log-list').innerHTML = items.map((e) => `
    <li class="${e.ok ? '' : 'err'}"><span class="who ${e.source}">${e.source === 'you' ? 'You' : e.source === 'ai' ? 'AI' : 'Recipe'}</span>
      <code>${esc(e.name)}</code> <span>${esc(e.ok ? (e.summary || '') : e.error)}</span></li>`).join('') || '<li class="muted">Every action — yours or an AI\'s — is listed here.</li>';
}

function setMode(m) {
  mode = m === 'advanced' ? 'advanced' : 'capture';
  try { localStorage.setItem('jri.mode', mode); } catch { /* ignore */ }
  document.body.classList.toggle('mode-capture', mode === 'capture');
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode === 'capture') wizard.enter().catch((e) => toast(e.message, 'error')).finally(renderAll);
  else { if (forge.doc && forge.step === 'character' && !forge.status().needsRig) forge.step = 'target'; renderAll(); }
}

function renderAll() {
  const s = forge.status();
  viewport.setRigMode(!!s.needsRig);
  $('#markers').hidden = !s.needsRig;
  document.body.classList.toggle('rigging', !!s.needsRig);
  buildMarkers();
  renderStepper(); renderPanel(); renderHud(); renderLog();
}

// ---------- auto-rig markers (draggable, front view) ----------
const LINES = [['chin', 'groin'], ['groin', 'leftKnee'], ['groin', 'rightKnee'], ['leftElbow', 'leftWrist'], ['rightElbow', 'rightWrist'], ['chin', 'leftElbow'], ['chin', 'rightElbow']];
function buildMarkers() {
  const host = $('#markers');
  if (!forge.rigMarkers) { host.innerHTML = ''; return; }
  if (host.dataset.built) return;
  host.dataset.built = '1';
  host.innerHTML = `<svg class="mlines">${LINES.map(() => '<line/>').join('')}</svg>` +
    MARKERS.map((k) => `<div class="mk ${markerClass(k)}" data-mk="${k}" title="${MARKER_LABELS[k]}"><span>${MARKER_LABELS[k].replace('Left ', 'L ').replace('Right ', 'R ')}</span></div>`).join('');
  host.querySelectorAll('.mk').forEach((el) => {
    el.onpointerdown = (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag');
      const k = el.dataset.mk;
      const rect = host.getBoundingClientRect();
      const move = (ev) => {
        const [x, y] = viewport.unproject(ev.clientX - rect.left, ev.clientY - rect.top);
        const m = forge.rigMarkers;
        const x0 = viewport.orthoCenterX ?? 0;
        if (k === 'chin' || k === 'groin') m[k] = [symmetric ? x0 : x, y];
        else { m[k] = [x, y]; if (symmetric) m[MIRROR[k]] = [2 * x0 - x, y]; }
      };
      el.onpointermove = move;
      el.onpointerup = async () => {
        el.onpointermove = null; el.onpointerup = null; el.classList.remove('drag');
        await run('set_rig_markers', { markers: { [k]: forge.rigMarkers[k] }, mirror: symmetric });
      };
    };
  });
}
function placeMarkers() {
  const host = $('#markers');
  if (host.hidden || !forge.rigMarkers || !viewport.rigMode) return;
  const pos = {};
  host.querySelectorAll('.mk').forEach((el) => {
    const m = forge.rigMarkers[el.dataset.mk];
    if (!m) return;
    const [px, py] = viewport.project(m[0], m[1]);
    pos[el.dataset.mk] = [px, py];
    el.style.transform = `translate(${px}px, ${py}px)`;
  });
  const lines = host.querySelectorAll('line');
  LINES.forEach(([a, b], i) => {
    if (!pos[a] || !pos[b] || !lines[i]) return;
    lines[i].setAttribute('x1', pos[a][0]); lines[i].setAttribute('y1', pos[a][1]);
    lines[i].setAttribute('x2', pos[b][0]); lines[i].setAttribute('y2', pos[b][1]);
  });
}

// ---------- wiring ----------
function wirePanel() {
  const p = $('#panel');
  const file = $('#file', p);
  if (file) file.onchange = () => file.files[0] && loadFile(file.files[0]);
  const af = $('#animfile', p);
  if (af) af.onchange = () => af.files[0] && loadAnimFile(af.files[0]);
  const sym = $('#sym', p);
  if (sym) sym.onchange = () => { symmetric = sym.checked; };
  const bm = $('#bonemap', p);
  if (bm) bm.ontoggle = async () => {
    if (!bm.open) return;
    const r = await forge.call('get_bone_map', {}, 'you');
    $('#bonemap-body').innerHTML = `<p>Detected: <b>${esc(r.skeleton)}</b> (${Math.round(r.confidence * 100)}% of key bones matched)</p>
      <table class="bones"><tr><th>Body part</th><th>Bone in your file</th></tr>${r.map.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.bone ? `<code>${esc(m.bone)}</code>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</table>`;
  };
  const vf = $('#vidfile', p);
  if (vf) vf.onchange = () => vf.files[0] && pickVideo(vf.files[0]);
  const num = (id, key) => { const el = $(id, p); if (el) el.onchange = () => { cap[key] = el.value; renderPanelKeepScroll(); }; };
  num('#capstart', 'start'); num('#capdur', 'duration');
  const sm = $('#capsmooth', p); if (sm) sm.onchange = () => { cap.smoothing = sm.value; };
  const fg = $('#capfingers', p); if (fg) fg.onchange = () => { cap.fingers = fg.checked; };
  if ($('#capstat', p) && !cap.status) refreshCaptureStatus();
  const nm = $('#naming', p);
  if (nm) nm.onchange = async () => { await run('set_export_options', { bone_naming: nm.value }); renderPanelKeepScroll(); };
  const bn = $('#basename', p);
  if (bn) bn.onchange = () => run('set_export_options', { base_name: bn.value });
  const sp = $('#split', p);
  if (sp) sp.onchange = () => run('set_export_options', { split_clips: sp.checked });
  p.querySelectorAll('[data-rename]').forEach((inp) => {
    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
    inp.onchange = () => { if (inp.value && inp.value !== inp.dataset.rename) run('update_clip', { name: inp.dataset.rename, new_name: inp.value }); };
  });
  p.querySelectorAll('[data-mode]').forEach((sel) => { sel.onchange = () => run('update_clip', { name: sel.dataset.mode, mode: sel.value }); });
  p.querySelectorAll('[data-include]').forEach((cb) => { cb.onchange = () => run('update_clip', { name: cb.dataset.include, include: cb.checked }); });
}

async function loadAnimFile(f) {
  const buf = await f.arrayBuffer();
  busy('Retargeting animations…');
  try { const r = await run('add_animations', { buffer: buf, filename: f.name }); toast(r.message); }
  finally { busy(null); }
}

function busy(msg, p) {
  const b = $('#busy');
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<div class="bbox"><b>${esc(msg)}</b>${p !== undefined ? `<div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div>` : ''}</div>`;
}

async function loadFile(f) {
  const buf = await f.arrayBuffer();
  busy('Loading ' + f.name + '…');
  try {
    const r = await run('load_character', { buffer: buf, filename: f.name });
    toast(r.message);
    lastExport = null;
  } finally { busy(null); }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-step],[data-goto],[data-action],[data-engine],[data-fix],[data-play],[data-motion],[data-rotate],[data-pack],[data-add],[data-libplay],[data-tab],[data-cat],[data-remove],[data-cam],[data-act],[data-wstep],[data-wmotion],[data-wtarget],[data-mode]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.mode) { setMode(d.mode); return; }
  if (mode === 'capture' && wizard && (d.act || d.wstep || d.wmotion || d.wtarget || d.cam)) {
    try { await wizard.onClick(el, e); } catch (err) { /* run() already showed the error */ }
    return;
  }
  if (d.step || d.goto) { e.preventDefault(); forge.step = d.step || d.goto; renderAll(); return; }
  if (d.engine) { await run('set_target', { engine: d.engine }); forge.step = 'target'; lastExport = null; renderAll(); return; }
  if (d.fix) { const r = await run('apply_fix', { fix: d.fix }); toast(r.message); return; }
  if (d.play) { await run('play_clip', { name: forge.playing === d.play ? null : d.play }); renderPanel(); renderHud(); return; }
  if (d.motion) { await run('set_export_options', { motion: d.motion }); return; }
  if (d.rotate) { await run('rotate_character', { degrees: +d.rotate }); return; }
  if (d.tab) { libTab = d.tab; if (d.tab === 'capture') cap.status = null; renderPanelKeepScroll(); return; }
  if (d.cam) { cap.camera = d.cam; renderPanelKeepScroll(); return; }
  if (d.cat) { libCat = d.cat; renderPanelKeepScroll(); return; }
  if (d.libplay) { await run('play_clip', forge.playing === 'library:' + d.libplay ? { name: null } : { library: d.libplay }); renderPanelKeepScroll(); renderHud(); return; }
  if (d.add) { busy('Retargeting ' + d.add + '…'); try { const r = await run('add_animations', { clips: [d.add] }); toast(r.message); } finally { busy(null); } return; }
  if (d.pack) { busy('Retargeting ' + PACKS[d.pack].label + '…'); try { const r = await run('add_animations', { pack: d.pack }); toast(r.message); } finally { busy(null); } return; }
  if (d.remove) { await run('remove_clip', { name: d.remove }); return; }
  switch (d.action) {
    case 'auto-markers': await run('auto_place_markers'); break;
    case 'capture': el.disabled = true; try { await runCapture(); } finally { el.disabled = false; } break;
    case 'cap-recheck': e.preventDefault(); cap.status = null; renderPanelKeepScroll(); break;
    case 'raw-glb': case 'raw-bvh': e.preventDefault(); await run('export_capture', { format: d.action === 'raw-bvh' ? 'bvh' : 'glb' }); break;
    case 'rig': {
      el.disabled = true;
      try { const r = await run('auto_rig'); toast(r.message); } finally { busy(null); }
      break;
    }
    case 'demo': { $('#busy').hidden = false; try { const r = await run('load_character', { demo: true }); toast(r.message); lastExport = null; } finally { $('#busy').hidden = true; } break; }
    case 'fix-all': { const r = await run('apply_fix', { fix: 'all' }); toast(r.message); break; }
    case 'export': {
      el.disabled = true; el.textContent = 'Building…';
      try { const r = await run('export_bundle', { deliver: 'download' }); if (r.delivered === 'declined') toast('Download cancelled.', 'warn'); } finally { renderPanel(); }
      break;
    }
    case 'preview-guide': {
      const r = await run('get_import_guide');
      $('#guide').innerHTML = `<div class="guide-head"><b>Import guide preview</b></div><div class="md">${renderMarkdown(r.markdown)}</div>`;
      break;
    }
    case 'copy-guide': copyText(lastExport?.guide || ''); break;
    case 'copy-prompt': copyText(AGENT_PROMPT); break;
    case 'open-ai': openModal('ai'); break;
    case 'open-glossary': openModal('glossary'); break;
    case 'close-modal': closeModal(); break;
    case 'toggle-skel': { const on = !viewport.showSkeleton; viewport.setSkeleton(on); el.classList.toggle('on', on); break; }
    case 'reset-cam': if (forge.doc) viewport.frame(forge.doc); break;
    case 'pause': { const p = viewport.togglePause(); el.textContent = p ? '▶' : '❚❚'; break; }
    case 'toggle-log': $('#log').classList.toggle('open'); break;
    default: break;
  }
});

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied to clipboard.'); }
  catch { toast('Copy blocked here — select the text and copy it manually.', 'warn'); }
}

// Drag & drop anywhere
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) document.body.classList.remove('dragging'); }));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (mode === 'capture' && wizard && wizard.onDrop(f)) return;
  if (VIDEO_EXT.test(f.name) || (f.type || '').startsWith('video/')) {
    if (forge.doc && forge.doc.skinnedMeshes.length) { forge.step = 'animations'; pickVideo(f); renderAll(); }
    else toast('Load (or auto-rig) a character first — then drop the video in step 4 to capture its motion.', 'warn');
    return;
  }
  if (forge.step === 'animations' && forge.doc && forge.doc.skinnedMeshes.length) loadAnimFile(f); else loadFile(f);
});

// Space = play/pause (when not typing)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && viewport.action) {
    e.preventDefault(); const p = viewport.togglePause(); $('#btn-pause').textContent = p ? '▶' : '❚❚';
  }
  if (e.key === 'Escape') closeModal();
});

// ---------- glossary tooltips ----------
const tip = document.createElement('div');
tip.className = 'tip'; tip.hidden = true;
document.body.appendChild(tip);
function showTip(el) {
  const g = GLOSSARY[el.dataset.term];
  if (!g) return;
  tip.innerHTML = `<b>${esc(g.term)}</b><p><em>What:</em> ${esc(g.what)}</p><p><em>Why:</em> ${esc(g.why)}</p><p><em>When:</em> ${esc(g.when)}</p>`;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 16);
  tip.style.width = w + 'px';
  tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  const below = r.bottom + 8;
  tip.style.top = (below + tip.offsetHeight > window.innerHeight ? Math.max(8, r.top - tip.offsetHeight - 8) : below) + 'px';
}
document.addEventListener('mouseover', (e) => { const t = e.target.closest('.term'); if (t) showTip(t); });
document.addEventListener('mouseout', (e) => { if (e.target.closest('.term')) tip.hidden = true; });
document.addEventListener('focusin', (e) => { const t = e.target.closest('.term'); if (t) showTip(t); });
document.addEventListener('focusout', (e) => { if (e.target.closest('.term')) tip.hidden = true; });

// ---------- modals ----------
function openModal(kind) {
  const m = $('#modal');
  const body = $('#modal-body');
  if (kind === 'glossary') {
    body.innerHTML = `<h2>Glossary</h2><p class="lead">Every term used in this app, in plain language.</p>
      <div class="gloss">${Object.values(GLOSSARY).map((g) => `<div class="g"><b>${esc(g.term)}</b><p>${esc(g.what)}</p><p class="muted"><em>Why it matters:</em> ${esc(g.why)}</p><p class="muted"><em>When:</em> ${esc(g.when)}</p></div>`).join('')}</div>`;
  } else {
    const tools = forge.listTools();
    body.innerHTML = `<h2>🤖 AI access</h2>
      <p class="lead">JustRigIt is built so AI assistants can use it directly — the buttons and the AI call the <b>same commands</b>. Anything you can click, an AI can do, and every AI action shows up in the Activity log.</p>
      <div class="ai-status">
        <div class="ok"><b>✓ In-page API</b><span><code>window.justrigit</code> — ${tools.length} commands. Works with browser agents like Claude in Chrome and OpenAI's browser agents today.</span></div>
        <div class="${aiStatus.webmcp ? 'ok' : 'pending'}"><b>${aiStatus.webmcp ? '✓' : '○'} WebMCP</b><span>${aiStatus.webmcp ? `Registered ${aiStatus.webmcpTools} tools with this browser via <code>navigator.modelContext</code>.` : 'Not available in this browser yet (experimental in Chrome behind a flag). When it ships, this page registers its tools automatically.'}</span></div>
        <div class="ok"><b>✓ MCP server</b><span>The same engine as a ${T('mcp', 'MCP')} server that runs on your computer, so Claude can rig, capture from video, look at the result and export — using your own files and GPU. Easiest: the Claude Desktop extension below.</span></div>
      </div>
      <h3>Give this to your AI agent</h3>
      <pre class="prompt">${esc(AGENT_PROMPT)}</pre>
      <button class="btn" data-action="copy-prompt">Copy prompt</button>
      <details class="help" open><summary>Use JustRigIt from Claude Desktop (one click)</summary>
        <p><b>1.</b> In the JustRigIt folder, open <code>dist</code> and double-click <code>JustRigIt.mcpb</code> (or Claude Desktop → Settings → Extensions → Install Extension… and pick it).</p>
        <p><b>2.</b> Pick an export folder (default: Documents\\JustRigIt Exports) and click <b>Install</b>. No Node.js needed — Claude Desktop brings its own.</p>
        <p><b>3.</b> In a new chat, ask: <i>"Use JustRigIt to turn my latest video into an Unreal animation on the mannequin."</i> Video capture uses the engine from Install-Capture.bat; Claude starts it for you.</p>
      </details>
      <details class="help"><summary>Other ways to connect (Claude Code, manual config, remote)</summary>
        <p><b>1.</b> Install <a href="https://nodejs.org" target="_blank" rel="noopener">Node.js</a> 18+, unzip the JustRigIt source, and run <code>npm install</code> in that folder.</p>
        <p><b>2a. Claude Desktop (manual)</b> — Settings → Developer → Edit Config, add:</p>
        <pre class="prompt">{ "mcpServers": { "justrigit": { "command": "node", "args": ["C:/path/to/justrigit/src/node/mcp-server.mjs"] } } }</pre>
        <p><b>2b. Claude Code</b> — <code>claude mcp add justrigit -- node /path/to/justrigit/src/node/mcp-server.mjs</code></p>
        <p><b>2c. ChatGPT / remote</b> — on your server: <code>npm run mcp:http -- --public-url https://rig.your-domain.com</code>, put it behind your HTTPS reverse proxy, then in ChatGPT: Settings → Apps → Advanced → Developer mode → Create → <code>https://rig.your-domain.com/mcp</code>.</p>
      </details>
      <p class="muted" style="margin-top:14px">JustRigIt is free software by SuddleMercury, developed with Claude — <a href="https://github.com/SuddleMercury/justrigit" target="_blank" rel="noopener">source code on GitHub</a> (AGPL-3.0: free to use for anything; changed versions must stay free and open).</p>
      <details class="help"><summary>All ${tools.length} commands</summary>
        <ul class="tools">${tools.map((t) => `<li><code>${esc(t.name)}</code>${t.annotations.readOnlyHint ? ' <span class="tag">read-only</span>' : ''}<p>${esc(t.description)}</p></li>`).join('')}</ul>
      </details>`;
  }
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

// ---------- boot ----------
function boot() {
  $('#ver').textContent = 'v' + VERSION;
  viewport = new Viewport($('#viewport'), forge);
  viewport.onTime = (frac, action) => {
    if (!action) return;
    const bar = $('#tl-bar');
    if (bar && !bar.matches(':active')) bar.value = String(Math.round(frac * 1000));
    $('#tl-time').textContent = action.time.toFixed(2) + 's';
  };
  $('#tl-bar').oninput = (e) => { viewport.paused = true; $('#btn-pause').textContent = '▶'; viewport.seek(e.target.value / 1000); };
  viewport.onRender = placeMarkers;
  forge.on((type, data) => {
    if (type === 'doc') { lastExport = null; delete $('#markers').dataset.built; }
    if (type === 'state' || type === 'doc') renderAll();
    if (type === 'command') renderLog();
    if (type === 'play') { renderHud(); if (forge.step === 'animations' || mode === 'capture') renderPanelKeepScroll(); }
    if (type === 'doc-clips' && (forge.step === 'animations' || mode === 'capture')) renderPanelKeepScroll();
    if (type === 'progress') { if (data) busy(data.msg, data.p); }
    if (type === 'exported') { lastExport = forge.lastExport; renderAll(); }
  });
  aiStatus = installBridge(forge);
  initDownloads();
  wizard = createWizard({ forge, run, toast, busy, esc, renderMarkdown, render: renderPanelKeepScroll, setMode });
  // Keep telling the local capture engine the window is open (it shuts down when idle) — also when this
  // page was opened as a file next to an engine that Claude started.
  if (typeof location !== 'undefined' && (location.protocol === 'file:' || forge.captureUrl === location.origin)) {
    setInterval(() => { fetch(forge.captureUrl + '/status', { cache: 'no-store' }).catch(() => {}); }, 20000);
  }
  setMode(mode);
}
boot();
