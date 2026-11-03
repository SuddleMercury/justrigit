const { chromium } = require('playwright'); const path=require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 } });
  const errors=[]; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve('dist/justrigit.html')); await page.waitForTimeout(500);
  await page.setInputFiles('#file', 'testassets/Xbot.glb'); await page.waitForTimeout(1500);
  console.log('timeline hidden:', await page.isHidden('#timeline'));
  await page.click('[data-engine="ue5"]'); await page.click('[data-goto="check"]'); await page.waitForTimeout(300);
  console.log(await page.$$eval('.issue b', els => els.map(e=>e.textContent).join(' | ')));
  await page.click('[data-action="fix-all"]'); await page.waitForTimeout(400);
  await page.click('[data-goto="animations"]'); await page.click('[data-play="run"]'); await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/shots/10-xbot.png' });
  await page.click('[data-goto="export"]'); await page.click('[data-action="preview-guide"]'); await page.waitForTimeout(300);
  await page.evaluate(()=>document.querySelector('#guide').scrollIntoView()); await page.screenshot({ path: '/tmp/shots/11-guide.png' });
  console.log('errors:', errors.join('\n')||'none'); await browser.close();
})();
