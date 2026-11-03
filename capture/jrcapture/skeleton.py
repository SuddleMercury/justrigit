"""The SOMA skeleton that NVIDIA GEM-X records motion on (78 public joints incl. a virtual Root).

At runtime the real names/parents come from the SOMA library; this table is the fallback and
is what the tests and the no-GPU demo mode use.
"""
from __future__ import annotations

import numpy as np

_FINGERS = ["Index", "Middle", "Ring", "Pinky"]


def _side(s: str) -> list[tuple[str, str]]:
    out = [(f"{s}Shoulder", "Chest"), (f"{s}Arm", f"{s}Shoulder"), (f"{s}ForeArm", f"{s}Arm"), (f"{s}Hand", f"{s}ForeArm")]
    prev = f"{s}Hand"
    for n in ["Thumb1", "Thumb2", "Thumb3", "ThumbEnd"]:
        out.append((f"{s}Hand{n}", prev))
        prev = f"{s}Hand{n}"
    for f in _FINGERS:
        prev = f"{s}Hand"
        for n in ["1", "2", "3", "4", "End"]:
            out.append((f"{s}Hand{f}{n}", prev))
            prev = f"{s}Hand{f}{n}"
    return out


def _legs(s: str) -> list[tuple[str, str]]:
    return [(f"{s}Leg", "Hips"), (f"{s}Shin", f"{s}Leg"), (f"{s}Foot", f"{s}Shin"),
            (f"{s}ToeBase", f"{s}Foot"), (f"{s}ToeEnd", f"{s}ToeBase")]


_PAIRS: list[tuple[str, str | None]] = (
    [("Root", None), ("Hips", "Root"), ("Spine1", "Hips"), ("Spine2", "Spine1"), ("Chest", "Spine2"),
     ("Neck1", "Chest"), ("Neck2", "Neck1"), ("Head", "Neck2"), ("HeadEnd", "Head"), ("Jaw", "Head"),
     ("LeftEye", "Head"), ("RightEye", "Head")]
    + _side("Left") + _side("Right") + _legs("Left") + _legs("Right")
)

SOMA_NAMES: list[str] = [n for n, _ in _PAIRS]
SOMA_PARENTS: np.ndarray = np.array([-1 if p is None else SOMA_NAMES.index(p) for _, p in _PAIRS], dtype=np.int64)

# GEM-X static-contact logits, in this order (gem/motion/postprocess/contact.py,
# SOMA_CONTACT_JOINT_IDS = (69, 70, 74, 75, 14, 42) on the 77 non-Root joints).
GEM_CONTACT_JOINTS = ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase", "LeftHand", "RightHand"]

assert len(SOMA_NAMES) == 78
assert SOMA_NAMES[1:].index("LeftFoot") == 69 and SOMA_NAMES[1:].index("RightHand") == 42


def synthetic_rest_positions() -> np.ndarray:
    """A plausible adult T-pose in meters: Y up, facing +Z, character's left = +X."""
    P: dict[str, tuple[float, float, float]] = {
        "Root": (0, 0, 0), "Hips": (0, 0.95, 0), "Spine1": (0, 1.05, -0.01), "Spine2": (0, 1.18, -0.01),
        "Chest": (0, 1.32, 0), "Neck1": (0, 1.48, 0), "Neck2": (0, 1.54, 0.01), "Head": (0, 1.60, 0.02),
        "HeadEnd": (0, 1.78, 0.02), "Jaw": (0, 1.58, 0.08), "LeftEye": (0.03, 1.68, 0.09), "RightEye": (-0.03, 1.68, 0.09),
    }
    for sgn, s in ((1, "Left"), (-1, "Right")):
        P[f"{s}Shoulder"] = (sgn * 0.03, 1.43, 0)
        P[f"{s}Arm"] = (sgn * 0.17, 1.43, 0)
        P[f"{s}ForeArm"] = (sgn * 0.45, 1.43, 0)
        P[f"{s}Hand"] = (sgn * 0.70, 1.43, 0)
        for i, n in enumerate(["Thumb1", "Thumb2", "Thumb3", "ThumbEnd"]):
            P[f"{s}Hand{n}"] = (sgn * (0.72 + 0.03 * i), 1.42 - 0.005 * i, 0.03 + 0.012 * i)
        for f, z, ln in (("Index", 0.025, 1.0), ("Middle", 0.008, 1.08), ("Ring", -0.01, 1.0), ("Pinky", -0.027, 0.82)):
            xs = [0.71, 0.79, 0.835, 0.865, 0.89]
            for n, x in zip(["1", "2", "3", "4", "End"], xs):
                P[f"{s}Hand{f}{n}"] = (sgn * (0.71 + (x - 0.71) * ln), 1.43, z)
        P[f"{s}Leg"] = (sgn * 0.09, 0.92, 0)
        P[f"{s}Shin"] = (sgn * 0.09, 0.50, 0)
        P[f"{s}Foot"] = (sgn * 0.09, 0.08, -0.02)
        P[f"{s}ToeBase"] = (sgn * 0.09, 0.02, 0.11)
        P[f"{s}ToeEnd"] = (sgn * 0.09, 0.02, 0.18)
    return np.array([P[n] for n in SOMA_NAMES], dtype=np.float64)
