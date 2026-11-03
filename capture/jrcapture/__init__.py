"""JustRigIt Capture — turns a video of a person into a game-ready skeleton animation.

Pipeline: NVIDIA GEM-X (video → SOMA body motion, on your GPU) → clean-up (units, floor,
facing, smoothing, foot contacts) → GLB file that JustRigIt retargets onto any character.
"""
__version__ = "0.1.0"
