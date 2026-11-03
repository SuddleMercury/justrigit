import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { detectSkeleton } from './profiles.js';

// A loaded character. Everything lives under `root` (a Group we own), so fixes like
// scale / rotate / move-to-floor are applied to that one wrapper.
export class CharacterDoc {
  constructor({ object, clips, sourceName, format }) {
    this.root = new THREE.Group();
    this.root.name = 'CharacterRoot';
    this.root.add(object);
    this.sourceName = sourceName || 'Character';
    this.baseName = cleanName(this.sourceName.replace(/\.[^.]+$/, '')) || 'Character';
    this.format = format;
    this.clips = (clips || []).map((c, i) => {
      if (!c.name) c.name = 'Clip_' + (i + 1);
      return c;
    });
    this.clipNames = new Map(this.clips.map((c) => [c.uuid, cleanName(c.name) || 'Clip']));
    this.appliedFixes = [];
    this.rest = new Map(); // bone -> {p,q,s} captured before anything animates
    this.mergedDuplicates = mergeLoaderDuplicateBones(this.root);
    this.refresh();
  }

  refresh() {
    this.skinnedMeshes = [];
    const boneSet = new Set();
    this.root.traverse((o) => {
      if (o.isSkinnedMesh) {
        this.skinnedMeshes.push(o);
        o.skeleton.bones.forEach((b) => boneSet.add(b));
      }
    });
    // Bones in hierarchy order (skeleton bone arrays can be in any order).
    this.bones = [];
    this.root.traverse((o) => { if (o.isBone && (boneSet.has(o) || boneSet.size === 0)) this.bones.push(o); });
    if (this.bones.length === 0) this.root.traverse((o) => { if (o.isBone) this.bones.push(o); });
    this.skeletons = [...new Set(this.skinnedMeshes.map((m) => m.skeleton))];
    for (const b of this.bones) {
      if (!this.rest.has(b)) this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
    }
    this.detection = detectSkeleton(this.bones);
    this.measure();
  }

  // Restores each bone's original local transform. (three's Skeleton.pose() is wrong
  // for rigs whose top bone sits under a scaled node, e.g. Mixamo's 0.01 Armature.)
  restPose() {
    for (const [b, r] of this.rest) { b.position.copy(r.p); b.quaternion.copy(r.q); b.scale.copy(r.s); }
    this.root.updateMatrixWorld(true);
  }

  bone(key) { return this.detection.map[key] || null; }

  topBones() {
    return this.bones.filter((b) => !b.parent || !b.parent.isBone);
  }

  rootBone() {
    const hips = this.bone('hips');
    if (!hips) return null;
    let p = hips.parent;
    while (p && p.isBone) { if (!p.parent || !p.parent.isBone) return p; p = p.parent; }
    return null;
  }

  measure() {
    this.restPose();
    const box = new THREE.Box3();
    if (this.skinnedMeshes.length) {
      for (const m of this.skinnedMeshes) {
        const b = new THREE.Box3().setFromObject(m, true);
        box.union(b);
      }
    } else {
      box.setFromObject(this.root, true);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const wp = (k) => { const b = this.bone(k); return b ? b.getWorldPosition(new THREE.Vector3()) : null; };

    let facing = null, facingDeg = null, armDropDeg = null;
    const lu = wp('leftUpperArm'), ru = wp('rightUpperArm'), ll = wp('leftLowerArm');
    const lt = wp('leftUpperLeg'), rt = wp('rightUpperLeg');
    const lr = lu && ru ? lu.clone().sub(ru) : (lt && rt ? lt.clone().sub(rt) : null);
    if (lr) {
      lr.y = 0;
      if (lr.lengthSq() > 1e-10) {
        lr.normalize();
        facing = new THREE.Vector3().crossVectors(lr, new THREE.Vector3(0, 1, 0)).normalize();
        facingDeg = THREE.MathUtils.radToDeg(Math.atan2(facing.x, facing.z)); // 0 = +Z
      }
    }
    if (lu && ll) {
      const d = ll.clone().sub(lu).normalize();
      armDropDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(-d.y, -1, 1)));
    }
    const names = this.bones.map((b) => b.name);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    let maxInfluences = 0;
    for (const m of this.skinnedMeshes) {
      const w = m.geometry.attributes.skinWeight;
      if (!w) continue;
      const step = Math.max(1, Math.floor(w.count / 4000));
      for (let i = 0; i < w.count; i += step) {
        let n = 0;
        for (let c = 0; c < 4; c++) if (w.getComponent(i, c) > 0.001) n++;
        if (n > maxInfluences) maxInfluences = n;
      }
    }
    // Scale factor from hips' local space to world meters (for root motion distances).
    const hips = this.bone('hips');
    let hipsParentScale = 1;
    if (hips && hips.parent) hipsParentScale = hips.parent.getWorldScale(new THREE.Vector3()).y;

