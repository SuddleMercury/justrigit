"""A synthetic "capture" (a person walking forward and waving) built on the SOMA skeleton.

Used by the tests and by `--demo` mode, so the whole JustRigIt flow can be tried before the
GPU model is installed. It deliberately includes jitter, a tilted/rotated world, centimetre
units and sliding feet, so the clean-up steps have real work to do.
"""
from __future__ import annotations

import numpy as np

from .quat import axis_angle_to_mat
from .skeleton import SOMA_NAMES, SOMA_PARENTS, synthetic_rest_positions


def _rx(a):
    return axis_angle_to_mat(np.array([a, 0, 0]))


def _rz(a):
    return axis_angle_to_mat(np.array([0, 0, a]))


def _ry(a):
    return axis_angle_to_mat(np.array([0, a, 0]))


def make_walk(seconds: float = 3.0, fps: float = 30.0, speed: float = 1.2, noise_deg: float = 1.5,
              world_yaw_deg: float = 35.0, units_cm: bool = True, seed: int = 0, root_follows: bool = False):
    """Returns (names, parents, rest_world (J,4,4), world (T,J,4,4), fps)."""
    rng = np.random.default_rng(seed)
    names, parents = SOMA_NAMES, SOMA_PARENTS
    J = len(names)
    rp = synthetic_rest_positions()
    T = int(seconds * fps) + 1
    t = np.arange(T) / fps
    stride = 1.25                       # m per full cycle
    phase = 2 * np.pi * (speed / stride) * t
    ix = {n: i for i, n in enumerate(names)}
    local = np.tile(np.eye(3), (T, J, 1, 1))
    for s, sg in (("Left", 0.0), ("Right", np.pi)):
        ph = phase + sg
        local[:, ix[f"{s}Leg"]] = np.stack([_rx(0.36 * np.sin(p)) for p in ph])                        # thigh swing
        local[:, ix[f"{s}Shin"]] = np.stack([_rx(0.55 * max(0.0, np.sin(p - 1.4)) + 0.05) for p in ph])  # knee bend
        local[:, ix[f"{s}Foot"]] = np.stack([_rx(0.15 * np.sin(p)) for p in ph])
        arm = -1 if s == "Left" else 1
        local[:, ix[f"{s}Arm"]] = np.stack([_rz(arm * 1.25) @ _rx(0.35 * np.sin(p + np.pi)) for p in ph])  # arms down + swing
        local[:, ix[f"{s}ForeArm"]] = np.stack([_rx(-0.25 - 0.15 * np.sin(p)) for p in ph])
        for f in ("Index", "Middle", "Ring", "Pinky"):
            for k in "234":
                local[:, ix[f"{s}Hand{f}{k}"]] = _rx(0.35 if s == "Left" else 0.2)
    local[:, ix["Spine1"]] = np.stack([_ry(0.08 * np.sin(p)) for p in phase])
    local[:, ix["Chest"]] = np.stack([_ry(-0.12 * np.sin(p)) for p in phase])
    # noise like a real capture
    nz = np.radians(noise_deg)
    for j in range(2, J):
        local[:, j] = axis_angle_to_mat(rng.normal(0, nz, (T, 3))) @ local[:, j]
    # Hips path from the planted foot: FK with the hips at the origin, then move the body so
    # the lower foot stays where it is (like a real walk) and the lowest toe touches the floor.
    rel = np.zeros((T, J, 3))
    relr = np.zeros((T, J, 3, 3))
    for j in range(J):
        p = parents[j]
        if p < 0:
            relr[:, j] = np.eye(3)
        elif names[j] == "Hips":
            relr[:, j] = local[:, j]
        else:
            relr[:, j] = relr[:, p] @ local[:, j]
            rel[:, j] = rel[:, p] + np.einsum("tij,j->ti", relr[:, p], rp[j] - rp[p])
    feet = [ix["LeftToeBase"], ix["RightToeBase"]]
    hips_world = np.zeros((T, 3))
    for i in range(T):
        k = feet[int(np.argmin(rel[i, feet, 1]))]
        if i:
            hips_world[i, [0, 2]] = hips_world[i - 1, [0, 2]] - (rel[i, k, [0, 2]] - rel[i - 1, k, [0, 2]])
        hips_world[i, 1] = -rel[i, feet, 1].min() + 0.02
    hips_world += rng.normal(0, 0.004, hips_world.shape)

    # FK in a "camera world": yawed, and in centimetres if requested
    Wr = np.zeros((T, J, 3, 3))
    Wp = np.zeros((T, J, 3))
    G = _ry(np.radians(world_yaw_deg))
    for j in range(J):
        p = parents[j]
        if p < 0:
            Wr[:, j] = G
            Wp[:, j] = (hips_world * [1, 0, 1]) @ G.T if root_follows else 0
        elif names[j] == "Hips":
            Wr[:, j] = G @ local[:, j]
            Wp[:, j] = hips_world @ G.T
        else:
            Wr[:, j] = Wr[:, p] @ local[:, j]
            Wp[:, j] = Wp[:, p] + np.einsum("tij,j->ti", Wr[:, p], rp[j] - rp[p])
    s = 100.0 if units_cm else 1.0
    world = np.tile(np.eye(4), (T, J, 1, 1))
    world[..., :3, :3] = Wr
    world[..., :3, 3] = Wp * s
    rest = np.tile(np.eye(4), (J, 1, 1))
    rest[:, :3, 3] = rp * s
    return list(names), parents, rest, world, fps
