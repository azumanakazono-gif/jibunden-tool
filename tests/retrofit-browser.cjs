const {chromium}=require('playwright');
const fs=require('fs'); const assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://**/*',async route=>{
  const u=route.request().url();
  if(u.includes('pptxgen'))return route.fulfill({path:require.resolve('pptxgenjs').replace(/pptxgen\.cjs\.js$/, 'pptxgen.bundle.js'),contentType:'application/javascript'});
  if(u.includes('chart.js'))return route.fulfill({path:require.resolve('chart.js').replace(/chart\.cjs$/, 'chart.umd.js'),contentType:'application/javascript'});
  return route.abort();
 });
 await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
 await page.waitForTimeout(400);
 console.log('init errors',errors);
 await page.click('#pm-btn-battery_only');assert.equal(await page.locator('#retrofit-panel').isVisible(),false);
 // Exercise the existing password-based unlock, without modifying its state directly.
 await page.locator('#unlock-pw').fill(await page.evaluate(()=>UNLOCK_PW));
 await page.locator('#unlock-panel button').click();
 await page.click('#pm-btn-battery_only');assert(await page.locator('#retrofit-panel').isVisible());
 assert.equal(await page.locator('#system-design-card').isVisible(),false);
 const d={generation:6000,exportKwh:4000,importKwh:4800,bill:160000,buyRate:30,sellRate:8,capacity:10,reserve:0,efficiency:90,matching:100,nightShare:100,days:365,cost:100,years:15,degradation:0};
 for(const [k,v] of Object.entries(d))await page.locator('#rt-'+k).fill(String(v));
 await page.locator('#cn').fill('後付け検証');
 assert((await page.locator('#rt-result').innerText()).includes('69,350'));
 await page.waitForTimeout(400);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('jibunden_current')));
 assert.equal(stored.batteryRetrofit.sellRate,'8');
 const data=await page.evaluate(()=>getFormData());
 await page.click('#pm-btn-pv_only');assert.equal(await page.locator('#retrofit-panel').isVisible(),false);
 assert(await page.locator('#system-design-card-so').isVisible());
 await page.click('#pm-btn-pv_battery');assert(await page.locator('#system-design-card').isVisible());
 await page.evaluate(d=>setFormData(d),data);assert(await page.locator('#retrofit-panel').isVisible());
 assert.equal(await page.locator('#rt-sellRate').inputValue(),'8');
 await page.locator('#rt-sellRate').fill('0');
 const zero=await page.evaluate(()=>getFormData());await page.evaluate(d=>setFormData(d),zero);assert.equal(await page.locator('#rt-sellRate').inputValue(),'0');
 await page.locator('#rt-sellRate').fill('8');
 const downloadP=page.waitForEvent('download');await page.click('#rt-pptx');const download=await downloadP;await download.saveAs('test-results/retrofit-test.pptx');
 assert(fs.statSync('test-results/retrofit-test.pptx').size>10000);
 const jsonP=page.waitForEvent('download');await page.click('#rt-save');const json=await jsonP;await json.saveAs('test-results/retrofit-test.json');
 assert.equal(JSON.parse(fs.readFileSync('test-results/retrofit-test.json')).batteryRetrofit.sellRate,'8');
 // Changed retrofit values must update history even when the legacy fields are identical.
 await page.locator('#rt-cost').fill('101');await page.evaluate(()=>saveCustomer());
 assert.equal(await page.evaluate(()=>getHistory()[0].batteryRetrofit.cost),'101');
 // Re-loading must not unlock the mode automatically.
 await page.reload();await page.waitForTimeout(400);assert.equal(await page.locator('#retrofit-panel').isVisible(),false);
 await page.locator('#unlock-pw').fill(await page.evaluate(()=>UNLOCK_PW));await page.locator('#unlock-panel button').click();await page.click('#pm-btn-battery_only');
 assert.equal(await page.locator('#rt-cost').inputValue(),'101');
 await page.screenshot({path:'test-results/retrofit-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/retrofit-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));console.log('mobile width',overflow);assert(overflow.scroll<=overflow.width+1);
 console.log('errors',errors);assert.deepEqual(errors,[]);
 console.log('PASS: lock, mode switch, calculation, persistence, JSON/PPTX, history, mobile');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
