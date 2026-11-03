"""Motion clean-up: world joint transforms → a clean, game-ready local-rotation animation.

Everything here is plain numpy so it is fast to test without a GPU.

Conventions of the output (same as glTF / Godot / JustRigIt):
  meters, +Y up, character faces +Z at the start, character's left side is +X,
  floor at y = 0, the virtual "Root" joint stays at the origin, "Hips" carries the travel.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .quat import hemisphere_continuous, mat_to_quat, orthonormalize, quat_to_mat, rot_y, slerp


@dataclass
class MotionClip:
    names: list[str]
    parents: np.ndarray            # (J,) parent index, -1 for the top joint
    rest_offsets: np.ndarray       # (J,3) local translation in the parent's frame, meters
    rest_rot: np.ndarray           # (J,4) local rest rotation (x,y,z,w)
    rot: np.ndarray                # (T,J,4) local rotations
    hips_pos: np.ndarray           # (T,3) local translation of the hips joint
    fps: float
    hips: int = 1
    contacts: dict[str, np.ndarray] = field(default_factory=dict)  # name -> (T,) bool
    meta: dict = field(default_factory=dict)

    @property
    def frames(self) -> int:
        return self.rot.shape[0]

    @property
    def duration(self) -> float:
        return (self.frames - 1) / self.fps


# ---------------------------------------------------------------- forward kinematics
def fk(clip: MotionClip, rot: np.ndarray | None = None, hips_pos: np.ndarray | None = None):
    """World positions (T,J,3) and rotation matrices (T,J,3,3)."""
    rot = clip.rot if rot is None else rot
    hp = clip.hips_pos if hips_pos is None else hips_pos
    T, J = rot.shape[:2]
    R = quat_to_mat(rot)
    Wr = np.zeros((T, J, 3, 3))
    Wp = np.zeros((T, J, 3))
    for j in range(J):
        p = clip.parents[j]
        off = hp if j == clip.hips else np.broadcast_to(clip.rest_offsets[j], (T, 3))
        if p < 0:
            Wr[:, j] = R[:, j]
            Wp[:, j] = off
        else:
            Wr[:, j] = Wr[:, p] @ R[:, j]
            Wp[:, j] = Wp[:, p] + np.einsum("tij,tj->ti", Wr[:, p], off)
    return Wp, Wr


def rest_world(clip: MotionClip):
    one = MotionClip(clip.names, clip.parents, clip.rest_offsets, clip.rest_rot, clip.rest_rot[None],
                     clip.rest_offsets[clip.hips][None], clip.fps, clip.hips)
    p, r = fk(one)
    return p[0], r[0]


# ---------------------------------------------------------------- conversion
def _idx(names: list[str], *cands: str) -> int | None:
    low = [n.lower() for n in names]
    for c in cands:
        if c.lower() in low:
            return low.index(c.lower())
    return None


def from_world_transforms(names, parents, rest_world_m, world_m, fps: float, *,
                          face_forward: bool = True, recenter: bool = True) -> MotionClip:
    """Build a clean MotionClip from world-space joint transforms.

    rest_world_m: (J,4,4) the skeleton in its rest/T-pose.  world_m: (T,J,4,4) per frame.
    Units (cm/m), up axis and facing are detected and normalised.
    """
    names = list(names)
    parents = np.asarray(parents, dtype=np.int64)
    W = np.asarray(world_m, dtype=np.float64)
    R0 = np.asarray(rest_world_m, dtype=np.float64)
    T, J = W.shape[:2]
    hips = _idx(names, "Hips", "pelvis") or 1
    head = _idx(names, "Head", "HeadEnd")
    feet = [i for i in (_idx(names, "LeftFoot"), _idx(names, "RightFoot")) if i is not None]
    lefts = [i for i in (_idx(names, "LeftArm"), _idx(names, "LeftLeg")) if i is not None]
    rights = [i for i in (_idx(names, "RightArm"), _idx(names, "RightLeg")) if i is not None]

    pos = W[..., :3, 3].copy()
    rot = orthonormalize(W[..., :3, :3])
    rpos = R0[:, :3, 3].copy()
    rrot = orthonormalize(R0[:, :3, :3])

    # 1. units: a person's rest skeleton spans 1–2.2 m; centimetres would be 100–220.
    span = float(np.ptp(rpos[:, 1])) if np.ptp(rpos[:, 1]) > 0 else float(np.ptp(rpos))
    scale = 0.01 if span > 10 else 1.0
    pos *= scale
    rpos *= scale

    # 2. up axis: average head-minus-feet direction → +Y
    up = np.mean(pos[:, head] - pos[:, feet].mean(1), axis=0) if head is not None and feet else np.array([0, 1, 0.0])
    up /= np.linalg.norm(up) + 1e-12
    # GEM-X worlds are gravity-aligned, so snap to the nearest axis: the head-minus-feet
    # direction leans with the walk and would tilt the whole clip by a few degrees.
    k = int(np.argmax(np.abs(up)))
    up = np.eye(3)[k] * np.sign(up[k])
    A = _align(up, np.array([0.0, 1.0, 0.0]))
    # 3. facing: character's left→right axis, horizontal, at the start → face +Z
    if face_forward and lefts and rights:
        n0 = min(T, 10)
        lr = (pos[:n0, lefts].mean((0, 1)) - pos[:n0, rights].mean((0, 1))) @ A.T
        lr[1] = 0
        if np.linalg.norm(lr) > 1e-6:
            facing = np.cross(lr / np.linalg.norm(lr), [0, 1, 0])
            deg = np.degrees(np.arctan2(facing[0], facing[2]))
            A = rot_y(-deg) @ A
    pos = pos @ A.T
    rot = A[None, None] @ rot

    # local rotations (Root stays identity at the origin; everything hangs off it)
    top = [j for j in range(J) if parents[j] < 0]
    local = np.zeros((T, J, 3, 3))
    rest_local = np.zeros((J, 3, 3))
    offsets = np.zeros((J, 3))
    for j in range(J):
        p = parents[j]
        if p < 0:
            local[:, j] = np.eye(3)
            rest_local[j] = np.eye(3)
            continue
        if p in top:  # parent is the virtual root: world rotation = local rotation
            local[:, j] = rot[:, j]
            rest_local[j] = rrot[j]
            offsets[j] = rpos[j] - rpos[p]
        else:
            local[:, j] = np.swapaxes(rot[:, p], -1, -2) @ rot[:, j]
            rest_local[j] = rrot[p].T @ rrot[j]
            offsets[j] = rrot[p].T @ (rpos[j] - rpos[p])
    hp = parents[hips]
    if hp < 0 or hp in top:      # hips hang off the (pinned) virtual root: absolute world position
        hips_pos = pos[:, hips].copy()
    else:                         # unusual rig: express in the parent's frame
        hips_pos = np.einsum("tji,tj->ti", rot[:, hp], pos[:, hips] - pos[:, hp])

    clip = MotionClip(names, parents, offsets, mat_to_quat(rest_local), hemisphere_continuous(mat_to_quat(local)),
                      hips_pos, float(fps), hips, meta={"unitScale": scale})

    # 4. floor: rest pose standing on y=0, and the animation's lowest planted joints on y=0
    rp, _ = rest_world(clip)
    clip.rest_offsets[hips, 1] -= rp[[j for j in range(J) if parents[j] >= 0], 1].min()
    wp, _ = fk(clip)
    body = [j for j in range(J) if parents[j] >= 0]   # the virtual root sits at y=0 and must not count
    low = wp[:, body, 1].min(1)                  # lowest body joint per frame
    floor = float(np.percentile(low, 5))
    clip.hips_pos[:, 1] -= floor
    # 5. start at the origin
    hips_xz0 = np.zeros(3)
    if recenter:
        hips_xz0 = np.array([clip.hips_pos[0, 0], 0, clip.hips_pos[0, 2]])
        if hp >= 0 and hp not in top:
            hips_xz0 = pos[0, hips] * np.array([1, 0, 1])
        clip.hips_pos[:, [0, 2]] -= clip.hips_pos[0, [0, 2]]

    # Accuracy of the rebuild: FK from local data vs. the original (normalised) positions
    wp2, _ = fk(clip)
    ref = pos - floor * np.array([0, 1, 0]) - (hips_xz0 if recenter else 0)
    real = [j for j in range(J) if parents[j] >= 0]   # the virtual root doesn't move with recentering
    clip.meta["fkErrorCm"] = float(np.abs(wp2[:, real] - ref[:, real]).max() * 100)
    return clip


def _align(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rotation matrix taking unit vector a onto unit vector b."""
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c > 1 - 1e-9:
        return np.eye(3)
    if c < -1 + 1e-9:
        axis = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 0, 1.0])
        v = np.cross(a, axis)
        v /= np.linalg.norm(v)
        return 2 * np.outer(v, v) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


