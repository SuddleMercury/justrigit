#!/usr/bin/env node
// JustRigIt MCP server — the same engine as the web app, for AI assistants.
//
//   Local (Claude Desktop, Claude Code, Cursor…):   node mcp-server.mjs
//   Remote (ChatGPT developer mode, claude.ai custom connector, Responses API):
//                                                   node mcp-server.mjs --http 8787
//     → serve it behind your HTTPS reverse proxy at https://your-domain/mcp
//
// Files: in stdio mode, tools read/write paths on this computer.
//        in HTTP mode, exports are written to ./exports and returned as download links.
import './shims.js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Forge, VERSION } from '../core/forge.js';
import { defaultExportDir, normalizeUserPath, resolveInputFile, findFiles, makeEnsureEngine } from './local.js';
import { renderSnapshot } from './render.js';

const args = process.argv.slice(2);
const httpPort = args.includes('--http') ? Number(args[args.indexOf('--http') + 1] || 8787) : null;
const publicUrl = (args.includes('--public-url') ? args[args.indexOf('--public-url') + 1] : process.env.JUSTRIGIT_PUBLIC_URL || (httpPort ? `http://localhost:${httpPort}` : '')).replace(/\/$/, '');
// Local: Documents\JustRigIt Exports (the server's working folder is often C:\Windows\System32 under
// Claude Desktop, so never default to a relative path). Remote: ./exports, served as download links.
const exportDir = httpPort ? path.resolve(process.env.JUSTRIGIT_EXPORT_DIR || 'exports') : defaultExportDir();
const log = (...a) => process.stderr.write(a.join(' ') + '\n'); // stdout belongs to the protocol in stdio mode

const INSTRUCTIONS = `JustRigIt prepares 3D characters for game engines: it auto-rigs meshes that have no skeleton, checks and fixes common import problems, retargets animations (a built-in CC0 library, the user's own files, or motion captured from a video) and exports GLB files with a step-by-step import guide.
Typical flow: get_status → load_character → (if needsRig: get_rig_markers → set_rig_markers if needed → auto_rig) → set_target → run_health_check → apply_fix {fix:"all"} → add_animations / capture_video → get_viewport_snapshot to check → export_bundle.
Motion capture from video: capture_video {path} runs NVIDIA GEM-X on the user's GPU (the engine is started automatically if installed). A capture can take minutes: if the reply has state "running", call wait_for_capture {job_id} until state is "done". Then the motion is on the character, with foot locking. Exports use each engine's standard bone names (set_export_options {bone_naming}).
Use get_viewport_snapshot (clip + time) to look at the result yourself before telling the user it is good.
Explain issues to the user in plain language (explain_term helps); the user is often a beginner.
${httpPort ? 'This is a remote server: pass files as url or base64; export_bundle returns a download link.' : `This server runs on the user's computer. Pass files as local paths (path). If you don't know where a file is, use find_files (searches Desktop, Downloads, Videos, Documents, Pictures). Exports go to ${exportDir} unless you give output_dir; tell the user the folder.`}`;

const HIDDEN = new Set(['go_to_step']); // needs the app window

