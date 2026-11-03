// Software renderer for the MCP server: draws the (posed, skinned) character to a PNG with no
// GPU or window, so a vision-capable AI can check rigging and animation. Flat-shaded, z-buffered,
// orthographic; front / side / three-quarter views side by side.
import * as THREE from 'three';
import zlib from 'node:zlib';

const VIEWS = {
  front: { yaw: 0, label: 'front' },      // camera on +Z looking at the character's face
  side: { yaw: Math.PI / 2, label: 'side' }, // camera on +X (the character's left)
  three_quarter: { yaw: Math.PI / 5, label: '3/4' },
  back: { yaw: Math.PI, label: 'back' },
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// World-space triangles of every visible mesh at the current pose.
function collectTriangles(root) {
  root.updateMatrixWorld(true);
  const tris = []; // [ax,ay,az,bx,by,bz,cx,cy,cz,r,g,b]
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position) return;
    const g = o.geometry, pa = g.attributes.position, n = pa.count;
    const P = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(pa, i);
      v.applyMatrix4(o.matrixWorld);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const colorOf = (m) => { const c = m && m.color ? m.color : new THREE.Color(0.5, 0.52, 0.55); return [c.r, c.g, c.b].map((x) => Math.min(1, Math.max(0.3, Math.pow(x, 1 / 2.2)))); }; // linear → screen
    const idx = g.index ? g.index.array : null;
    const triCount = idx ? idx.length / 3 : n / 3;
    const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.length : n, materialIndex: 0 }];
    for (const gr of groups) {
      const col = colorOf(mats[gr.materialIndex] || mats[0]);
      for (let t = gr.start / 3; t < Math.min(triCount, (gr.start + gr.count) / 3); t++) {
        const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
        tris.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2], col[0], col[1], col[2]);
      }
    }
  });
  return new Float32Array(tris);
}

function rasterize(T, view, W, H, bounds) {
  const rgb = Buffer.alloc(W * H * 3);
  // background gradient + floor
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 3, s = 30 + (y / H) * 18; rgb[k] = s; rgb[k + 1] = s + 2; rgb[k + 2] = s + 8; }
  const zb = new Float32Array(W * H).fill(-Infinity);
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
  // camera basis: view direction d = toward the character; screen right r, up (0,1,0)
  const toCam = (x, z) => [x * cy - z * sy, x * sy + z * cy]; // rotate world by -yaw around Y: returns [sx, depth]
  // fit: use bounds rotated
  let minX = Infinity, maxX = -Infinity;
  for (const [bx, bz] of [[bounds.min.x, bounds.min.z], [bounds.min.x, bounds.max.z], [bounds.max.x, bounds.min.z], [bounds.max.x, bounds.max.z]]) { const [sx] = toCam(bx, bz); minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); }
  const minY = Math.min(0, bounds.min.y), maxY = bounds.max.y;
  const span = Math.max((maxX - minX) * H / W, maxY - minY) * 1.12;
  const scale = H / span, ox = W / 2 - ((minX + maxX) / 2) * scale, oy = H / 2 + ((minY + maxY) / 2) * scale;
  const proj = (x, y, z) => { const [sx, dz] = toCam(x, z); return [ox + sx * scale, oy - y * scale, dz * scale]; };
  // floor line at y = 0
  const fy = Math.round(oy);
  if (fy >= 0 && fy < H) for (let y = fy; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 3; rgb[k] = 46; rgb[k + 1] = 40; rgb[k + 2] = 38; }
  const L = new THREE.Vector3(0.35, 0.6, 1).normalize();
  for (let t = 0; t < T.length; t += 12) {
    const a = proj(T[t], T[t + 1], T[t + 2]), b = proj(T[t + 3], T[t + 4], T[t + 5]), c = proj(T[t + 6], T[t + 7], T[t + 8]);
    // normal in camera space (two-sided)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny = -ny / nl; nz /= nl; // screen y is down
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const shade = 0.28 + 0.72 * Math.max(0, nx * L.x + ny * L.y + nz * L.z);
    const r = T[t + 9] * shade * 255, g = T[t + 10] * shade * 255, bl = T[t + 11] * shade * 255;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
      const k = y * W + x;
      if (z <= zb[k]) continue;
      zb[k] = z; rgb[k * 3] = r; rgb[k * 3 + 1] = g; rgb[k * 3 + 2] = bl;
    }
  }
  return rgb;
}

// Poses the character (optional clip + time), renders the views and restores the pose.
export function renderSnapshot(doc, { clip, time, views = ['front', 'side'], size = 448 } = {}) {
  if (!doc) throw new Error('No character loaded yet.');
  const root = doc.root;
  let mixer = null, used = null, t = 0;
  if (clip) {
    used = doc.clips.find((c) => c.name === clip) || doc.clips.find((c) => c.name.toLowerCase() === String(clip).toLowerCase());
    if (!used) throw new Error(`No animation "${clip}". Animations: ${doc.clips.map((c) => c.name).join(', ') || 'none'}.`);
    doc.restPose();
    mixer = new THREE.AnimationMixer(root);
    const act = mixer.clipAction(used);
    act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play();
    t = Math.min(Math.max(0, time ?? used.duration / 2), used.duration);
    mixer.setTime(t);
  } else doc.restPose();
  try {
    const T = collectTriangles(root);
    if (!T.length) throw new Error('Nothing to draw (no meshes).');
    const bounds = new THREE.Box3();
    for (let i = 0; i < T.length; i += 12) { bounds.expandByPoint(new THREE.Vector3(T[i], T[i + 1], T[i + 2])); }
    const vs = (Array.isArray(views) ? views : [views]).map((v) => VIEWS[v] ? v : null).filter(Boolean);
    if (!vs.length) vs.push('front', 'side');
    const W = Math.round(size * 0.75), H = size;
    const panels = vs.map((v) => rasterize(T, VIEWS[v], W, H, bounds));
    const gap = 4, TW = W * panels.length + gap * (panels.length - 1);
    const out = Buffer.alloc(TW * H * 3, 12);
    panels.forEach((p, i) => { for (let y = 0; y < H; y++) p.copy(out, (y * TW + i * (W + gap)) * 3, y * W * 3, (y + 1) * W * 3); });
    const png = encodePNG(TW, H, out);
    return {
      png, views: vs, clip: used ? used.name : null, time: used ? +t.toFixed(3) : null,
      heightMeters: +(bounds.max.y - bounds.min.y).toFixed(3),
      lowestPointMeters: +bounds.min.y.toFixed(3),
      centre: [bounds.getCenter(new THREE.Vector3()).x, bounds.getCenter(new THREE.Vector3()).z].map((x) => +x.toFixed(3)),
    };
  } finally {
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); }
    doc.restPose();
  }
}
