"""Run: python -m pytest capture/tests   (or: python capture/tests/test_capture.py)

Covers everything that doesn't need the GPU model: maths, unit/axis/facing normalisation,
skeleton rebuild accuracy, smoothing, contacts, GLB/BVH writers.
"""
import json
import os
import struct
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from jrcapture.gltf import _zxy, write_bvh, write_glb  # noqa: E402
from jrcapture.motion import (detect_contacts, fk, foot_skate_cm, from_world_transforms, resample,  # noqa: E402
                              rest_world, smooth, trim)
from jrcapture.quat import axis_angle_to_mat, mat_to_quat, quat_to_mat  # noqa: E402
from jrcapture.skeleton import SOMA_NAMES, SOMA_PARENTS  # noqa: E402
from jrcapture.synthetic import make_walk  # noqa: E402


def _clip(**kw):
    n, p, rest, w, fps = make_walk(**kw)
    return from_world_transforms(n, p, rest, w, fps), (n, p, rest, w, fps)


def test_quat_roundtrip():
    r = axis_angle_to_mat(np.random.default_rng(1).normal(size=(200, 3)))
    assert np.abs(quat_to_mat(mat_to_quat(r)) - r).max() < 1e-9


def test_skeleton_table():
    assert len(SOMA_NAMES) == 78 and SOMA_PARENTS[0] == -1
    assert all(SOMA_PARENTS[j] < j for j in range(1, 78))


def test_rebuild_is_exact_and_normalised():
    for kw in ({}, {"units_cm": False}, {"world_yaw_deg": -120}, {"root_follows": True}):
        c, (n, *_rest) = _clip(**kw)
        assert c.meta["fkErrorCm"] < 1e-6, kw
        wp, _ = fk(c)
        assert wp[0, n.index("LeftArm"), 0] > 0 > wp[0, n.index("RightArm"), 0], "character's left must be +X"
        travel = c.hips_pos[-1] - c.hips_pos[0]
        assert travel[2] > 3.0 and abs(travel[0]) < 0.5, f"walks forward along +Z: {travel}"
        assert abs(np.percentile(wp[:, 1:, 1].min(1), 5)) < 1e-6, "floor at y=0"
        assert abs(rest_world(c)[0][1:, 1].min()) < 1e-9, "rest pose stands on the floor"
        assert abs(c.hips_pos[:, 1].max() - c.hips_pos[:, 1].min()) < 0.15, "no tilt: hips height stays level"


def test_smoothing_reduces_jitter():
    c, _ = _clip(noise_deg=3)
    jit = lambda q: np.abs(np.diff(q, 2, axis=0)).mean()  # noqa: E731
    before = jit(c.rot)
    smooth(c, "medium")
    assert jit(c.rot) < before * 0.3
    assert np.allclose(np.linalg.norm(c.rot, axis=-1), 1)


def test_contacts_and_skate():
    c, _ = _clip(seconds=4)
    detect_contacts(c)
    assert c.contacts["leftFoot"].sum() > 3 and c.contacts["rightFoot"].sum() > 3
    assert foot_skate_cm(c) >= 0
    logits = np.full((c.frames, 6), -5.0)
    detect_contacts(c, logits, ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase", "LeftHand", "RightHand"])
    assert c.contacts["leftFoot"].sum() == 0, "learned 'no contact' wins"


def test_trim_resample():
    c, _ = _clip(seconds=3)
    detect_contacts(c)
    trim(c, 0.5, 2.5)
    assert c.frames == 61
    resample(c, 60)
    assert c.frames == 121 and len(c.contacts["leftFoot"]) == 121


def test_zxy_decomposition():
    from jrcapture.synthetic import _rx, _ry, _rz
    z, x, y = 0.4, -0.3, 1.1
    m = _rz(z) @ _rx(x) @ _ry(y)
    assert np.allclose(np.radians(_zxy(m)), [z, x, y], atol=1e-9)


def test_glb_and_bvh_files():
    c, _ = _clip(seconds=2)
    detect_contacts(c)
    with tempfile.TemporaryDirectory() as d:
        g = os.path.join(d, "a.glb")
        write_glb(c, g, extras={"video": "x.mp4"})
        b = open(g, "rb").read()
        magic, ver, total = struct.unpack("<III", b[:12])
        assert magic == 0x46546C67 and ver == 2 and total == len(b)
        n = struct.unpack("<I", b[12:16])[0]
        js = json.loads(b[20:20 + n])
        names = [x["name"] for x in js["nodes"]]
        assert "Hips" in names and "LeftShin" in names and "RightHandPinky4" in names
        ex = js["animations"][0]["extras"]["jrcapture"]
        assert ex["video"] == "x.mp4" and len(ex["contacts"]["leftFoot"]) == c.frames
        assert len(js["skins"][0]["joints"]) == 78
        bv = os.path.join(d, "a.bvh")
        write_bvh(c, bv)
        txt = open(bv).read()
        assert txt.startswith("HIERARCHY") and f"Frames: {c.frames}" in txt


if __name__ == "__main__":
    fails = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            try:
                f()
                print("PASS", k)
            except Exception as e:  # noqa: BLE001
                fails += 1
                print("FAIL", k, e)
    print("ALL PASSED" if not fails else f"{fails} FAILED")
    sys.exit(1 if fails else 0)
