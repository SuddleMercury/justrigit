import * as THREE from 'three';
import { CANONICAL, FINGERS } from './profiles.js';

// Retargeting: copy an animation from a source skeleton onto a target skeleton.
//
// Method (per canonical bone, in world space):
//   D(t)  = S_world(t) * S_rest_world⁻¹        how far the source bone rotated from its rest pose
//   D'(t) = F * D(t) * F⁻¹                      F = yaw that turns the source's facing into the target's
//   A     = shortest rotation taking the target bone's rest direction onto the source's rest direction
//           (this is what makes T-pose ↔ A-pose work)
//   T_world(t) = D'(t) * A * T_rest_world
// The hips' translation is copied as an offset from rest, scaled by the ratio of hip heights.

const CHILD = {
  hips: [], spine: ['chest', 'neck', 'head'], chest: ['neck', 'head'], neck: ['head'], head: [],
  leftShoulder: ['leftUpperArm'], leftUpperArm: ['leftLowerArm'], leftLowerArm: ['leftHand'], leftHand: [],
  rightShoulder: ['rightUpperArm'], rightUpperArm: ['rightLowerArm'], rightLowerArm: ['rightHand'], rightHand: [],
  leftUpperLeg: ['leftLowerLeg'], leftLowerLeg: ['leftFoot'], leftFoot: ['leftToes'], leftToes: [],
  rightUpperLeg: ['rightLowerLeg'], rightLowerLeg: ['rightFoot'], rightFoot: ['rightToes'], rightToes: [],
};
// Finger chains: each phalanx points at the next one. The hand points at the middle finger.
for (const side of ['left', 'right']) {
  CHILD[`${side}Hand`] = [`${side}MiddleProximal`, `${side}IndexProximal`];
  for (const f of FINGERS) {
    const phs = f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    phs.forEach((ph, i) => { CHILD[`${side}${f}${ph}`] = phs.slice(i + 1).map((p2) => `${side}${f}${p2}`); });
  }
}

const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

