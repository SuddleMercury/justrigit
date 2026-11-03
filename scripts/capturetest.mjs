// End-to-end: JustRigIt → local capture engine (run `python -m jrcapture serve --demo` first)
// → retarget onto the demo character with foot locking → export for UE5/Godot/Unity
// with each engine's skeleton naming → re-import and check.
import * as THREE from 'three';
globalThis.FileReader = class { readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{this.result=r; this.onloadend&&this.onloadend();}); } readAsDataURL(b){ b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend&&this.onloadend();}); } };
const { Forge } = await import('../src/core/forge.js');
const { loadFromArrayBuffer } = await import('../src/core/character.js');
const { unzipSync } = await import('fflate');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const f = new Forge();
const st = await f.call('capture_status');
ok(st.online, `engine online (${st.engine}${st.demo ? ', demo' : ''})`);
if (!st.online) { console.log('Start the engine first.'); process.exit(1); }
await f.call('load_character', { demo: true });
const events = []; f.on((t, d) => { if (t === 'capture-progress') events.push(d); });
const fake = Buffer.alloc(50000, 7).toString('base64');
const r = await f.call('capture_video', { base64: fake, filename: 'my_walk.mp4', smoothing: 'medium' });
console.log('  ', r.message);
ok(r.clip === 'Capture_my_walk', 'clip named from the video');
ok(events.length > 2 && events.at(-1).progress === 1, `progress events (${events.length})`);
ok(r.footLock && r.footLock.skateAfterCm < r.footLock.skateBeforeCm * 0.5, 'foot locking at least halves foot sliding');
const info = f.clipInfo().find((c) => c.name === 'Capture_my_walk');
ok(info && info.moves && info.travelMeters > 2, `clip travels (${info?.travelMeters} m)`);
const raw = await f.call('export_capture', { format: 'bvh', deliver: 'base64' });
ok(raw.filename.endsWith('_SOMA.bvh') && raw.bytes > 1000, 'raw capture BVH available');
for (const target of ['ue5', 'godot', 'unity']) {
  await f.call('set_target', { engine: target });
  await f.call('set_export_options', { bone_naming: 'auto', motion: 'rootmotion' });
  if (target === 'ue5') await f.call('apply_fix', { fix: 'all' });
  const ex = await f.call('export_bundle', { deliver: 'base64' });
  const files = unzipSync(new Uint8Array(Buffer.from(ex.base64, 'base64')));
  const g = Object.keys(files).find((k) => k.endsWith('.glb')); const u8 = files[g];
  const doc = await loadFromArrayBuffer(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), g);
  const clip = doc.clips.find((c) => /Capture_my_walk/.test(c.name));
  ok(!!clip, `${target}: captured clip exported (${clip?.name})`);
  ok(/Motion-captured animations/.test(ex.guide_markdown), `${target}: guide has the capture section`);
  // Play it: feet must stay near the floor, head up, and the character must travel forward (+Z) via root motion
  const mixer = new THREE.AnimationMixer(doc.root); const act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
  let minFoot = 9, head = 9, z0 = null, z1 = null;
  const ft = [doc.bone('leftFoot'), doc.bone('rightFoot')], hd = doc.bone('head'), hp = doc.bone('hips');
  for (let i = 0; i <= 20; i++) { mixer.setTime(clip.duration * i / 20); doc.root.updateMatrixWorld(true);
    minFoot = Math.min(minFoot, ...ft.map((b) => b.getWorldPosition(new THREE.Vector3()).y)); head = Math.min(head, hd.getWorldPosition(new THREE.Vector3()).y);
    const z = hp.getWorldPosition(new THREE.Vector3()).z; if (i === 0) z0 = z; if (i === 20) z1 = z; }
  ok(minFoot > -0.03 && minFoot < 0.2, `${target}: feet on the floor (lowest ankle ${minFoot.toFixed(3)} m)`);
  ok(head > 1.2, `${target}: stays upright (lowest head ${head.toFixed(2)} m)`);
  ok(z1 - z0 > 2, `${target}: travels forward ${(z1 - z0).toFixed(2)} m`);
}
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
