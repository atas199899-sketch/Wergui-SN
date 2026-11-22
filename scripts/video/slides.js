const { chromium } = require('playwright'); const fs = require('fs'); const D = '/tmp/claude-0/-home-user/8a45cc43-8049-5e9a-b61e-235f58f717b7/scratchpad/video/build/';
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const f of fs.readdirSync(D).filter(x => /^s\d+\.html$/.test(x)).sort()) { await p.goto('file://' + D + f); await p.waitForTimeout(300); await p.screenshot({ path: D + f.replace('.html', '.png') }); }
  await b.close(); console.log('diapositives ok'); })();