    let triangles = 0;
    this.root.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry;
        triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      }
    });

    this.metrics = {
      height: size.y, width: size.x, depth: size.z,
      minY: box.min.y, center: center.toArray(),
      facingDeg, armDropDeg, dupes, maxInfluences, hipsParentScale, triangles: Math.round(triangles),
    };
  }

  clipName(clip) { return this.clipNames.get(clip.uuid) || clip.name; }
  findClip(name) {
    const n = String(name).toLowerCase();
    return this.clips.find((c) => this.clipName(c).toLowerCase() === n || c.name.toLowerCase() === n) || null;
  }
}

// FBXLoader sometimes gives a second mesh its own copy of every bone, parented
// under the real bone with an identity transform. Rebind those meshes to the real
// bones and delete the copies so the engine receives one clean skeleton.
function mergeLoaderDuplicateBones(root) {
  const dupes = new Map();
  root.traverse((o) => {
    if (o.isBone && o.parent && o.parent.isBone && o.parent.name === o.name &&
        o.position.lengthSq() < 1e-10 && Math.abs(Math.abs(o.quaternion.w) - 1) < 1e-6 &&
        Math.abs(o.scale.x - 1) < 1e-6 && o.children.every((c) => c.isBone && dupesCandidate(c))) {
      dupes.set(o, o.parent);
    }
  });
  if (!dupes.size) return 0;
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const sk = o.skeleton;
    if (!sk.bones.some((b) => dupes.has(b))) return;
    const bones = sk.bones.map((b) => dupes.get(b) || b);
    o.bind(new THREE.Skeleton(bones, sk.boneInverses.map((m) => m.clone())), o.bindMatrix);
  });
  for (const d of dupes.keys()) d.parent && d.parent.remove(d);
  return dupes.size;
}
function dupesCandidate(c) { return c.parent && c.parent.isBone; }

export function cleanName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

export function loadFromArrayBuffer(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return new Promise((resolve, reject) => {
    try {
      if (ext === 'glb' || ext === 'gltf') {
        const data = ext === 'gltf' ? new TextDecoder().decode(buffer) : buffer;
        new GLTFLoader().parse(data, '', (g) => {
          resolve(new CharacterDoc({ object: g.scene, clips: g.animations, sourceName: filename, format: ext.toUpperCase() }));
        }, (e) => reject(new Error('Could not read this glTF/GLB file: ' + (e?.message || e))));
      } else if (ext === 'fbx') {
        const obj = new FBXLoader().parse(buffer, '');
        resolve(new CharacterDoc({ object: obj, clips: obj.animations, sourceName: filename, format: 'FBX' }));
      } else {
        reject(new Error(`".${ext}" files aren't supported yet. Use GLB, glTF (embedded) or FBX.`));
      }
    } catch (e) {
      reject(new Error('Could not read this file: ' + (e?.message || e)));
    }
  });
}
