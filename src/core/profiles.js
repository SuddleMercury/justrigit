// Skeleton profiles: how different tools name the same humanoid bones.
// Every profile maps our canonical bone keys -> that tool's bone names.
// Names are compared after normalize() so "mixamorig:LeftArm", "mixamorigLeftArm"
// and "mixamorig_LeftArm" all match.

// Finger bones, named after Godot's SkeletonProfileHumanoid (the same idea Unity's
// Humanoid avatar uses): thumb = metacarpal/proximal/distal, other fingers =
// proximal/intermediate/distal. Optional: rigs without fingers simply skip them.
export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
export const PHALANGES = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] };
export function FINGER_KEYS(side) {
  const out = [];
  for (const f of FINGERS) for (const ph of (f === 'Thumb' ? PHALANGES.Thumb : PHALANGES.other)) out.push(`${side}${f}${ph}`);
  return out;
}
export const isFingerKey = (k) => /^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(k);

export const CANONICAL = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  ...FINGER_KEYS('left'), ...FINGER_KEYS('right'),
];

// Bones a humanoid must have for retargeting / checks to work.
export const REQUIRED = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

export const CANONICAL_LABELS = {
  hips: 'Hips / Pelvis', spine: 'Spine (lower)', chest: 'Chest (upper spine)', neck: 'Neck', head: 'Head',
  leftShoulder: 'Left clavicle', leftUpperArm: 'Left upper arm', leftLowerArm: 'Left forearm', leftHand: 'Left hand',
  rightShoulder: 'Right clavicle', rightUpperArm: 'Right upper arm', rightLowerArm: 'Right forearm', rightHand: 'Right hand',
  leftUpperLeg: 'Left thigh', leftLowerLeg: 'Left shin', leftFoot: 'Left foot', leftToes: 'Left toes',
  rightUpperLeg: 'Right thigh', rightLowerLeg: 'Right shin', rightFoot: 'Right foot', rightToes: 'Right toes',
};
for (const side of ['left', 'right']) {
  for (const k of FINGER_KEYS(side)) {
    const m = k.match(/^(left|right)(Thumb|Index|Middle|Ring|Little)(\w+)$/);
    CANONICAL_LABELS[k] = `${side === 'left' ? 'Left' : 'Right'} ${m[2].toLowerCase()} — ${m[3].toLowerCase()}`;
  }
}

