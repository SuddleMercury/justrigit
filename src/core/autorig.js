import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { CharacterDoc } from './character.js';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-rigging, Mixamo-style:
//   1. 8 markers (chin, wrists, elbows, knees, groin) are guessed from the mesh,
//      then the user (or an AI) can drag them.
//   2. A UE5-mannequin-style skeleton (root, pelvis, spine_01-05, neck_01, head,
//      clavicles, arms, thighs, calves, feet, balls) is built from the markers.
//   3. Skin weights are computed with heat diffusion (Baran & Popović 2007,
//      "Pinocchio"; same idea as Blender's "Automatic Weights"):
//      solve (L + A·H) w_j = A·H·p_j per bone on the welded mesh, where H pulls
//      each vertex towards its nearest *visible* bone.
// Character must face +Z (the front view). Its LEFT side is +X.
// ─────────────────────────────────────────────────────────────────────────────

export const MARKERS = ['chin', 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee', 'groin'];
export const MARKER_LABELS = {
  chin: 'Chin', groin: 'Groin',
  leftWrist: 'Left wrist', rightWrist: 'Right wrist',
  leftElbow: 'Left elbow', rightElbow: 'Right elbow',
  leftKnee: 'Left knee', rightKnee: 'Right knee',
};
export const MIRROR = { leftWrist: 'rightWrist', rightWrist: 'leftWrist', leftElbow: 'rightElbow', rightElbow: 'leftElbow', leftKnee: 'rightKnee', rightKnee: 'leftKnee' };

// ---------- mesh gathering ----------
export function gatherMesh(doc) {
  doc.root.updateMatrixWorld(true);
  const parts = [];
  doc.root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (o.visible === false) return;
    parts.push(o);
  });
  if (!parts.length) throw new Error('No meshes found to rig.');
  // World-space positions per part, plus a welded vertex list.
  const keyMap = new Map();
  const pos = [];
  const partMaps = [];
  const tris = [];
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of parts) {
    const pa = m.geometry.attributes.position;
    const map = new Int32Array(pa.count);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      const k = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
      let id = keyMap.get(k);
      if (id === undefined) { id = pos.length / 3; keyMap.set(k, id); pos.push(v.x, v.y, v.z); }
      map[i] = id;
    }
    partMaps.push(map);
    const idx = m.geometry.index;
    const count = idx ? idx.count : pa.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = map[idx ? idx.getX(t) : t], b = map[idx ? idx.getX(t + 1) : t + 1], c = map[idx ? idx.getX(t + 2) : t + 2];
      if (a !== b && b !== c && a !== c) tris.push(a, b, c);
    }
  }
  return {
    parts, partMaps, pos: new Float32Array(pos), tris: new Uint32Array(tris),
    box: { minX, maxX, minY, maxY, minZ, maxZ, H: maxY - minY, W: maxX - minX, x0: (minX + maxX) / 2, z0: (minZ + maxZ) / 2 },
  };
}

// Vertices of the welded mesh inside an axis-aligned slab test
function select(g, fn) {
  const out = [];
  const p = g.pos;
  for (let i = 0; i < p.length; i += 3) if (fn(p[i], p[i + 1], p[i + 2])) out.push(i / 3);
  return out;
}

