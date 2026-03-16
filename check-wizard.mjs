import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch();

// Mobile
const mobile = await browser.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto('http://localhost:4200/new-report', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(1000);
for (let i = 0; i < 4; i++) {
  writeFileSync(`/tmp/wiz-mob-${i}.png`, await mobile.screenshot({ type: 'png' }));
  await mobile.evaluate(() => window.scrollBy(0, 500));
  await mobile.waitForTimeout(200);
}

// Desktop
const desk = await browser.newPage();
await desk.setViewportSize({ width: 1280, height: 900 });
await desk.goto('http://localhost:4200/new-report', { waitUntil: 'networkidle' });
await desk.waitForTimeout(1000);
writeFileSync('/tmp/wiz-desk-0.png', await desk.screenshot({ type: 'png' }));

await browser.close();
console.log('done');
