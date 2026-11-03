// Exports the demo character with every skeleton naming standard, re-imports each file
// and checks that the engines' expected bone names are present and detection still works.
import * as THREE from 'three';
globalThis.FileReader = class { readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{this.result=r; this.onloadend&&this.onloadend();}); } readAsDataURL(b){ b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend&&this.onloadend();}); } };
const { Forge } = await import('../src/core/forge.js');
const { loadFromArrayBuffer } = await import('../src/core/character.js');
const { unzipSync } = await import('fflate');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const glbNames = (u8) => { const dv = new DataView(u8.buffer, u8.byteOffset); const n = dv.getUint32(12, true); return JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + n))).nodes.map((x) => x.name); };
const EXPECT = {
  ue5: ['root', 'pelvis', 'spine_01', 'spine_05', 'neck_01', 'head', 'clavicle_l', 'upperarm_l', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_r', 'foot_l', 'ball_r'],
  godot: ['Root', 'Hips', 'Spine', 'UpperChest', 'Neck', 'Head', 'LeftShoulder', 'LeftUpperArm', 'RightLowerArm', 'RightHand', 'LeftUpperLeg', 'RightLowerLeg', 'LeftFoot', 'RightToes'],
  mixamo: ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine2', 'mixamorig:Neck', 'mixamorig:Head', 'mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand', 'mixamorig:LeftUpLeg', 'mixamorig:RightLeg', 'mixamorig:LeftFoot', 'mixamorig:RightToeBase'],
};
for (const target of ['ue5', 'godot', 'unity', 'blender']) {
  const f = new Forge();
  await f.call('load_character', { demo: true });
  await f.call('set_target', { engine: target });
  await f.call('apply_fix', { fix: 'all' }); // Unreal target adds the root bone
  await f.call('add_animations', { clips: ['Idle', 'Walk_Fwd'] });
  const nClips = f.doc.clips.length, hasRoot = !!f.doc.rootBone();
  for (const naming of ['auto', 'ue5', 'godot', 'mixamo', 'keep']) {
    await f.call('set_export_options', { bone_naming: naming });
    const st = f.status().boneNaming;
    const r = await f.call('export_bundle', { deliver: 'base64' });
    const files = unzipSync(new Uint8Array(Buffer.from(r.base64, 'base64')));
    const glbName = Object.keys(files).find((k) => k.endsWith('.glb'));
    const names = glbNames(files[glbName]);
    const eff = st.effective;
    if (EXPECT[eff]) {
      const missing = EXPECT[eff].filter((n) => !names.includes(n)).filter((n) => hasRoot || !/^root$/i.test(n));
      ok(!missing.length, `${target}/${naming} → ${eff}: standard names present${missing.length ? ' (missing ' + missing.join(',') + ')' : ''}`);
    }
    if (naming === 'auto' && target === 'ue5') ok(hasRoot && names.includes('root'), 'ue5 export has the root bone');
    ok(new Set(names.filter(Boolean)).size === names.filter(Boolean).length, `${target}/${naming}: no duplicate node names`);
    // re-import: animations still bound & skeleton recognised
    const u8 = files[glbName];
    const doc = await loadFromArrayBuffer(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), glbName);
    ok(doc.detection.missing.length === 0, `${target}/${naming}: re-imported skeleton detected as ${doc.detection.label}`);
    ok(doc.clips.length === nClips && doc.clips.every((c) => c.tracks.length > 10), `${target}/${naming}: ${doc.clips.length} clips with tracks`);
    if (naming === 'auto') ok(eff === { ue5: 'ue5', godot: 'godot', unity: 'mixamo', blender: 'keep' }[target], `${target}: auto naming = ${eff}`);
    if (target === 'godot' && naming === 'auto') ok(/SkeletonProfileHumanoid/.test(r.guide_markdown), 'godot guide explains SkeletonProfileHumanoid');
  }
}
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