// ---------- 1. marker guesses ----------
export function guessMarkers(g) {
  const { minY, H, x0 } = g.box;
  const p = g.pos;
  const y = (f) => minY + f * H;

  // Groin: highest height where there is a gap between the legs at the centre line.
  let crotch = null;
  for (let f = 0.3; f <= 0.6; f += 0.005) {
    const yy = y(f);
    const slab = select(g, (vx, vy) => Math.abs(vy - yy) < 0.012 * H);
    if (slab.length < 4) continue;
    const centre = slab.some((i) => Math.abs(p[i * 3] - x0) < 0.025 * H);
    if (!centre) crotch = yy; else if (crotch !== null) break;
  }
  const groinY = crotch !== null ? crotch + 0.015 * H : y(0.48);

  // Knees: centre of each leg's cross-section at ~28% height
  const knee = (sg) => {
    const yy = y(0.28);
    const vs = select(g, (vx, vy) => Math.abs(vy - yy) < 0.02 * H && sg * (vx - x0) > 0.01 * H);
    if (!vs.length) return [x0 + sg * 0.1 * H, yy];
    let mn = Infinity, mx = -Infinity;
    vs.forEach((i) => { mn = Math.min(mn, p[i * 3]); mx = Math.max(mx, p[i * 3]); });
    return [(mn + mx) / 2, yy];
  };

  // Wrists: the most outward point above hip height is the fingertip; wrist sits ~a hand length inward.
  const shoulderGuess = (sg) => new THREE.Vector2(x0 + sg * 0.11 * H, y(0.81));
  const arm = (sg) => {
    const vs = select(g, (vx, vy) => vy > y(0.35) && vy < y(0.92) && sg * (vx - x0) > 0);
    let best = -1, bi = -1;
    vs.forEach((i) => { const d = sg * (p[i * 3] - x0); if (d > best) { best = d; bi = i; } });
    const S = shoulderGuess(sg);
    if (bi < 0 || best < 0.18 * H) return { wrist: [x0 + sg * 0.33 * H, y(0.5)], elbow: [x0 + sg * 0.2 * H, y(0.65)] };
    const tip = new THREE.Vector2(p[bi * 3], p[bi * 3 + 1]);
    const toS = S.clone().sub(tip).normalize();
    const W = tip.clone().add(toS.multiplyScalar(0.1 * H));
    const E = S.clone().add(W).multiplyScalar(0.5);
    return { wrist: [W.x, W.y], elbow: [E.x, E.y] };
  };
  const L = arm(1), R = arm(-1);
  return {
    chin: [x0, y(0.865)], groin: [x0, groinY],
    leftWrist: L.wrist, rightWrist: R.wrist, leftElbow: L.elbow, rightElbow: R.elbow,
    leftKnee: knee(1), rightKnee: knee(-1),
  };
}

// z-centre of the mesh around (x, y): middle of the front/back surfaces
function zCentre(g, x, y, r) {
  const p = g.pos;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i] - x) < r && Math.abs(p[i + 1] - y) < r) { mn = Math.min(mn, p[i + 2]); mx = Math.max(mx, p[i + 2]); }
  }
  return mn === Infinity ? g.box.z0 : (mn + mx) / 2;
}

// ---------- 2. skeleton from markers ----------
export function buildJoints(g, mk) {
  const { minY, maxY, H, x0 } = g.box;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const at = (x, y, r = 0.03 * H) => V(x, y, zCentre(g, x, y, r));
  const cx = (mk.chin[0] + mk.groin[0]) / 2 || x0;
  const J = {};
  J.pelvis = at(cx, mk.groin[1] + 0.05 * H, 0.06 * H);
  J.root = V(J.pelvis.x, minY, J.pelvis.z);
  const neckY = mk.chin[1] - 0.05 * H;
  J.neck_01 = at(cx, neckY, 0.03 * H);
  for (let k = 1; k <= 5; k++) {
    const yy = J.pelvis.y + (neckY - J.pelvis.y) * (k / 6);
    J['spine_0' + k] = at(cx, yy, 0.05 * H);
  }
  J.head = at(cx, mk.chin[1] + 0.015 * H, 0.04 * H);
  J.head_top = V(J.head.x, maxY, J.head.z);

  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    const S = s === 'l' ? 'left' : 'right';
    const W2 = new THREE.Vector2(...mk[S + 'Wrist']), E2 = new THREE.Vector2(...mk[S + 'Elbow']);
    const fore = E2.clone().sub(W2);
    let Sh = E2.clone().add(fore.clone().normalize().multiplyScalar(fore.length() * 1.05));
    const dx = THREE.MathUtils.clamp(sg * (Sh.x - cx), 0.07 * H, 0.15 * H);
    Sh = new THREE.Vector2(cx + sg * dx, THREE.MathUtils.clamp(Sh.y, neckY - 0.1 * H, neckY - 0.01 * H));
    J['clavicle_' + s] = at(cx + sg * 0.02 * H, neckY - 0.035 * H, 0.03 * H);
    J['upperarm_' + s] = at(Sh.x, Sh.y, 0.035 * H);
    J['lowerarm_' + s] = at(E2.x, E2.y, 0.025 * H);
    J['hand_' + s] = at(W2.x, W2.y, 0.02 * H);
    // fingertip: farthest vertex beyond the wrist along the forearm direction
    const dir = W2.clone().sub(E2).normalize();
    let far = 0.08 * H;
    const p = g.pos;
    for (let i = 0; i < p.length; i += 3) {
      const rx = p[i] - W2.x, ry = p[i + 1] - W2.y;
      const along = rx * dir.x + ry * dir.y, perp = Math.abs(rx * -dir.y + ry * dir.x);
      if (along > far && along < 0.2 * H && perp < 0.06 * H) far = along;
    }
    J['hand_end_' + s] = V(W2.x + dir.x * far, W2.y + dir.y * far, J['hand_' + s].z);
    placeFingers(g, J, s, W2, dir, far, H);

    const K = mk[S + 'Knee'];
    const legX = cx + sg * Math.max(0.05 * H, Math.abs(K[0] - cx) * 0.95);
    J['thigh_' + s] = at(legX, J.pelvis.y - 0.04 * H, 0.05 * H);
    J['calf_' + s] = at(K[0], K[1], 0.035 * H);
    // feet from the vertices near the floor on that side
    const foot = select(g, (vx, vy) => vy < minY + 0.07 * H && sg * (vx - cx) > 0.005 * H);
    let fx = K[0], fz0 = J['calf_' + s].z - 0.05 * H, fz1 = J['calf_' + s].z + 0.12 * H;
    if (foot.length) {
      let sx = 0, mnz = Infinity, mxz = -Infinity;
      foot.forEach((i) => { sx += p[i * 3]; mnz = Math.min(mnz, p[i * 3 + 2]); mxz = Math.max(mxz, p[i * 3 + 2]); });
      fx = sx / foot.length; fz0 = mnz; fz1 = mxz;
    }
    const len = fz1 - fz0;
    J['foot_' + s] = V(fx, minY + 0.045 * H, fz0 + len * 0.22);
    J['ball_' + s] = V(fx, minY + 0.015 * H, fz0 + len * 0.72);
    J['toe_end_' + s] = V(fx, minY + 0.012 * H, fz1);
  }
  return J;
}

