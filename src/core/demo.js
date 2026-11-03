import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CharacterDoc } from './character.js';

// A procedurally built test mannequin (our own work → free to ship, CC0).
// Uses Mixamo-style bone names and has no root bone, on purpose, so the
// health check has something real to fix for Unreal.
const P = 'mixamorig';
const J = {
  Hips: [0, 1.0, 0, null],
  Spine: [0, 1.1, 0, 'Hips'], Spine1: [0, 1.22, 0, 'Spine'], Spine2: [0, 1.34, 0, 'Spine1'],
  Neck: [0, 1.5, 0, 'Spine2'], Head: [0, 1.6, 0.01, 'Neck'], HeadTop_End: [0, 1.8, 0.01, 'Head'],
  LeftShoulder: [0.05, 1.45, 0, 'Spine2'], LeftArm: [0.17, 1.45, 0, 'LeftShoulder'],
  LeftForeArm: [0.44, 1.45, 0, 'LeftArm'], LeftHand: [0.69, 1.45, 0, 'LeftForeArm'],
  LeftUpLeg: [0.1, 0.95, 0, 'Hips'], LeftLeg: [0.1, 0.52, 0, 'LeftUpLeg'], LeftFoot: [0.1, 0.09, 0, 'LeftLeg'],
  LeftToeBase: [0.1, 0.03, 0.12, 'LeftFoot'], LeftToe_End: [0.1, 0.03, 0.2, 'LeftToeBase'],
};
// Fingers (Mixamo names: 1–3 are the joints, 4 is the tip). T-pose, palm down, thumb forward (+Z).
const FINGER_DEF = [ // name, knuckle z, length scale, knuckle x offset
  ['Index', 0.026, 1.0, 0.0], ['Middle', 0.009, 1.08, 0.004], ['Ring', -0.008, 1.0, 0.0], ['Pinky', -0.024, 0.8, -0.008],
];
const KNUCKLE_X = 0.785, PHAL = [0.034, 0.024, 0.02];
for (const [f, z, sc, dx] of FINGER_DEF) {
  let x = KNUCKLE_X + dx, parent = 'LeftHand';
  for (let i = 1; i <= 4; i++) {
    J[`LeftHand${f}${i}`] = [x, 1.448, z, parent];
    parent = `LeftHand${f}${i}`;
    if (i < 4) x += PHAL[i - 1] * sc;
  }
}
{ // thumb: from the base of the palm, forward and out
  const pts = [[0.715, 1.44, 0.03], [0.745, 1.437, 0.052], [0.772, 1.435, 0.066], [0.795, 1.434, 0.076]];
  let parent = 'LeftHand';
  pts.forEach((pt, i) => { J[`LeftHandThumb${i + 1}`] = [...pt, parent]; parent = `LeftHandThumb${i + 1}`; });
}
for (const [k, v] of Object.entries({ ...J })) {
  if (k.startsWith('Left')) {
    const r = k.replace('Left', 'Right');
    J[r] = [-v[0], v[1], v[2], v[3].startsWith('Left') ? v[3].replace('Left', 'Right') : v[3]];
  }
}

function segment(a, b, radius, boneIndex, shape = 'capsule') {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  let g;
  if (shape === 'box') g = new THREE.BoxGeometry(radius * 2.4, len, radius * 1.4);
  else if (shape === 'sphere') g = new THREE.SphereGeometry(radius, 20, 14);
  else g = new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 1.2), 6, 14);
  g = g.toNonIndexed();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = boneIndex; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Flat palm block from the wrist to the knuckles.
function palm(a, b, boneIndex) {
  const len = Math.abs(b.x - a.x);
  let g = new THREE.BoxGeometry(len, 0.03, 0.075).toNonIndexed();
  g.translate((a.x + b.x) / 2, a.y, 0.002);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = boneIndex; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function buildDemoCharacter() {
  const armature = new THREE.Object3D();
  armature.name = 'Armature';
  const bones = {}, list = [];
  const world = {};
  for (const [k, v] of Object.entries(J)) {
    const b = new THREE.Bone();
    b.name = P + k;
    bones[k] = b; list.push(b);
    world[k] = new THREE.Vector3(v[0], v[1], v[2]);
  }
  for (const [k, v] of Object.entries(J)) {
    const parent = v[3];
    const b = bones[k];
    if (parent) { bones[parent].add(b); b.position.copy(world[k]).sub(world[parent]); }
    else { armature.add(b); b.position.copy(world[k]); }
  }
  const idx = (k) => list.indexOf(bones[k]);
  const W = world;
  const parts = [
    segment(W.Hips.clone().add(new THREE.Vector3(0, -0.06, 0)), W.Spine, 0.11, idx('Hips'), 'box'),
    segment(W.Spine, W.Spine1, 0.1, idx('Spine'), 'box'),
    segment(W.Spine1, W.Spine2, 0.11, idx('Spine1'), 'box'),
    segment(W.Spine2, W.Neck, 0.13, idx('Spine2'), 'box'),
    segment(W.Neck, W.Head, 0.04, idx('Neck')),
    segment(W.Head, W.HeadTop_End, 0.1, idx('Head'), 'sphere'),
  ];
  for (const s of ['Left', 'Right']) {
    parts.push(
      segment(W[s + 'Shoulder'], W[s + 'Arm'], 0.045, idx(s + 'Shoulder')),
      segment(W[s + 'Arm'], W[s + 'ForeArm'], 0.045, idx(s + 'Arm')),
      segment(W[s + 'ForeArm'], W[s + 'Hand'], 0.038, idx(s + 'ForeArm')),
      palm(W[s + 'Hand'], W[s + 'HandMiddle1'], idx(s + 'Hand')),
      ...['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'].flatMap((f) => [1, 2, 3].map((i) =>
        segment(W[`${s}Hand${f}${i}`], W[`${s}Hand${f}${i + 1}`], f === 'Thumb' ? 0.0105 - i * 0.0008 : 0.0095 - i * 0.0008, idx(`${s}Hand${f}${i}`)))),
      segment(W[s + 'UpLeg'], W[s + 'Leg'], 0.065, idx(s + 'UpLeg')),
      segment(W[s + 'Leg'], W[s + 'Foot'], 0.052, idx(s + 'Leg')),
      segment(W[s + 'Foot'].clone().add(new THREE.Vector3(0, -0.02, -0.03)), W[s + 'ToeBase'], 0.045, idx(s + 'Foot')),
      segment(W[s + 'ToeBase'], W[s + 'Toe_End'], 0.035, idx(s + 'ToeBase')),
    );
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9cdd6, roughness: 0.55, metalness: 0.05 });
  mat.name = 'M_Mannequin';
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'Mannequin';
  armature.add(mesh);
  armature.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));

  const clips = [makeIdle(bones), makeWalk(bones)];
  return new CharacterDoc({ object: armature, clips, sourceName: 'Demo_Mannequin.glb', format: 'Built-in' });
}

