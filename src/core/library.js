import * as THREE from 'three';
import { buildDemoCharacter } from './demo.js';

// Built-in animation library. Every clip is generated procedurally here on the
// demo mannequin's skeleton (our own work → CC0, safe to ship in a public product),
// then retargeted onto the user's character.

const N = (k) => 'mixamorig' + k;
const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const qa = (axis, ang) => new THREE.Quaternion().setFromAxisAngle(axis, ang);
const Qe = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
const steps = (dur, n) => Array.from({ length: n + 1 }, (_, i) => (dur * i) / n);
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function Q(bone, times, fn) {
  const v = [];
  let prev = null;
  for (const t of times) {
    const q = fn(t).normalize();
    if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    v.push(q.x, q.y, q.z, q.w);
    prev = q;
  }
  return new THREE.QuaternionKeyframeTrack(`${N(bone)}.quaternion`, times, v);
}
function P(bone, times, fn) {
  const v = [];
  for (const t of times) { const p = fn(t); v.push(p.x, p.y, p.z); }
  return new THREE.VectorKeyframeTrack(`${N(bone)}.position`, times, v);
}
// Arms start in a T-pose on this rig; lower them, then swing (x) / twist.
const arm = (side, lower, swing, out = 0) => Qe(swing, 0, 0).multiply(Qe(0, 0, (side === 'Left' ? -1 : 1) * (lower - out)));
const HIP_Y = 1.0;

// ---------- locomotion ----------
// dir: unit vector of travel (character faces +Z; its LEFT is +X)
function gait({ name, dir, speed, cycle, run = false, crouch = 0 }) {
  const T = steps(cycle, 30);
  const ph = (t) => (t / cycle) * Math.PI * 2;
  const d = dir.clone().normalize();
  const swingAxis = new THREE.Vector3().crossVectors(d, UP).normalize(); // +angle = foot toward travel
  const leanAxis = new THREE.Vector3().crossVectors(UP, d).normalize();
  const fwd = d.z, side = d.x;
  const legAmp = (run ? 0.62 : 0.42) * (crouch ? 0.7 : 1);
  const knee = run ? 1.25 : 0.75;
  const bob = run ? 0.045 : 0.022;
  const crouchDrop = crouch ? 0.245 : 0;
  const lean = (run ? 0.22 : 0.05) + (crouch ? 0.3 : 0);
  const armLower = run ? 1.15 : 1.25;
  const armAmp = (run ? 0.75 : 0.42) * Math.max(0.25, Math.abs(fwd));
  const elbow = run ? 1.25 : 0.3;
  const baseThigh = crouch ? -0.95 : 0; // crouch: thighs forward (about X)
  const baseKnee = crouch ? 1.5 : 0;
  const tracks = [
    P('Hips', T, (t) => new THREE.Vector3(
      d.x * speed * t + 0.012 * Math.sin(ph(t)),
      HIP_Y - crouchDrop - (run ? 0.05 : 0.018) + bob * 0.5 * (1 + Math.cos(ph(t) * 2)) * (run ? 1 : 0.5),
      d.z * speed * t)),
    Q('Hips', T, (t) => Qe(0, 0.1 * Math.sin(ph(t)) * Math.sign(fwd || 1), 0)),
    Q('Spine', T, (t) => qa(leanAxis, lean * 0.4)),
    Q('Spine1', T, (t) => qa(leanAxis, lean * 0.4).multiply(Qe(0, -0.14 * Math.sin(ph(t)) * (fwd >= 0 ? 1 : -1) * Math.abs(fwd), 0))),
    Q('Spine2', T, () => qa(leanAxis, lean * 0.2)),
    Q('Neck', T, () => qa(leanAxis, -lean * 0.5)),
  ];
  for (const s of ['Left', 'Right']) {
    const sg = s === 'Left' ? 1 : -1; // left leg leads at phase 0
    tracks.push(
      Q(s + 'UpLeg', T, (t) => qa(swingAxis, sg * legAmp * Math.sin(ph(t))).multiply(Qe(baseThigh, 0, 0))),
      Q(s + 'Leg', T, (t) => Qe(baseKnee + knee * Math.max(0, Math.sin(ph(t) + (sg > 0 ? 1.3 : 1.3 + Math.PI))) * (0.5 + 0.5 * Math.abs(fwd) + (run ? 0.2 : 0)), 0, 0)),
      Q(s + 'Foot', T, (t) => Qe((crouch ? -0.55 : 0) + 0.25 * Math.sin(ph(t) + (sg > 0 ? 0.6 : 0.6 + Math.PI)) * Math.abs(fwd), 0, 0)),
      Q(s + 'Arm', T, (t) => arm(s, armLower, -sg * armAmp * Math.sin(ph(t)) * Math.sign(fwd || 1), crouch ? 0.15 : 0.05 + Math.abs(side) * 0.1)),
      Q(s + 'ForeArm', T, (t) => Qe(0, (s === 'Left' ? -1 : 1) * (elbow + 0.2 * Math.sin(ph(t) * sg)), 0)),
    );
  }
  return new THREE.AnimationClip(name, cycle, tracks);
}