// ---------- fingers ----------
// The hand is everything past the wrist along the forearm. Fingers start ~45% of the way to the
// fingertip. Which way are they spread? Palm-down T-pose → across Z (thumb toward the front);
// thumbs-up → vertically (thumb on top). Five chains are laid out across that spread.
export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
function placeFingers(g, J, s, W2, dir, far, H) {
  const p = g.pos;
  const hz = J['hand_' + s].z, hy = W2.y;
  const perp2 = new THREE.Vector2(-dir.y, dir.x); // in the front view, across the hand
  let zmin = Infinity, zmax = -Infinity, vmin = Infinity, vmax = -Infinity, cnt = 0;
  for (let i = 0; i < p.length; i += 3) {
    const rx = p[i] - W2.x, ry = p[i + 1] - W2.y;
    const along = rx * dir.x + ry * dir.y, across = rx * perp2.x + ry * perp2.y;
    if (along < 0.66 * far || along > far || Math.abs(across) > 0.06 * H || Math.abs(p[i + 2] - hz) > 0.08 * H) continue;
    zmin = Math.min(zmin, p[i + 2]); zmax = Math.max(zmax, p[i + 2]);
    vmin = Math.min(vmin, across); vmax = Math.max(vmax, across); cnt++;
  }
  const flatZ = cnt < 8 || (zmax - zmin) >= (vmax - vmin);
  // spread axis in 3D, pointing from pinky side to thumb side
  const spread = flatZ ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(perp2.x, perp2.y, 0).multiplyScalar(perp2.y >= 0 ? 1 : -1);
  const width = cnt < 8 ? 0.05 * H : Math.max(0.02 * H, flatZ ? zmax - zmin : vmax - vmin);
  const centre = cnt < 8 ? 0 : (flatZ ? (zmin + zmax) / 2 - hz : (vmin + vmax) / 2 * (perp2.y >= 0 ? 1 : -1));
  const along3 = new THREE.Vector3(dir.x, dir.y, 0);
  const base = new THREE.Vector3(W2.x, hy, hz);
  const pt = (a, sp) => base.clone().addScaledVector(along3, a).addScaledVector(spread, centre + sp);
  const reach = far * 0.97;
  const fingers = { index: [0.36, 0.96], middle: [0.12, 1.0], ring: [-0.12, 0.96], pinky: [-0.36, 0.86] };
  for (const [f, [frac, len]] of Object.entries(fingers)) {
    const k0 = 0.47 * far, k3 = 0.47 * far + (reach - 0.47 * far) * len;
    const sp = frac * width;
    const steps = [k0, k0 + (k3 - k0) * 0.42, k0 + (k3 - k0) * 0.72, k3];
    steps.forEach((a, i) => { J[`${f}_0${i + 1}_${s}`] = pt(a, sp); });
    J[`${f}_end_${s}`] = J[`${f}_04_${s}`]; delete J[`${f}_04_${s}`];
  }
  // thumb: find the part of the mesh sticking out on the thumb side; fall back to typical proportions
  const spreadOf = (i) => (p[i] - base.x) * spread.x + (p[i + 1] - base.y) * spread.y + (p[i + 2] - base.z) * spread.z - centre;
  let tip = null, tipScore = -Infinity, nThumb = 0;
  for (let i = 0; i < p.length; i += 3) {
    const rx = p[i] - W2.x, ry = p[i + 1] - W2.y;
    const along = rx * dir.x + ry * dir.y;
    if (along < 0.05 * far || along > 0.7 * far || Math.abs(p[i + 2] - hz) > 0.12 * H) continue;
    const sp = spreadOf(i);
    if (sp < 0.6 * width) continue;
    nThumb++;
    const score = along + sp;
    if (score > tipScore) { tipScore = score; tip = new THREE.Vector3(p[i], p[i + 1], p[i + 2]); }
  }
  const thumbBase = pt(0.13 * far, 0.42 * width);
  const thumbTip = nThumb >= 6 && tip ? tip : pt(0.62 * far, 1.1 * width);
  // pull the tip back inside the surface a little (joints sit in the middle of the finger)
  thumbTip.lerp(thumbBase, 0.06);
  [0, 0.4, 0.7, 1].forEach((f, i) => { J[`thumb_0${i + 1}_${s}`] = thumbBase.clone().lerp(thumbTip, f); });
  J[`thumb_end_${s}`] = J[`thumb_04_${s}`]; delete J[`thumb_04_${s}`];
  // the palm bone now ends at the knuckles, so fingers get their own vertices
  J['hand_end_' + s] = J[`middle_01_${s}`].clone();
}