const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
function qtrack(bone, times, fn) {
  const v = [];
  times.forEach((t) => { const q = fn(t); v.push(q.x, q.y, q.z, q.w); });
  return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, v);
}
function vtrack(bone, times, fn) {
  const v = [];
  times.forEach((t) => { const p = fn(t); v.push(p.x, p.y, p.z); });
  return new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, v);
}
const steps = (dur, n) => Array.from({ length: n + 1 }, (_, i) => (dur * i) / n);

function armsDown(side, swing) {
  // Lower the T-pose arm ~70°, then swing forward/back around X.
  const down = Q(0, 0, side === 'Left' ? -1.2 : 1.2);
  return Q(swing, 0, 0).multiply(down);
}

function makeIdle(b) {
  const T = steps(3, 30);
  const w = (t) => Math.sin((t / 3) * Math.PI * 2);
  return new THREE.AnimationClip('Idle', 3, [
    qtrack(b.Spine1, T, (t) => Q(0.02 * w(t), 0, 0)),
    qtrack(b.Head, T, (t) => Q(-0.03 * w(t), 0.04 * w(t), 0)),
    qtrack(b.LeftArm, T, (t) => armsDown('Left', 0.03 * w(t))),
    qtrack(b.RightArm, T, (t) => armsDown('Right', 0.03 * w(t))),
    vtrack(b.Hips, T, (t) => new THREE.Vector3(0, 1.0 - 0.006 * (1 + w(t)), 0)),
  ]);
}

function makeWalk(b) {
  const D = 1.0, T = steps(D, 24);
  const ph = (t) => (t / D) * Math.PI * 2;
  const speed = 1.3; // m/s
  return new THREE.AnimationClip('Walk', D, [
    vtrack(b.Hips, T, (t) => new THREE.Vector3(0.015 * Math.sin(ph(t)), 0.985 + 0.02 * Math.cos(ph(t) * 2), speed * t)),
    qtrack(b.Hips, T, (t) => Q(0, 0.08 * Math.sin(ph(t)), 0)),
    qtrack(b.Spine1, T, (t) => Q(0.05, -0.12 * Math.sin(ph(t)), 0)),
    qtrack(b.LeftUpLeg, T, (t) => Q(-0.45 * Math.sin(ph(t)), 0, 0)),
    qtrack(b.RightUpLeg, T, (t) => Q(0.45 * Math.sin(ph(t)), 0, 0)),
    qtrack(b.LeftLeg, T, (t) => Q(0.7 * Math.max(0, Math.sin(ph(t) + 1.2)), 0, 0)),
    qtrack(b.RightLeg, T, (t) => Q(0.7 * Math.max(0, Math.sin(ph(t) + 1.2 + Math.PI)), 0, 0)),
    qtrack(b.LeftFoot, T, (t) => Q(0.2 * Math.sin(ph(t) + 0.5), 0, 0)),
    qtrack(b.RightFoot, T, (t) => Q(-0.2 * Math.sin(ph(t) + 0.5), 0, 0)),
    qtrack(b.LeftArm, T, (t) => armsDown('Left', 0.4 * Math.sin(ph(t)))),
    qtrack(b.RightArm, T, (t) => armsDown('Right', -0.4 * Math.sin(ph(t)))),
    qtrack(b.LeftForeArm, T, (t) => Q(0, -0.25 - 0.15 * Math.sin(ph(t)), 0)),
    qtrack(b.RightForeArm, T, (t) => Q(0, 0.25 - 0.15 * Math.sin(ph(t)), 0)),
  ]);
}
