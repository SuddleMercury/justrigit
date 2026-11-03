import fs from 'fs';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
const { loadFromArrayBuffer } = await import('../src/core/character.js');
const { runHealthCheck } = await import('../src/core/health.js');
for (const z of ['/tmp/out_demo.zip','/tmp/out_Xbot.glb.zip','/tmp/out_Samba.fbx.zip']) {
  const files = unzipSync(fs.readFileSync(z));
  const glbName = Object.keys(files).find(n=>n.endsWith('.glb'));
  const u = files[glbName];
  const d = await loadFromArrayBuffer(u.buffer.slice(u.byteOffset, u.byteOffset+u.byteLength), glbName);
  const issues = runHealthCheck(d, 'ue5').filter(i=>i.severity!=='ok' && i.severity!=='info');
  console.log(z.split('/').pop(), '->', glbName, '| bones', d.bones.length, '| top bone', d.topBones().map(b=>b.name).join(','), '| height', d.metrics.height.toFixed(2), '| clips', d.clips.map(c=>c.name).join(','), '| problems:', issues.map(i=>i.title).join('; ')||'none');
  // play first moving clip mid-way and check the skinned mesh still has a sane size (no explosion)
  const mixer = new THREE.AnimationMixer(d.root);
  const c = d.clips.find(c=>/walk/i.test(c.name)) || d.clips[0];
  if (c) { mixer.clipAction(c).play(); mixer.update(c.duration*0.5); d.root.updateMatrixWorld(true);
    const box = new THREE.Box3(); d.skinnedMeshes.forEach(m=>box.union(new THREE.Box3().setFromObject(m,true)));
    const rt = c.tracks.find(t=>t.name==='root.position'); 
    console.log('   mid-clip', c.name, 'size', box.getSize(new THREE.Vector3()).toArray().map(v=>v.toFixed(2)).join(' x '), 'rootTrack', !!rt);
  }
}
console.log(Object.keys(unzipSync(fs.readFileSync('/tmp/out_demo.zip'))));