export function retargetClip(src, srcClip, tgt, opts = {}) {
  const fps = opts.fps || 30;
  const name = opts.name || srcClip.name;
  const keys = CANONICAL.filter((k) => src.bone(k) && tgt.bone(k));
  if (!keys.includes('hips')) throw new Error('Both skeletons need an identifiable hips bone to retarget.');

  src.restPose(); tgt.restPose();
  const yaw = THREE.MathUtils.degToRad((tgt.metrics.facingDeg || 0) - (src.metrics.facingDeg || 0));
  const F = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const Fi = F.clone().invert();

  const rest = {};
  for (const k of keys) {
    const s = src.bone(k), t = tgt.bone(k);
    const sRest = wq(s), tRest = wq(t);
    let A = new THREE.Quaternion();
    const ck = (CHILD[k] || []).find((c) => src.bone(c) && tgt.bone(c));
    if (ck) {
      const dS = wp(src.bone(ck)).sub(wp(s)).applyQuaternion(F);
      const dT = wp(tgt.bone(ck)).sub(wp(t));
      if (dS.lengthSq() > 1e-12 && dT.lengthSq() > 1e-12) A = new THREE.Quaternion().setFromUnitVectors(dT.normalize(), dS.normalize());
    }
    rest[k] = { sRestInv: sRest.clone().invert(), tRest, A };
  }

  const sH = src.bone('hips'), tH = tgt.bone('hips');
  const sHipsRest = wp(sH), tHipsRest = wp(tH);
  const sLeg = Math.max(1e-4, sHipsRest.y - src.metrics.minY);
  const tLeg = Math.max(1e-4, tHipsRest.y - tgt.metrics.minY);
  const scale = tLeg / sLeg;

  // Target bones in hierarchy order, so parents are solved before children.
  const order = tgt.bones.filter((b) => keys.some((k) => tgt.bone(k) === b));
  const keyOf = new Map(keys.map((k) => [tgt.bone(k), k]));

  const mixer = new THREE.AnimationMixer(src.root);
  const action = mixer.clipAction(srcClip);
  // Play once and hold the last frame: with the default looping, sampling at exactly
  // `duration` wraps to frame 0 and travelling clips would snap back on their last frame.
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const frames = Math.max(2, Math.round(srcClip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const qv = new Map(order.map((b) => [b, new Float32Array(frames * 4)]));
  const pv = new Float32Array(frames * 3);
  const D = new THREE.Quaternion(), Tw = new THREE.Quaternion(), pq = new THREE.Quaternion(), prev = new Map();
  // Floor-contact guard: never let the ankles sink below their rest height.
  const feet = ['leftFoot', 'rightFoot'].map((k) => tgt.bone(k)).filter(Boolean);
  const restAnkle = feet.length ? Math.min(...feet.map((b) => wp(b).y)) : null;
  const guard = opts.floorGuard !== false && restAnkle !== null;

  for (let i = 0; i < frames; i++) {
    const t = Math.min(srcClip.duration, i / fps);
    times[i] = t;
    mixer.setTime(t);
    src.root.updateMatrixWorld(true);
    tgt.restPose();

    const delta = wp(sH).sub(sHipsRest).applyQuaternion(F).multiplyScalar(scale);
    const target = tHipsRest.clone().add(delta);
    tH.parent.updateMatrixWorld(true);
    tH.position.copy(tH.parent.worldToLocal(target.clone()));
    tH.updateMatrixWorld(true);

    for (const b of order) {
      const k = keyOf.get(b);
      const r = rest[k];
      D.copy(wq(src.bone(k))).multiply(r.sRestInv);
      D.premultiply(F).multiply(Fi);
      Tw.copy(D).multiply(r.A).multiply(r.tRest);
      b.parent.getWorldQuaternion(pq);
      b.quaternion.copy(pq.invert().multiply(Tw)).normalize();
      // keep quaternion signs continuous so interpolation never takes the long way round
      const p = prev.get(b);
      if (p && p.dot(b.quaternion) < 0) b.quaternion.set(-b.quaternion.x, -b.quaternion.y, -b.quaternion.z, -b.quaternion.w);
      prev.set(b, b.quaternion.clone());
      b.updateMatrixWorld(true);
      const arr = qv.get(b);
      arr.set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 4);
    }

    if (guard) {
      const low = Math.min(...feet.map((b) => wp(b).y));
      if (low < restAnkle - 0.003) target.y += restAnkle - low;
    }
    const local = tH.parent.worldToLocal(target);
    pv.set([local.x, local.y, local.z], i * 3);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(src.root);
  src.restPose(); tgt.restPose();

  // ---- Foot locking (anti foot-skate) ----
  // Captured clips carry per-frame foot contacts; for any other clip they're detected from
  // the motion itself. Planted feet are pinned in place with two-bone IK.
  const cap = srcClip.userData && srcClip.userData.jrcapture;
  const lockOn = opts.footLock === undefined ? !!cap : !!opts.footLock;
  let footStats = null;
  if (lockOn) {
    footStats = lockFeet(tgt, { order, qv, pv, tH, times, fps, contacts: cap && cap.contacts, contactFps: cap && cap.fps });
  }

  const tracks = order.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, qv.get(b)));
  tracks.push(new THREE.VectorKeyframeTrack(`${tH.name}.position`, times, pv));
  const clip = new THREE.AnimationClip(name, srcClip.duration, tracks);
  clip.userData = { retargetedFrom: src.detection.label, mappedBones: keys.length };
  if (footStats) clip.userData.footLock = footStats;
  return clip;
}

// Poses the target skeleton at frame i from the solved arrays.
function applyFrame(tgt, s, i) {
  tgt.restPose();
  s.tH.position.set(s.pv[i * 3], s.pv[i * 3 + 1], s.pv[i * 3 + 2]);
  for (const b of s.order) {
    const a = s.qv.get(b);
    b.quaternion.set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]);
  }
  tgt.root.updateMatrixWorld(true);
}