const FIND_FILES = {
  name: 'find_files', title: 'Find videos and 3D models on this computer',
  description: 'Lists video files (for capture_video) and 3D models (.glb/.gltf/.fbx, for load_character / add_animations) on this computer, newest first. Searches Desktop, Downloads, Videos, Documents and Pictures (OneDrive too) unless folder is given. query matches words in the file name.',
  inputSchema: { type: 'object', properties: {
    kind: { type: 'string', enum: ['video', 'model', 'any'], default: 'any' },
    query: { type: 'string', description: 'Words in the file name, e.g. "jump" or "grey alien".' },
    folder: { type: 'string', description: 'Only search this folder (and subfolders).' },
    limit: { type: 'number', default: 25 },
  }, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

function newForge() {
  const forge = new Forge();
  forge.hooks.snapshot = (o = {}) => {
    const r = renderSnapshot(forge.doc, o);
    const { png, ...info } = r;
    return { ...info, image: 'data:image/png;base64,' + png.toString('base64'), message: `Rendered ${info.views.join(' + ')} view${info.views.length > 1 ? 's' : ''}${info.clip ? ` of "${info.clip}" at ${info.time} s` : ' (rest pose)'}.` };
  };
  if (!httpPort) forge.hooks.ensureEngine = makeEnsureEngine(log);
  return forge;
}

function sessionTools(forge) {
  return forge.listTools().filter((t) => !HIDDEN.has(t.name)).map((t) => {
    const schema = JSON.parse(JSON.stringify(t.inputSchema));
    if (t.name === 'load_character' || t.name === 'add_animations' || t.name === 'capture_video') {
      if (!httpPort) schema.properties.path = { type: 'string', description: t.name === 'capture_video' ? 'Path to a video file (.mp4/.mov/.mkv/.avi/.webm) on this computer, e.g. C:\\Users\\me\\Videos\\jump.mp4 (use find_files if unsure).' : 'Path to a .glb/.gltf/.fbx file on this computer (use find_files if unsure).' };
      if (t.name === 'capture_video') schema.properties.wait_seconds = { ...schema.properties.wait_seconds, default: 40, description: 'Return after this many seconds with state "running" if not finished (default 40 here); then call wait_for_capture.' };
      t = { ...t, description: t.description + (httpPort ? ' On this remote server use url or base64.' : ' On this server you can also pass a local file path.') };
    }
    if (t.name === 'export_capture') {
      schema.properties.deliver = { type: 'string', enum: ['file', 'base64'], default: 'file' };
      if (!httpPort) schema.properties.output_dir = { type: 'string', description: `Folder to write the file into. Defaults to ${exportDir}.` };
    }
    if (t.name === 'export_bundle') {
      schema.properties.deliver = { type: 'string', enum: httpPort ? ['link', 'base64'] : ['folder', 'base64'], default: httpPort ? 'link' : 'folder' };
      if (!httpPort) {
        schema.properties.output_dir = { type: 'string', description: `Folder to write the files into (created if needed). Defaults to ${exportDir}.` };
        schema.properties.unzip = { type: 'boolean', default: true, description: 'Also write the individual files (GLB, guide) next to the zip.' };
      }
    }
    return { name: t.name, title: t.title, description: t.description, inputSchema: schema, annotations: t.annotations };
  }).concat(httpPort ? [] : [FIND_FILES]);
}

async function runTool(forge, name, a = {}) {
  a = { ...a };
  if (name === 'find_files') {
    if (httpPort) throw new Error('find_files is only available when the server runs on your computer.');
    const r = findFiles({ kind: a.kind, query: a.query, folder: a.folder, limit: Math.min(200, a.limit || 25) });
    return { ...r, message: r.files.length ? `Found ${r.total} file(s)${r.total > r.files.length ? `, showing the newest ${r.files.length}` : ''}.` : `No matching files in ${r.searched.join(', ')}.` };
  }
  if (name === 'capture_video' && a.wait_seconds === undefined) a.wait_seconds = 40;
  if (a.output_dir && !httpPort) a.output_dir = normalizeUserPath(a.output_dir);
  if ((name === 'load_character' || name === 'add_animations' || name === 'capture_video') && a.path) {
    if (httpPort) throw new Error('path is not available on a remote server; use url or base64.');
    const p = resolveInputFile(a.path, name === 'capture_video' ? 'video' : 'model');
    const b = fs.readFileSync(p);
    a.buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    a.filename ??= path.basename(p);
    delete a.path;
  }
  if (name === 'export_capture' && (a.deliver || 'file') !== 'base64') {
    const r = await forge.call('export_capture', { format: a.format || 'glb', deliver: 'base64' }, 'ai');
    const dir = httpPort ? path.join(exportDir, crypto.randomBytes(6).toString('hex')) : path.resolve(a.output_dir || exportDir);
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, r.filename);
    fs.writeFileSync(fp, Buffer.from(r.base64, 'base64'));
    return { message: `Saved ${r.filename}`, path: httpPort ? undefined : fp, url: httpPort ? `${publicUrl}/exports/${path.basename(dir)}/${r.filename}` : undefined, bytes: r.bytes };
  }
  if (name === 'export_bundle') {
    const mode = a.deliver || (httpPort ? 'link' : 'folder');
    const r = await forge.call('export_bundle', { deliver: mode === 'base64' ? 'base64' : 'none' }, 'ai');
    const bundle = forge.lastExport;
    if (mode === 'folder' || mode === 'link') {
      const dir = mode === 'folder' ? path.resolve(a.output_dir || exportDir) : path.join(exportDir, crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(dir, { recursive: true });
      const zipPath = path.join(dir, bundle.names.bundle);
      fs.writeFileSync(zipPath, bundle.zip);
      r.zip_path = zipPath;
      if (mode === 'folder' && a.unzip !== false) {
        const { unzipSync } = await import('fflate');
        const files = unzipSync(bundle.zip);
        r.files_written = Object.entries(files).map(([n, d]) => { const fp = path.join(dir, n); fs.writeFileSync(fp, d); return fp; });
      }
      if (mode === 'link') {
        r.download_url = `${publicUrl}/exports/${path.basename(dir)}/${encodeURIComponent(bundle.names.bundle)}`;
        delete r.zip_path;
      }
      delete r.guide_markdown; // it's inside the zip; keep responses small
      r.message += mode === 'link' ? ` Download: ${r.download_url}` : ` Saved to ${dir}.`;
    }
    return r;
  }
  return forge.call(name, a, 'ai');
}

function makeServer(forge) {
  const server = new Server({ name: 'justrigit', title: 'JustRigIt', version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: sessionTools(forge) }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    // Progress notifications (capture) when the client asks for them; some clients use these
    // to keep long calls alive and to show a progress bar.
    const token = req.params._meta?.progressToken;
    const off = token !== undefined && extra?.sendNotification
      ? forge.on((type, d) => { if (type === 'capture-progress') extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: Math.round((d.progress || 0) * 100), total: 100, message: d.message } }).catch(() => {}); })
      : null;
    try {
      const result = await runTool(forge, req.params.name, req.params.arguments || {});
      const content = [];
      let structured = typeof result === 'object' && result && !Array.isArray(result) ? { ...result } : { result };
      if (typeof structured.image === 'string' && structured.image.startsWith('data:image/')) {
        const [, mime, data] = structured.image.match(/^data:([^;]+);base64,(.*)$/) || [];
        if (data) content.push({ type: 'image', data, mimeType: mime });
        delete structured.image;
      }
      content.unshift({ type: 'text', text: JSON.stringify(structured, null, 1) });
      return { content, structuredContent: structured };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    } finally { off?.(); }
  });
  return server;
}