function idle(name = 'Idle') {
  const D = 4, T = steps(D, 40), w = (t) => Math.sin((t / D) * Math.PI * 2);
  return new THREE.AnimationClip(name, D, [
    P('Hips', T, (t) => new THREE.Vector3(0.008 * w(t), HIP_Y - 0.006 * (1 + w(t * 2)), 0)),
    Q('Spine1', T, (t) => Qe(0.025 * w(t * 2), 0.02 * w(t), 0)),
    Q('Head', T, (t) => Qe(-0.03 * w(t * 2), 0.06 * w(t), 0)),
    Q('LeftArm', T, (t) => arm('Left', 1.3, 0.04 * w(t * 2))),
    Q('RightArm', T, (t) => arm('Right', 1.3, 0.04 * w(t * 2))),
    Q('LeftForeArm', T, () => Qe(0, -0.2, 0)),
    Q('RightForeArm', T, () => Qe(0, 0.2, 0)),
  ]);
}

function crouchIdle() {
  const D = 3, T = steps(D, 30), w = (t) => Math.sin((t / D) * Math.PI * 2);
  return new THREE.AnimationClip('Crouch_Idle', D, [
    P('Hips', T, (t) => new THREE.Vector3(0, HIP_Y - 0.268 - 0.004 * (1 + w(t)), -0.02)),
    Q('Spine', T, () => Qe(0.18, 0, 0)), Q('Spine1', T, (t) => Qe(0.16 + 0.02 * w(t), 0, 0)), Q('Neck', T, () => Qe(-0.25, 0, 0)),
    Q('LeftUpLeg', T, () => Qe(-1.0, 0, 0.05)), Q('RightUpLeg', T, () => Qe(-1.0, 0, -0.05)),
    Q('LeftLeg', T, () => Qe(1.6, 0, 0)), Q('RightLeg', T, () => Qe(1.6, 0, 0)),
    Q('LeftFoot', T, () => Qe(-0.58, 0, 0)), Q('RightFoot', T, () => Qe(-0.58, 0, 0)),
    Q('LeftArm', T, (t) => arm('Left', 1.25, -0.3 + 0.02 * w(t))), Q('RightArm', T, (t) => arm('Right', 1.25, -0.3 + 0.02 * w(t))),
    Q('LeftForeArm', T, () => Qe(0, -0.8, 0)), Q('RightForeArm', T, () => Qe(0, 0.8, 0)),
  ]);
}

