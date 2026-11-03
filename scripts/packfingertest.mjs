// Library packs + export still work on the finger mannequin (MCP stdio path)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const c = new Client({ name: 'test', version: '1' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['src/node/mcp-server.mjs'], stderr: 'ignore' }));
let fail = 0;
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); const t = r.content[0].text; let j; try { j = JSON.parse(t); } catch { j = { message: t }; } console.log((r.isError ? 'FAIL ' : 'ok   ') + name.padEnd(16), String(j.message || '').slice(0, 160)); if (r.isError) fail++; return j; };
const lib = await call('list_library');
const pack = (lib.packs || [])[0]?.id || 'locomotion';
for (const engine of ['ue5', 'godot', 'unity']) {
  await call('load_character', { demo: true });
  await call('set_target', { engine });
  await call('add_animations', { pack });
  await call('export_bundle', { output_dir: '/tmp/pack_out_' + engine });
}
await c.close();
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
