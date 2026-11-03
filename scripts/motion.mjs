const { Forge } = await import('../src/core/forge.js');
const { processClip } = await import('../src/core/clips.js');
const f = new Forge();
await f.call('load_character', {demo:true}); await f.call('set_target',{engine:'ue5'}); await f.call('apply_fix',{fix:'all'});
const c = f.doc.findClip('Walk');
for (const mode of ['keep','inplace','rootmotion']) {
  const p = processClip(f.doc, c, mode);
  const h = p.tracks.find(t=>t.name.endsWith('Hips.position')).values, r = p.tracks.find(t=>t.name==='root.position');
  const n=h.length; console.log(mode.padEnd(10), 'hips z start/end', h[2].toFixed(2), h[n-1].toFixed(2), '| root z end', r ? r.values[r.values.length-1].toFixed(2) : '—');
}
console.log('original untouched:', c.tracks.find(t=>t.name.endsWith('Hips.position')).values.slice(-1)[0].toFixed(2));
