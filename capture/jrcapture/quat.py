"""Small numpy rotation toolkit. Quaternions are (x, y, z, w), like glTF and three.js."""
from __future__ import annotations

import numpy as np


def orthonormalize(m: np.ndarray) -> np.ndarray:
    """Nearest rotation matrix (polar decomposition) for (..., 3, 3) input."""
    u, _, vt = np.linalg.svd(m)
    r = u @ vt
    det = np.linalg.det(r)
    fix = det < 0
    if np.any(fix):
        u = u.copy()
        u[fix, :, -1] *= -1
        r = u @ vt
    return r


def mat_to_quat(m: np.ndarray) -> np.ndarray:
    """(..., 3, 3) rotation matrices → (..., 4) unit quaternions (x, y, z, w)."""
    m = np.asarray(m, dtype=np.float64)
    shape = m.shape[:-2]
    m = m.reshape(-1, 3, 3)
    q = np.empty((m.shape[0], 4))
    tr = m[:, 0, 0] + m[:, 1, 1] + m[:, 2, 2]
    for i in range(m.shape[0]):
        a = m[i]
        if tr[i] > 0:
            s = np.sqrt(tr[i] + 1.0) * 2
            q[i] = [(a[2, 1] - a[1, 2]) / s, (a[0, 2] - a[2, 0]) / s, (a[1, 0] - a[0, 1]) / s, 0.25 * s]
        elif a[0, 0] > a[1, 1] and a[0, 0] > a[2, 2]:
            s = np.sqrt(1.0 + a[0, 0] - a[1, 1] - a[2, 2]) * 2
            q[i] = [0.25 * s, (a[0, 1] + a[1, 0]) / s, (a[0, 2] + a[2, 0]) / s, (a[2, 1] - a[1, 2]) / s]
        elif a[1, 1] > a[2, 2]:
            s = np.sqrt(1.0 + a[1, 1] - a[0, 0] - a[2, 2]) * 2
            q[i] = [(a[0, 1] + a[1, 0]) / s, 0.25 * s, (a[1, 2] + a[2, 1]) / s, (a[0, 2] - a[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + a[2, 2] - a[0, 0] - a[1, 1]) * 2
            q[i] = [(a[0, 2] + a[2, 0]) / s, (a[1, 2] + a[2, 1]) / s, 0.25 * s, (a[1, 0] - a[0, 1]) / s]
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    return q.reshape(*shape, 4)


def quat_to_mat(q: np.ndarray) -> np.ndarray:
    q = np.asarray(q, dtype=np.float64)
    q = q / np.linalg.norm(q, axis=-1, keepdims=True)
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    m = np.empty(q.shape[:-1] + (3, 3))
    m[..., 0, 0] = 1 - 2 * (y * y + z * z)
    m[..., 0, 1] = 2 * (x * y - z * w)
    m[..., 0, 2] = 2 * (x * z + y * w)
    m[..., 1, 0] = 2 * (x * y + z * w)
    m[..., 1, 1] = 1 - 2 * (x * x + z * z)
    m[..., 1, 2] = 2 * (y * z - x * w)
    m[..., 2, 0] = 2 * (x * z - y * w)
    m[..., 2, 1] = 2 * (y * z + x * w)
    m[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def axis_angle_to_mat(v: np.ndarray) -> np.ndarray:
    """(..., 3) axis-angle (Rodrigues) → (..., 3, 3)."""
    v = np.asarray(v, dtype=np.float64)
    th = np.linalg.norm(v, axis=-1, keepdims=True)
    k = np.where(th > 1e-12, v / np.maximum(th, 1e-12), 0.0)
    kx, ky, kz = k[..., 0], k[..., 1], k[..., 2]
    zero = np.zeros_like(kx)
    K = np.stack([np.stack([zero, -kz, ky], -1), np.stack([kz, zero, -kx], -1), np.stack([-ky, kx, zero], -1)], -2)
    th = th[..., None]
    eye = np.broadcast_to(np.eye(3), K.shape)
    return eye + np.sin(th) * K + (1 - np.cos(th)) * (K @ K)


def rot_y(deg: float) -> np.ndarray:
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def hemisphere_continuous(q: np.ndarray) -> np.ndarray:
    """Flip quaternion signs along axis 0 (time) so neighbours stay on the same hemisphere."""
    q = q.copy()
    for t in range(1, q.shape[0]):
        d = np.sum(q[t] * q[t - 1], axis=-1)
        q[t][d < 0] *= -1
    return q


def slerp(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    d = np.sum(a * b, axis=-1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    out = np.where(d > 0.9995, a + t * (b - a), 0)
    th = np.arccos(np.clip(d, -1, 1))
    s = np.sin(th)
    with np.errstate(invalid="ignore", divide="ignore"):
        sl = (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.where(s < 1e-9, 1, s)
    out = np.where(d > 0.9995, out, sl)
    return out / np.linalg.norm(out, axis=-1, keepdims=True)
