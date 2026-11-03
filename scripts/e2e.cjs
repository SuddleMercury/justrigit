const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve('dist/justrigit.html'));
  await page.waitForTimeout(800);
  const shot = async (n) => page.screenshot({ path: `/tmp/shots/${n}.png` });
  fs.mkdirSync('/tmp/shots', { recursive: true });
  await shot('1-start');
  // UI path: demo
  await page.click('text=Use the built-in demo mannequin'); await page.waitForTimeout(700); await shot('2-loaded');
  await page.click('[data-step="target"]'); await page.waitForTimeout(300);
  await page.click('[data-engine="ue5"]'); await page.waitForTimeout(300); await shot('3-target');
  await page.click('[data-goto="check"]'); await page.waitForTimeout(300);
  await page.hover('.issue.warn .term'); await page.waitForTimeout(200); await shot('4-check');
  await page.click('[data-action="fix-all"]'); await page.waitForTimeout(500); await shot('5-fixed');
  await page.click('[data-goto="animations"]'); await page.waitForTimeout(300);
  await page.click('[data-play="Walk"]'); await page.waitForTimeout(700);
  await page.click('[data-action="toggle-skel"]'); await page.waitForTimeout(300); await shot('6-anim');
  await page.click('[data-goto="export"]'); await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  await dl.saveAs('/tmp/ui_export.zip'); await page.waitForTimeout(500); await shot('7-export');
  console.log('UI download:', dl.suggestedFilename(), fs.statSync('/tmp/ui_export.zip').size, 'bytes');
  // AI path: drive via window.justrigit with a real file
  const b64 = fs.readFileSync('testassets/Samba.fbx').toString('base64');
  const ai = await page.evaluate(async (b64) => {
    const out = [];
    out.push(typeof window.justrigit, (await window.justrigit.call('list_commands')).length + ' commands');
    out.push((await window.justrigit.call('load_character', { base64: b64, filename: 'Samba.fbx' })).message);
    await window.justrigit.call('set_target', { engine: 'godot' });
    out.push((await window.justrigit.call('apply_fix', { fix: 'all' })).message);
    const ex = await window.justrigit.call('export_bundle', { deliver: 'base64' });
    out.push(ex.message);
    out.push('manifest tools: ' + JSON.parse(document.getElementById('justrigit-ai-manifest').textContent).tools.length);
    out.push('snapshot: ' + (await window.justrigit.call('get_viewport_snapshot')).image.slice(0, 30));
    return out;
  }, b64);
  console.log(ai.join('\n'));
  await page.waitForTimeout(600);
  await page.click('[data-action="toggle-log"]'); await page.waitForTimeout(300); await shot('8-ai-log');
  await page.click('[data-action="open-ai"]'); await page.waitForTimeout(300); await shot('9-ai-modal');
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
