import * as THREE from 'three';

function posTrack(clip, bone) {
  if (!bone) return null;
  return clip.tracks.find((t) => t.name === `${bone.name}.position`) || null;
}

// How far (meters) does the clip carry the hips horizontally from first to last frame?
export function analyzeTravel(doc, clip) {
  const hips = doc.bone('hips');
  const tr = posTrack(clip, hips);
  const root = doc.rootBone();
  const rtr = posTrack(clip, root);
  let dist = 0;
  const s = doc.metrics.hipsParentScale; // world scale of the hips' parent (includes any fixes)
  if (tr && tr.values.length >= 6) {
    const v = tr.values, n = v.length;
    dist = Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) * s;
  }
  let rootDist = 0;
  if (rtr && rtr.values.length >= 6) {
    const v = rtr.values, n = v.length;
    rootDist = Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) * s;
  }
  const threshold = Math.max(0.15, (doc.metrics.height || 1.7) * 0.08);
  return {
    hipsTravel: dist, rootTravel: rootDist,
    moves: clip.duration > 0.2 && (dist > threshold || rootDist > threshold),
    speed: clip.duration > 0 ? (Math.max(dist, rootDist) / clip.duration) : 0,
  };
}

// mode: 'inplace' | 'rootmotion' | 'keep'
// Returns a NEW clip; the original is never modified.
export function processClip(doc, clip, mode, newName) {
  const out = clip.clone();
  out.name = newName || clip.name;
  if (mode === 'keep') return out;
  const hips = doc.bone('hips');
  const root = doc.rootBone();
  const ht = posTrack(out, hips);
  if (!ht) return out;
  const v = ht.values, times = ht.times, n = times.length;
  if (n < 2) return out;
  const T = times[n - 1] - times[0] || 1;
  const dx = v[(n - 1) * 3] - v[0];
  const dz = v[(n - 1) * 3 + 2] - v[2];
  const travel = analyzeTravel(doc, clip);

  // Linear drift removed from the hips; the natural side-to-side sway stays.
  const drift = (i) => (times[i] - times[0]) / T;

  if (mode === 'inplace') {
    for (let i = 0; i < n; i++) {
      v[i * 3] -= dx * drift(i);
      v[i * 3 + 2] -= dz * drift(i);
    }
    const rt = posTrack(out, root);
    if (rt) {
      const r = rt.values;
      for (let i = 0; i < r.length; i += 3) { r[i] = r[0]; r[i + 2] = r[2]; }
    }
    return out;
  }

  if (mode === 'rootmotion') {
    // Move the travel from the hips onto the root bone (if there is one directly above the hips
    // and its local transform is identity, so both live in the same space).
    if (!root || hips.parent !== root || !travel.moves) return out;
    const identity = root.position.lengthSq() < 1e-8 && Math.abs(root.quaternion.w) > 0.9999 && Math.abs(root.scale.x - 1) < 1e-6;
    if (!identity) return out;
    if (posTrack(out, root) && travel.rootTravel > 0.01) return out; // already on root
    const rv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = drift(i);
      rv[i * 3] = dx * f; rv[i * 3 + 1] = 0; rv[i * 3 + 2] = dz * f;
      v[i * 3] -= dx * f;
      v[i * 3 + 2] -= dz * f;
    }
    out.tracks = out.tracks.filter((t) => t.name !== `${root.name}.position`);
    out.tracks.push(new THREE.VectorKeyframeTrack(`${root.name}.position`, Array.from(times), rv));
    return out;
  }
  return out;
}

// Does the clip end where it starts (a cycle)? Library clips say so explicitly;
// for anything else, compare the first and last keyframe of every track.
export function isLooping(clip) {
  const lib = clip.userData && clip.userData.lib;
  if (lib && typeof lib.loop === 'boolean') return lib.loop;
  if (clip.duration < 0.3) return false;
  for (const t of clip.tracks) {
    const n = t.getValueSize(), v = t.values, last = v.length - n;
    if (last <= 0) continue;
    const isPos = t.name.endsWith('.position');
    for (let i = 0; i < n; i++) {
      const d = Math.abs(v[i] - v[last + i]);
      if (isPos ? false : d > 0.05) return false;
    }
  }
  return true;
}
