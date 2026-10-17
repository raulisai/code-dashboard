/* UI real, API simulada. No envía peticiones a agentes ni modifica proyectos. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/responsive-20261018';
const assert = (value, message) => {if (!value) throw Error(message);};
const name = 'codex-dashboard';
const tasks = ['working', 'espera', 'error'].map((status, i) => ({id: `fixture-${i}`, project: name, provider: 'codex', status, title: 'Revisar el estado de la aplicación y los servicios con un título bastante largo para probar el móvil', date: '2026-10-18', priority: 'normal', result: status === 'error' ? 'No se pudo conectar al servicio de prueba' : ''}));
const services = [1,2].map(i => ({Id: `service-${i}`, Names: [`/${name}-servicio-con-nombre-largo-${i}`], Image: 'example/una-imagen-con-nombre-largo:latest', Status: 'Up 1 hour (healthy)', State: i===1?'running':'exited', Project:name, Urls:['https://codex-dashboard.devdj.lat'], MemoryUsage:5000000}));
const details = services.map(c => ({id:c.Id,name:c.Names[0].slice(1),state:c.State,status:c.Status,image:c.Image,memory:c.MemoryUsage}));
const project = {name, description:'Panel para administrar proyectos, agentes y aplicaciones desde cualquier dispositivo.',url:'https://preview.example.test',running_containers:1,container_details:details,working:[tasks[0]],queued:1,activity:10,protected:true,stack:'web',containers:services};
let state = {projects:[project,{...project,name:'mi-app',description:'Segunda aplicación',working:[],running_containers:0,container_details:[],activity:1}],task_records:tasks,approvals:[],docker:services,memory:{total_kb:8000000,available_kb:4000000},disk:{percent:'32%',used:'10 GB',total:'30 GB',free:'20 GB'},cpu:{percent:14,cores:4,load_1m:.3},sessions:[{name:`${name}-shell`,command:'bash',attached:false}],automation:{last_message:'Todo al día'},tmux_ok:true,docker_ok:true,stacks:{auto:'La IA decide',web:'Web',react:'React'},settings:{default_provider:'codex',claude_permission:'auto',codex_sandbox:'full',claude_model:'',codex_model:'',auto_commit:'on'},domain:'devdj.lat'};
const agent = {rev:'1',runs:[],queue:[],working:[],sessions:{},settings:state.settings,rules:[]};
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true});try{
for(const width of (process.env.CM_TEST_WIDTHS || '320,360,390,600,768,1024,1440').split(',').map(Number)){
const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',locale:'es-MX'});const page=await context.newPage();const errors=[];
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route('https://preview.example.test/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Vista previa de prueba</h1>'}));
await page.routeWebSocket('**/api/term**', ws => {ws.send(JSON.stringify({t:'o',d:'Terminal de prueba\r\n'}));});
await page.route('**/api/**',route=>{const u=new URL(route.request().url());let data={};
if(u.pathname==='/api/state') data=state;
else if(u.pathname==='/api/agent')data=agent;
else if(u.pathname==='/api/agent/chats')data={chats:[{id:'main',title:'Chat principal',working:0,queued:0}]};
else if(u.pathname==='/api/security')data={totp_enabled:true,recovery_remaining:8,sessions:[]};
else if(u.pathname==='/api/github')data={connected:false};
else if(u.pathname==='/api/projects/trash')data={projects:[]};
else if(u.pathname==='/api/files/list')data={entries:[]};
else if(u.pathname==='/api/jobs')data={jobs:[]};
else if(u.pathname==='/api/git')data={available:true,repo:false,changes:[],branches:[]};
else if(u.pathname==='/api/git/log')data={commits:[],more:false};
else if(u.pathname==='/api/logs')data={entries:[]};
else if(u.pathname==='/api/voice')data={ready:true,local:true};
return route.fulfill({json:data});});
for(const [path,selector] of [['/projects','.project-status-grid'],['/','.dashboard-home'],['/queue','.task-list'],['/server','.container-list'],['/settings','.settings'],['/new','.create'],['/agent','.general'],['/p/codex-dashboard?tab=agent','.panel-agent'],['/p/codex-dashboard?tab=files','.panel-files'],['/p/codex-dashboard?tab=console','.panel-console'],['/p/codex-dashboard?tab=deploy','.panel-deploy'],['/p/codex-dashboard?tab=git','.panel-git'],['/p/codex-dashboard?tab=preview','.panel-preview'],['/p/codex-dashboard?tab=shell','.panel-shell']]){
await page.goto(base+path,{waitUntil:'domcontentloaded'});await page.locator(selector).first().waitFor().catch(async err=>{await page.screenshot({path:`${out}/failure-${width}.png`,fullPage:true});console.error(await page.locator('body').innerText());throw err;});await page.waitForTimeout(120);
const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+2 && getComputedStyle(el).position!=='fixed').slice(0,6).map(el=>el.className)}));
assert(overflow.scroll<=width+1,`${width} ${path}: ${JSON.stringify(overflow)}`);
if(path==='/projects'){
assert(await page.locator('.project-identity h2').innerText()===name,'Proyecto incorrecto');
assert((await page.locator('.project-online').innerText()).includes('Parcialmente activa'),'Estado parcial ausente');
assert(await page.locator('.project-tool-dock a').count()===7,'Faltan herramientas');
assert(await page.locator('.project-thumbnail').evaluate(el=>el.getBoundingClientRect().height)<=64,'Imagen excesiva');
if(width<700){await page.screenshot({path:`${out}/projects-check-${width}.png`,fullPage:true});const rect=await page.locator('.project-tool-dock').boundingBox();assert(rect.y<650,`Herramientas muy abajo: ${rect.y}`);}
await page.getByLabel('Buscar proyecto',{exact:true}).fill(' no-existe ');await page.getByText('No hay coincidencias',{exact:true}).waitFor();
await page.getByRole('button',{name:'Limpiar búsqueda',exact:true}).first().click();await page.locator('#selected-project').selectOption('mi-app');assert((await page.locator('.project-online').innerText()).includes('Sin desplegar'),'Estado vacío incorrecto');await page.locator('#selected-project').selectOption(name);
await page.getByRole('button',{name:'Proyecto siguiente',exact:true}).click();assert((await page.locator('.project-identity h2').innerText())==='mi-app','Siguiente no cambia');await page.getByRole('button',{name:'Proyecto anterior',exact:true}).click();
await page.locator('.project-tool-dock').getByRole('link',{name:'Archivos',exact:true}).click();await page.locator('.panel-files').waitFor();await page.goto(base+'/projects');await page.locator('.project-status-grid').waitFor();
}
if([360,390,768,1440].includes(width))await page.screenshot({path:`${out}/${path.replace(/[^a-z0-9]/gi,'_')||'home'}-${width}.png`,fullPage:true});
}
assert(!errors.length,`${width}: ${errors.join('; ')}`);console.log(`RESPONSIVE_OK ${width}px: 14 vistas, búsqueda, selección, estados y herramientas`);await context.close();
}
// Sin proyectos: se conserva creación y búsqueda sin errores.
state={...state,projects:[],task_records:[],docker:[],sessions:[]};const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/state'?state:{}}));await page.goto(base+'/projects');await page.getByText('Tu próximo proyecto empieza aquí',{exact:true}).waitFor();assert(await page.getByRole('link',{name:'Nuevo proyecto',exact:true}).isVisible(),'Falta crear en vacío');await context.close();console.log('RESPONSIVE_BROWSER_OK');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
