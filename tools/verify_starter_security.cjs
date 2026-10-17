/* Genera una plantilla desechable y prueba HTTP real, siempre en loopback. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'cm-starter-security-'));
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
(async()=>{
 let child;
 try{
  const generate="from pathlib import Path\nfrom cm.projects import scaffold_files\nfor name,content in scaffold_files('cm-audit-starter','Static test','node').items():\n p=Path('/out')/name\n p.parent.mkdir(parents=True,exist_ok=True)\n p.write_text(content)\n";
  execFileSync('docker',['run','--rm','-v',root+':/src:ro','-v',fixture+':/out','-w','/src','codex-dashboard-dashboard','python','-c',generate],{stdio:'pipe'});
  const file=path.join(fixture,'server.js');
  const source=fs.readFileSync(file,'utf8').replace(".listen(3000, () => console.log('Escuchando en el puerto 3000'));", ".listen(0, '127.0.0.1', function(){console.log('PORT:'+this.address().port);});");
  assert(source.includes('listen(0'),'No adaptó el puerto de la plantilla');fs.writeFileSync(file,source);
  fs.writeFileSync(path.join(fixture,'private-test.txt'),'CM_PRIVATE_CANARY');
  fs.symlinkSync(path.join(fixture,'private-test.txt'),path.join(fixture,'public/leak.txt'));
  child=spawn(process.execPath,['server.js'],{cwd:fixture,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('No inició el servidor de plantilla')),5000);let buffer='';
   child.stdout.on('data',data=>{buffer+=data;const match=buffer.match(/PORT:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
   child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(Error('La plantilla terminó inesperadamente'));});
  });
  const get=pathname=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:pathname},response=>{let body='';response.on('data',d=>body+=d);response.on('end',()=>resolve({status:response.statusCode,body}));}).on('error',reject);});
  assert((await get('//')).status===400,'La URL inválida no se rechazó');
  assert((await get('/%zz')).status===400,'La codificación inválida no se rechazó');
  for(const pathname of ['/leak.txt','/%2e%2e%2fprivate-test.txt']){
   const response=await get(pathname);assert(response.status===403&&!response.body.includes('CM_PRIVATE_CANARY'),'La plantilla expone archivos fuera de public');
  }
  assert((await get('/')).status===200,'El servidor dejó de responder tras una URL malformada');
  assert((await get('/api/health')).status===200,'Health de plantilla roto');
  console.log('STARTER_SECURITY_OK: URL inválida no derriba el servidor; traversal y enlaces externos rechazados; sitio y health operativos.');
 }finally{
  if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}
  fs.rmSync(fixture,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
