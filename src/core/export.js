import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { zipSync, strToU8 } from 'fflate';
import { TARGETS } from './targets.js';
import { processClip, isLooping } from './clips.js';
import { cleanName } from './character.js';
import { buildGuide } from './guides.js';
import { namingMap, renameGLB, defaultNaming } from './naming.js';

export function effectiveNaming(targetId, opts) {
  return (opts && opts.boneNaming && opts.boneNaming !== 'auto') ? opts.boneNaming : defaultNaming(targetId);
}

export function plannedNames(doc, targetId, opts) {
  const t = TARGETS[targetId] || TARGETS.ue5;
  const base = cleanName(opts.baseName || doc.baseName) || 'Character';
  const mesh = t.meshPrefix + base;
  const clips = doc.clips
    .filter((c) => !opts.excluded || !opts.excluded.includes(doc.clipName(c)))
    .map((c) => {
      let out = t.clipPrefix + base + '_' + doc.clipName(c);
      // Godot sets an animation's loop flag on import when its name ends with "loop".
      if (t.id === 'godot' && isLooping(c) && !/(loop|cycle)$/i.test(out)) out += '_loop';
      return { clip: c, out, loop: isLooping(c) };
    });
  return { mesh, clips, bundle: `${mesh}_${t.short}.zip` };
}

function exportGLB(object, animations) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(object, (res) => resolve(new Uint8Array(res)), (e) => reject(e), {
      binary: true, animations, onlyVisible: false,
    });
  });
}

// Returns { zip: Uint8Array, files: [{name, size}], names }
export async function buildBundle(doc, targetId, opts, extras = {}) {
  const names = plannedNames(doc, targetId, opts);
  doc.restPose();
  const modeFor = (c) => (opts.clipModes && opts.clipModes[doc.clipName(c)]) || opts.motion || 'inplace';
  const processed = names.clips.map(({ clip, out }) => processClip(doc, clip, modeFor(clip), out));
  const files = {};
  const prevName = doc.root.name;
  const naming = effectiveNaming(targetId, opts);
  const nmap = namingMap(doc, naming);
  const glb = async (anims) => renameGLB(await exportGLB(doc.root, anims), nmap);
  doc.root.name = names.mesh;
  try {
    if (opts.splitClips && processed.length) {
      files[`${names.mesh}.glb`] = await glb([]);
      for (const c of processed) files[`${c.name}.glb`] = await glb([c]);
    } else {
      files[`${names.mesh}.glb`] = await glb(processed);
    }
  } finally {
    doc.root.name = prevName;
  }
  const guide = buildGuide(doc, targetId, { ...opts, naming, namingMap: nmap }, names, processed, modeFor);
  files[`IMPORT_GUIDE_${TARGETS[targetId].short}.md`] = strToU8(guide);
  if (extras.recipe) files['justrigit-recipe.json'] = strToU8(JSON.stringify(extras.recipe, null, 2));
  if (extras.report) files['health-report.json'] = strToU8(JSON.stringify(extras.report, null, 2));
  const zip = zipSync(files, { level: 6 });
  return {
    zip, guide, names,
    files: Object.entries(files).map(([name, d]) => ({ name, size: d.length })),
  };
}