# ---------------------------------------------------------------- smoothing
SMOOTHING = {  # One Euro filter: (min_cutoff Hz, beta). Lower cutoff = smoother but laggier.
    "off": None,
    "light": (4.0, 0.6),
    "medium": (2.0, 0.4),
    "strong": (1.0, 0.25),
}


def one_euro(x: np.ndarray, fps: float, min_cutoff: float, beta: float, d_cutoff: float = 1.0) -> np.ndarray:
    """One Euro filter along axis 0, run forwards then backwards (zero lag)."""
    def run(sig):
        out = np.empty_like(sig)
        out[0] = sig[0]
        dx_prev = np.zeros_like(sig[0])
        te = 1.0 / fps

        def alpha(cut):
            r = 2 * np.pi * cut * te
            return r / (r + 1)

        for t in range(1, len(sig)):
            dx = (sig[t] - out[t - 1]) * fps
            a_d = alpha(d_cutoff)
            dx_hat = a_d * dx + (1 - a_d) * dx_prev
            cut = min_cutoff + beta * np.abs(dx_hat)
            a = alpha(cut)
            out[t] = a * sig[t] + (1 - a) * out[t - 1]
            dx_prev = dx_hat
        return out
    fwd = run(x)
    return run(fwd[::-1])[::-1]