// Contact spans from per-frame booleans: hysteresis-free but with a minimum length,
// and short gaps (≤2 frames) inside a contact are closed.
export function spansFrom(flags, minLen = 3) {
  const f = Array.from(flags, (v) => !!v);
  for (let i = 1; i < f.length - 1; i++) {
    if (!f[i]) {
      let j = i; while (j < f.length && !f[j]) j++;
      if (j < f.length && j - i <= 2 && f[i - 1]) for (let k = i; k < j; k++) f[k] = true;
      i = j;
    }
  }
  const spans = [];
  for (let i = 0; i < f.length;) {
    if (!f[i]) { i++; continue; }
    let j = i; while (j < f.length && f[j]) j++;
    if (j - i >= minLen) spans.push([i, j - 1]);
    i = j;
  }
  return spans;
}

// Heuristic contacts: foot near its lowest height and barely moving horizontally.
export function detectContacts(heights, xz, fps, legLength) {
  const n = heights.length;
  const floor = Math.min(...heights);
  const hTol = Math.max(0.02, legLength * 0.06);         // ~5 cm for a human
  const vTol = Math.max(0.12, legLength * 0.35);          // ~0.3 m/s
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dt = Math.max(1, b - a) / fps;
    const v = Math.hypot(xz[b * 2] - xz[a * 2], xz[b * 2 + 1] - xz[a * 2 + 1]) / dt;
    out[i] = heights[i] - floor < hTol && v < vTol ? 1 : 0;
  }
  return out;
}

const _v = () => new THREE.Vector3();
function setWorldQuat(bone, q) {
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q)).normalize();
  bone.updateMatrixWorld(true);
}

