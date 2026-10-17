/* Solo HTTPS local y tmux propio: nunca usa sesiones, credenciales o proyectos reales. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs=require('node:fs'), crypto=require('node:crypto');
const base=process.env.CM_TERMINAL_TEST_URL || 'https://127.0.0.1:13008';
if(!/^https:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Requiere instancia local aislada');
const out=process.env.CM_ARTIFACTS || 'artifacts/security-20261017';
const stateFile='/srv/platform/backups/codex-dashboard-security-check-20261017/browser-state.json';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function otp(secret){let bits='';for(const c of secret)bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=crypto.createHmac('sha1',key).update(counter).digest();return String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,args:['--ignore-certificate-errors']});
 let page;
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},ignoreHTTPSErrors:true,storageState:fs.existsSync(stateFile)?stateFile:undefined});
  if((await context.request.get(base+'/api/me')).status()!==200){
   const response=await context.request.post(base+'/api/login',{data:{user:'tester',password:'isolated-auth-browser-test'}}),login=await response.json();
   assert(login.setup_required,'La fixture requiere borrar su configuración de pruebas anterior');
   const setup=await(await context.request.post(base+'/api/security/setup',{data:{}})).json();
   const confirm=await context.request.post(base+'/api/security/confirm',{data:{code:otp(setup.secret),remember:true}});assert(confirm.status()===200,'No se pudo configurar la fixture');
   await context.storageState({path:stateFile});fs.chmodSync(stateFile,0o600);
  }
  await context.addInitScript(()=>{const Native=window.WebSocket;window.__cmTestSockets=[];window.WebSocket=class extends Native{constructor(...args){super(...args);window.__cmTestSockets.push(this);}};});
  page=await context.newPage();const errors=[],sockets=[];let output='';
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('websocket',ws=>{sockets.push(ws.url().replace(base,''));ws.on('framereceived',event=>{output+=Buffer.isBuffer(event.payload)?event.payload.toString():event.payload;});});
  await page.goto(base+'/p/codex-dashboard?tab=shell');
  await page.locator('.term-status.open').waitFor({timeout:20000});
  const input=page.getByPlaceholder('Escribe un comando y pulsa enviar');
  const tag=crypto.randomBytes(4).toString('hex'),marker='CM_SEC_'+tag;
  await input.fill("printf 'CM_SEC_%s\\n' '"+tag+"'");await input.press('Enter');
  for(let i=0;i<100&&!output.includes(marker);i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert(output.includes(marker),'No se recibió la salida real del comando');
  await input.fill("printf 'history\\n%.0s' {1..150}; printf 'CM_HIST_%s\\n' '"+tag+"'");await input.press('Enter');
  for(let i=0;i<100&&!output.includes('CM_HIST_'+tag);i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert(output.includes('CM_HIST_'+tag),'No creó historial real');
  await page.getByRole('button',{name:'Subir en el historial',exact:true}).click();
  await page.getByRole('button',{name:'Volver al directo',exact:true}).waitFor();
  await page.getByRole('button',{name:'Volver al directo',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.term-copy'));
  const beforeReconnect=sockets.length;
  await page.evaluate(()=>window.__cmTestSockets.at(-1).close(4001,'prueba de reconexion'));
  await page.locator('.term-status.closed').waitFor();await page.locator('.term-status.open').waitFor({timeout:20000});
  assert(sockets.length>beforeReconnect,'No reconectó el WebSocket');
  for(const width of [390,360,1440]){
   await page.setViewportSize({width,height:844});await page.waitForTimeout(200);
   const metrics=await page.locator('.term-host').boundingBox();assert(metrics.height>80,'La terminal tiene altura insuficiente');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Desbordamiento horizontal');
   await page.screenshot({path:out+`/terminal-${width}.png`,fullPage:true});
  }
  await page.goto(base+'/projects');
  await page.goto(base+'/p/codex-dashboard?tab=shell');await page.locator('.term-status.open').waitFor();
  await page.goto(base+'/projects');
  await page.route('**/api/term/status?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Prueba temporal de terminal no disponible'})}),{times:1});
  await page.goto(base+'/p/codex-dashboard?tab=shell');
  await page.getByText('Prueba temporal de terminal no disponible',{exact:true}).waitFor();
  await page.locator('.term-status.closed').waitFor();
  await page.getByRole('button',{name:'Reconectar',exact:true}).click();
  await page.locator('.term-status.open').waitFor();
  await page.waitForTimeout(200);
  assert(!errors.length,'Errores JavaScript: '+errors.join('; '));
  console.log('TERMINAL_BROWSER_OK: WebSocket, salida real de bash, historial/directo, reconexión automática y recuperación de error, navegación, tamaños 360/390/1440; sin agentes reales.');
 }catch(e){if(page)await page.screenshot({path:out+'/terminal-failure.png',fullPage:true}).catch(()=>{});throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
