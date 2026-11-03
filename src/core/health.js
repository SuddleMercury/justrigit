import * as THREE from 'three';
import { TARGETS } from './targets.js';
import { CANONICAL_LABELS } from './profiles.js';
import { analyzeTravel } from './clips.js';

// Each issue: { id, severity: ok|info|warn|error, title, detail, term?, fix?: {id,label} }
export function runHealthCheck(doc, targetId) {
  const t = TARGETS[targetId] || TARGETS.ue5;
  const m = doc.metrics;
  const det = doc.detection;
  const out = [];
  const add = (o) => out.push(o);

  // 1. Skeleton present
  if (!doc.skinnedMeshes.length) {
    add({
      id: 'no_skeleton', severity: 'error', term: 'skeleton',
      title: 'No skeleton found',
      detail: 'This model has no bones, so it can\'t be animated yet. Go to step 1 and use Auto-rig: check the 8 markers, then press "Rig it".',
    });
    return out;
  }
  add({
    id: 'skeleton', severity: 'ok', term: 'skeleton',
    title: `Skeleton found: ${det.label}`,
    detail: `${doc.bones.length} bones, ${doc.skinnedMeshes.length} skinned mesh${doc.skinnedMeshes.length > 1 ? 'es' : ''}, ${m.triangles.toLocaleString()} triangles.`,
  });

  // 2. Humanoid mapping
  if (det.missing.length === 0) {
    add({ id: 'humanoid', severity: 'ok', term: 'bone', title: 'All key humanoid bones identified', detail: 'Hips, spine, head, arms and legs were all matched. Retargeting will work.' });
  } else if (det.missing.length <= 3) {
    add({ id: 'humanoid', severity: 'warn', term: 'bone', title: `${det.missing.length} key bone${det.missing.length > 1 ? 's' : ''} not identified`, detail: 'Could not match: ' + det.missing.map((k) => CANONICAL_LABELS[k]).join(', ') + '. You can still export, but retargeting may be off for those parts.' });
  } else {
    add({ id: 'humanoid', severity: 'warn', term: 'bone', title: 'Doesn\'t look like a standard humanoid', detail: `Only ${15 - det.missing.length} of 15 key bones matched. Fine for creatures/props; retargeting human animations won't work well.` });
  }

  // 3. Duplicate bone names
  if (m.dupes.length) {
    add({ id: 'dupes', severity: 'error', term: 'bone', title: 'Duplicate bone names', detail: `Bones sharing a name confuse every engine: ${m.dupes.slice(0, 5).join(', ')}.`, fix: { id: 'rename_duplicate_bones', label: 'Make names unique' } });
  }

  // 4. Scale
  const h = m.height;
  if (h > 20) {
    add({ id: 'scale', severity: 'error', term: 'units', title: `Character is ${h.toFixed(0)} m tall — almost certainly centimeters`, detail: 'The file was probably authored in centimeters. Shrinking it by 100× gives a normal height.', fix: { id: 'fix_scale_down', label: 'Shrink 100×' } });
  } else if (h < 0.05 && h > 0) {
    add({ id: 'scale', severity: 'error', term: 'units', title: `Character is only ${(h * 100).toFixed(1)} cm tall`, detail: 'Looks like a units mix-up. Growing it by 100× gives a normal height.', fix: { id: 'fix_scale_up', label: 'Grow 100×' } });
  } else if (h > 4 || h < 0.3) {
    add({ id: 'scale', severity: 'warn', term: 'units', title: `Height is ${h.toFixed(2)} m`, detail: 'That\'s unusual for a human. Fine if it\'s intentional (a giant, a gnome).' });
  } else {
    add({ id: 'scale', severity: 'ok', term: 'units', title: `Height ${h.toFixed(2)} m${t.id.startsWith('ue') ? ` (${Math.round(h * 100)} cm in Unreal)` : ''}`, detail: t.unitsNote });
  }

  // 5. Floor & center
  const off = Math.abs(m.minY);
  const cx = m.center[0], cz = m.center[2];
  const horiz = Math.hypot(cx, cz);
  if (off > Math.max(0.02, h * 0.03) || horiz > Math.max(0.05, h * 0.1)) {
    add({ id: 'placement', severity: 'warn', term: 'units', title: off > Math.max(0.02, h * 0.03) ? `Feet are ${off.toFixed(2)} m ${m.minY > 0 ? 'above' : 'below'} the floor` : 'Character is off-center', detail: 'Engines place characters by their origin (the point at 0,0,0). It should sit between the feet, on the floor.', fix: { id: 'place_on_floor', label: 'Center on floor' } });
  } else {
    add({ id: 'placement', severity: 'ok', title: 'Standing on the floor at the origin', detail: 'Origin is between the feet — exactly what engines expect.' });
  }

  // 6. Facing direction
  if (m.facingDeg !== null) {
    const a = ((m.facingDeg % 360) + 540) % 360 - 180;
    if (Math.abs(a) > 20) {
      add({ id: 'facing', severity: 'warn', term: 'forward_axis', title: `Facing ${Math.round(a)}° away from forward`, detail: 'The glTF standard is facing +Z (towards the camera here). Otherwise the character may walk sideways or backwards in the engine.', fix: { id: 'face_forward', label: 'Turn to face forward' } });
    } else {
      add({ id: 'facing', severity: 'ok', term: 'forward_axis', title: 'Facing forward (+Z)', detail: 'Standard glTF orientation. Engines convert it to their own forward axis on import.' });
    }
  }

  // 7. Root bone
  const root = doc.rootBone();
  const hips = doc.bone('hips');
  if (hips) {
    if (!root) {
      if (t.needsRootBone) {
        add({ id: 'root_bone', severity: 'warn', term: 'root_bone', title: 'No root bone — Unreal will have trouble', detail: `The top bone is "${hips.name}" (the hips). Unreal expects a "root" bone on the floor above the hips; without it root motion won't work and the IK Retargeter needs extra setup.`, fix: { id: 'add_root_bone', label: 'Add root bone' } });
      } else {
        add({ id: 'root_bone', severity: 'info', term: 'root_bone', title: 'No separate root bone', detail: `Fine for ${t.label}. Add one if you want root motion stored on its own bone.`, fix: { id: 'add_root_bone', label: 'Add root bone anyway' } });
      }
    } else {
      add({ id: 'root_bone', severity: 'ok', term: 'root_bone', title: `Root bone: "${root.name}"`, detail: 'Root motion has a proper bone to live on.' });
    }
  }

  // 8. Rest pose
  if (m.armDropDeg !== null) {
    const d = m.armDropDeg;
    const pose = d < 15 ? 'T-pose' : d < 60 ? 'A-pose' : 'arms-down pose';
    add({ id: 'pose', severity: 'info', term: 't_pose', title: `Rest pose: ${pose} (arms ${Math.round(d)}° below horizontal)`, detail: t.id.startsWith('ue') ? 'Unreal\'s Manny/Quinn use an A-pose. If you later retarget Unreal animations onto this character, the IK Retargeter lines the poses up for you.' : 'Recorded for retargeting. No action needed.' });
  }

  // 9. Skin influences
  if (m.maxInfluences > 0) {
    add({ id: 'weights', severity: 'ok', term: 'skinning', title: `Skin weights: up to ${m.maxInfluences} bones per vertex`, detail: 'Within the glTF limit of 4.' });
  }

  // 10. Animations
  if (!doc.clips.length) {
    add({ id: 'clips', severity: 'info', term: 'clip', title: 'No animations in this file', detail: 'You can still export the character. The built-in animation library with retargeting is the next milestone.' });
  } else {
    const moving = doc.clips.filter((c) => analyzeTravel(doc, c).moves).map((c) => doc.clipName(c));
    add({ id: 'clips', severity: 'ok', term: 'clip', title: `${doc.clips.length} animation${doc.clips.length > 1 ? 's' : ''} found`, detail: moving.length ? `These move the character forward (root motion): ${moving.join(', ')}. Choose "In place" or "Root motion" on the Animations step.` : 'None of them travel — no root-motion decisions needed.' });
  }
  return out;
}

export function summarize(issues) {
  const c = { ok: 0, info: 0, warn: 0, error: 0 };
  issues.forEach((i) => c[i.severity]++);
  return c;
}

export { THREE };
