const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve('dist/justrigit.html')); await page.waitForTimeout(500);
  const shot = (n) => page.screenshot({ path: `/tmp/shots/${n}.png` });
  await page.setInputFiles('#file', 'testassets/Robot_unrigged.glb'); await page.waitForTimeout(1500);
  await shot('20-rig-sideways');
  await page.click('[data-rotate="-90"]'); await page.waitForTimeout(800);
  await shot('21-rig-front');
  // drag the left knee marker a bit (symmetry on)
  const knee = await page.$('.mk[data-mk="leftKnee"]'); const kb = await knee.boundingBox();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down(); await page.mouse.move(kb.x + 3, kb.y - 12, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300);
  console.log('markers after drag:', JSON.stringify(await page.evaluate(() => window.justrigit.call('get_status').then(s => ({ lk: s.rigMarkers.leftKnee.map(v => +v.toFixed(3)), rk: s.rigMarkers.rightKnee.map(v => +v.toFixed(3)) })))));
  await page.click('[data-action="rig"]'); await page.waitForTimeout(400); await shot('22-rigging');
  await page.waitForFunction(() => !document.body.classList.contains('rigging'), null, { timeout: 120000 }); await page.waitForTimeout(800);
  await shot('23-rigged');
  await page.click('[data-engine="ue5"]'); await page.click('[data-goto="check"]'); await page.waitForTimeout(300);
  console.log('health:', await page.$$eval('.issue b', els => els.map(e => e.textContent).join(' | ')));
  await page.click('[data-goto="animations"]'); await page.waitForTimeout(300);
  await page.click('[data-pack="locomotion8"]'); await page.waitForTimeout(2500);
  await page.click('[data-tab="browse"]'); await page.click('[data-cat="Jump"]'); await page.waitForTimeout(200);
  await page.click('[data-libplay="Jump_Start"]'); await page.waitForTimeout(250); await shot('24-lib-jump');
  await page.click('[data-cat="Run"]'); await page.click('[data-libplay="Run_Fwd_Left"]'); await page.waitForTimeout(400); await shot('25-run-fl');
  await page.click('[data-tab="file"]'); await page.setInputFiles('#animfile', 'testassets/Samba.fbx'); await page.waitForTimeout(3000);
  await page.click('[data-play="Samba"]'); await page.waitForTimeout(1200); await shot('26-samba');
  await page.click('[data-goto="export"]'); await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  await dl.saveAs('/tmp/ui_m2.zip'); await page.waitForTimeout(500);
  console.log('download', dl.suggestedFilename(), fs.statSync('/tmp/ui_m2.zip').size);
  await page.evaluate(() => document.querySelector('#guide .md h2:nth-of-type(4)')?.scrollIntoView()); await shot('27-guide');
  // AI path: rig a fresh copy using commands only
  const b64 = fs.readFileSync('testassets/Robot_unrigged.glb').toString('base64');
  const ai = await page.evaluate(async (b64) => {
    const j = window.justrigit, out = [];
    out.push((await j.call('load_character', { base64: b64, filename: 'Bot2.glb' })).message);
    out.push((await j.call('rotate_character', { degrees: -90 })).message);
    const m = await j.call('get_rig_markers'); out.push('chin ' + m.markers.chin.map(v => v.toFixed(2)));
    out.push((await j.call('auto_rig')).message);
    await j.call('set_target', { engine: 'godot' });
    out.push((await j.call('add_animations', { clips: ['Idle', 'Wave'] })).message);
    out.push((await j.call('export_bundle', { deliver: 'none' })).message);
    return out;
  }, b64);
  console.log(ai.join('\n'));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
