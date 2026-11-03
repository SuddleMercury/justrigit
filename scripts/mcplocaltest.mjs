// MCP on the user's own computer: auto-start engine, find_files, friendly paths, async capture,
// snapshot images, progress notifications, default export folder.
// Run with the capture engine STOPPED (the test starts it in demo mode).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execSync } from 'node:child_process';
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jri-home-'));
for (const d of ['Desktop', 'Documents', 'Downloads', 'Videos']) fs.mkdirSync(path.join(HOME, d));
fs.mkdirSync(path.join(HOME, 'Desktop', 'clips'));
execSync(`ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x240:rate=30 -t 3 -pix_fmt yuv420p "${path.join(HOME, 'Desktop', 'clips', 'my jump.mp4')}"`);
// bare (unrigged) character on the Desktop
execSync(`node scripts/_bare.mjs "${path.join(HOME, 'Desktop', 'Hero.glb')}"`, { stdio: 'ignore' });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const c = new Client({ name: 'local-test', version: '1' });
await c.connect(new StdioClientTransport({ command: 'node', args: [process.env.JRI_SERVER || path.resolve('src/node/mcp-server.mjs')], cwd: os.tmpdir(), stderr: 'ignore',
  env: { ...process.env, HOME, USERPROFILE: HOME, JUSTRIGIT_CAPTURE_PYTHON: 'python3', JUSTRIGIT_CAPTURE_ARGS: '--demo', JRCAPTURE_HOME: path.join(HOME, '.jrc') } }));
const call = async (name, args = {}, opts) => { const r = await c.callTool({ name, arguments: args }, undefined, opts); const txt = r.content.find((x) => x.type === 'text')?.text || ''; let j; try { j = JSON.parse(txt); } catch { j = { message: txt }; } j._raw = r; return j; };
const tools = (await c.listTools()).tools.map((t) => t.name);
ok(['find_files', 'get_viewport_snapshot', 'wait_for_capture', 'cancel_capture'].every((n) => tools.includes(n)), `tools: ${tools.length} incl. find_files, get_viewport_snapshot, wait_for_capture`);
ok(/JustRigIt Exports/.test(c.getInstructions()), 'instructions name the export folder');

const st = await call('capture_status');
ok(st.online === true && /Started the capture engine/.test(st.message), `capture engine auto-started: ${st.message.slice(0, 60)}`);

const ff = await call('find_files', { kind: 'video' });
ok(ff.files?.[0]?.name === 'my jump.mp4', `find_files video → ${ff.files?.map((f) => f.name)}`);
const fm = await call('find_files', { kind: 'model', query: 'hero' });
ok(fm.files?.length === 1, `find_files model "hero" → ${fm.files?.map((f) => f.name)}`);

const miss = await call('load_character', { path: 'C:\\Nowhere\\Hero.glb' });
ok(miss._raw.isError && /Did you mean/.test(miss.message) && /Hero\.glb/.test(miss.message), 'missing file suggests the real one');
const ld = await call('load_character', { path: '"Desktop/Hero.glb"' });
ok(!ld._raw.isError && /no skeleton/.test(ld.message), `load with quotes + "Desktop/…": ${ld.message.slice(0, 50)}`);
const rig = await call('auto_rig');
ok(/55 bones/.test(rig.message), rig.message);

const snap0 = await call('get_viewport_snapshot', { views: ['front'] });
const img0 = snap0._raw.content.find((x) => x.type === 'image');
ok(img0 && img0.mimeType === 'image/png' && img0.data.length > 2000, `snapshot returns an MCP image (${img0 && img0.data.length} b64 chars)`);

let progressEvents = 0;
const cap = await call('capture_video', { path: '~/Desktop/clips/my jump.mp4', wait_seconds: 0, name: 'Jump' }, { onprogress: () => progressEvents++ });
ok(cap.state === 'running' && cap.job_id, `capture_video with wait 0 returns running + job_id (${cap.message?.slice(0, 50)})`);
let w = cap, n = 0;
while (w.state === 'running' && n++ < 30) w = await call('wait_for_capture', { job_id: cap.job_id, wait_seconds: 5 }, { onprogress: () => progressEvents++ });
ok(w.state === 'done' && w.clip === 'Jump', `wait_for_capture finished: ${w.message?.slice(0, 70)}`);
ok(progressEvents > 0, `progress notifications sent: ${progressEvents}`);
const again = await call('wait_for_capture', { job_id: cap.job_id });
ok(again._raw.isError, 'finished job id is rejected politely');

const cap2 = await call('capture_video', { path: path.join(HOME, 'Desktop', 'clips', 'my jump.mp4'), name: 'Jump2' });
ok(cap2.state === 'done' || cap2.state === 'running', `default wait (40 s) capture → ${cap2.state}`);

const snap = await call('get_viewport_snapshot', { clip: 'Jump', time: 1.2, views: ['front', 'side'] });
const img = snap._raw.content.find((x) => x.type === 'image');
if (img) fs.writeFileSync('/tmp/mcp_snapshot.png', Buffer.from(img.data, 'base64'));
ok(img && snap.clip === 'Jump' && snap.time === 1.2, `snapshot of Jump at 1.2 s (${snap.message})`);

const ex = await call('export_bundle');
const expDir = path.join(HOME, 'Documents', 'JustRigIt Exports');
ok(ex.zip_path && ex.zip_path.startsWith(expDir) && fs.existsSync(ex.zip_path), `export defaults to Documents\\JustRigIt Exports: ${ex.zip_path}`);
const ex2 = await call('export_bundle', { output_dir: '~/Desktop/out' });
ok(ex2.zip_path && ex2.zip_path.startsWith(path.join(HOME, 'Desktop', 'out')), 'output_dir with ~ works');

await c.close();
for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) { try { const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); if (/python/.test(cl[0]) && cl[1] === '-m' && cl[2] === 'jrcapture') process.kill(Number(pid)); } catch {} }
fs.rmSync(HOME, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
