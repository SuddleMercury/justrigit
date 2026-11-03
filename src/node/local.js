// Helpers for running the MCP server on the user's own computer (Claude Desktop, Claude Code…):
// friendly path handling, a sensible export folder, finding the user's videos/models, and
// starting the local capture engine when it isn't running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureStatus } from '../core/capture.js';

const HOME = os.homedir();
const WIN = process.platform === 'win32';
const here = path.dirname(fileURLToPath(import.meta.url));

// Windows often redirects Desktop/Documents into OneDrive.
function knownFolder(name) {
  const cands = [];
  if (process.env.OneDrive) cands.push(path.join(process.env.OneDrive, name));
  if (process.env.OneDriveConsumer) cands.push(path.join(process.env.OneDriveConsumer, name));
  cands.push(path.join(HOME, 'OneDrive', name), path.join(HOME, name));
  return cands.find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) || path.join(HOME, name);
}

export function defaultExportDir() {
  const env = (process.env.JUSTRIGIT_EXPORT_DIR || '').trim();
  if (env && !env.includes('${')) return path.resolve(expandVars(env)); // ignore an unfilled ${user_config…}
  return path.join(knownFolder('Documents'), 'JustRigIt Exports');
}

function expandVars(p) {
  return p
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, v) => process.env[v] ?? m)
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, v) => (v in process.env ? process.env[v] : m));
}

// Accepts what people (and AIs) actually type: quotes, ~, %USERPROFILE%, file:// URLs,
// forward slashes, "Desktop/clip.mp4".
export function normalizeUserPath(p) {
  let s = String(p || '').trim().replace(/^["']+|["']+$/g, '');
  if (!s) throw new Error('Empty path.');
  if (/^file:\/\//i.test(s)) s = fileURLToPath(s);
  s = expandVars(s);
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(HOME, s.slice(1));
  if (!path.isAbsolute(s)) {
    const first = s.split(/[\\/]/)[0].toLowerCase();
    const named = { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads', videos: 'Videos', pictures: 'Pictures' }[first];
    s = named ? path.join(knownFolder(named), s.slice(first.length + 1)) : path.join(HOME, s);
  }
  return path.resolve(s);
}

export function resolveInputFile(p, kind) {
  const fp = normalizeUserPath(p);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp;
  // Not there: look for the same file name in the usual places so the error can help.
  const near = findFiles({ kind, query: String(p).replace(/["']/g, '').split(/[\\/]/).pop(), limit: 5 }).files.map((f) => f.path);
  throw new Error(`File not found: ${fp}` + (near.length ? `. Did you mean: ${near.join(' | ')}` : '. Use find_files to look for it.'));
}

export const EXT = {
  video: ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'],
  model: ['.glb', '.gltf', '.fbx'],
};

export function searchRoots() {
  const roots = ['Desktop', 'Downloads', 'Videos', 'Documents', 'Pictures'].map(knownFolder);
  return [...new Set(roots)].filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

const SKIP = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'venv', '.venv', '__pycache__', 'library', 'intermediate', 'deriveddatacache', 'saved', 'binaries']);

// Finds videos / 3D models on this computer (newest first). Read-only.
export function findFiles({ kind = 'any', query = '', folder, limit = 25, depth = 4 } = {}) {
  const exts = kind === 'video' ? EXT.video : kind === 'model' ? EXT.model : [...EXT.video, ...EXT.model];
  const q = String(query || '').toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const words = q.split(/[\s_\-.]+/).filter(Boolean);
  const roots = folder ? [normalizeUserPath(folder)] : searchRoots();
  const out = [];
  let scanned = 0;
  const walk = (dir, d) => {
    if (scanned > 40000) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      scanned++;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (d < depth && !e.name.startsWith('.') && !SKIP.has(e.name.toLowerCase())) walk(fp, d + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!exts.includes(ext)) continue;
      const nm = e.name.toLowerCase();
      if (words.length && !words.every((w) => nm.includes(w))) continue;
      let st; try { st = fs.statSync(fp); } catch { continue; }
      out.push({ path: fp, name: e.name, kind: EXT.video.includes(ext) ? 'video' : 'model', sizeMB: +(st.size / 1048576).toFixed(1), modified: st.mtime.toISOString().slice(0, 16).replace('T', ' ') , _t: st.mtimeMs });
    }
  };
  for (const r of roots) walk(r, 0);
  out.sort((a, b) => b._t - a._t);
  const files = out.slice(0, limit).map(({ _t, ...f }) => f);
  return { files, searched: roots, total: out.length };
}

// ---- capture engine auto-start ------------------------------------------------------------

function engineHome() {
  if (process.env.JRCAPTURE_HOME) return process.env.JRCAPTURE_HOME;
  return WIN ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'JustRigIt', 'capture') : path.join(HOME, '.justrigit', 'capture');
}

export function findEngine() {
  const home = engineHome();
  const python = process.env.JUSTRIGIT_CAPTURE_PYTHON ||
    [path.join(home, 'venv', 'Scripts', 'pythonw.exe'), path.join(home, 'venv', 'Scripts', 'python.exe'), path.join(home, 'venv', 'bin', 'python')].find((p) => fs.existsSync(p));
  // the jrcapture package: next to this server (extension bundle) or in the JustRigIt folder
  const pkgDirs = [process.env.JUSTRIGIT_CAPTURE_DIR, path.join(here, 'capture'), path.join(here, '..', '..', 'capture')].filter(Boolean);
  const pkgDir = pkgDirs.find((d) => fs.existsSync(path.join(d, 'jrcapture', '__main__.py')));
  return { home, python, pkgDir };
}

let starting = null;
export function makeEnsureEngine(log = () => {}) {
  return async (url) => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) return { started: false, reason: 'The capture engine address is not on this computer.' };
    if (starting) return starting;
    starting = (async () => {
      const { python, pkgDir } = findEngine();
      if (!python) return { started: false, reason: 'The capture engine is not installed on this computer yet: double-click Install-Capture.bat in the JustRigIt folder (one time, ~10 GB download).' };
      if (!pkgDir) return { started: false, reason: 'Found the capture engine but not its program files. Start it with Start-JustRigIt.bat instead.' };
      const port = new URL(url).port || '8790';
      const extra = (process.env.JUSTRIGIT_CAPTURE_ARGS || '').split(' ').filter(Boolean);
      log(`Starting capture engine: ${python} -m jrcapture serve (in ${pkgDir})`);
      const child = spawn(python, ['-m', 'jrcapture', 'serve', '--port', port, '--exit-when-idle', '1800', ...extra], {
        cwd: pkgDir, detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, PYTHONPATH: pkgDir + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '') },
      });
      child.on('error', (e) => log('Engine start failed: ' + e.message));
      child.unref();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if ((await captureStatus(url)).online) return { started: true };
      }
      return { started: false, reason: 'Tried to start the capture engine but it did not answer within 30 s. Start-Capture.bat shows what went wrong.' };
    })();
    try { return await starting; } finally { starting = null; }
  };
}
