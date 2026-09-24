// Browser regression for the real accordion and production CSS, with synthetic
// RPC data only. Run after installing Playwright + Chromium:
// node scripts/qa/dashboard-budget-mobile.browser.mjs
// Optional: QA_CHROMIUM_PATH, QA_SCREENSHOT_DIR, QA_VITE_URL.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const appRequire = createRequire(new URL('../../app/package.json', import.meta.url))
const root = fileURLToPath(new URL('../../', import.meta.url))
const app = path.join(root, 'app')
const entry = `budget-mobile-qa-${randomUUID()}`
let server, browser
const rows = count => Array.from({ length: count }, (_, i) => ({
  id: `qa-${i + 1}`, source: 'request', reference: `SOL-2026-000000${i + 1}`,
  title: i === 0 ? 'Servicios de seguridad y mantenimiento de instalaciones del centro operativo' : `Proveedor de prueba ${i + 1}`,
  description: i === 0 ? 'Servicio mensual con un concepto extenso para comprobar que se pueda leer completo en pantallas pequeñas. REFERENCIA_SIN_ESPACIOS_123456789012345678901234567890' : `Servicio mensual de prueba ${i + 1}`,
  date: '2026-09-15', budget_month: '2026-09-01', status: 'finance_validation', amount: 1234.56,
}))
try {
  await writeFile(path.join(app, `${entry}.html`), `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prueba móvil de partidas</title><div id="root"></div><script>window.FLUX_ENV_CONFIG={supabaseUrl:'https://budget-qa.invalid',supabaseAnonKey:'synthetic-test-key'}</script><script type="module" src="/${entry}.tsx"></script></html>`, { flag: 'wx' })
  await writeFile(path.join(app, `${entry}.tsx`), `
import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';
import {BudgetAccordion} from './src/features/dashboard/BudgetAccordion';import s from './src/features/dashboard/Dashboard.module.css';import './src/theme/tokens.css';
const count=Number(new URLSearchParams(location.search).get('count')||14);
const p={categoryId:'qa',name:'Servicio Seguridad',group:'GASTOS DE SEGURIDAD',classification:'partida',budgeted:216600,used:count*1234.56,executed:0,committed:count*1234.56,available:216600-count*1234.56,pctUsed:20.3,over:false,warn:false};
createRoot(document.getElementById('root')!).render(<BrowserRouter><main className={s.dash} style={{padding:12}}><h1 style={{fontSize:18,marginBottom:16}}>Dashboard operativo · QA</h1><section className={s.tableCard}><BudgetAccordion curated={[p]} noUse={[]} search="" companyId="qa-company" year={2026} period="2026-09-01" periodLabel="Septiembre de 2026" onRefresh={()=>{}}/></section><p style={{padding:'24px 0'}}>Fin del detalle</p></main></BrowserRouter>);
`, { flag: 'wx' })
  let origin = process.env.QA_VITE_URL
  if (!origin) {
    const { createServer } = appRequire('vite')
    server = await createServer({ root: app, server: { host: '127.0.0.1', port: 4186, strictPort: true }, logLevel: 'error' })
    await server.listen()
    origin = 'http://127.0.0.1:4186'
  }
  browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--no-zygote', '--disable-gpu'] } : {}) })
  for (const [width, height, count] of [[320,740,14],[360,800,5],[390,844,14],[430,932,4],[640,900,14],[760,900,14],[768,1024,5],[1440,1000,14]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 760, isMobile: width <= 760 })
    await context.route('https://budget-qa.invalid/**', route => route.fulfill({ json: rows(count) }))
    const page = await context.newPage()
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`${origin}/${entry}.html?count=${count}`)
    const toggle=page.getByRole('button',{name:/Servicio Seguridad/})
    await toggle.click()
    await page.locator('tbody tr').last().waitFor()
    const viewport=page.getByRole('region',{name:/Movimientos de/})
    await page.waitForFunction(()=>!!document.querySelector('[role="region"]').style.getPropertyValue('--movement-visible-height'))
    const geometry=await page.evaluate(()=>{
      const v=document.querySelector('[role="region"]'),t=v.querySelector('table'),r=Array.from(t.tBodies[0].rows),fourth=r[Math.min(3,r.length-1)]
      return { pageWidth:document.documentElement.scrollWidth,screen:innerWidth,viewportWidth:v.clientWidth,scrollWidth:v.scrollWidth,clientHeight:v.clientHeight,scrollHeight:v.scrollHeight,fourHeight:fourth.getBoundingClientRect().bottom-t.getBoundingClientRect().top,layout:getComputedStyle(r[0]).display,cells:r.flatMap(row=>Array.from(row.cells)).map(cell=>({left:cell.getBoundingClientRect().left,right:cell.getBoundingClientRect().right})),linkHeight:v.querySelector('a').getBoundingClientRect().height,wrapped:getComputedStyle(v.querySelector('td strong')).whiteSpace}
    })
    assert.ok(geometry.pageWidth<=geometry.screen+1,`page overflow at ${width}: ${JSON.stringify(geometry)}`)
    assert.ok(geometry.clientHeight<=Math.ceil(geometry.fourHeight)+1,'maximum four rows')
    if(width<=760){
      assert.equal(geometry.layout,'grid');assert.equal(geometry.wrapped,'normal')
      assert.ok(geometry.scrollWidth<=geometry.viewportWidth+1,'no mobile horizontal scrolling')
      assert.ok(geometry.cells.every(c=>c.left>=0&&c.right<=width+1),'every field fits screen')
      assert.ok(geometry.linkHeight>=44,'touch target at least 44px')
      assert.ok(geometry.clientHeight<=height*.65+1,'detail respects phone height')
    }else{
      assert.equal(geometry.layout,'table-row');assert.ok(Math.abs(geometry.clientHeight-292)<=1,'desktop retains four 64px rows + header')
    }
    if(count>4)assert.ok(geometry.scrollHeight>geometry.clientHeight,'extra rows scroll inside')
    await viewport.scrollIntoViewIfNeeded()
    // Actual wheel input verifies that the region, rather than the page, scrolls.
    await viewport.hover();await page.mouse.wheel(0,600)
    await page.waitForFunction(()=>document.querySelector('[role="region"]').scrollTop>0)
    if(width===390){
      // Touch pan in a mobile context (same native overflow path as Android/PWA).
      const box=await viewport.boundingBox(), x=box.x+box.width/2,y=Math.min(height-30,box.y+box.height-30)
      const cdp=await context.newCDPSession(page)
      const before=await viewport.evaluate(e=>e.scrollTop)
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
      for(let dy=20;dy<=140;dy+=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.waitForFunction(before=>document.querySelector('[role="region"]').scrollTop>before,before)
      await cdp.detach()
    }
    // The final request remains reachable and navigates to the correct record.
    await viewport.focus();await page.keyboard.press('Control+End')
    const last=page.getByRole('link',{name:'Ver solicitud ↗'}).last()
    await last.scrollIntoViewIfNeeded()
    assert.equal(await last.getAttribute('href'),`/solicitudes?request_id=qa-${count}`)
    if(process.env.QA_SCREENSHOT_DIR && [390,1440].includes(width)){
      await viewport.evaluate(e=>e.scrollTop=0);await page.evaluate(()=>window.scrollTo(0,0))
      await mkdir(process.env.QA_SCREENSHOT_DIR,{recursive:true})
      await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`budget-${width}.png`),fullPage:true})
    }
    await toggle.click();assert.equal(await viewport.count(),0)
    await toggle.click();await page.locator('tbody tr').last().waitFor()
    await last.click();assert.match(page.url(),new RegExp(`request_id=qa-${count}$`))
    assert.deepEqual(errors,[])
    console.log(`PASS ${width}×${height}, ${count} requests: fit, scroll, fields, toggle, navigation`)
    await context.close()
  }
}finally{
  await browser?.close();await server?.close()
  await Promise.all([`${entry}.html`,`${entry}.tsx`].map(f=>unlink(path.join(app,f)).catch(()=>{})))
}
