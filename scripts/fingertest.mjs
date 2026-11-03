// Fingers: demo mannequin has them, auto-rig finds them, captured finger motion arrives.
import * as THREE from 'three';
import fs from 'fs';
globalThis.FileReader = class { readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{this.result=r; this.onloadend&&this.onloadend();}); } readAsDataURL(b){ b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend&&this.onloadend();}); } };
const { buildDemoCharacter } = await import('../src/core/demo.js');
const { CharacterDoc, loadFromArrayBuffer } = await import('../src/core/character.js');
const { autoRig } = await import('../src/core/autorig.js');
const { retargetClip } = await import('../src/core/retarget.js');
const { FINGER_KEYS } = await import('../src/core/profiles.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const FK = [...FINGER_KEYS('left'), ...FINGER_KEYS('right')];

const demo = buildDemoCharacter();
const mapped = FK.filter((k) => demo.bone(k));
ok(mapped.length === 30, `demo mannequin: ${mapped.length}/30 finger bones recognised (${demo.bones.length} bones, ${demo.detection.label})`);
ok(demo.detection.missing.length === 0, 'demo mannequin: full humanoid detected');

// bare copy of the mannequin (fingers included) → auto-rig
demo.restPose();
const g = new THREE.Group();
for (const m of demo.skinnedMeshes) { const geo = m.geometry.clone(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); const pa = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < pa.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); pa.setXYZ(i, v.x, v.y, v.z); } g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial())); }
const bare = new CharacterDoc({ object: g, clips: [], sourceName: 'Bare.glb', format: 'GLB' });
const t0 = Date.now();
const { doc: rigged, joints: J, stats } = await autoRig(bare, null);
console.log(`  auto-rig: ${stats.bones} bones in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const rmapped = FK.filter((k) => rigged.bone(k));
ok(rmapped.length === 30, `auto-rig: ${rmapped.length}/30 finger bones recognised (${rigged.detection.label})`);
// finger joints should sit on the real fingers: compare with the mannequin's own finger joints
const pairs = [['index_01_l', 'mixamorigLeftHandIndex1'], ['middle_03_l', 'mixamorigLeftHandMiddle3'], ['pinky_02_r', 'mixamorigRightHandPinky2'], ['thumb_02_l', 'mixamorigLeftHandThumb2']];
for (const [a, b] of pairs) {
  const bb = demo.bones.find((x) => x.name === b).getWorldPosition(new THREE.Vector3());
  const d = J[a].distanceTo(bb);
  ok(d < 0.03, `auto-rig ${a} lands ${(d * 100).toFixed(1)} cm from the real ${b.replace('mixamorig', '')}`);
}
// weights: every finger bone owns some vertices
const sm = rigged.skinnedMeshes[0], si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
const owned = new Map();
for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) if (sw.getComponent(i, c) > 0.5) { const b = sm.skeleton.bones[si.getComponent(i, c)].name; owned.set(b, (owned.get(b) || 0) + 1); }
const fingerBones = sm.skeleton.bones.filter((b) => /^(thumb|index|middle|ring|pinky)_/.test(b.name));
const empty = fingerBones.filter((b) => !owned.get(b.name)).map((b) => b.name);
ok(empty.length <= 2, `auto-rig weights: ${fingerBones.length - empty.length}/${fingerBones.length} finger bones drive vertices${empty.length ? ' (empty: ' + empty.join(',') + ')' : ''}`);

// captured finger motion reaches the mannequin's fingers
const b = fs.readFileSync('/tmp/demo.glb');
const src = await loadFromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'cap.glb');
for (const [name, tgt] of [['mannequin', buildDemoCharacter()], ['auto-rigged', rigged]]) {
  const clip = retargetClip(src, src.clips[0], tgt, { name: 'cap' });
  const ft = clip.tracks.filter((t) => FK.some((k) => tgt.bone(k) && t.name === tgt.bone(k).name + '.quaternion'));
  // fingers in the synthetic capture are curled (not rest) → retargeted quats differ from the bone's rest
  let curled = 0;
  for (const t of ft) {
    const bone = tgt.bones.find((x) => t.name === x.name + '.quaternion');
    const r = tgt.rest.get(bone).q, q = new THREE.Quaternion().fromArray(t.values, 0);
    if (q.angleTo(r) > 0.1) curled++;
  }
  ok(ft.length === 30 && curled >= 16, `${name}: ${ft.length} finger tracks retargeted, ${curled} bent away from rest`);
}
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
