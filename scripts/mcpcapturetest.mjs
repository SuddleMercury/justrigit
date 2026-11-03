// MCP (stdio) smoke test for the capture tools. Needs the capture engine running
// (python -m jrcapture serve --demo is enough).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
const c = new Client({ name: 'test', version: '1' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['src/node/mcp-server.mjs'], stderr: 'ignore' }));
let fail = 0;
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); const t = r.content[0].text; let j; try { j = JSON.parse(t); } catch { j = { message: t }; } console.log((r.isError ? 'FAIL ' : 'ok   ') + name.padEnd(16), String(j.message || '').slice(0, 150)); if (r.isError) fail++; return j; };
const tools = (await c.listTools()).tools;
const cv = tools.find((t) => t.name === 'capture_video');
console.log('capture_video has path param:', !!cv?.inputSchema.properties.path);
fs.writeFileSync('/tmp/mcp_test_video.mp4', Buffer.alloc(20000, 1));
await call('capture_status');
await call('load_character', { demo: true });
await call('set_target', { engine: 'godot' });
await call('capture_video', { path: '/tmp/mcp_test_video.mp4', smoothing: 'light' });
const raw = await call('export_capture', { format: 'glb', output_dir: '/tmp/mcp_out' });
console.log('raw file exists:', fs.existsSync(raw.path || ''));
const ex = await call('export_bundle', { output_dir: '/tmp/mcp_out' });
console.log('files:', (ex.files_written || []).map((f) => f.split('/').pop()).join(', '));
await c.close();
process.exit(fail ? 1 : 0);
