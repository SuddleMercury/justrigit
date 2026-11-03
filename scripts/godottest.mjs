import '../src/node/shims.js';
import fs from 'fs';
const { Forge } = await import('../src/core/forge.js');
const f = new Forge();
await f.call('load_character', { demo: true });
await f.call('set_target', { engine: 'godot' });
await f.call('add_animations', { clips: ['Walk_Fwd', 'Run_Fwd', 'Jump_Start', 'Jump_Loop', 'Wave'] });
console.log(f.status().exportNames.clips.join('\n'));
const g = await f.call('get_import_guide'); fs.writeFileSync('/tmp/godot_guide.md', g.markdown);
// Xbot's own clips (not from the library) use the keyframe comparison
await f.call('load_character', { base64: fs.readFileSync('testassets/Xbot.glb').toString('base64'), filename: 'Xbot.glb' });
await f.call('set_target', { engine: 'godot' });
console.log('---\n' + f.status().exportNames.clips.join('\n'));
