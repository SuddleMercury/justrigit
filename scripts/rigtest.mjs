import fs from 'fs';
import * as THREE from 'three';
const { loadFromArrayBuffer, CharacterDoc } = await import('../src/core/character.js');
const { autoRig } = await import('../src/core/autorig.js');
const file = process.argv[2] || 'testassets/Xbot.glb';
const b = fs.readFileSync(file);
const rigged = await loadFromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), file.split('/').pop());
rigged.restPose();
// strip skin -> plain meshes in world space
const g = new THREE.Group();
for (const m of rigged.skinnedMeshes) {
  const geo = m.geometry.clone(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
  const pa = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); pa.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, m.material));
}
const s = rigged.metrics.height > 20 ? 0.01 : 1; g.scale.setScalar(s);
const bare = new CharacterDoc({ object: g, clips: [], sourceName: 'bare.glb', format: 'GLB' });
console.log('bare skinned meshes:', bare.skinnedMeshes.length, 'height', bare.metrics.height.toFixed(2));
const t0 = Date.now();
let last = 0;
const res = await autoRig(bare, null, (p, msg) => { if (p - last > 0.25) { last = p; console.log('  ', Math.round(p * 100) + '%', msg); } });
console.log('rigged in', ((Date.now() - t0) / 1000).toFixed(1) + 's', res.stats);
const d = res.doc;
console.log('detected as:', d.detection.label, 'missing:', d.detection.missing, 'height', d.metrics.height.toFixed(2), 'facing', d.metrics.facingDeg?.toFixed(1));
// compare joints with the original professional rig
const wp = (bn) => bn.getWorldPosition(new THREE.Vector3());
rigged.root.scale.setScalar(s); rigged.root.updateMatrixWorld(true);
const pairs = ['hips','head','leftUpperArm','leftLowerArm','leftHand','rightLowerArm','leftUpperLeg','leftLowerLeg','leftFoot','rightLowerLeg'];
for (const k of pairs) {
  const a = rigged.bone(k), c = d.bone(k);
  if (!a || !c) { console.log(k, 'missing'); continue; }
  console.log('  ', k.padEnd(14), 'error', (wp(a).distanceTo(wp(c)) * 100).toFixed(1), 'cm');
}
// weight sanity: how many vertices dominated by which bone
const sm = d.skinnedMeshes[0]; const si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
const counts = {};
for (let i = 0; i < si.count; i++) { const n = sm.skeleton.bones[si.getX(i)].name; counts[n] = (counts[n] || 0) + 1; }
console.log('dominant bone counts:', JSON.stringify(counts));
globalThis.__rig = res;
fs.writeFileSync('/tmp/rigged_doc_ok', 'yes');
{
const res = globalThis.__rig; const d = res.doc; const J = res.joints;
console.log('chin marker', res.markers.chin.map(v=>v.toFixed(3)), 'head joint', J.head.toArray().map(v=>v.toFixed(3)), 'neck', J.neck_01.toArray().map(v=>v.toFixed(3)), 'top', J.head_top.y.toFixed(3));
for (const sm of d.skinnedMeshes) {
  const si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight, pa = sm.geometry.attributes.position;
  let above=0; const dom={};
  for (let i=0;i<pa.count;i++){ if (pa.getY(i) > J.head.y + 0.05){ above++; const n=sm.skeleton.bones[si.getX(i)].name; dom[n]=(dom[n]||0)+1; } }
  console.log(sm.name, 'verts above head joint+5cm:', above, JSON.stringify(dom));
}
}
