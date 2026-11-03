// Client for JustRigIt Capture — the local engine that turns a video into motion
// (NVIDIA GEM-X on the user's own GPU). Works in the browser and in Node (MCP server).
// The engine listens on 127.0.0.1 only; start it with "Start-Capture.bat".

export const DEFAULT_CAPTURE_URL = 'http://127.0.0.1:8790';

async function fetchJson(url, opts = {}, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: opts.signal || ctl.signal });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Capture engine replied HTTP ${r.status}`);
    return body;
  } finally { clearTimeout(t); }
}

export async function captureStatus(base = DEFAULT_CAPTURE_URL) {
  try {
    const s = await fetchJson(`${base}/status`, {}, 1500);
    return { online: true, url: base, ...s };
  } catch (e) {
    return { online: false, url: base, error: e.name === 'AbortError' ? 'No answer' : e.message };
  }
}

export async function startCapture(base, bytes, filename, o = {}) {
  const q = new URLSearchParams({ filename: filename || 'video.mp4' });
  for (const k of ['camera', 'smoothing', 'start', 'duration']) if (o[k] !== undefined && o[k] !== null && o[k] !== '') q.set(k, String(o[k]));
  if (o.fingers === false) q.set('fingers', '0');
  return fetchJson(`${base}/capture?${q}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }, 10 * 60 * 1000);
}

// Polls a job until it finishes. With deadlineMs, gives up waiting after that long and returns
// { pending: true, job } instead (the job keeps running in the engine).
export async function waitForJob(base, id, onProgress, { intervalMs = 700, signal, deadlineMs } = {}) {
  const until = deadlineMs != null ? Date.now() + deadlineMs : Infinity;
  for (;;) {
    if (signal && signal.aborted) {
      await fetchJson(`${base}/jobs/${id}/cancel`, { method: 'POST' }).catch(() => {});
      throw new Error('Capture cancelled.');
    }
    const j = await fetchJson(`${base}/jobs/${id}`);
    if (onProgress) onProgress(j);
    if (j.state === 'done') return j;
    if (j.state === 'error') throw new Error(j.error || 'Capture failed.');
    if (j.state === 'cancelled') throw new Error('Capture cancelled.');
    if (Date.now() + intervalMs > until) return { pending: true, job: j };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function cancelJob(base, id) {
  return fetchJson(`${base}/jobs/${id}/cancel`, { method: 'POST' });
}

export async function fetchResult(base, id, kind = 'glb') {
  const r = await fetch(`${base}/jobs/${id}/result.${kind}`);
  if (!r.ok) throw new Error(`Could not download the capture result (HTTP ${r.status}).`);
  return r.arrayBuffer();
}

export const CAPTURE_TIPS = [
  'Camera on a tripod or propped up — not handheld (choose "Handheld" if you must).',
  'Whole body in view the entire time, feet included, with a little space above the head.',
  'Good, even light. 1080p at 30–60 fps. Fitted clothes that contrast with the background.',
  'Start and end standing still for a second. One person in the shot.',
  'Film side-on for walks, about 45° for fighting moves. Keep clips short: one action each (max 60 s).',
];
