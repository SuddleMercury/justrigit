// Skeleton naming standards for export.
//
// Engines and tools recognise a humanoid by its bone NAMES:
//   - Unreal's IK Retargeter auto-maps the UE5 Mannequin names (pelvis, spine_01, thigh_l …)
//   - Godot's importer auto-maps SkeletonProfileHumanoid names (Hips, Spine, LeftUpperLeg …)
//   - Unity's Humanoid avatar, Blender add-ons and most mocap tools auto-map Mixamo names
//     (mixamorig:Hips, mixamorig:LeftUpLeg …)
// Renaming happens on the exported GLB file only — the character in the app is untouched.
// (three.js can't hold ":" in bone names, which Mixamo naming needs, so we rename in the file.)
import { CANONICAL, PROFILES } from './profiles.js';

export const NAMINGS = {
  keep: { id: 'keep', label: 'Keep original names', blurb: 'Bone names stay exactly as they are in your file.' },
  ue5: { id: 'ue5', label: 'Unreal Mannequin (UE5)', blurb: 'pelvis, spine_01, thigh_l … — Unreal\'s IK Retargeter maps it to Manny/Quinn/MetaHumans automatically.' },
  mixamo: { id: 'mixamo', label: 'Mixamo', blurb: 'mixamorig:Hips, mixamorig:LeftUpLeg … — understood by Unity Humanoid, Blender add-ons, Godot, Unreal and most mocap tools.' },
  godot: { id: 'godot', label: 'Godot humanoid', blurb: 'Hips, Spine, LeftUpperLeg … (SkeletonProfileHumanoid) — Godot maps it automatically, so animations are shareable between Godot characters.' },
};

export function defaultNaming(targetId) {
  if (targetId === 'ue5' || targetId === 'ue4') return 'ue5';
  if (targetId === 'godot') return 'godot';
  if (targetId === 'unity') return 'mixamo';
  return 'keep';
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

// Assign standard names to a chain of bones (e.g. spine_01 … chest). The ends always get
// the first/last standard name; middle bones fill the middle names in order.
function assignChain(bones, names, out) {
  const n = bones.length, m = names.length;
  if (!n || !m) return;
  if (n === 1) { out.set(bones[0], names[0]); return; }
  out.set(bones[0], names[0]);
  out.set(bones[n - 1], names[m - 1]);
  const mids = bones.slice(1, -1), midNames = names.slice(1, -1);
  if (!midNames.length) return;
  mids.forEach((b, i) => {
    if (mids.length <= midNames.length) {
      // spread evenly: 1 middle bone of 3 names → the middle name
      const idx = Math.round(((i + 1) * (midNames.length + 1)) / (mids.length + 1)) - 1;
      out.set(b, midNames[Math.min(midNames.length - 1, Math.max(0, idx))]);
    } else if (i < midNames.length) {
      out.set(b, midNames[i]);
    }
  });
}

function chainBetween(top, bottom) {
  // bones from `bottom` up to `top` (inclusive), returned top-first; null if not an ancestor
  const list = [];
  let b = bottom;
  while (b && b.isBone) { list.push(b); if (b === top) return list.reverse(); b = b.parent; }
  return null;
}

// Returns Map(oldName -> newName) for the doc's bones.
export function namingMap(doc, namingId) {
  if (!namingId || namingId === 'keep') return new Map();
  const prof = PROFILES[namingId];
  if (!prof) throw new Error(`Unknown naming "${namingId}". Use one of: ${Object.keys(NAMINGS).join(', ')}.`);
  const byBone = new Map();
  for (const k of CANONICAL) {
    const b = doc.bone(k);
    if (!b || k === 'spine' || k === 'chest' || k === 'neck') continue;
    const nm = first(prof.bones[k]);
    if (nm) byBone.set(b, nm);
  }
  const spine = doc.bone('spine'), chest = doc.bone('chest'), neck = doc.bone('neck'), head = doc.bone('head');
  if (spine && chest && spine !== chest) {
    const ch = chainBetween(spine, chest);
    if (ch) assignChain(ch, prof.spineChain || [first(prof.bones.spine), first(prof.bones.chest)], byBone);
    else { byBone.set(spine, first(prof.bones.spine)); byBone.set(chest, (prof.spineChain || []).slice(-1)[0] || first(prof.bones.chest)); }
  } else if (spine) byBone.set(spine, first(prof.bones.spine));
  if (neck) {
    const ch = head ? chainBetween(neck, head.parent) : null;
    if (ch && ch.length) assignChain(ch, prof.neckChain || [first(prof.bones.neck)], byBone);
    else byBone.set(neck, first(prof.bones.neck));
  }
  const root = doc.rootBone();
  if (root && prof.rootName && !byBone.has(root)) byBone.set(root, prof.rootName);

  // Finger tips (the bone after each distal joint) follow the same style: index_03_l → index_04_l,
  // LeftHandIndex3 → LeftHandIndex4, LeftIndexDistal → LeftIndexTip.
  for (const k of CANONICAL) {
    if (!/Distal$/.test(k)) continue;
    const b = doc.bone(k), nm = byBone.get(b);
    if (!b || !nm) continue;
    const tip = (b.children || []).find((c) => c.isBone && !byBone.has(c));
    if (!tip) continue;
    const tn = nm.includes('_03_') ? nm.replace('_03_', '_04_') : /3$/.test(nm) ? nm.replace(/3$/, '4') : /Distal$/.test(nm) ? nm.replace(/Distal$/, 'Tip') : nm + '_end';
    byBone.set(tip, tn);
  }
  const pre = prof.exportPrefix || '';
  const map = new Map();
  for (const [b, nm] of byBone) map.set(b.name, pre + nm);
  // Other extra bones lose the source tool's prefix (mixamorig:, mixamorig1_ …) and take the target's.
  for (const b of doc.bones) {
    if (map.has(b.name)) continue;
    const bare = b.name.replace(/^mixamorig\d*[:_]?/i, '');
    const used = new Set(map.values());
    if (bare && bare !== b.name && !used.has(pre + bare) && !doc.bones.some((o) => o !== b && o.name === pre + bare)) map.set(b.name, pre + bare);
  }
  // Bones we don't rename must not collide with a new name.
  const taken = new Set(map.values());
  for (const b of doc.bones) {
    if (map.has(b.name)) continue;
    if (taken.has(b.name) || taken.has(pre + b.name)) {
      let alt = b.name + '_orig', i = 2;
      while (taken.has(alt)) alt = `${b.name}_orig${i++}`;
      map.set(b.name, alt); taken.add(alt);
    }
  }
  for (const [o, nw] of [...map]) if (o === nw) map.delete(o);
  return map;
}

// Rename nodes inside a GLB (binary glTF) buffer. Animations reference nodes by index,
// so only the names change.
export function renameGLB(u8, map) {
  if (!map || !map.size) return u8;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
  for (const node of json.nodes || []) if (node.name && map.has(node.name)) node.name = map.get(node.name);
  const rest = u8.subarray(20 + jsonLen); // remaining chunks (BIN), untouched
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) { const p = new Uint8Array(js.length + pad); p.set(js); p.fill(0x20, js.length); js = p; }
  const out = new Uint8Array(12 + 8 + js.length + rest.length);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, 0x46546c67, true); ov.setUint32(4, 2, true); ov.setUint32(8, out.length, true);
  ov.setUint32(12, js.length, true); ov.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20); out.set(rest, 20 + js.length);
  return out;
}