export function normalize(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const sym = (l) => {
  // Build right-side names from left-side ones.
  const out = {};
  for (const [k, v] of Object.entries(l)) {
    out[k] = v;
    if (k.startsWith('left')) {
      const rk = 'right' + k.slice(4);
      out[rk] = Array.isArray(v) ? v.map(flip) : flip(v);
    }
  }
  return out;
};
const flip = (s) => s
  .replace(/Left/g, 'Right').replace(/_l$/g, '_r').replace(/_L_/g, '_R_').replace(/\.L$/g, '.R');

// fingerNames(fn) builds left-side finger entries; fn(finger, index0to2, canonicalPhalanx) -> name(s)
function fingerNames(fn) {
  const out = {};
  for (const f of FINGERS) {
    const phs = f === 'Thumb' ? PHALANGES.Thumb : PHALANGES.other;
    phs.forEach((ph, i) => { const v = fn(f, i, ph); if (v) out[`left${f}${ph}`] = v; });
  }
  return out;
}
const MIXAMO_FINGER = { Thumb: 'Thumb', Index: 'Index', Middle: 'Middle', Ring: 'Ring', Little: 'Pinky' };
const UE_FINGER = { Thumb: 'thumb', Index: 'index', Middle: 'middle', Ring: 'ring', Little: 'pinky' };
const CC_FINGER = { Thumb: 'Thumb', Index: 'Index', Middle: 'Mid', Ring: 'Ring', Little: 'Pinky' };
const RIGIFY_FINGER = { Thumb: 'thumb', Index: 'f_index', Middle: 'f_middle', Ring: 'f_ring', Little: 'f_pinky' };

export const PROFILES = {
  mixamo: {
    id: 'mixamo', label: 'Mixamo',
    stripPrefix: /^mixamorig\d*/,
    bones: sym({
      hips: 'Hips', spine: 'Spine', chest: ['Spine2', 'Spine1'], neck: 'Neck', head: 'Head',
      leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftArm', leftLowerArm: 'LeftForeArm', leftHand: 'LeftHand',
      leftUpperLeg: 'LeftUpLeg', leftLowerLeg: 'LeftLeg', leftFoot: 'LeftFoot', leftToes: 'LeftToeBase',
      ...fingerNames((f, i) => `LeftHand${MIXAMO_FINGER[f]}${i + 1}`),
    }),
    // Names used when exporting with Mixamo naming (Unity's Humanoid avatar and most tools auto-map these).
    exportPrefix: 'mixamorig:',
    spineChain: ['Spine', 'Spine1', 'Spine2'],
    neckChain: ['Neck'],
  },
  ue5: {
    id: 'ue5', label: 'Unreal Engine 5 Mannequin (Manny/Quinn)',
    marker: ['spine_04', 'spine_05'],
    bones: sym({
      hips: 'pelvis', spine: 'spine_01', chest: ['spine_05', 'spine_04'], neck: 'neck_01', head: 'head',
      leftShoulder: 'clavicle_l', leftUpperArm: 'upperarm_l', leftLowerArm: 'lowerarm_l', leftHand: 'hand_l',
      leftUpperLeg: 'thigh_l', leftLowerLeg: 'calf_l', leftFoot: 'foot_l', leftToes: 'ball_l',
      ...fingerNames((f, i) => `${UE_FINGER[f]}_0${i + 1}_l`),
    }),
    rootName: 'root',
    spineChain: ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'],
    neckChain: ['neck_01', 'neck_02'],
  },
  ue4: {
    id: 'ue4', label: 'Unreal Engine 4 Mannequin',
    bones: sym({
      hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'head',
      leftShoulder: 'clavicle_l', leftUpperArm: 'upperarm_l', leftLowerArm: 'lowerarm_l', leftHand: 'hand_l',
      leftUpperLeg: 'thigh_l', leftLowerLeg: 'calf_l', leftFoot: 'foot_l', leftToes: 'ball_l',
      ...fingerNames((f, i) => `${UE_FINGER[f]}_0${i + 1}_l`),
    }),
  },
  reallusion: {
    id: 'reallusion', label: 'Reallusion (Character Creator / ActorCore)',
    bones: sym({
      hips: 'CC_Base_Hip', spine: ['CC_Base_Waist', 'CC_Base_Spine01'], chest: 'CC_Base_Spine02', neck: 'CC_Base_NeckTwist01', head: 'CC_Base_Head',
      leftShoulder: 'CC_Base_L_Clavicle', leftUpperArm: 'CC_Base_L_Upperarm', leftLowerArm: 'CC_Base_L_Forearm', leftHand: 'CC_Base_L_Hand',
      leftUpperLeg: 'CC_Base_L_Thigh', leftLowerLeg: 'CC_Base_L_Calf', leftFoot: 'CC_Base_L_Foot', leftToes: 'CC_Base_L_ToeBase',
      ...fingerNames((f, i) => `CC_Base_L_${CC_FINGER[f]}${i + 1}`),
    }),
  },
  rigify: {
    id: 'rigify', label: 'Blender Rigify (deform bones)',
    bones: sym({
      hips: 'DEF-spine', spine: 'DEF-spine.001', chest: 'DEF-spine.003', neck: 'DEF-spine.004', head: 'DEF-spine.006',
      leftShoulder: 'DEF-shoulder.L', leftUpperArm: 'DEF-upper_arm.L', leftLowerArm: 'DEF-forearm.L', leftHand: 'DEF-hand.L',
      leftUpperLeg: 'DEF-thigh.L', leftLowerLeg: 'DEF-shin.L', leftFoot: 'DEF-foot.L', leftToes: 'DEF-toe.L',
      ...fingerNames((f, i) => `DEF-${RIGIFY_FINGER[f]}.0${i + 1}.L`),
    }),
  },
  // Godot 4's SkeletonProfileHumanoid. Unity's Humanoid avatar and VRM use the same names
  // (case differs, which the matcher ignores). Exporting with these names lets Godot's
  // importer map the skeleton automatically (BoneMap → SkeletonProfileHumanoid).
  godot: {
    id: 'godot', label: 'Godot humanoid (SkeletonProfileHumanoid) / Unity / VRM',
    marker: ['LeftUpperLeg', 'LeftLowerLeg'],
    bones: sym({
      hips: 'Hips', spine: 'Spine', chest: ['UpperChest', 'Chest'], neck: 'Neck', head: 'Head',
      leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftUpperArm', leftLowerArm: 'LeftLowerArm', leftHand: 'LeftHand',
      leftUpperLeg: 'LeftUpperLeg', leftLowerLeg: 'LeftLowerLeg', leftFoot: 'LeftFoot', leftToes: 'LeftToes',
      ...fingerNames((f, i, ph) => `Left${f}${ph}`),
    }),
    rootName: 'Root',
    spineChain: ['Spine', 'Chest', 'UpperChest'],
    neckChain: ['Neck'],
  },
  // NVIDIA SOMA — the skeleton JustRigIt Capture (GEM-X) records video motion on.
  // Note "LeftLeg" is the THIGH here (unlike Mixamo), so this profile needs "LeftShin" to win.
  soma: {
    id: 'soma', label: 'SOMA (JustRigIt Capture / NVIDIA GEM-X)',
    marker: ['LeftShin', 'RightShin'],
    bones: sym({
      hips: 'Hips', spine: 'Spine1', chest: ['Chest', 'Spine2'], neck: 'Neck1', head: 'Head',
      leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftArm', leftLowerArm: 'LeftForeArm', leftHand: 'LeftHand',
      leftUpperLeg: 'LeftLeg', leftLowerLeg: 'LeftShin', leftFoot: 'LeftFoot', leftToes: 'LeftToeBase',
      // SOMA's Index1/Middle1/... are metacarpals, so the proximal phalanx is "2".
      ...fingerNames((f, i) => f === 'Thumb' ? `LeftHandThumb${i + 1}` : `LeftHand${MIXAMO_FINGER[f]}${i + 2}`),
    }),
  },
};

function matchProfile(profile, bonesByNorm) {
  const map = {};
  let found = 0;
  for (const key of CANONICAL) {
    const want = profile.bones[key];
    if (!want) continue;
    const list = Array.isArray(want) ? want : [want];
    for (const w of list) {
      const n = normalize(w);
      const hit = bonesByNorm.get(n);
      if (hit) { map[key] = hit; break; }
    }
  }
  for (const k of REQUIRED) if (map[k]) found++;
  return { map, score: found / REQUIRED.length };
}

// Fuzzy matcher for rigs that don't follow a known naming convention.
const SIDE_L = /(^|[^a-z])(l|left)([^a-z]|$)|left/;
const SIDE_R = /(^|[^a-z])(r|right)([^a-z]|$)|right/;
function sideOf(raw) {
  const s = String(raw);
  if (/left/i.test(s) || /(^|[_\-. ])L([_\-. ]|$)/.test(s) || /_l$/i.test(s) || /\.l$/i.test(s) || /^l_/i.test(s)) return 'left';
  if (/right/i.test(s) || /(^|[_\-. ])R([_\-. ]|$)/.test(s) || /_r$/i.test(s) || /\.r$/i.test(s) || /^r_/i.test(s)) return 'right';
  return null;
}
const FUZZY = [
  ['UpperLeg', /(thigh|upleg|upperleg|hipjoint)/],
  ['LowerLeg', /(calf|shin|lowerleg|knee|leg$)/],
  ['Foot', /(foot|ankle)/],
  ['Toes', /(toe|ball)/],
  ['Shoulder', /(clavicle|shoulder|collar)/],
  ['LowerArm', /(forearm|lowerarm|elbow)/],
  ['UpperArm', /(upperarm|uparm|arm$)/],
  ['Hand', /(hand|wrist)/],
];
function fuzzyMap(bones) {
  const prefix = commonPrefix(bones);
  const norm = (b) => normalize(b.name).slice(prefix.length);
  const map = {};
  const used = new Set();
  const take = (key, b) => { if (!map[key] && !used.has(b)) { map[key] = b; used.add(b); } };
  for (const b of bones) {
    const n = norm(b).replace(/^mixamorig\d*/, '');
    if (!map.hips && /(hips?|pelvis)$/.test(n) && !sideOf(b.name)) take('hips', b);
    if (!map.head && /head$/.test(n)) take('head', b);
    if (!map.neck && /neck/.test(n)) take('neck', b);
  }
  for (const b of bones) {
    if (used.has(b)) continue;
    const n = norm(b);
    if (/(spine|waist|torso|chest)/.test(n) && !sideOf(b.name)) {
      if (!map.spine) take('spine', b); else take('chest', b);
    }
  }
  for (const [suffix, re] of FUZZY) {
    for (const b of bones) {
      if (used.has(b)) continue;
      const n = norm(b);
      if (/(twist|end|nub|tip|finger|thumb|index|middle|ring|pinky)/.test(n)) continue;
      if (!re.test(n)) continue;
      const side = sideOf(b.name);
      if (!side) continue;
      take(side + suffix, b);
    }
  }
  let found = 0;
  for (const k of REQUIRED) if (map[k]) found++;
  return { map, score: found / REQUIRED.length };
}

// Returns { profile, label, map: {canonicalKey: Bone}, score, missing: [] }
// Many FBX files put a namespace in front of every bone ("Character1:pelvis",
// "SK_Mannequin|thigh_l"). Find the prefix every bone shares so it can be ignored.
export function commonPrefix(bones) {
  const names = bones.map((b) => normalize(b.name)).filter(Boolean);
  if (names.length < 5) return '';
  let pre = names[0];
  for (const n of names) {
    let i = 0;
    while (i < pre.length && i < n.length && pre[i] === n[i]) i++;
    pre = pre.slice(0, i);
    if (!pre) return '';
  }
  // Never strip a whole bone name, and ignore one-letter coincidences.
  if (pre.length < 2 || names.some((n) => n.length <= pre.length)) return '';
  return pre;
}

export function detectSkeleton(bones) {
  const byNorm = new Map();
  const prefix = commonPrefix(bones);
  for (const b of bones) {
    const n = normalize(b.name);
    byNorm.set(n, b);
    const variants = [n.replace(PROFILES.mixamo.stripPrefix, '')];
    if (prefix) variants.push(n.slice(prefix.length), n.slice(prefix.length).replace(PROFILES.mixamo.stripPrefix, ''));
    for (const v of variants) if (v && !byNorm.has(v)) byNorm.set(v, b);
  }
  let best = { id: 'generic', label: 'Generic humanoid (auto-matched)', score: 0, map: {} };
  for (const p of Object.values(PROFILES)) {
    const r = matchProfile(p, byNorm);
    let score = r.score;
    if (p.marker && !p.marker.some((m) => byNorm.has(normalize(m)))) score -= (p.id === 'soma' || p.id === 'godot') ? 0.3 : 0.01; // UE5 vs UE4 tie-break
    if (p.id === 'ue4' && ['spine_04', 'spine_05'].some((m) => byNorm.has(normalize(m)))) score -= 0.02;
    if (score > best.score) best = { id: p.id, label: p.label, score, map: r.map };
  }
  if (best.score < 0.75) {
    const f = fuzzyMap(bones);
    if (f.score > best.score) best = { id: 'generic', label: 'Generic humanoid (auto-matched)', score: f.score, map: f.map };
  }
  const missing = REQUIRED.filter((k) => !best.map[k]);
  return { ...best, missing };
}
