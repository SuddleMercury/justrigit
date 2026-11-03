import * as THREE from 'three';

// Each fix mutates the CharacterDoc and returns a human-readable message.
export const FIXES = {
  fix_scale_down: {
    label: 'Shrink 100× (centimeters → meters)',
    run(doc) { doc.root.scale.multiplyScalar(0.01); return 'Scaled the character down 100×.'; },
  },
  fix_scale_up: {
    label: 'Grow 100×',
    run(doc) { doc.root.scale.multiplyScalar(100); return 'Scaled the character up 100×.'; },
  },
  place_on_floor: {
    label: 'Center on floor',
    run(doc) {
      const m = doc.metrics;
      doc.root.position.x -= m.center[0];
      doc.root.position.z -= m.center[2];
      doc.root.position.y -= m.minY;
      return 'Moved the character so its feet are on the floor at the origin.';
    },
  },
  face_forward: {
    label: 'Turn to face forward (+Z)',
    run(doc) {
      const deg = doc.metrics.facingDeg || 0;
      doc.root.rotation.y -= THREE.MathUtils.degToRad(deg);
      // Rotating moves the center; re-center afterwards.
      doc.root.updateMatrixWorld(true);
      doc.measure();
      FIXES.place_on_floor.run(doc);
      return `Rotated the character ${Math.round(-deg)}° so it faces +Z.`;
    },
  },
  add_root_bone: {
    label: 'Add root bone',
    run(doc) {
      const hips = doc.bone('hips');
      if (!hips) throw new Error('No hips bone found to put a root bone above.');
      if (doc.rootBone()) return 'A root bone already exists.';
      doc.restPose();
      const parent = hips.parent;
      const root = new THREE.Bone();
      root.name = 'root';
      parent.add(root);
      root.updateMatrixWorld(true);
      // root sits at the parent's origin (the floor for normal rigs).
      parent.remove(hips);
      root.add(hips);
      // root is identity in parent space, so hips' local transform (and all
      // animation tracks on it) stay valid.
      doc.root.updateMatrixWorld(true);
      for (const mesh of doc.skinnedMeshes) {
        const sk = mesh.skeleton;
        if (!sk.bones.includes(hips)) continue;
        // root sits at the hips' parent frame (identity), so in bind space:
        // rootBindWorld = hipsBindWorld * inverse(hipsLocal)
        // => rootInverse = hipsLocal * hipsInverse  (same frame as the existing inverses)
        const hi = sk.bones.indexOf(hips);
        hips.updateMatrix();
        const bindInv = new THREE.Matrix4().multiplyMatrices(hips.matrix, sk.boneInverses[hi]);
        const bones = [...sk.bones, root];
        const inverses = [...sk.boneInverses, bindInv];
        mesh.bind(new THREE.Skeleton(bones, inverses), mesh.bindMatrix);
      }
      doc.refresh();
      return 'Added a "root" bone on the floor above the hips. Unreal can now use it for root motion.';
    },
  },
  rename_duplicate_bones: {
    label: 'Make bone names unique',
    run(doc) {
      const seen = new Map();
      let n = 0;
      for (const b of doc.bones) {
        const c = seen.get(b.name) || 0;
        if (c > 0) { const old = b.name; b.name = `${old}_${c}`; n++; }
        seen.set(b.name, c + 1);
      }
      doc.refresh();
      return `Renamed ${n} duplicate bone${n === 1 ? '' : 's'}.`;
    },
  },
};