// Jump phases share one pose function: s = squash (0..1), air = 0..1
function jumpPose(T, fnS, fnAir, fnHipY) {
  return [
    P('Hips', T, (t) => new THREE.Vector3(0, fnHipY(t), 0)),
    Q('Spine1', T, (t) => Qe(0.3 * fnS(t) - 0.08 * fnAir(t), 0, 0)),
    Q('Neck', T, (t) => Qe(-0.2 * fnS(t), 0, 0)),
    ...['Left', 'Right'].flatMap((s) => [
      Q(s + 'UpLeg', T, (t) => Qe(-0.85 * fnS(t) - 0.5 * fnAir(t), 0, (s === 'Left' ? 1 : -1) * 0.04)),
      Q(s + 'Leg', T, (t) => Qe(1.4 * fnS(t) + 0.9 * fnAir(t), 0, 0)),
      Q(s + 'Foot', T, (t) => Qe(-0.6 * fnS(t) + 0.35 * fnAir(t), 0, 0)),
      Q(s + 'Arm', T, (t) => arm(s, 1.25 - 0.9 * fnAir(t), 0.5 * fnS(t) - 0.9 * fnAir(t))),
      Q(s + 'ForeArm', T, (t) => Qe(0, (s === 'Left' ? -1 : 1) * (0.3 + 0.4 * fnAir(t)), 0)),
    ]),
  ];
}
function jumpStart() {
  const D = 0.45, T = steps(D, 18);
  const s = (t) => (t < 0.28 ? smooth(t / 0.28) : 1 - smooth(clamp01((t - 0.28) / 0.17)));
  const air = (t) => smooth(clamp01((t - 0.3) / 0.15));
  return new THREE.AnimationClip('Jump_Start', D, jumpPose(T, s, air, (t) => HIP_Y - 0.2 * s(t) + 0.1 * air(t)));
}
function jumpLoop() {
  const D = 0.8, T = steps(D, 20), w = (t) => Math.sin((t / D) * Math.PI * 2);
  return new THREE.AnimationClip('Jump_Loop', D, jumpPose(T, () => 0, (t) => 0.92 + 0.08 * w(t), (t) => HIP_Y + 0.1 + 0.01 * w(t)));
}
function jumpLand() {
  const D = 0.6, T = steps(D, 24);
  const s = (t) => (t < 0.12 ? smooth(t / 0.12) : 1 - smooth(clamp01((t - 0.12) / 0.48)));
  const air = (t) => 1 - smooth(clamp01(t / 0.1));
  return new THREE.AnimationClip('Jump_Land', D, jumpPose(T, s, air, (t) => HIP_Y - 0.2 * s(t) + 0.1 * air(t)));
}

function wave() {
  const D = 2.4, T = steps(D, 48);
  const up = (t) => smooth(clamp01(t / 0.4)) * (1 - smooth(clamp01((t - 2.0) / 0.4)));
  return new THREE.AnimationClip('Wave', D, [
    Q('LeftArm', T, () => arm('Left', 1.3, 0)),
    Q('LeftForeArm', T, () => Qe(0, -0.2, 0)),
    Q('RightArm', T, (t) => arm('Right', 1.3 - 1.75 * up(t), -0.25 * up(t))),
    Q('RightForeArm', T, (t) => Qe(0, 0, 0).multiply(Qe(0, 0, -1.3 * up(t) - 0.35 * up(t) * Math.sin(t * 11)))),
    Q('Head', T, (t) => Qe(0, -0.12 * up(t), 0)),
    Q('Spine1', T, (t) => Qe(0, 0, 0.04 * up(t))),
  ]);
}

// ---------- catalog ----------
const DIRS = [
  ['Fwd', 0, 0, 1], ['Fwd_Left', 45, 0.7071, 0.7071], ['Left', 90, 1, 0], ['Bwd_Left', 135, 0.7071, -0.7071],
  ['Bwd', 180, 0, -1], ['Bwd_Right', -135, -0.7071, -0.7071], ['Right', -90, -1, 0], ['Fwd_Right', -45, -0.7071, 0.7071],
];
// Unreal "Calculate Direction" convention: 0 = forward, +90 = right, -90 = left.
const ueDir = (deg) => -deg;

