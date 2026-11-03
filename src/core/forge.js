// The Forge: one command registry shared by the buttons, AI agents (window.justrigit,
// WebMCP) and — later — the MCP server. If a button can do it, an AI can do it.
import { loadFromArrayBuffer, cleanName } from './character.js';
import { buildDemoCharacter } from './demo.js';
import { runHealthCheck, summarize } from './health.js';
import { FIXES } from './fixes.js';
import { TARGETS, ENGINE_IDS } from './targets.js';
import { analyzeTravel } from './clips.js';
import { buildBundle, plannedNames, effectiveNaming } from './export.js';
import { NAMINGS, namingMap } from './naming.js';
import { GLOSSARY } from './glossary.js';
import { CANONICAL, CANONICAL_LABELS } from './profiles.js';
import { retargetClip } from './retarget.js';
import { LIBRARY, PACKS, libraryRig, libraryClip, catalog } from './library.js';
import { gatherMesh, guessMarkers, autoRig, MARKERS, MARKER_LABELS, MIRROR } from './autorig.js';
import { DEFAULT_CAPTURE_URL, captureStatus, startCapture, waitForJob, fetchResult, cancelJob, CAPTURE_TIPS } from './capture.js';

export const VERSION = '0.3.0';

function b64ToBuffer(b64) {
  const clean = String(b64).replace(/^data:[^,]*,/, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  const buf = Buffer.from(clean, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
function bufferToB64(u8) {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return Buffer.from(u8).toString('base64');
}

export class Forge {
  constructor() {
    this.doc = null;
    this.target = 'ue5';
    this.step = 'character';
    this.options = { motion: 'inplace', splitClips: false, baseName: '', clipModes: {}, excluded: [], boneNaming: 'auto' };
    this.issues = [];
    this.playing = null;
    this.recipe = [];
    this.log = [];
    this.listeners = new Set();
    this.commands = new Map();
    this.hooks = { deliver: null, snapshot: null, fetchUrl: null, ensureEngine: null };
    this.pendingCaptures = new Map(); // job id → what to do with the result once the engine finishes
    this.captureUrl = DEFAULT_CAPTURE_URL;
    this.lastCapture = null;      // { name, glb, bvh, stats } — the raw capture on the SOMA skeleton
    this.captures = [];           // every capture this session, so they can follow a character change
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
      this.captureUrl = location.origin; // the page is served by the capture engine itself
    }
    this.rigMarkers = null;      // markers for an un-rigged character
    this.previewCache = new Map(); // retargeted library previews for the current character
    registerCommands(this);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { this.listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } }); }

  define(cmd) { this.commands.set(cmd.name, cmd); }

  listTools() {
    return [...this.commands.values()].map((c) => ({
      name: c.name, title: c.title, description: c.description, inputSchema: c.inputSchema,
      annotations: { readOnlyHint: !c.mutates },
    }));
  }

  async call(name, args = {}, source = 'ai') {
    const cmd = this.commands.get(name);
    if (!cmd) throw new Error(`Unknown command "${name}". Call list_commands to see what's available.`);
    const entry = { time: new Date().toISOString(), source, name, args: redact(args) };
    try {
      const result = await cmd.run(args || {});
      entry.ok = true;
      entry.summary = result && result.message ? result.message : undefined;
      if (cmd.mutates && cmd.recordable !== false) this.recipe.push({ tool: name, args: redact(args) });
      this.log.push(entry);
      this.emit('command', entry);
      if (cmd.mutates) this.emit('state', this.status());
      return result;
    } catch (e) {
      entry.ok = false; entry.error = e.message;
      this.log.push(entry);
      this.emit('command', entry);
      throw e;
    }
  }

  requireDoc() {
    if (!this.doc) throw new Error('No character loaded yet. Call load_character first (or load_character with {"demo": true}).');
    return this.doc;
  }

  previewLibrary(id) {
    if (!this.previewCache.has(id)) {
      const lc = libraryClip(id);
      if (!lc) throw new Error(`No library animation "${id}".`);
      this.previewCache.set(id, retargetClip(libraryRig(), lc.clip, this.doc, { name: lc.entry.id }));
    }
    return this.previewCache.get(id);
  }

  recheck() {
    this.issues = this.doc ? runHealthCheck(this.doc, this.target) : [];
    return this.issues;
  }

  clipInfo() {
    const d = this.doc;
    if (!d) return [];
    return d.clips.map((c) => {
      const tr = analyzeTravel(d, c);
      const name = d.clipName(c);
      return {
        name, original: c.name, duration: +c.duration.toFixed(3), tracks: c.tracks.length,
        moves: tr.moves, travelMeters: +Math.max(tr.hipsTravel, tr.rootTravel).toFixed(2), speed: +tr.speed.toFixed(2),
        mode: this.options.clipModes[name] || this.options.motion,
        included: !this.options.excluded.includes(name),
      };
    });
  }

  status() {
    const d = this.doc;
    return {
      app: 'JustRigIt', version: VERSION, step: this.step, target: this.target,
      targetLabel: TARGETS[this.target].label,
      character: d ? {
        name: d.baseName, source: d.sourceName, format: d.format,
        skeleton: d.detection.label, skeletonId: d.detection.id, bones: d.bones.length,
        rootBone: d.rootBone()?.name || null,
        heightMeters: +d.metrics.height.toFixed(3), triangles: d.metrics.triangles,
        fixesApplied: d.appliedFixes,
      } : null,
      health: d ? summarize(this.issues) : null,
      needsRig: !!(d && !d.skinnedMeshes.length),
      autoRigged: !!(d && d.autoRigged),
      rigMarkers: this.rigMarkers,
      clips: this.clipInfo(),
      playing: this.playing,
      options: this.options,
      exportNames: d ? (() => { const n = plannedNames(d, this.target, this.options); return { mesh: n.mesh, clips: n.clips.map((c) => c.out), bundle: n.bundle }; })() : null,
      boneNaming: d ? (() => {
        const id = effectiveNaming(this.target, this.options);
        let renamed = 0; try { renamed = namingMap(d, id).size; } catch { /* ignore */ }
        return { setting: this.options.boneNaming, effective: id, label: NAMINGS[id].label, renamedBones: renamed };
      })() : null,
    };
  }

  async setDoc(doc) {
    this.doc = doc;
    this.playing = null;
    this.previewCache = new Map();
    this.rigMarkers = null;
    if (!doc.skinnedMeshes.length) prepareForRigging(doc, this);
    this.options.clipModes = {};
    this.options.excluded = [];
    this.options.baseName = doc.baseName;
    this.recheck();
    this.emit('doc', doc);
  }
}