def smooth(clip: MotionClip, strength: str = "light") -> MotionClip:
    params = SMOOTHING.get(strength)
    if not params or clip.frames < 4:
        return clip
    mc, beta = params
    q = hemisphere_continuous(clip.rot.copy())
    fingers = np.array([("Hand" in n and n not in ("LeftHand", "RightHand")) for n in clip.names])
    out = q.copy()
    out[:, ~fingers] = one_euro(q[:, ~fingers], clip.fps, mc, beta)
    if fingers.any():
        out[:, fingers] = one_euro(q[:, fingers], clip.fps, mc * 0.7, beta)
    out /= np.linalg.norm(out, axis=-1, keepdims=True)
    clip.rot = out
    clip.hips_pos = one_euro(clip.hips_pos, clip.fps, mc * 1.5, beta * 2)
    clip.meta["smoothing"] = strength
    return clip


# ---------------------------------------------------------------- contacts
def _sigmoid(x):
    return 1 / (1 + np.exp(-np.asarray(x, dtype=np.float64)))


def detect_contacts(clip: MotionClip, gem_logits: np.ndarray | None = None, gem_joint_names: list[str] | None = None):
    """Per-frame foot contacts. Uses GEM-X's learned contact logits when present, and
    always cross-checks with geometry (foot low + slow) so a bad logit can't pin a lifted foot."""
    wp, _ = fk(clip)
    out = {}
    for side in ("Left", "Right"):
        jf = _idx(clip.names, f"{side}Foot")
        jt = _idx(clip.names, f"{side}ToeBase")
        if jf is None:
            continue
        cand = [j for j in (jf, jt) if j is not None]
        h = wp[:, cand, 1].min(1)
        xz = wp[:, cand][:, :, [0, 2]].mean(1)
        v = np.zeros(clip.frames)
        v[1:-1] = np.linalg.norm(xz[2:] - xz[:-2], axis=1) * clip.fps / 2
        if clip.frames > 1:
            v[0], v[-1] = v[1], v[-2]
        geo_low = h < (np.percentile(h, 5) + 0.06)
        geo_slow = v < 0.35
        flags = geo_low & geo_slow
        if gem_logits is not None and gem_joint_names:
            ids = [i for i, n in enumerate(gem_joint_names) if n.startswith(side) and ("Foot" in n or "Toe" in n)]
            if ids:
                learned = _sigmoid(np.asarray(gem_logits)[:, ids]).max(1) > 0.5
                flags = learned & geo_low & (v < 0.6)   # trust the network, but never a high/fast foot
        out[f"{side.lower()}Foot"] = _clean_flags(flags)
    clip.contacts = out
    return out