export const LIBRARY = [];
const add = (e) => LIBRARY.push(e);
add({ id: 'Idle', category: 'Idle', loop: true, desc: 'Relaxed standing breathing loop.', make: () => idle() });
for (const [n, deg, x, z] of DIRS) {
  const back = z < -0.1;
  add({ id: `Walk_${n}`, category: 'Walk', loop: true, speed: 1.4, direction: ueDir(deg), desc: `Walk cycle, ${n.replace('_', '-').toLowerCase()}.`, make: () => gait({ name: `Walk_${n}`, dir: new THREE.Vector3(x, 0, z), speed: 1.4, cycle: back ? 1.15 : 1.05 }) });
}
for (const [n, deg, x, z] of DIRS) {
  const back = z < -0.1;
  add({ id: `Run_${n}`, category: 'Run', loop: true, speed: 3.6, direction: ueDir(deg), desc: `Run cycle, ${n.replace('_', '-').toLowerCase()}.`, make: () => gait({ name: `Run_${n}`, dir: new THREE.Vector3(x, 0, z), speed: 3.6, cycle: back ? 0.74 : 0.7, run: true }) });
}
add({ id: 'Jump_Start', category: 'Jump', loop: false, desc: 'Crouch and push off.', make: jumpStart });
add({ id: 'Jump_Loop', category: 'Jump', loop: true, desc: 'In the air (loops while falling).', make: jumpLoop });
add({ id: 'Jump_Land', category: 'Jump', loop: false, desc: 'Impact and recover to standing.', make: jumpLand });
add({ id: 'Crouch_Idle', category: 'Crouch', loop: true, desc: 'Crouched breathing loop.', make: crouchIdle });
for (const [n, deg, x, z] of DIRS.filter((d) => ['Fwd', 'Bwd', 'Left', 'Right'].includes(d[0]))) {
  add({ id: `Crouch_Walk_${n}`, category: 'Crouch', loop: true, speed: 0.9, direction: ueDir(deg), desc: `Crouched walk, ${n.toLowerCase()}.`, make: () => gait({ name: `Crouch_Walk_${n}`, dir: new THREE.Vector3(x, 0, z), speed: 0.9, cycle: 1.2, crouch: 1 }) });
}
add({ id: 'Wave', category: 'Gesture', loop: false, desc: 'Friendly right-hand wave.', make: wave });

export const PACKS = {
  starter: { id: 'starter', label: 'Starter pack', desc: 'Idle, walk, run and a 3-part jump — everything for a first playable character.', clips: ['Idle', 'Walk_Fwd', 'Run_Fwd', 'Jump_Start', 'Jump_Loop', 'Jump_Land'] },
  locomotion8: { id: 'locomotion8', label: '8-direction locomotion', desc: 'Idle + walk and run in all 8 directions, ready for a 2D Blend Space (strafing shooters, lock-on combat).', clips: ['Idle', ...DIRS.map((d) => 'Walk_' + d[0]), ...DIRS.map((d) => 'Run_' + d[0])] },
  third_person: { id: 'third_person', label: 'Complete third-person set', desc: 'The 8-direction set plus jumps, crouch and a wave. 26 clips.', clips: LIBRARY.map((e) => e.id) },
  crouch: { id: 'crouch', label: 'Crouch / stealth', desc: 'Crouch idle and crouched walking in 4 directions.', clips: ['Crouch_Idle', 'Crouch_Walk_Fwd', 'Crouch_Walk_Bwd', 'Crouch_Walk_Left', 'Crouch_Walk_Right'] },
};

let rig = null;
const cache = new Map();
export function libraryRig() {
  if (!rig) rig = buildDemoCharacter();
  return rig;
}
export function libraryClip(id) {
  const e = LIBRARY.find((x) => x.id.toLowerCase() === String(id).toLowerCase());
  if (!e) return null;
  if (!cache.has(e.id)) cache.set(e.id, e.make());
  return { entry: e, clip: cache.get(e.id) };
}
export function catalog() {
  return LIBRARY.map(({ make, ...e }) => e);
}