// Bone list: [name, parent, startJoint, endJoint (for weighting), side]
// eslint-disable-next-line no-use-before-define
export const BONES = [
  ['root', null, 'root', null, 'c'],
  ['pelvis', 'root', 'pelvis', 'spine_01', 'c'],
  ['spine_01', 'pelvis', 'spine_01', 'spine_02', 'c'],
  ['spine_02', 'spine_01', 'spine_02', 'spine_03', 'c'],
  ['spine_03', 'spine_02', 'spine_03', 'spine_04', 'c'],
  ['spine_04', 'spine_03', 'spine_04', 'spine_05', 'c'],
  ['spine_05', 'spine_04', 'spine_05', 'neck_01', 'c'],
  ['neck_01', 'spine_05', 'neck_01', 'head', 'c'],
  ['head', 'neck_01', 'head', 'head_top', 'c'],
  ...['l', 'r'].flatMap((s) => [
    [`clavicle_${s}`, 'spine_05', `clavicle_${s}`, `upperarm_${s}`, s],
    [`upperarm_${s}`, `clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, s],
    [`lowerarm_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, s],
    [`hand_${s}`, `lowerarm_${s}`, `hand_${s}`, `hand_end_${s}`, s],
    ...FINGER_NAMES.flatMap((f) => [1, 2, 3].map((i) => [`${f}_0${i}_${s}`, i === 1 ? `hand_${s}` : `${f}_0${i - 1}_${s}`, `${f}_0${i}_${s}`, i === 3 ? `${f}_end_${s}` : `${f}_0${i + 1}_${s}`, s])),
    [`thigh_${s}`, 'pelvis', `thigh_${s}`, `calf_${s}`, s],
    [`calf_${s}`, `thigh_${s}`, `calf_${s}`, `foot_${s}`, s],
    [`foot_${s}`, `calf_${s}`, `foot_${s}`, `ball_${s}`, s],
    [`ball_${s}`, `foot_${s}`, `ball_${s}`, `toe_end_${s}`, s],
  ]),
];

// ---------- 3. heat-diffusion skin weights ----------
function segDist(px, py, pz, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1e-12;
  let t = ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  if (out) out.set(cx, cy, cz);
  return Math.hypot(px - cx, py - cy, pz - cz);
}

