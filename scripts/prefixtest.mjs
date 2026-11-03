import fs from 'fs';
import * as THREE from 'three';
const { detectSkeleton } = await import('../src/core/profiles.js');
const { loadFromArrayBuffer } = await import('../src/core/character.js');
// UE5-mannequin-style names with various FBX namespaces
const ue = ['root','pelvis','spine_01','spine_02','spine_03','spine_04','spine_05','neck_01','head','clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r','ik_hand_root','lowerarm_twist_01_l'];
for (const pre of ['', 'Character1:', 'SK_Mannequin|', 'Armature_', 'Rig.']) {
  const bones = ue.map(n => { const b = new THREE.Bone(); b.name = THREE.PropertyBinding.sanitizeNodeName(pre + n); return b; });
  const d = detectSkeleton(bones);
  console.log(JSON.stringify(pre).padEnd(16), '->', d.label, Math.round(d.score * 15) + '/15', 'missing:', d.missing.join(',') || 'none');
}
// regression: real files still detect correctly
for (const f of ['testassets/Xbot.glb', 'testassets/Samba.fbx']) {
  const b = fs.readFileSync(f); const d = await loadFromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop());
  console.log(f.padEnd(22), '->', d.detection.label, d.detection.missing.length ? 'missing ' + d.detection.missing : '15/15');
}
