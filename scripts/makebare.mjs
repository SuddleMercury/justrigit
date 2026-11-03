import fs from 'fs';
import * as THREE from 'three';
globalThis.FileReader = class { readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{this.result=r; this.onloadend&&this.onloadend();}); } readAsDataURL(b){ b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend&&this.onloadend();}); } };
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { loadFromArrayBuffer } = await import('../src/core/character.js');
const b = fs.readFileSync('testassets/Xbot.glb');
const rigged = await loadFromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength), 'Xbot.glb'); rigged.restPose();
const g = new THREE.Group();
for (const m of rigged.skinnedMeshes) { const geo = m.geometry.clone(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); const pa = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < pa.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); pa.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); const mm = new THREE.Mesh(geo, m.material); mm.name = m.name; g.add(mm); }
// rotate 90° so the test also covers "turn the character to face you"
g.rotation.y = Math.PI / 2;
new GLTFExporter().parse(g, (r) => { fs.writeFileSync('testassets/Robot_unrigged.glb', Buffer.from(r)); console.log('wrote', r.byteLength); }, console.error, { binary: true });