export async function computeWeights(g, J, onProgress = () => {}) {
  const n = g.pos.length / 3;
  const P = g.pos, tris = g.tris;
  const { H, x0 } = g.box;
  const segs = [];
  BONES.forEach(([name, , a, b, side], bi) => { if (b) segs.push({ bi, a: J[a], b: J[b], side, name }); });
  // Pelvis segment reaches down to the crotch so the hips get the pelvis, not a thigh.
  const pel = segs.find((s) => s.name === 'pelvis');
  pel.a = J.pelvis.clone().setY(J.pelvis.y - 0.06 * H);

  // Visibility via BVH: is the straight line from bone to vertex inside the mesh?
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  bgeo.setIndex(new THREE.BufferAttribute(tris, 1));
  const bvh = new MeshBVH(bgeo);
  const ray = new THREE.Ray(), cp = new THREE.Vector3(), dir = new THREE.Vector3();

  onProgress(0.02, 'Finding nearest bones');
  const nearest = new Int32Array(n), nearD = new Float32Array(n);
  const cand = segs.map(() => 0);
  for (let i = 0; i < n; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    const side = px - x0 > 0.015 * H ? 'l' : px - x0 < -0.015 * H ? 'r' : 'c';
    const list = [];
    for (let s = 0; s < segs.length; s++) {
      const sg = segs[s];
      if ((sg.side === 'l' && side === 'r') || (sg.side === 'r' && side === 'l')) continue;
      list.push([segDist(px, py, pz, sg.a, sg.b), s]);
    }
    list.sort((u, w) => u[0] - w[0]);
    let pick = list[0];
    for (let c = 0; c < Math.min(4, list.length); c++) {
      const [d, s] = list[c];
      if (d > list[0][0] * 2.5) break;
      segDist(px, py, pz, segs[s].a, segs[s].b, cp);
      dir.set(px - cp.x, py - cp.y, pz - cp.z);
      const len = dir.length();
      if (len < 1e-6) { pick = list[c]; break; }
      ray.origin.copy(cp); ray.direction.copy(dir).divideScalar(len);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, len * 0.98);
      if (!hit) { pick = list[c]; break; }
    }
    nearest[i] = pick[1]; nearD[i] = Math.max(pick[0], 0.004 * H);
    void cand;
  }

  onProgress(0.15, 'Building the surface graph');
  // Cotangent Laplacian (clamped) + lumped vertex areas
  const area = new Float64Array(n);
  const edges = new Map();
  const addW = (i, j, w) => {
    const k = i < j ? i * n + j : j * n + i;
    edges.set(k, (edges.get(k) || 0) + w);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  const cot = (o, p1, p2) => {
    u.subVectors(p1, o); v.subVectors(p2, o);
    const cr = u.clone().cross(v).length();
    return cr < 1e-12 ? 0 : u.dot(v) / cr;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t], j = tris[t + 1], k = tris[t + 2];
    a.fromArray(P, i * 3); b.fromArray(P, j * 3); c.fromArray(P, k * 3);
    const ar = u.subVectors(b, a).cross(v.subVectors(c, a)).length() / 2;
    area[i] += ar / 3; area[j] += ar / 3; area[k] += ar / 3;
    const ci = cot(a, b, c), cj = cot(b, c, a), ck = cot(c, a, b);
    addW(j, k, Math.max(0.5 * ci, 1e-3));
    addW(k, i, Math.max(0.5 * cj, 1e-3));
    addW(i, j, Math.max(0.5 * ck, 1e-3));
  }
  // CSR
  const deg = new Int32Array(n);
  for (const key of edges.keys()) { deg[Math.floor(key / n)]++; deg[key % n]++; }
  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i] + deg[i];
  const col = new Int32Array(rowPtr[n]), val = new Float64Array(rowPtr[n]);
  const fill = rowPtr.slice(0, n);
  const diag = new Float64Array(n);
  for (const [key, w0] of edges) {
    const i = Math.floor(key / n), j = key % n, w = Math.min(w0, 1e3);
    col[fill[i]] = j; val[fill[i]++] = -w;
    col[fill[j]] = i; val[fill[j]++] = -w;
    diag[i] += w; diag[j] += w;
  }
  const meanArea = area.reduce((s, x) => s + x, 0) / Math.max(1, n) || 1;
  const Hd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const A = area[i] > 0 ? area[i] : meanArea;
    Hd[i] = A / (nearD[i] * nearD[i]);
    diag[i] += Hd[i];
  }
  const mul = (x, out) => {
    for (let i = 0; i < n; i++) {
      let s = diag[i] * x[i];
      for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) s += val[e] * x[col[e]];
      out[i] = s;
    }
  };

  // Solve one system per bone with Jacobi-preconditioned conjugate gradients.
  const nb = BONES.length;
  const W = new Float32Array(n * nb);
  const x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n), rhs = new Float64Array(n);
  for (let s = 0; s < segs.length; s++) {
    const bi = segs[s].bi;
    let any = false;
    for (let i = 0; i < n; i++) { const on = nearest[i] === s; rhs[i] = on ? Hd[i] : 0; x[i] = on ? 1 : 0; if (on) any = true; }
    if (!any) continue;
    mul(x, Ap);
    let rz = 0, bnorm = 0;
    for (let i = 0; i < n; i++) { r[i] = rhs[i] - Ap[i]; z[i] = r[i] / diag[i]; p[i] = z[i]; rz += r[i] * z[i]; bnorm += rhs[i] * rhs[i]; }
    bnorm = Math.sqrt(bnorm) || 1;
    for (let it = 0; it < 500; it++) {
      mul(p, Ap);
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      if (pAp <= 0) break;
      const alpha = rz / pAp;
      let rn = 0, rzNew = 0;
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rn += r[i] * r[i]; }
      if (Math.sqrt(rn) / bnorm < 1e-5) break;
      for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; rzNew += r[i] * z[i]; }
      const beta = rzNew / rz; rz = rzNew;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    for (let i = 0; i < n; i++) W[i * nb + bi] = x[i] > 0 ? Math.min(1, x[i]) : 0;
    onProgress(0.2 + 0.75 * ((s + 1) / segs.length), `Skin weights: ${segs[s].name}`);
    await new Promise((res) => setTimeout(res, 0));
  }

  // Keep the 4 strongest influences per vertex (glTF limit) and normalise.
  const idx4 = new Uint16Array(n * 4), w4 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < nb; j++) { const w = W[i * nb + j]; if (w > 0.01) row.push([w, j]); }
    row.sort((p1, p2) => p2[0] - p1[0]);
    const top = row.slice(0, 4);
    let sum = top.reduce((s, e) => s + e[0], 0);
    if (sum <= 0) { top.length = 0; top.push([1, segs[nearest[i]].bi]); sum = 1; }
    top.forEach(([w, j], k) => { idx4[i * 4 + k] = j; w4[i * 4 + k] = w / sum; });
  }
  bgeo.dispose();
  return { idx4, w4 };
}