def _clean_flags(f: np.ndarray, min_len: int = 3, max_gap: int = 2) -> np.ndarray:
    f = f.astype(bool).copy()
    n = len(f)
    i = 0
    while i < n:  # close short gaps
        if not f[i]:
            j = i
            while j < n and not f[j]:
                j += 1
            if 0 < i and j < n and j - i <= max_gap:
                f[i:j] = True
            i = j
        else:
            i += 1
    i = 0
    while i < n:  # drop short contacts
        if f[i]:
            j = i
            while j < n and f[j]:
                j += 1
            if j - i < min_len:
                f[i:j] = False
            i = j
        else:
            i += 1
    return f


# ---------------------------------------------------------------- editing
def trim(clip: MotionClip, start_s: float | None = None, end_s: float | None = None) -> MotionClip:
    a = 0 if start_s is None else max(0, int(round(start_s * clip.fps)))
    b = clip.frames if end_s is None else min(clip.frames, int(round(end_s * clip.fps)) + 1)
    if b - a < 2:
        raise ValueError("Trim leaves fewer than 2 frames.")
    clip.rot = clip.rot[a:b]
    clip.hips_pos = clip.hips_pos[a:b]
    clip.contacts = {k: v[a:b] for k, v in clip.contacts.items()}
    return clip


def resample(clip: MotionClip, fps: float) -> MotionClip:
    if abs(fps - clip.fps) < 1e-6:
        return clip
    n = int(round(clip.duration * fps)) + 1
    t = np.arange(n) / fps * clip.fps
    i0 = np.clip(np.floor(t).astype(int), 0, clip.frames - 1)
    i1 = np.clip(i0 + 1, 0, clip.frames - 1)
    w = (t - i0)[:, None]
    rot = np.stack([slerp(clip.rot[a], clip.rot[b], float(ww)) for a, b, ww in zip(i0, i1, w[:, 0])])
    clip.hips_pos = clip.hips_pos[i0] * (1 - w) + clip.hips_pos[i1] * w
    clip.contacts = {k: v[np.clip(np.round(t).astype(int), 0, clip.frames - 1)] for k, v in clip.contacts.items()}
    clip.rot = rot
    clip.fps = float(fps)
    return clip


def foot_skate_cm(clip: MotionClip) -> float:
    """Total horizontal sliding of feet while they are in contact (cm)."""
    wp, _ = fk(clip)
    total = 0.0
    for side in ("Left", "Right"):
        j = _idx(clip.names, f"{side}Foot")
        c = clip.contacts.get(f"{side.lower()}Foot")
        if j is None or c is None:
            continue
        both = c[1:] & c[:-1]
        total += float(np.linalg.norm(np.diff(wp[:, j][:, [0, 2]], axis=0)[both], axis=1).sum())
    return total * 100
