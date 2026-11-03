"""Write a MotionClip as a GLB (binary glTF 2.0) or BVH file.

The GLB holds the skeleton, a simple skinned "stick figure" mesh (so every app sees real
bones and something to look at) and one animation. Foot contacts and capture info travel in
the animation's `extras.jrcapture`, which JustRigIt reads to lock the feet.
"""
from __future__ import annotations

import json
import struct

import numpy as np

from .motion import MotionClip, rest_world
from .quat import quat_to_mat

ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
FLOAT, UBYTE, USHORT, UINT = 5126, 5121, 5123, 5125


class _Buf:
    def __init__(self):
        self.data = bytearray()
        self.views, self.accessors = [], []

    def add(self, arr: np.ndarray, ctype: int, atype: str, target: int | None = None, minmax: bool = False) -> int:
        while len(self.data) % 4:
            self.data.append(0)
        b = arr.tobytes()
        view = {"buffer": 0, "byteOffset": len(self.data), "byteLength": len(b)}
        if target:
            view["target"] = target
        self.views.append(view)
        self.data.extend(b)
        acc = {"bufferView": len(self.views) - 1, "componentType": ctype, "count": int(arr.shape[0]), "type": atype}
        if minmax:
            flat = arr.reshape(arr.shape[0], -1)
            acc["min"] = [float(v) for v in flat.min(0)]
            acc["max"] = [float(v) for v in flat.max(0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def _stick_mesh(clip: MotionClip, rp: np.ndarray):
    """One 4-sided bar per bone (parent→child), rigidly bound to the parent bone."""
    pos, joints, idx = [], [], []
    for j, p in enumerate(clip.parents):
        if p < 0 or clip.parents[p] < 0:
            continue  # nothing hangs off the virtual root
        a, b = rp[p], rp[j]
        d = b - a
        L = np.linalg.norm(d)
        if L < 1e-4:
            continue
        name = clip.names[j]
        w = 0.006 if ("Hand" in name and name not in ("LeftHand", "RightHand")) else (0.035 if L > 0.15 else 0.02)
        u = d / L
        ref = np.array([0, 1.0, 0]) if abs(u[1]) < 0.9 else np.array([1.0, 0, 0])
        s1 = np.cross(u, ref)
        s1 /= np.linalg.norm(s1)
        s2 = np.cross(u, s1)
        base = len(pos)
        mid = a + d * 0.15
        ring = [mid + w * s1, mid + w * s2, mid - w * s1, mid - w * s2]
        pos += [a, *ring, b]
        joints += [p] * 6
        for k in range(4):
            r0, r1 = base + 1 + k, base + 1 + (k + 1) % 4
            idx += [base, r1, r0, r0, r1, base + 5]
    return np.array(pos, np.float32), np.array(joints), np.array(idx, np.uint32)


def write_glb(clip: MotionClip, path: str, name: str = "Capture", extras: dict | None = None) -> None:
    J, T = len(clip.names), clip.frames
    rp, rr = rest_world(clip)
    buf = _Buf()

    # nodes: 0 = scene wrapper, 1 = mesh, 2.. = joints
    nodes: list[dict] = [{"name": f"{name}", "children": []}, {"name": f"{name}_Mesh", "mesh": 0, "skin": 0}]
    jn = lambda j: 2 + j  # noqa: E731
    for j in range(J):
        node = {"name": clip.names[j]}
        t = clip.rest_offsets[j]
        q = clip.rest_rot[j]
        if np.abs(t).max() > 1e-9:
            node["translation"] = [float(v) for v in t]
        if abs(q[3]) < 1 - 1e-9:
            node["rotation"] = [float(v) for v in q]
        kids = [jn(c) for c in range(J) if clip.parents[c] == j]
        if kids:
            node["children"] = kids
        nodes.append(node)
    tops = [jn(j) for j in range(J) if clip.parents[j] < 0]
    nodes[0]["children"] = [1, *tops]

    # skin
    ibm = np.zeros((J, 4, 4), np.float32)
    for j in range(J):
        m = np.eye(4)
        m[:3, :3] = rr[j]
        m[:3, 3] = rp[j]
        ibm[j] = np.linalg.inv(m).T  # column-major for glTF
    ibm_acc = buf.add(ibm.reshape(J, 16), FLOAT, "MAT4")

    # mesh
    P, Jt, I = _stick_mesh(clip, rp)
    jt = np.zeros((len(P), 4), np.uint8 if J < 256 else np.uint16)
    jt[:, 0] = Jt
    wt = np.zeros((len(P), 4), np.float32)
    wt[:, 0] = 1
    a_pos = buf.add(P, FLOAT, "VEC3", ARRAY_BUFFER, minmax=True)
    a_j = buf.add(jt, UBYTE if J < 256 else USHORT, "VEC4", ARRAY_BUFFER)
    a_w = buf.add(wt, FLOAT, "VEC4", ARRAY_BUFFER)
    a_i = buf.add(I, UINT, "SCALAR", ELEMENT_ARRAY_BUFFER)

    # animation
    times = (np.arange(T) / clip.fps).astype(np.float32)
    a_t = buf.add(times, FLOAT, "SCALAR", minmax=True)
    samplers, channels = [], []
    for j in range(J):
        if clip.parents[j] < 0:
            continue
        q = clip.rot[:, j].astype(np.float32)
        if np.abs(q - q[0]).max() < 1e-7 and np.abs(q[0] - clip.rest_rot[j]).max() < 1e-7:
            continue
        samplers.append({"input": a_t, "output": buf.add(np.ascontiguousarray(q), FLOAT, "VEC4"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": jn(j), "path": "rotation"}})
    samplers.append({"input": a_t, "output": buf.add(clip.hips_pos.astype(np.float32), FLOAT, "VEC3"), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": jn(clip.hips), "path": "translation"}})

    anim_extras = {"jrcapture": {
        "fps": clip.fps,
        "contacts": {k: [int(x) for x in v] for k, v in clip.contacts.items()},
        **(extras or {}),
    }}
    gltf = {
        "asset": {"version": "2.0", "generator": "JustRigIt Capture"},
        "scene": 0,
        "scenes": [{"name": name, "nodes": [0]}],
        "nodes": nodes,
        "meshes": [{"name": f"{name}_Stick", "primitives": [{"attributes": {"POSITION": a_pos, "JOINTS_0": a_j, "WEIGHTS_0": a_w}, "indices": a_i, "material": 0}]}],
        "materials": [{"name": "Capture", "pbrMetallicRoughness": {"baseColorFactor": [0.36, 0.62, 0.95, 1], "metallicFactor": 0, "roughnessFactor": 0.7}}],
        "skins": [{"name": f"{name}_Skin", "joints": [jn(j) for j in range(J)], "inverseBindMatrices": ibm_acc, "skeleton": tops[0]}],
        "animations": [{"name": name, "samplers": samplers, "channels": channels, "extras": anim_extras}],
        "accessors": buf.accessors,
        "bufferViews": buf.views,
        "buffers": [{"byteLength": len(buf.data)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    bin_ = bytes(buf.data) + b"\0" * ((4 - len(buf.data) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942) + bin_)


def write_bvh(clip: MotionClip, path: str) -> None:
    """Classic BVH (centimeters, Y up, ZXY Euler) for tools that prefer it."""
    J = len(clip.names)
    kids = {j: [c for c in range(J) if clip.parents[c] == j] for j in range(J)}
    order: list[int] = []
    lines: list[str] = ["HIERARCHY"]

    def emit(j, depth):
        ind = "  " * depth
        off = clip.rest_offsets[j] * 100
        top = clip.parents[j] < 0
        lines.append(f"{ind}{'ROOT' if top else 'JOINT'} {clip.names[j]}")
        lines.append(f"{ind}{{")
        lines.append(f"{ind}  OFFSET {off[0]:.4f} {off[1]:.4f} {off[2]:.4f}")
        chans = "6 Xposition Yposition Zposition Zrotation Xrotation Yrotation" if (top or j == clip.hips) else "3 Zrotation Xrotation Yrotation"
        lines.append(f"{ind}  CHANNELS {chans}")
        order.append(j)
        if kids[j]:
            for c in kids[j]:
                emit(c, depth + 1)
        else:
            lines.append(f"{ind}  End Site")
            lines.append(f"{ind}  {{")
            lines.append(f"{ind}    OFFSET 0.0000 0.0000 0.0000")
            lines.append(f"{ind}  }}")
        lines.append(f"{ind}}}")

    for j in range(J):
        if clip.parents[j] < 0:
            emit(j, 0)
    lines += ["MOTION", f"Frames: {clip.frames}", f"Frame Time: {1.0 / clip.fps:.6f}"]
    R = quat_to_mat(clip.rot)
    for t in range(clip.frames):
        row = []
        for j in order:
            if clip.parents[j] < 0 or j == clip.hips:
                p = (clip.hips_pos[t] if j == clip.hips else clip.rest_offsets[j]) * 100
                row += [f"{v:.4f}" for v in p]
            z, x, y = _zxy(R[t, j])
            row += [f"{z:.4f}", f"{x:.4f}", f"{y:.4f}"]
        lines.append(" ".join(row))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def _zxy(m: np.ndarray):
    """Decompose R = Rz·Rx·Ry into degrees (z, x, y)."""
    x = np.arcsin(np.clip(m[2, 1], -1, 1))
    if abs(m[2, 1]) < 0.9999:
        z = np.arctan2(-m[0, 1], m[1, 1])
        y = np.arctan2(-m[2, 0], m[2, 2])
    else:
        z = np.arctan2(m[1, 0], m[0, 0])
        y = 0.0
    return np.degrees(z), np.degrees(x), np.degrees(y)