function redact(args) {
  if (!args || typeof args !== 'object') return args;
  const o = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'base64' || k === 'buffer' || k === 'file') o[k] = `<${typeof v === 'string' ? v.length + ' chars' : 'binary'} omitted>`;
    else o[k] = v;
  }
  return o;
}

// Adds (or replaces, by name) a clip on the character.
function putClip(d, clip, meta, added) {
  const nm = cleanName(clip.name) || 'Clip';
  const old = d.clips.find((c) => d.clipName(c) === nm);
  if (old) { d.clips.splice(d.clips.indexOf(old), 1); d.clipNames.delete(old.uuid); }
  clip.userData = { ...(clip.userData || {}), ...meta };
  d.clips.push(clip);
  d.clipNames.set(clip.uuid, nm);
  if (added) added.push(nm);
  return nm;
}

function registerCommands(f) {
  f.define({
    name: 'get_status', title: 'Get status', mutates: false,
    description: 'Returns the full current state: wizard step, target engine, loaded character (skeleton type, height, root bone), health summary, animation clips, export options and planned file names. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => f.status(),
  });

  f.define({
    name: 'list_commands', title: 'List commands', mutates: false,
    description: 'Lists every command this app supports with its JSON input schema.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => f.listTools(),
  });

  f.define({
    name: 'load_character', title: 'Load character', mutates: true,
    description: 'Loads a 3D character. Provide exactly one of: demo=true (built-in test mannequin), base64 + filename (GLB, embedded glTF or FBX file contents), or url (only works where the page is allowed to fetch it). Replaces any loaded character.',
    inputSchema: {
      type: 'object',
      properties: {
        demo: { type: 'boolean', description: 'Load the built-in demo mannequin.' },
        base64: { type: 'string', description: 'File contents, base64 encoded (data: URL prefix allowed).' },
        filename: { type: 'string', description: 'Original file name incl. extension (.glb, .gltf, .fbx). Required with base64/url.' },
        url: { type: 'string', description: 'URL of a .glb/.gltf/.fbx file.' },
      },
      additionalProperties: false,
    },
    async run(a) {
      let doc;
      if (a.demo) doc = buildDemoCharacter();
      else if (a.base64) doc = await loadFromArrayBuffer(b64ToBuffer(a.base64), a.filename || 'character.glb');
      else if (a.buffer) doc = await loadFromArrayBuffer(a.buffer, a.filename || 'character.glb');
      else if (a.url) {
        const fetcher = f.hooks.fetchUrl || ((u) => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }));
        doc = await loadFromArrayBuffer(await fetcher(a.url), a.filename || a.url.split('/').pop().split('?')[0]);
      } else throw new Error('Provide demo=true, base64+filename, or url.');
      await f.setDoc(doc);
      if (!doc.skinnedMeshes.length) {
        f.step = 'character';
        return { message: `Loaded "${doc.sourceName}" — it has no skeleton yet. Check the 8 markers (get_rig_markers / set_rig_markers), then run auto_rig.`, status: f.status() };
      }
      f.step = 'target';
      const s = summarize(f.issues);
      return { message: `Loaded "${doc.sourceName}": ${doc.detection.label}, ${doc.bones.length} bones, ${doc.clips.length} animation(s). Health: ${s.error} errors, ${s.warn} warnings.`, status: f.status() };
    },
  });

  f.define({
    name: 'set_target', title: 'Choose destination engine', mutates: true,
    description: 'Sets where the export is going. This changes health checks (e.g. Unreal needs a root bone), naming (SK_/A_ for Unreal) and the generated import guide.',
    inputSchema: { type: 'object', properties: { engine: { type: 'string', enum: ENGINE_IDS, description: 'ue5 | ue4 | unity | godot | blender' } }, required: ['engine'], additionalProperties: false },
    run(a) {
      if (!TARGETS[a.engine]) throw new Error('engine must be one of ' + ENGINE_IDS.join(', '));
      f.target = a.engine;
      f.options.motion = 'inplace';
      f.recheck();
      if (f.step === 'target') f.step = 'check';
      return { message: `Destination set to ${TARGETS[a.engine].label}.`, target: TARGETS[a.engine] };
    },
  });

  f.define({
    name: 'run_health_check', title: 'Run health check', mutates: false,
    description: 'Checks the loaded character for problems with the chosen engine: skeleton type, missing humanoid bones, scale/units, floor placement, facing direction, root bone, rest pose, skin weights, animations. Each issue has severity (ok/info/warn/error) and, when fixable, a fix id for apply_fix.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() { f.requireDoc(); return { summary: summarize(f.recheck()), issues: f.issues }; },
  });

  f.define({
    name: 'apply_fix', title: 'Apply fix', mutates: true,
    description: 'Applies a fix suggested by run_health_check. Use fix="all" to apply every available fix in a safe order. Re-runs the health check afterwards.',
    inputSchema: { type: 'object', properties: { fix: { type: 'string', description: 'Fix id from an issue (e.g. add_root_bone, fix_scale_down, place_on_floor, face_forward, rename_duplicate_bones) or "all".' } }, required: ['fix'], additionalProperties: false },
    run(a) {
      const d = f.requireDoc();
      const order = ['rename_duplicate_bones', 'fix_scale_down', 'fix_scale_up', 'face_forward', 'place_on_floor', 'add_root_bone'];
      let ids;
      if (a.fix === 'all') {
        const avail = new Set(f.issues.filter((i) => i.fix && (i.severity === 'warn' || i.severity === 'error')).map((i) => i.fix.id));
        ids = order.filter((id) => avail.has(id));
      } else ids = [a.fix];
      const messages = [];
      for (const id of ids) {
        const fx = FIXES[id];
        if (!fx) throw new Error(`Unknown fix "${id}".`);
        messages.push(fx.run(d));
        d.appliedFixes.push(id);
        d.root.updateMatrixWorld(true);
        d.measure();
        f.recheck();
        // Placement can change after scale/rotation; fix it in the same pass.
        if (a.fix === 'all' && id !== 'place_on_floor' && f.issues.some((i) => i.fix?.id === 'place_on_floor' && i.severity === 'warn') && !ids.includes('place_on_floor')) ids.push('place_on_floor');
      }
      f.emit('doc', d);
      return { message: messages.length ? messages.join(' ') : 'Nothing needed fixing.', summary: summarize(f.issues), issues: f.issues };
    },
  });

  f.define({
    name: 'list_clips', title: 'List animations', mutates: false,
    description: 'Lists animation clips in the loaded character: name, duration, whether it travels (root motion), and its export mode.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() { f.requireDoc(); return f.clipInfo(); },
  });

  f.define({
    name: 'play_clip', title: 'Preview animation', mutates: false, recordable: false,
    description: 'Plays a clip in the 3D viewport, as it will be exported (in place or root motion). name=null stops playback. library=<id> previews a library animation retargeted onto the character without adding it.',
    inputSchema: { type: 'object', properties: { name: { type: ['string', 'null'] }, library: { type: 'string', description: 'Library animation id to preview, e.g. Run_Fwd.' } }, additionalProperties: false },
    run(a) {
      const d = f.requireDoc();
      if (a.library) {
        requireRig(d);
        const clip = f.previewLibrary(a.library);
        f.playing = 'library:' + a.library;
        f.emit('play', { name: f.playing, clip });
        return { message: `Previewing library animation ${a.library} on ${d.baseName}.` };
      }
      if (a.name === null || a.name === undefined) { f.playing = null; f.emit('play', null); return { message: 'Stopped.' }; }
      const c = d.findClip(a.name);
      if (!c) throw new Error(`No clip named "${a.name}". Clips: ${d.clips.map((x) => d.clipName(x)).join(', ')}`);
      f.playing = d.clipName(c);
      f.emit('play', f.playing);
      return { message: `Playing ${f.playing}.` };
    },
  });

  f.define({
    name: 'update_clip', title: 'Rename / configure animation', mutates: true,
    description: 'Renames a clip, sets its movement mode, or includes/excludes it from export.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Current clip name.' },
        new_name: { type: 'string', description: 'New name (letters, numbers, underscores).' },
        mode: { type: 'string', enum: ['inplace', 'rootmotion', 'keep'], description: 'inplace = remove forward travel; rootmotion = keep travel (moved onto the root bone when one exists); keep = untouched.' },
        include: { type: 'boolean', description: 'false to leave this clip out of the export.' },
      },
      required: ['name'], additionalProperties: false,
    },
    run(a) {
      const d = f.requireDoc();
      const c = d.findClip(a.name);
      if (!c) throw new Error(`No clip named "${a.name}".`);
      let cur = d.clipName(c);
      const msgs = [];
      if (a.new_name) {
        const nn = cleanName(a.new_name);
        if (!nn) throw new Error('new_name has no usable characters.');
        if (f.options.clipModes[cur]) { f.options.clipModes[nn] = f.options.clipModes[cur]; delete f.options.clipModes[cur]; }
        if (f.options.excluded.includes(cur)) f.options.excluded = f.options.excluded.map((x) => (x === cur ? nn : x));
        if (f.playing === cur) f.playing = nn;
        d.clipNames.set(c.uuid, nn); msgs.push(`Renamed ${cur} → ${nn}.`);
        for (const cp of f.captures) if (cp.clipName === cur) cp.clipName = nn;
        cur = nn;
      }
      if (a.mode) { f.options.clipModes[cur] = a.mode; msgs.push(`${cur}: ${a.mode}.`); if (f.playing === cur) f.emit('play', cur); }
      if (typeof a.include === 'boolean') {
        f.options.excluded = f.options.excluded.filter((x) => x !== cur);
        if (!a.include) f.options.excluded.push(cur);
        msgs.push(`${cur} ${a.include ? 'included' : 'excluded'}.`);
      }
      return { message: msgs.join(' ') || 'No changes.', clips: f.clipInfo() };
    },
  });

  f.define({
    name: 'set_export_options', title: 'Set export options', mutates: true,
    description: 'Sets export options. motion applies to all clips without their own mode.',
    inputSchema: {
      type: 'object',
      properties: {
        motion: { type: 'string', enum: ['inplace', 'rootmotion', 'keep'], description: 'Default movement mode for clips.' },
        split_clips: { type: 'boolean', description: 'true = one GLB per animation; false = one GLB with everything (recommended for Unreal).' },
        base_name: { type: 'string', description: 'Base name for files/assets, e.g. "Knight" → SK_Knight, A_Knight_Walk.' },
        bone_naming: { type: 'string', enum: ['auto', ...Object.keys(NAMINGS)], description: 'Skeleton naming standard written into the exported file: ue5 (Unreal Mannequin names), mixamo (mixamorig:Hips …), godot (Godot SkeletonProfileHumanoid: Hips, LeftUpperLeg …), keep (unchanged), or auto (Unreal→ue5, Godot→godot, Unity→mixamo, Blender→keep).' },
      },
      additionalProperties: false,
    },
    run(a) {
      f.requireDoc();
      if (a.bone_naming) f.options.boneNaming = a.bone_naming;
      if (a.motion) { f.options.motion = a.motion; f.options.clipModes = {}; }
      if (typeof a.split_clips === 'boolean') f.options.splitClips = a.split_clips;
      if (a.base_name !== undefined) f.options.baseName = cleanName(a.base_name) || f.doc.baseName;
      if (f.playing) f.emit('play', f.playing);
      return { message: 'Export options updated.', options: f.options, exportNames: f.status().exportNames };
    },
  });

  f.define({
    name: 'export_bundle', title: 'Export', mutates: true,
    description: 'Builds the export: a .zip with the GLB file(s), a step-by-step import guide for the chosen engine, the health report and a replayable recipe. deliver="download" offers it to the user; deliver="base64" returns the zip contents to the caller.',
    inputSchema: { type: 'object', properties: { deliver: { type: 'string', enum: ['download', 'base64', 'none'], default: 'download' } }, additionalProperties: false },
    async run(a) {
      const d = f.requireDoc();
      const deliver = a.deliver || 'download';
      const bundle = await buildBundle(d, f.target, f.options, {
        recipe: { app: 'JustRigIt', version: VERSION, created: new Date().toISOString(), steps: [...f.recipe] },
        report: { target: f.target, character: f.status().character, issues: f.issues },
      });
      f.lastExport = bundle;
      f.step = 'export';
      let delivered = null;
      if (deliver === 'download' && f.hooks.deliver) delivered = await f.hooks.deliver(bundle.names.bundle, bundle.zip);
      f.emit('exported', bundle);
      const res = {
        message: `Built ${bundle.names.bundle} (${(bundle.zip.length / 1024).toFixed(0)} KB): ${bundle.files.map((x) => x.name).join(', ')}.`,
        filename: bundle.names.bundle, bytes: bundle.zip.length, files: bundle.files, delivered,
        guide_markdown: bundle.guide,
      };
      if (deliver === 'base64') res.base64 = bufferToB64(bundle.zip);
      return res;
    },
  });

  f.define({
    name: 'get_import_guide', title: 'Get import guide', mutates: false,
    description: 'Returns the step-by-step engine import guide (Markdown) for the current character, target and options, without exporting.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const d = f.requireDoc();
      const { buildGuide } = await import('./guides.js');
      const { processClip } = await import('./clips.js');
      const names = plannedNames(d, f.target, f.options);
      const modeFor = (c) => f.options.clipModes[d.clipName(c)] || f.options.motion;
      return { markdown: buildGuide(d, f.target, f.options, names, names.clips.map(({ clip, out }) => processClip(d, clip, modeFor(clip), out)), modeFor) };
    },
  });

  f.define({
    name: 'get_bone_map', title: 'Get bone map', mutates: false,
    description: 'Shows which bone in the file was identified as each standard humanoid bone (hips, spine, arms, legs...). Useful for debugging retargeting.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const d = f.requireDoc();
      return {
        skeleton: d.detection.label, confidence: +d.detection.score.toFixed(2),
        map: CANONICAL.map((k) => ({ key: k, label: CANONICAL_LABELS[k], bone: d.detection.map[k]?.name || null })),
        allBones: d.bones.map((b) => ({ name: b.name, parent: b.parent && b.parent.isBone ? b.parent.name : null })),
      };
    },
  });

  f.define({
    name: 'explain_term', title: 'Explain a term', mutates: false,
    description: 'Plain-language explanation of an animation/engine term (what it is, why it matters, when you care). term=null lists all terms.',
    inputSchema: { type: 'object', properties: { term: { type: ['string', 'null'], description: 'e.g. root_motion, in_place, retargeting, root_bone, skinning' } }, required: ['term'], additionalProperties: false },
    run(a) {
      if (!a.term) return Object.entries(GLOSSARY).map(([id, g]) => ({ id, term: g.term }));
      const key = String(a.term).toLowerCase().replace(/[\s-]+/g, '_');
      const g = GLOSSARY[key] || Object.values(GLOSSARY).find((x) => x.term.toLowerCase().includes(String(a.term).toLowerCase()));
      if (!g) throw new Error(`Unknown term. Known: ${Object.keys(GLOSSARY).join(', ')}`);
      return g;
    },
  });

  f.define({
    name: 'go_to_step', title: 'Go to wizard step', mutates: false, recordable: false,
    description: 'Moves the on-screen wizard to a step so the user can see what you are doing.',
    inputSchema: { type: 'object', properties: { step: { type: 'string', enum: ['character', 'target', 'check', 'animations', 'export'] } }, required: ['step'], additionalProperties: false },
    run(a) { f.step = a.step; f.emit('state', f.status()); return { message: `Showing step: ${a.step}.` }; },
  });

  f.define({
    name: 'get_viewport_snapshot', title: 'Snapshot viewport', mutates: false,
    description: 'Returns a picture (PNG) of the character so a vision-capable AI can check the rig and animations. Optional: clip + time (seconds) to pose it at a moment of an animation, and views (front, side, three_quarter, back). Look at it after auto_rig, after adding animations and before exporting.',
    inputSchema: { type: 'object', properties: {
      clip: { type: 'string', description: 'Animation to pose (omit for the rest pose).' },
      time: { type: 'number', description: 'Seconds into the animation (default: the middle).' },
      views: { type: 'array', items: { type: 'string', enum: ['front', 'side', 'three_quarter', 'back'] }, description: 'Default front + side (MCP server).' },
    }, additionalProperties: false },
    async run(a) {
      if (!f.hooks.snapshot) throw new Error('No viewport in this environment.');
      const r = await f.hooks.snapshot(a || {});
      return typeof r === 'string' ? { image: r } : r;
    },
  });


  f.define({
    name: 'capture_status', title: 'Check video capture engine', mutates: false,
    description: 'Checks whether JustRigIt Capture (the local video motion-capture engine, NVIDIA GEM-X on the user\'s GPU) is running. Returns online, demo (true = model not installed, captures return a sample walk), problems (plain-English install issues), gpu, and filming tips. Optional url changes the engine address (default http://127.0.0.1:8790).',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, start: { type: 'boolean', default: true, description: 'If the engine is installed but not running, start it (MCP server only).' } }, additionalProperties: false },
    async run(a) {
      if (a.url) f.captureUrl = String(a.url).replace(/\/$/, '');
      let st = await captureStatus(f.captureUrl);
      let started = null;
      if (!st.online && a.start !== false && f.hooks.ensureEngine) {
        started = await f.hooks.ensureEngine(f.captureUrl);
        st = await captureStatus(f.captureUrl);
      }
      const help = st.online
        ? (st.demo ? 'The engine is running in DEMO mode (the GEM-X model is not installed yet), so captures return a sample walk. Run capture\\install_capture.ps1 to install the model.' : `Ready${st.gpu ? ' on ' + st.gpu : ''}.`)
        : 'The capture engine is not running. Double-click Start-Capture.bat in the JustRigIt folder (first time: run capture\\install_capture.ps1), then try again.';
      return { ...st, message: (started && started.started && st.online ? 'Started the capture engine. ' : '') + help + (started && !st.online && started.reason ? ' ' + started.reason : ''), tips: CAPTURE_TIPS, pendingJobs: [...f.pendingCaptures.keys()] };
    },
  });

  f.define({
    name: 'capture_video', title: 'Capture animation from video', mutates: true,
    description: 'Motion capture from a video of a person (e.g. filmed on a phone): runs NVIDIA GEM-X on the user\'s GPU via the local JustRigIt Capture engine, cleans the motion (floor, facing, smoothing, foot contacts), retargets it onto the loaded character with foot locking and adds it as a clip. Provide the video as base64 + filename (mp4/mov/mkv/avi/webm). camera: static (tripod, best) | background (handheld) | vipe (moving camera, needs ViPE). Max 60 s per capture — use start/duration for longer videos. A capture takes from a few seconds to a few minutes: with wait_seconds the call returns after that long with state "running" and a job_id — then call wait_for_capture {job_id} until it is done.',
    inputSchema: {
      type: 'object',
      properties: {
        base64: { type: 'string', description: 'Video file contents (base64).' },
        filename: { type: 'string', description: 'Video file name with extension.' },
        name: { type: 'string', description: 'Name for the new animation clip (default: from the file name).' },
        camera: { type: 'string', enum: ['static', 'background', 'vipe'], default: 'static' },
        start: { type: 'number', description: 'Start time in seconds.' },
        duration: { type: 'number', description: 'Length in seconds (max 60).' },
        smoothing: { type: 'string', enum: ['off', 'light', 'medium', 'strong'], default: 'light' },
        fingers: { type: 'boolean', default: true, description: 'Capture finger motion (false = relaxed hands).' },
        foot_lock: { type: 'boolean', default: true, description: 'Pin planted feet to the floor on the character.' },
        wait_seconds: { type: 'number', description: 'Return after this many seconds even if the capture is still running (it keeps going; use wait_for_capture). Omit to wait until done.' },
      },
      additionalProperties: false,
    },
    async run(a) {
      const d = f.requireDoc();
      requireRig(d);
      const bytes = a.buffer || (a.base64 ? b64ToBuffer(a.base64) : null);
      if (!bytes) throw new Error('Provide the video as base64 + filename.');
      const filename = a.filename || 'video.mp4';
      let st = await captureStatus(f.captureUrl);
      if (!st.online && f.hooks.ensureEngine) { await f.hooks.ensureEngine(f.captureUrl); st = await captureStatus(f.captureUrl); }
      if (!st.online) throw new Error('The JustRigIt Capture engine is not running. Double-click Start-Capture.bat (first time: run capture\\install_capture.ps1), then try again.');
      f.emit('capture-progress', { progress: 0, message: 'Uploading video to the capture engine…' });
      const job = await startCapture(f.captureUrl, bytes, filename, { camera: a.camera || 'static', smoothing: a.smoothing || 'light', start: a.start, duration: a.duration, fingers: a.fingers !== false });
      f.pendingCaptures.set(job.id, { filename, name: a.name, camera: a.camera || 'static', footLock: a.foot_lock !== false, demo: !!st.demo, startedAt: Date.now() });
      return awaitCapture(job.id, a.wait_seconds);
    },
  });

  f.define({
    name: 'wait_for_capture', title: 'Wait for a running capture', mutates: true,
    description: 'Continues a capture started by capture_video that returned state "running". Waits up to wait_seconds (default 40) and then either finishes it (the animation is added to the character, same result as capture_video) or returns state "running" again with the latest progress — call it again until it is done.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' }, wait_seconds: { type: 'number', default: 40 } }, required: ['job_id'], additionalProperties: false },
    async run(a) { return awaitCapture(a.job_id, a.wait_seconds ?? 40); },
  });

  f.define({
    name: 'cancel_capture', title: 'Cancel a running capture', mutates: true,
    description: 'Stops a capture that is still running (job_id from capture_video).',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'], additionalProperties: false },
    async run(a) {
      if (!f.pendingCaptures.has(a.job_id)) throw new Error(`No running capture "${a.job_id}".`);
      await cancelJob(f.captureUrl, a.job_id).catch(() => {});
      f.pendingCaptures.delete(a.job_id);
      return { message: 'Capture cancelled.' };
    },
  });

  async function awaitCapture(jobId, waitSeconds) {
    const pend = f.pendingCaptures.get(jobId);
    if (!pend) throw new Error(`No running capture "${jobId}". It may have finished already — call list_clips.`);
    const progress = (j) => f.emit('capture-progress', { progress: j.progress, message: j.message, job_id: jobId });
    let done;
    try {
      done = await waitForJob(f.captureUrl, jobId, progress, waitSeconds != null ? { deadlineMs: Math.max(0, waitSeconds) * 1000 } : {});
    } catch (e) { f.pendingCaptures.delete(jobId); throw e; }
    if (done.pending) {
      const j = done.job || {};
      const pct = Math.round((j.progress || 0) * 100);
      return { state: 'running', job_id: jobId, progress: j.progress || 0, stage: j.message || '', elapsedSeconds: Math.round((Date.now() - pend.startedAt) / 1000),
        message: `Still capturing (${pct}%${j.message ? ' — ' + j.message : ''}). Call wait_for_capture {"job_id":"${jobId}"} to continue.` };
    }
    f.pendingCaptures.delete(jobId);
    return finishCapture(jobId, done, pend);
  }

  async function finishCapture(jobId, done, pend) {
    const d = f.requireDoc();
    requireRig(d);
    const filename = pend.filename;
    f.emit('capture-progress', { progress: 0.97, message: 'Retargeting onto your character…' });
    const glb = await fetchResult(f.captureUrl, jobId, 'glb');
    let bvh = null; try { bvh = await fetchResult(f.captureUrl, jobId, 'bvh'); } catch { /* optional */ }
    const src = await loadFromArrayBuffer(glb.slice(0), filename.replace(/\.[^.]+$/, '') + '.glb');
    if (!src.clips.length) throw new Error('The capture engine returned no animation.');
    const base = cleanName(pend.name || ('Capture_' + filename.replace(/\.[^.]+$/, ''))) || 'Capture';
    f.lastCapture = { name: base, glb: new Uint8Array(glb), bvh: bvh ? new Uint8Array(bvh) : null, stats: done.stats };
    const clip = retargetClip(src, src.clips[0], d, { name: base, footLock: pend.footLock });
    const cap = src.clips[0].userData.jrcapture || {};
    const meta = { source: filename, capture: { video: filename, engine: cap.engine || (pend.demo ? 'demo' : 'NVIDIA GEM-X'), stats: done.stats, camera: pend.camera } };
    const nm = putClip(d, clip, meta);
    f.captures = f.captures.filter((cp) => cp.clipName !== nm);
    f.captures.push({ clipName: nm, glb: new Uint8Array(glb), filename, meta, footLock: pend.footLock, demo: pend.demo });
    f.recheck();
    f.emit('doc-clips', d);
    f.emit('capture-progress', { progress: 1, message: 'Done' });
    const s = done.stats || {}, fl = clip.userData.footLock;
    const msg = `Captured "${nm}" from ${filename}${pend.demo ? ' (DEMO mode: sample walk — install the model for real captures)' : ''}: ${s.seconds ?? clip.duration.toFixed(1)} s, ${s.travelMeters ?? 0} m travel` +
      (fl ? `, foot sliding ${fl.skateBeforeCm} → ${fl.skateAfterCm} cm after foot locking.` : '.');
    return { state: 'done', message: msg, clip: nm, demo: pend.demo, stats: s, footLock: fl || null, clips: f.clipInfo() };
  }

  f.define({
    name: 'reapply_captures', title: 'Move captures onto this character', mutates: true,
    description: 'Retargets every video capture made in this session onto the currently loaded character (use after loading a different character). Captures that are already on it are replaced.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const d = f.requireDoc();
      requireRig(d);
      const added = [];
      for (const cp of f.captures) {
        const src = await loadFromArrayBuffer(cp.glb.slice().buffer, cp.filename.replace(/\.[^.]+$/, '') + '.glb');
        if (!src.clips.length) continue;
        const clip = retargetClip(src, src.clips[0], d, { name: cp.clipName, footLock: cp.footLock });
        putClip(d, clip, cp.meta, added);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (added.length) { f.recheck(); f.emit('doc-clips', d); }
      return { message: added.length ? `Moved ${added.length} capture(s) onto ${d.baseName}: ${added.join(', ')}.` : 'No captures to move.', added, clips: f.clipInfo() };
    },
  });

  f.define({
    name: 'export_capture', title: 'Download raw capture', mutates: false,
    description: 'Downloads the most recent raw capture (before retargeting) on its own SOMA skeleton, as GLB or BVH — useful for Blender, MotionBuilder or other retargeting tools.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['glb', 'bvh'], default: 'glb' }, deliver: { type: 'string', enum: ['download', 'base64'], default: 'download' } }, additionalProperties: false },
    async run(a) {
      const c = f.lastCapture;
      if (!c) throw new Error('No capture yet — run capture_video first.');
      const fmt = a.format || 'glb';
      const bytes = fmt === 'bvh' ? c.bvh : c.glb;
      if (!bytes) throw new Error(`No ${fmt.toUpperCase()} available for the last capture.`);
      const filename = `${c.name}_SOMA.${fmt}`;
      if ((a.deliver || 'download') === 'base64') return { filename, base64: bufferToB64(bytes), bytes: bytes.length };
      const delivered = f.hooks.deliver ? await f.hooks.deliver(filename, bytes) : null;
      return { message: `Saved ${filename} (${(bytes.length / 1024).toFixed(0)} KB).`, filename, delivered };
    },
  });

  f.define({
    name: 'list_library', title: 'List animation library', mutates: false,
    description: 'Lists the built-in CC0 animation library (idle, walk/run in 8 directions, jumps, crouch, wave) and the one-click packs. Speeds are m/s; direction uses Unreal\'s Calculate Direction convention (0 forward, +90 right, -90 left, 180 back).',
    inputSchema: { type: 'object', properties: { category: { type: 'string', description: 'Optional filter: Idle, Walk, Run, Jump, Crouch, Gesture.' } }, additionalProperties: false },
    run(a) {
      const items = catalog().filter((e) => !a.category || e.category.toLowerCase() === String(a.category).toLowerCase());
      return { animations: items, packs: Object.values(PACKS) };
    },
  });

  f.define({
    name: 'add_animations', title: 'Add animations', mutates: true,
    description: 'Retargets animations onto the loaded character and adds them to the export. Sources: pack (a pack id from list_library), clips (library ids), or a file (base64 + filename of any rigged GLB/FBX with animations, e.g. a Mixamo or Quaternius download; optional file_clips to pick some). Existing clips with the same name are replaced.',
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string', enum: Object.keys(PACKS) },
        clips: { type: 'array', items: { type: 'string' }, description: 'Library animation ids.' },
        base64: { type: 'string', description: 'Animation file contents (base64).' },
        filename: { type: 'string', description: 'Animation file name with extension.' },
        file_clips: { type: 'array', items: { type: 'string' }, description: 'Only these clip names from the file.' },
        foot_lock: { type: 'boolean', description: 'Pin planted feet to the floor (anti foot-sliding). Default: on for JustRigIt Capture files, off otherwise.' },
      },
      additionalProperties: false,
    },
    async run(a) {
      const d = f.requireDoc();
      requireRig(d);
      const added = [];
      const put = (clip, meta) => putClip(d, clip, meta, added);
      if (a.pack || a.clips) {
        const ids = [...(a.pack ? PACKS[a.pack]?.clips || [] : []), ...(a.clips || [])];
        if (!ids.length) throw new Error('Unknown pack, or no clips given.');
        const src = libraryRig();
        for (const id of [...new Set(ids)]) {
          const lc = libraryClip(id);
          if (!lc) throw new Error(`No library animation "${id}". Call list_library.`);
          const rc = retargetClip(src, lc.clip, d, { name: lc.entry.id });
          put(rc, { lib: { id: lc.entry.id, speed: lc.entry.speed, direction: lc.entry.direction, loop: lc.entry.loop, category: lc.entry.category } });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (a.base64 || a.buffer) {
        const buf = a.buffer || b64ToBuffer(a.base64);
        const src = await loadFromArrayBuffer(buf, a.filename || 'animations.glb');
        if (!src.clips.length) throw new Error('That file has no animations in it.');
        if (src.detection.missing.length > 4) throw new Error(`Couldn't recognise a humanoid skeleton in ${src.sourceName} (${src.detection.label}).`);
        const picked = src.clips.filter((c) => (!a.file_clips || a.file_clips.includes(c.name)) && c.duration > 0 && c.tracks.length);
        picked.forEach((c, i) => {
          const generic = /mixamo\.com|mixamo_com|^take|^clip_?\d*$|^animation$/i.test(c.name);
          const base = picked.length === 1 ? (generic ? src.baseName : c.name) : (generic ? `${src.baseName}_${i + 1}` : c.name);
          const cap = c.userData && c.userData.jrcapture;
          put(retargetClip(src, c, d, { name: base, footLock: a.foot_lock }), cap ? { source: src.sourceName, capture: { video: cap.video, engine: cap.engine, stats: cap.stats } } : { source: src.sourceName });
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!added.length) throw new Error('Nothing was added.');
      f.recheck();
      f.emit('doc-clips', d);
      return { message: `Added ${added.length} animation(s) to ${d.baseName}: ${added.join(', ')}.`, added, clips: f.clipInfo() };
    },
  });

  f.define({
    name: 'remove_clip', title: 'Remove animation', mutates: true,
    description: 'Removes an animation clip from the character.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    run(a) {
      const d = f.requireDoc();
      const c = d.findClip(a.name);
      if (!c) throw new Error(`No clip named "${a.name}".`);
      const nm = d.clipName(c);
      d.clips.splice(d.clips.indexOf(c), 1);
      d.clipNames.delete(c.uuid);
      f.captures = f.captures.filter((cp) => cp.clipName !== nm);
      if (f.playing === nm) { f.playing = null; f.emit('play', null); }
      f.recheck();
      return { message: `Removed ${nm}.` };
    },
  });

  f.define({
    name: 'get_rig_markers', title: 'Get rig markers', mutates: false,
    description: 'For a character WITHOUT a skeleton: returns the 8 auto-rig markers (chin, wrists, elbows, knees, groin) as [x, y] in meters, front view, character facing +Z. The character\'s LEFT side is +X (appears on the RIGHT of the screen). Also returns the bounding box to help you judge positions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const d = f.requireDoc();
      if (d.skinnedMeshes.length) throw new Error('This character already has a skeleton.');
      const g = gatherMesh(d);
      return { markers: f.rigMarkers, labels: MARKER_LABELS, box: g.box };
    },
  });

  f.define({
    name: 'set_rig_markers', title: 'Move rig markers', mutates: true,
    description: 'Moves auto-rig markers. markers = { chin: [x, y], leftWrist: [x, y], ... } in meters (front view). mirror=true (default) copies left/right changes to the other side.',
    inputSchema: {
      type: 'object',
      properties: {
        markers: { type: 'object', properties: Object.fromEntries(MARKERS.map((m) => [m, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }])), additionalProperties: false },
        mirror: { type: 'boolean', default: true },
      },
      required: ['markers'], additionalProperties: false,
    },
    run(a) {
      const d = f.requireDoc();
      if (!f.rigMarkers) throw new Error('No rig markers: the character already has a skeleton.');
      const x0 = gatherMesh(d).box.x0;
      for (const [k, v] of Object.entries(a.markers)) {
        if (!MARKERS.includes(k)) continue;
        f.rigMarkers[k] = [+v[0], +v[1]];
        if (a.mirror !== false && MIRROR[k]) f.rigMarkers[MIRROR[k]] = [2 * x0 - v[0], +v[1]];
        if (a.mirror !== false && (k === 'chin' || k === 'groin')) f.rigMarkers[k][0] = x0;
      }
      f.emit('markers', f.rigMarkers);
      return { message: 'Markers updated.', markers: f.rigMarkers };
    },
  });

  f.define({
    name: 'auto_place_markers', title: 'Auto-place markers', mutates: true,
    description: 'Re-guesses all 8 auto-rig markers from the mesh shape.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const d = f.requireDoc();
      if (d.skinnedMeshes.length) throw new Error('This character already has a skeleton.');
      f.rigMarkers = guessMarkers(gatherMesh(d));
      f.emit('markers', f.rigMarkers);
      return { message: 'Markers placed automatically.', markers: f.rigMarkers };
    },
  });

  f.define({
    name: 'rotate_character', title: 'Rotate character', mutates: true,
    description: 'Turns an un-rigged character around the vertical axis (degrees, e.g. 90, -90, 180) so it faces forward (+Z, towards the camera in the front view) before auto-rigging.',
    inputSchema: { type: 'object', properties: { degrees: { type: 'number' } }, required: ['degrees'], additionalProperties: false },
    run(a) {
      const d = f.requireDoc();
      d.root.rotation.y += THREE_DEG(a.degrees);
      d.root.updateMatrixWorld(true);
      d.measure();
      FIXES.place_on_floor.run(d);
      d.root.updateMatrixWorld(true);
      d.measure();
      if (!d.skinnedMeshes.length) f.rigMarkers = guessMarkers(gatherMesh(d));
      f.emit('doc', d);
      return { message: `Rotated ${a.degrees}°.` };
    },
  });

  f.define({
    name: 'auto_rig', title: 'Auto-rig', mutates: true,
    description: 'Builds a skeleton (Unreal-5-mannequin style: root, pelvis, spine_01-05, neck_01, head, clavicles, arms, legs, feet) for a character that has none, using the current markers, and computes smooth skin weights. Takes a few seconds. Afterwards the character behaves like any rigged character (health check, animations, export).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const d = f.requireDoc();
      if (d.skinnedMeshes.length) throw new Error('This character already has a skeleton.');
      const t0 = Date.now();
      const res = await autoRig(d, f.rigMarkers, (p, msg) => f.emit('progress', { p, msg }));
      res.doc.baseName = d.baseName;
      const step = f.step;
      await f.setDoc(res.doc);
      f.step = step === 'character' ? 'target' : step;
      f.emit('progress', null);
      return { message: `Rigged ${d.baseName} in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${res.stats.bones} bones, ${res.stats.vertices.toLocaleString()} vertices weighted.`, stats: res.stats };
    },
  });

  f.define({
    name: 'get_recipe', title: 'Get recipe', mutates: false,
    description: 'Returns every state-changing command run so far, as a replayable list. Save it to repeat the same export on another character.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => ({ app: 'JustRigIt', version: VERSION, steps: [...f.recipe] }),
  });

  f.define({
    name: 'run_recipe', title: 'Run recipe', mutates: false, recordable: false,
    description: 'Runs a list of commands in order: steps=[{tool, args}]. Stops at the first error. Load steps with omitted file data are skipped — load the character first.',
    inputSchema: {
      type: 'object',
      properties: { steps: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool'] } } },
      required: ['steps'], additionalProperties: false,
    },
    async run(a) {
      const results = [];
      for (const s of a.steps) {
        if (s.tool === 'run_recipe') continue;
        if (s.tool === 'load_character' && s.args && (String(s.args.base64 || '').startsWith('<') || String(s.args.buffer || '').startsWith('<'))) { results.push({ tool: s.tool, skipped: 'file data not stored in recipe' }); continue; }
        const r = await f.call(s.tool, s.args || {}, 'recipe');
        results.push({ tool: s.tool, message: r?.message });
      }
      return { message: `Ran ${results.length} step(s).`, results };
    },
  });
}

const THREE_DEG = (d) => (d * Math.PI) / 180;

function requireRig(d) {
  if (!d.skinnedMeshes.length) throw new Error('This character has no skeleton yet. Run auto_rig first.');
}

// Un-rigged meshes: fix units and placement up front, then guess the markers.
function prepareForRigging(doc, f) {
  const h = doc.metrics.height;
  if (h > 20) doc.root.scale.multiplyScalar(0.01);
  else if (h > 0 && h < 0.05) doc.root.scale.multiplyScalar(100);
  doc.root.updateMatrixWorld(true);
  doc.measure();
  FIXES.place_on_floor.run(doc);
  doc.root.updateMatrixWorld(true);
  doc.measure();
  try { f.rigMarkers = guessMarkers(gatherMesh(doc)); } catch { f.rigMarkers = null; }
}