// ---------- 4. assemble the rigged character ----------
export async function autoRig(doc, markers, onProgress = () => {}) {
  const g = gatherMesh(doc);
  const mk = { ...guessMarkers(g), ...(markers || {}) };
  onProgress(0.01, 'Placing joints');
  const J = buildJoints(g, mk);
  const { idx4, w4 } = await computeWeights(g, J, onProgress);

  const armature = new THREE.Object3D();
  armature.name = 'Armature';
  const bones = new Map();
  for (const [name, parent, start] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const pw = parent ? J[BONES.find((x) => x[0] === parent)[2]] : new THREE.Vector3();
    bone.position.copy(J[start]).sub(pw);
    (parent ? bones.get(parent) : armature).add(bone);
    bones.set(name, bone);
  }
  const list = BONES.map(([name]) => bones.get(name));
  armature.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);

  g.parts.forEach((m, pi) => {
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (k === 'skinIndex' || k === 'skinWeight') geo.deleteAttribute(k);
    const map = g.partMaps[pi];
    const cnt = geo.attributes.position.count;
    const si = new Uint16Array(cnt * 4), sw = new Float32Array(cnt * 4);
    for (let i = 0; i < cnt; i++) {
      const w = map[i];
      for (let c = 0; c < 4; c++) { si[i * 4 + c] = idx4[w * 4 + c]; sw[i * 4 + c] = w4[w * 4 + c]; }
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    const sm = new THREE.SkinnedMesh(geo, m.material);
    sm.name = m.name || 'Body';
    armature.add(sm);
    sm.bind(skeleton);
  });
  onProgress(1, 'Done');
  const out = new CharacterDoc({ object: armature, clips: [], sourceName: doc.sourceName, format: doc.format + ' (auto-rigged)' });
  out.rigMarkers = mk;
  out.autoRigged = true;
  return { doc: out, markers: mk, joints: J, stats: { vertices: g.pos.length / 3, triangles: g.tris.length / 3, bones: list.length } };
}
