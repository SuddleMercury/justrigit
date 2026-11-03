import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const show = (r) => { const t = r.content[0].text; return (r.isError ? 'ERROR ' : '') + (JSON.parse(t.startsWith('Error') ? '{"message":' + JSON.stringify(t) + '}' : t).message || t).slice(0, 170); };

// ---- stdio (Claude Desktop / Claude Code style) ----
const c = new Client({ name: 'test', version: '1' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['src/node/mcp-server.mjs'], stderr: 'ignore' }));
console.log('server:', c.getServerVersion().name, c.getServerVersion().version, '| instructions:', !!c.getInstructions());
const tools = (await c.listTools()).tools; console.log('tools:', tools.length, tools.map(t => t.name).join(', '));
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); console.log(' ', name.padEnd(17), show(r)); return r; };
await call('load_character', { path: process.cwd() + '/testassets/Robot_unrigged.glb' });
await call('rotate_character', { degrees: -90 });
await call('auto_rig');
await call('set_target', { engine: 'ue5' });
await call('apply_fix', { fix: 'all' });
await call('add_animations', { pack: 'locomotion8' });
await call('add_animations', { path: process.cwd() + '/testassets/Samba.fbx' });
const ex = await call('export_bundle', { output_dir: '/tmp/mcp_out' });
console.log('  files:', JSON.parse(ex.content[0].text).files_written.map(f => f.split('/').pop()).join(', '));
await call('explain_term', { term: 'root motion' });
await c.close();

// ---- HTTP (ChatGPT / remote connector style) ----
const srv = spawn('node', ['src/node/mcp-server.mjs', '--http', '8799'], { stdio: ['ignore', 'ignore', 'pipe'] });
await new Promise((r) => srv.stderr.once('data', r));
const h = new Client({ name: 'remote', version: '1' });
await h.connect(new StreamableHTTPClientTransport(new URL('http://localhost:8799/mcp')));
const hc = async (name, args = {}) => { const r = await h.callTool({ name, arguments: args }); console.log(' http', name.padEnd(15), show(r)); return r; };
await hc('load_character', { base64: fs.readFileSync('testassets/Xbot.glb').toString('base64'), filename: 'Xbot.glb' });
await hc('set_target', { engine: 'godot' });
await hc('add_animations', { clips: ['Wave', 'Jump_Start'] });
const r = await hc('export_bundle');
const url = JSON.parse(r.content[0].text).download_url;
const dl = await fetch(url); console.log(' http download:', dl.status, dl.headers.get('content-type'), (await dl.arrayBuffer()).byteLength, 'bytes');
await h.close(); srv.kill();
