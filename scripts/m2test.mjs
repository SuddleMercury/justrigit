import fs from 'fs';
import * as THREE from 'three';
globalThis.FileReader = class { readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{this.result=r; this.onloadend&&this.onloadend();}); } readAsDataURL(b){ b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend&&this.onloadend();}); } };
const { Forge } = await import('../src/core/forge.js');
const { loadFromArrayBuffer, CharacterDoc } = await import('../src/core/character.js');
const { unzipSync } = await import('fflate');
const buf = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
// bare Xbot
const rigged = await loadFromArrayBuffer(buf('testassets/Xbot.glb'), 'Xbot.glb'); rigged.restPose();
const g = new THREE.Group();
for (const m of rigged.skinnedMeshes) { const geo = m.geometry.clone(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); const pa = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < pa.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); pa.setXYZ(i, v.x, v.y, v.z); } g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial())); }
const f = new Forge();
await f.setDoc(new CharacterDoc({ object: g, clips: [], sourceName: 'Robot.glb', format: 'GLB' }));
console.log('needsRig', f.status().needsRig, 'markers', Object.keys(f.rigMarkers).length);
console.log((await f.call('auto_rig')).message);
await f.call('set_target', { engine: 'ue5' });
console.log('health:', JSON.stringify(f.status().health), f.issues.filter(i => i.severity !== 'ok').map(i => i.title));
let t = Date.now(); console.log((await f.call('add_animations', { pack: 'third_person' })).message.slice(0, 120), ((Date.now() - t) / 1000).toFixed(1) + 's');
t = Date.now(); console.log((await f.call('add_animations', { base64: fs.readFileSync('testassets/Samba.fbx').toString('base64'), filename: 'Samba.fbx' })).message, ((Date.now() - t) / 1000).toFixed(1) + 's');
// foot-on-ground quality check for a few clips, played as exported (in place)
const { processClip } = await import('../src/core/clips.js');
const d = f.doc;
for (const nm of ['Idle', 'Walk_Fwd', 'Run_Fwd', 'Walk_Left', 'Crouch_Idle', 'Jump_Land', 'Samba']) {
  const c = d.findClip(nm); if (!c) { console.log('no', nm); continue; }
  const pc = processClip(d, c, 'inplace');
  const mixer = new THREE.AnimationMixer(d.root); mixer.clipAction(pc).play();
  let minFoot = Infinity, maxFoot = -Infinity, maxH = 0;
  for (let i = 0; i <= 20; i++) { mixer.setTime(pc.duration * i / 20); d.root.updateMatrixWorld(true);
    const lf = d.bone('leftFoot').getWorldPosition(new THREE.Vector3()).y, rf = d.bone('rightFoot').getWorldPosition(new THREE.Vector3()).y;
    minFoot = Math.min(minFoot, lf, rf); maxFoot = Math.max(maxFoot, Math.min(lf, rf)); maxH = Math.max(maxH, d.bone('head').getWorldPosition(new THREE.Vector3()).y); }
  mixer.stopAllAction(); d.restPose();
  console.log('  ', nm.padEnd(12), 'lowest ankle', (minFoot*100).toFixed(1), 'cm | lower foot highest', (maxFoot*100).toFixed(1), 'cm | head max', maxH.toFixed(2));
}
const ex = await f.call('export_bundle', { deliver: 'base64' });
console.log(ex.message.slice(0, 160));
const files = unzipSync(Buffer.from(ex.base64, 'base64'));
const glb = files[Object.keys(files).find(n => n.endsWith('.glb'))];
const back = await loadFromArrayBuffer(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), 'SK.glb');
console.log('reimport:', back.detection.label, back.bones.length, 'bones,', back.clips.length, 'clips, height', back.metrics.height.toFixed(2));
const guide = new TextDecoder().decode(files[Object.keys(files).find(n => n.endsWith('.md'))]);
fs.writeFileSync('/tmp/guide.md', guide);
