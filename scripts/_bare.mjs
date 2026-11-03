// helper: writes an unrigged copy of the demo mannequin to argv[2]
import fs from 'fs'; import * as THREE from 'three';
import '../src/node/shims.js';
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { buildDemoCharacter } = await import('../src/core/demo.js');
const d = buildDemoCharacter(); d.restPose(); const g = new THREE.Group();
for (const m of d.skinnedMeshes) { const geo = m.geometry.clone(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); const pa = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < pa.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); pa.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8899aa }))); }
new GLTFExporter().parse(g, (r) => fs.writeFileSync(process.argv[2], Buffer.from(r)), console.error, { binary: true });
