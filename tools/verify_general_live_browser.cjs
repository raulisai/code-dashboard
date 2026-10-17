/* Voz nativa simulada + renderer real. Nunca envía tareas ni audio a producción. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs=require('node:fs');
const base=process.env.CM_TEST_URL || 'http://127.0.0.1:4178', out=process.env.CM_ARTIFACTS || 'artifacts/general-live-next-20261017';
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['microphone'],serviceWorkers:'allow'});
  await context.addInitScript(()=>{
   window.recognizers=[];window.spoken=[];
   class Recognition {
    constructor(){window.recognizers.push(this);}
    start(){this.active=true;setTimeout(()=>{if(this.active)this.onstart?.();},5);}
    emit(text){const result=[{transcript:text}];result.isFinal=false;this.onresult?.({results:[result]});}
    stop(){this.active=false;this.onend?.();}
    abort(){this.active=false;this.onerror?.({error:'aborted'});this.onend?.();}
   }
   window.SpeechRecognition=Recognition;window.webkitSpeechRecognition=undefined;
   Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,cancel(){},speak(utterance){if(utterance.text)window.spoken.push(utterance.text);setTimeout(()=>utterance.onend?.(),20);}}});
  });
  const page=await context.newPage(), errors=[], posts=[], leaks=[];
  let agent={rev:'1',runs:[],queue:[],working:[],settings:{default_provider:'codex'}};
  page.on('pageerror',e=>errors.push(e.stack || String(e)));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/sw.js') return route.fulfill({contentType:'application/javascript',body:'self.addEventListener("install",()=>self.skipWaiting());'});
   if(url.hostname==='evil.invalid'){leaks.push(url.href);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   let result={};
   if(url.pathname==='/api/state')result={projects:[{name:'alpha',running_containers:1,working:[],containers:[],container_details:[],queued:0}],task_records:[],approvals:[],memory:{},disk:{},tmux:[],automation:{},cpu:{percent:10},settings:{default_provider:'codex'},tmux_ok:true,docker_ok:true};
   else if(url.pathname==='/api/agent')result=agent;
   else if(url.pathname==='/api/agent/send'){
    posts.push(route.request().postDataJSON());
    agent={...agent,rev:'2',working:[{id:'voice-id'}],runs:[{id:'r-voice',task_id:'voice-id',prompt:posts.at(-1).text,provider:'claude',status:'running',approvals:[],events:[]}]};
    result={task:{id:'voice-id'}};
   } else if(url.pathname==='/api/files/raw')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="lightblue"/><text x="10" y="50">Archivo plano</text></svg>'});
   return route.fulfill({json:result});
  });
  await page.goto(base+'/agent');
  await page.getByRole('button',{name:'Hablar con el agente general'}).click();
  await page.waitForFunction(()=>window.recognizers[0]?.active);
  await page.evaluate(()=>window.recognizers[0].emit('Revisa el'));
  await page.locator('.live-transcript',{hasText:'Revisa el'}).waitFor();
  const started=Date.now();
  await page.evaluate(()=>{window.recognizers[0].emit('Revisa el servidor');window.recognizers[0].stop();});
  for(let i=0;i<30&&!posts.length;i++)await page.waitForTimeout(50);
  assert(posts.length===1&&posts[0].text==='Revisa el servidor','No envió una sola vez la frase nativa');
  assert(Date.now()-started<1800,'El envío conserva una espera artificial larga');
  agent={...agent,rev:'3',working:[],runs:[{...agent.runs[0],status:'done',result:{text:'Listo. El servidor está en línea.'}}]};
  await page.waitForFunction(()=>window.recognizers.length>=2&&window.recognizers[1].active,null,{timeout:8000});
  assert(await page.evaluate(()=>window.spoken.some(x=>x.includes('El servidor'))),'No leyó la respuesta');
  // El navegador falla: vuelve al micrófono local y sigue permitiendo detenerlo.
  await page.evaluate(()=>window.recognizers.at(-1).onerror({error:'network'}));
  await page.locator('.live-transcript',{hasText:'Voz local'}).waitFor({timeout:8000});
  await page.getByRole('button',{name:'Terminar conversación',exact:true}).click();
  assert(posts.length===1,'Duplicó la frase al cambiar el motor de voz');
  const fence=spec=>'```cm-ui\n'+JSON.stringify(spec)+'\n```';
  agent={...agent,rev:'4',runs:[{...agent.runs[0],result:{text:'Te muestro el plano y los datos.\n'+[
   {type:'chart',title:'Consumo',labels:['A','B'],values:[3,8]},
   {type:'html',title:'Plano seguro',html:'<h1>Plano de prueba</h1><svg viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" fill="lightblue"/></svg><script>parent.hacked=1</script><img src="https://evil.invalid/leak"><meta http-equiv="refresh" content="0;url=https://evil.invalid/nav"><a href="javascript:parent.hacked=1">Acción</a>'},
   {type:'table',title:'Resumen',columns:['Nombre','Valor'],rows:[['A',3],['B',8]]},
   {type:'file',title:'Archivo SVG',project:'alpha',path:'public/plano.svg'}
  ].map(fence).join('\n')}}]};
  await page.locator('.presentation-card',{hasText:'Consumo'}).waitFor({timeout:8000});
  assert(await page.locator('.presentation-card').count()===4,'No renderizó las cuatro presentaciones');
  await page.getByRole('button',{name:'Línea',exact:true}).click();
  assert(await page.locator('.presentation-chart polyline').count()===1,'El gráfico no responde');
  const iframe=page.locator('iframe[title="Plano seguro"]');
  assert(await iframe.getAttribute('sandbox')==='','El HTML no está aislado');
  const frame=page.frameLocator('iframe[title="Plano seguro"]');
  await frame.getByText('Plano de prueba',{exact:true}).waitFor();
  assert(await frame.locator('script,meta[http-equiv="refresh"],img[src^="https:"]').count()===0,'Contenido activo no saneado');
  assert(await page.evaluate(()=>window.hacked===undefined),'La UI accedió al panel');
  assert(leaks.length===0,'La UI abrió conexiones externas');
  await page.waitForFunction(()=>document.querySelector('.presentation-image')?.naturalWidth>0);
  await page.screenshot({path:out+'/presentations-390.png',fullPage:true});
  await page.getByRole('button',{name:'Ampliar Consumo'}).click();
  await page.getByRole('dialog',{name:'Consumo',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert(await page.getByRole('dialog',{name:'Consumo',exact:true}).count()===0,'Escape no cierra la presentación');
  agent={...agent,rev:'5',runs:[{...agent.runs[0],status:'error',result:null,error:'Límite de uso',providers_tried:'codex,claude'}]};
  await page.getByRole('heading',{name:'Ahora no hay conexión disponible'}).waitFor({timeout:8000});
  assert(errors.length===0,errors.join('\n'));
  await context.close();
  console.log('GENERAL_LIVE_OK: voz en vivo, envío inmediato, turnos, motor local, gráficos/HTML/tabla/archivo, aislamiento y agotamiento doble');
 } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