if (!httpPort) {
  const forge = newForge();
  await makeServer(forge).connect(new StdioServerTransport());
  log(`JustRigIt MCP server ${VERSION} ready (stdio).`);
} else {
  // One Forge (one loaded character) per MCP session.
  const sessions = new Map();
  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname.startsWith('/exports/')) {
        const fp = path.join(exportDir, decodeURIComponent(url.pathname.slice('/exports/'.length)));
        if (!fp.startsWith(exportDir + path.sep) || !fs.existsSync(fp)) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${path.basename(fp)}"` });
        fs.createReadStream(fp).pipe(res);
        return;
      }
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`JustRigIt MCP server ${VERSION}. MCP endpoint: ${publicUrl}/mcp`); return; }
      if (url.pathname !== '/mcp') { res.writeHead(404).end('Not found'); return; }
      let body;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      }
      const sid = req.headers['mcp-session-id'];
      let entry = sid && sessions.get(sid);
      if (!entry) {
        if (req.method !== 'POST') { res.writeHead(400).end('No session'); return; }
        const forge = newForge();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => sessions.set(id, { transport, forge, touched: Date.now() }),
        });
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
        await makeServer(forge).connect(transport);
        entry = { transport, forge };
      }
      entry.touched = Date.now();
      await entry.transport.handleRequest(req, res, body);
    } catch (e) {
      log('HTTP error:', e.stack || e.message);
      if (!res.headersSent) res.writeHead(500).end(String(e.message));
    }
  });
  // Drop idle sessions after an hour.
  setInterval(() => { for (const [id, s] of sessions) if (Date.now() - s.touched > 3600e3) { s.transport.close?.(); sessions.delete(id); } }, 60e3).unref();
  httpServer.listen(httpPort, () => log(`JustRigIt MCP server ${VERSION} on http://localhost:${httpPort}/mcp (public: ${publicUrl}/mcp)`));
}