// Analytic two-bone IK: rotates upper & lower so `end` reaches `target`, keeping the knee
// on the side it was already bending towards and the foot's world orientation unchanged.
export function solveTwoBone(upper, lower, end, target) {
  const A = upper.getWorldPosition(_v()), B = lower.getWorldPosition(_v()), C = end.getWorldPosition(_v());
  const endQ = end.getWorldQuaternion(new THREE.Quaternion());
  const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
  const AT = target.clone().sub(A);
  const d = THREE.MathUtils.clamp(AT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const u = AT.lengthSq() > 1e-12 ? AT.normalize() : C.clone().sub(A).normalize();
  let pole = B.clone().sub(A); pole.sub(u.clone().multiplyScalar(pole.dot(u)));
  if (pole.lengthSq() < 1e-10) pole = new THREE.Vector3(0, 0, 1).sub(u.clone().multiplyScalar(u.z));
  pole.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const knee = A.clone().addScaledVector(u, l1 * cosA).addScaledVector(pole, l1 * Math.sqrt(1 - cosA * cosA));
  const q1 = new THREE.Quaternion().setFromUnitVectors(B.clone().sub(A).normalize(), knee.clone().sub(A).normalize());
  setWorldQuat(upper, q1.multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
  const B2 = lower.getWorldPosition(_v()), C2 = end.getWorldPosition(_v());
  const goal = A.clone().addScaledVector(u, d);
  const q2 = new THREE.Quaternion().setFromUnitVectors(C2.clone().sub(B2).normalize(), goal.sub(B2).normalize());
  setWorldQuat(lower, q2.multiply(lower.getWorldQuaternion(new THREE.Quaternion())));
  setWorldQuat(end, endQ);
}

function lockFeet(tgt, s) {
  const n = s.times.length;
  const legs = [['left', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'], ['right', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']]
    .map(([side, a, b, c]) => ({ side, up: tgt.bone(a), lo: tgt.bone(b), ft: tgt.bone(c) }))
    .filter((l) => l.up && l.lo && l.ft && s.order.includes(l.up) && s.order.includes(l.lo) && s.order.includes(l.ft));
  if (!legs.length || n < 4) return null;
  tgt.restPose();
  const legLen = legs[0].up.getWorldPosition(_v()).distanceTo(legs[0].lo.getWorldPosition(_v())) +
    legs[0].lo.getWorldPosition(_v()).distanceTo(legs[0].ft.getWorldPosition(_v()));

  // Sample foot positions.
  const pos = legs.map(() => new Float32Array(n * 3));
  for (let i = 0; i < n; i++) {
    applyFrame(tgt, s, i);
    legs.forEach((l, k) => { const p = l.ft.getWorldPosition(_v()); pos[k].set([p.x, p.y, p.z], i * 3); });
  }

  const stats = { source: s.contacts ? 'capture' : 'detected', spans: 0, skateBeforeCm: 0, skateAfterCm: 0 };
  const plans = legs.map((l, k) => {
    let flags;
    const key = l.side + 'Foot';
    if (s.contacts && s.contacts[key]) {
      const c = s.contacts[key], cf = s.contactFps || s.fps;
      flags = new Uint8Array(n);
      for (let i = 0; i < n; i++) flags[i] = c[Math.min(c.length - 1, Math.round(s.times[i] * cf))] ? 1 : 0;
    } else {
      const h = new Float32Array(n), xz = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { h[i] = pos[k][i * 3 + 1]; xz[i * 2] = pos[k][i * 3]; xz[i * 2 + 1] = pos[k][i * 3 + 2]; }
      flags = detectContacts(h, xz, s.fps, legLen);
    }
    const spans = spansFrom(flags);
    // Per-frame goal + weight: full lock inside spans, eased in/out over 4 frames.
    const goal = new Float32Array(n * 3), w = new Float32Array(n);
    const BL = 4;
    for (const [a, b] of spans) {
      let ax = 0, ay = 0, az = 0;
      for (let i = a; i <= b; i++) { ax += pos[k][i * 3]; ay += pos[k][i * 3 + 1]; az += pos[k][i * 3 + 2]; }
      const m = b - a + 1; ax /= m; ay /= m; az /= m;
      let slide = 0;
      for (let i = a + 1; i <= b; i++) slide += Math.hypot(pos[k][i * 3] - pos[k][(i - 1) * 3], pos[k][i * 3 + 2] - pos[k][(i - 1) * 3 + 2]);
      stats.skateBeforeCm += slide * 100; stats.spans++;
      for (let i = Math.max(0, a - BL); i <= Math.min(n - 1, b + BL); i++) {
        const t = i < a ? (i - (a - BL)) / BL : i > b ? ((b + BL) - i) / BL : 1;
        const wt = t * t * (3 - 2 * t); // smoothstep
        if (wt > w[i]) { w[i] = wt; goal.set([ax, ay, az], i * 3); }
      }
    }
    return { l, k, spans, goal, w };
  });

  for (let i = 0; i < n; i++) {
    if (!plans.some((p) => p.w[i] > 1e-3)) continue;
    applyFrame(tgt, s, i);
    for (const p of plans) {
      if (p.w[i] <= 1e-3) continue;
      const cur = new THREE.Vector3(pos[p.k][i * 3], pos[p.k][i * 3 + 1], pos[p.k][i * 3 + 2]);
      const g = new THREE.Vector3(p.goal[i * 3], p.goal[i * 3 + 1], p.goal[i * 3 + 2]);
      solveTwoBone(p.l.up, p.l.lo, p.l.ft, cur.lerp(g, p.w[i]));
      for (const b of [p.l.up, p.l.lo, p.l.ft]) {
        const a = s.qv.get(b), q = b.quaternion;
        const prev = i > 0 ? [a[(i - 1) * 4], a[(i - 1) * 4 + 1], a[(i - 1) * 4 + 2], a[(i - 1) * 4 + 3]] : null;
        const sign = prev && (prev[0] * q.x + prev[1] * q.y + prev[2] * q.z + prev[3] * q.w) < 0 ? -1 : 1;
        a.set([q.x * sign, q.y * sign, q.z * sign, q.w * sign], i * 4);
      }
    }
  }
  // Measure what's left.
  for (const p of plans) {
    for (const [a, b] of p.spans) {
      let prev = null;
      for (let i = a; i <= b; i++) {
        applyFrame(tgt, s, i);
        const q = p.l.ft.getWorldPosition(_v());
        if (prev) stats.skateAfterCm += Math.hypot(q.x - prev.x, q.z - prev.z) * 100;
        prev = q;
      }
    }
  }
  tgt.restPose();
  stats.skateBeforeCm = +stats.skateBeforeCm.toFixed(1);
  stats.skateAfterCm = +stats.skateAfterCm.toFixed(1);
  return stats;
}
