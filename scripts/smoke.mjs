import fs from 'fs';
// Node polyfill for GLTFExporter's binary path
globalThis.FileReader = class { readAsArrayBuffer(b){ b.arrayBuffer().then(r=>{this.result=r; this.onloadend&&this.onloadend();}); } readAsDataURL(b){ b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64'); this.onloadend&&this.onloadend();}); } };
const { Forge } = await import('../src/core/forge.js');
const f = new Forge();
for (const src of ['demo', 'testassets/Xbot.glb', 'testassets/Samba.fbx']) {
  console.log('\n=====', src);
  const args = src==='demo' ? {demo:true} : {base64: fs.readFileSync(src).toString('base64'), filename: src.split('/').pop()};
  console.log((await f.call('load_character', args)).message);
  await f.call('set_target', {engine:'ue5'});
  const hc = await f.call('run_health_check');
  hc.issues.forEach(i=>console.log(' ', i.severity.padEnd(5), i.title, i.fix? '[fix:'+i.fix.id+']':''));
  console.log('FIX:', (await f.call('apply_fix', {fix:'all'})).message);
  (await f.call('run_health_check')).issues.filter(i=>i.severity!=='ok').forEach(i=>console.log('  after', i.severity, i.title));
  console.log('clips', JSON.stringify(f.clipInfo().map(c=>[c.name,c.moves,c.travelMeters])));
  const ex = await f.call('export_bundle', {deliver:'base64'});
  console.log(ex.message);
  fs.writeFileSync('/tmp/out_'+src.split('/').pop()+'.zip', Buffer.from(ex.base64,'base64'));
}
