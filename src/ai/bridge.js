// Exposes the Forge to AI agents:
//  1. window.justrigit — a plain JS API any browser agent (Claude in Chrome, OpenAI Operator/Atlas,
//     Playwright scripts) can call: await justrigit.call('get_status').
//  2. WebMCP — navigator.modelContext.registerTool(...) when the browser supports it.
//  3. A JSON manifest in the DOM (#justrigit-ai-manifest) for agents that only read the page.
import { VERSION } from '../core/forge.js';

export const AGENT_PROMPT = `You can operate JustRigIt directly — no clicking needed.
This page exposes a JavaScript API at window.justrigit:

  await window.justrigit.call('get_status')       // always start here
  await window.justrigit.call('list_commands')    // every command + JSON schema
  await window.justrigit.call('<command>', { ...args })

Character WITHOUT a skeleton (status.needsRig = true):
  get_rig_markers → check/adjust with set_rig_markers {markers:{chin:[x,y], ...}}
  (use get_viewport_snapshot to look at it) → auto_rig

Typical flow for "get my character ready for Unreal 5":
  1. load_character {demo:true}  (or the user drops a file on the page)
  2. set_target {engine:'ue5'}
  3. run_health_check → apply_fix {fix:'all'}
  4. list_library → add_animations {pack:'locomotion8'}  (or clips:[...], or a file via base64+filename)
  5. update_clip {name, mode:'inplace'|'rootmotion'}  /  play_clip {name}
  6. export_bundle {deliver:'download'}  → zip with GLB + step-by-step import guide

Motion capture from a video (runs NVIDIA GEM-X locally on the user's GPU):
  capture_status → if online: capture_video {base64, filename, camera:'static'|'background'|'vipe', start, duration}
  The motion is retargeted onto the character with foot locking. export_capture {format:'bvh'} gives the raw take.
Skeleton names in the export follow the engine (set_export_options {bone_naming:'ue5'|'mixamo'|'godot'|'keep'|'auto'}).
Use explain_term {term:'root_motion'} for beginner-friendly explanations.
Every command you run appears in the on-screen Activity log tagged "AI".`;

export function installBridge(forge) {
  const api = {
    version: VERSION,
    call: (name, args) => forge.call(name, args, 'ai'),
    listTools: () => forge.listTools(),
    help: () => AGENT_PROMPT,
    on: (fn) => forge.on(fn),
  };
  try { Object.defineProperty(window, 'justrigit', { value: Object.freeze(api), configurable: false }); } catch { window.justrigit = api; }

  // DOM manifest
  const manifest = document.createElement('script');
  manifest.type = 'application/json';
  manifest.id = 'justrigit-ai-manifest';
  manifest.textContent = JSON.stringify({
    name: 'JustRigIt', version: VERSION,
    description: 'Browser tool that prepares 3D characters and animations for Unreal, Unity, Godot and Blender.',
    api: 'window.justrigit.call(name, args) → Promise<result>',
    instructions: AGENT_PROMPT,
    tools: forge.listTools(),
  });
  document.head.appendChild(manifest);

  // WebMCP (experimental; Chrome behind a flag as of late 2026). Feature-detect only.
  const status = { webmcp: false, webmcpTools: 0, webmcpError: null };
  const mc = (typeof navigator !== 'undefined' && navigator.modelContext) || (typeof document !== 'undefined' && document.modelContext);
  if (mc) {
    const tools = forge.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      async execute(args) {
        try {
          const r = await forge.call(t.name, args || {}, 'ai');
          return { content: [{ type: 'text', text: JSON.stringify(r) }] };
        } catch (e) {
          return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
        }
      },
    }));
    try {
      if (typeof mc.registerTool === 'function') { tools.forEach((t) => mc.registerTool(t)); status.webmcp = true; }
      else if (typeof mc.provideContext === 'function') { mc.provideContext({ tools }); status.webmcp = true; }
      status.webmcpTools = status.webmcp ? tools.length : 0;
    } catch (e) { status.webmcpError = e.message; }
  }
  return status;
}
