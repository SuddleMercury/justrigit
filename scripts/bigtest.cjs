const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve('dist/justrigit.html')); await page.waitForTimeout(500);
  await page.setInputFiles('#file', 'testassets/Samba.fbx'); await page.waitForTimeout(2500);
  await page.click('[data-engine="godot"]'); await page.click('[data-goto="check"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/shots/30-big-before-fix.png' });
  await page.click('[data-action="fix-all"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/shots/31-big-after-fix.png' });
  console.log('errors:', errors.join('\n') || 'none'); await browser.close();
})();
