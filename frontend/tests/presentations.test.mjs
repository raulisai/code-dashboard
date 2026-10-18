import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationParts, filePresentation, chartValues, codeOf, draftingType, imageSources, liveSpecs, progressOf, statItems} from '../src/presentations.js';
import {spherePoints} from '../src/particles.js';

test('presentaciones mezcladas con conversación y formatos inválidos',()=>{
  const parts=presentationParts('Mira esto.\n```cm-ui\n{"type":"chart","values":[1],"labels":["A"]}\n```\nListo.');
  assert.equal(parts[1].spec.type,'chart'); assert.match(parts[2].text,/Listo/);
  assert.equal(presentationParts('```cm-ui\n{"type":"script"}\n```')[0].spec,undefined);
  assert.equal(presentationParts('Texto\n```cm-ui\n{"partial":')[0].text,'Texto\n');
});
test('rutas de archivos y gráficos solo admiten datos acotados',()=>{
  for(const path of ['../.env','/etc/passwd','.git/config','hola.exe','a\\b.svg']) assert.equal(filePresentation({project:'alpha',path}),null);
  assert.equal(filePresentation({project:'alpha',path:'public/plano.svg'}).ext,'svg');
  assert.equal(chartValues({labels:['A','B','C'],values:[1,NaN,Infinity]}).length,1);
  assert.equal(chartValues({labels:[],values:Array(100).fill(1)}).length,80);
});
test('nube esférica estable y finita',()=>{
  const a=spherePoints(1250), b=spherePoints(1250);
  assert.deepEqual(a,b);
  for(const p of a) assert.ok(Number.isFinite(p.x+p.y+p.z) && Math.abs(p.x*p.x+p.y*p.y+p.z*p.z-1)<1e-9);
});
test('formas de partículas por acción: finitas, acotadas, distintas y con efectos finitos',async()=>{
  const {SHAPE_NAMES,MOTION,shapeOf,shapePoints,shapeFx,tintOf,neuralPairs,codeAt,mixColor}=await import('../src/particles.js');
  assert.equal(shapeOf('web'),'globe'); assert.equal(shapeOf('docker'),'cube'); assert.equal(shapeOf('idle'),'sphere');
  assert.equal(shapeOf('edit'),'code'); assert.equal(shapeOf('terminal'),'prompt'); assert.equal(shapeOf('database'),'cylinder');
  assert.equal(shapeOf('thinking'),'neural'); assert.equal(shapeOf('chart'),'bars'); assert.equal(shapeOf('queue'),'hourglass');
  const sphere=shapePoints('sphere',600), out={};
  for(const shape of SHAPE_NAMES){
    assert.ok(MOTION[shape], `${shape} sin movimiento`);
    const points=shapePoints(shape,600);
    assert.equal(points.length,600);
    for(const [i,p] of points.entries()){
      assert.ok(Number.isFinite(p.x+p.y+p.z) && Math.hypot(p.x,p.y,p.z)<=1.25, shape);
      for(const t of [0,1.7,9.3]){ shapeFx(shape,p,i,t,out); assert.ok(Number.isFinite(out.dx+out.dy+out.a+out.s) && Math.abs(out.dx)+Math.abs(out.dy)<=2.2, `${shape} fx`); }
    }
    const moved=points.some((p,i)=>Math.hypot(p.x-sphere[i].x,p.y-sphere[i].y,p.z-sphere[i].z)>(shape==='shatter'?.1:.3));
    if(!['sphere','neural'].includes(shape)) assert.ok(moved, `${shape} igual a la esfera`);
    if(shape!=='sphere') assert.match(tintOf(shape),/^#[0-9a-f]{6}$/);
  }
  // El código se escribe en orden de lectura: el cursor avanza por las líneas.
  assert.ok(codeAt(0).y>codeAt(.5).y && codeAt(.5).y>codeAt(1).y);
  assert.ok(neuralPairs(1250).every(([a,b])=>b<1250 && b>a));
  assert.equal(mixColor('#000000','#ffffff',.5),'#808080'); assert.equal(mixColor('#123456','',1),'#123456');
});
test('interfaz viva: tarjetas por id que se actualizan, bloques idénticos juntos y borrador en curso',()=>{
  const fence=spec=>'```cm-ui\n'+JSON.stringify(spec)+'\n```';
  const first=fence({type:'progress',id:'deploy',value:20}), table=fence({type:'table',columns:['A'],rows:[[1]]});
  const live=liveSpecs([`Empiezo.\n${first}`,`${table}`,`Sigo.\n${fence({type:'progress',id:'deploy',value:80})}`,`Listo.\n${table}`]);
  assert.deepEqual(live.cards.map(card=>[card.key.split(':')[0],card.spec.type,card.version]),[['id','progress',1],['json','table',0]]);
  assert.equal(live.cards[0].spec.value,80); assert.equal(live.drafting,'');
  assert.equal(liveSpecs(['Te muestro:\n```cm-ui\n{"type":"chart","labels":["A"'] ).drafting,'chart');
  assert.equal(draftingType('```cm-ui\n{"ti'),'visual'); assert.equal(draftingType('sin bloque'),''); assert.equal(draftingType(first),'');
  assert.equal(liveSpecs(Array.from({length:12},(_,i)=>fence({type:'stats',id:`s${i}`,items:[]}))).cards.length,8);
});
test('datos, progreso, imágenes y código se validan y acotan',()=>{
  const items=statItems({items:[{label:'CPU',value:'42.5',unit:'%',delta:-3,trend:[1,'x',3]},{label:'Estado',value:'activo'},null]});
  assert.deepEqual(items.map(item=>[item.numeric,item.value]),[[true,42.5],[false,'activo']]);
  assert.deepEqual(items[0].trend,[1,3]); assert.equal(items[0].delta,-3);
  assert.deepEqual(progressOf({steps:[{label:'a',status:'completed'},{content:'b',status:'in_progress'},{label:'c'}]}),{value:1/3*100,steps:[{label:'a',status:'done'},{label:'b',status:'running'},{label:'c',status:'pending'}]});
  assert.equal(progressOf({value:180}).value,100);
  const images=imageSources({images:[{media:'captura.png',caption:'Hola'},{media:'../x.png'},{media:'.oculta.png'},{project:'alpha',path:'public/a.webp'},{project:'alpha',path:'notas.md'},
    {src:'data:image/png;base64,iVBORw0KGgo='},{src:'https://evil.invalid/x.png'},{src:'data:text/html;base64,PHNjcmlwdD4='}]});
  assert.deepEqual(images.map(image=>image.src),['/api/media/captura.png','/api/files/raw?project=alpha&path=public%2Fa.webp','data:image/png;base64,iVBORw0KGgo=']);
  assert.equal(imageSources({media:'FOTO.JPG'})[0].src,'/api/media/FOTO.JPG');
  assert.deepEqual(codeOf({language:'js<script>',code:'a\r\nb'}),{language:'jsscript',lines:['a','b']});
  assert.equal(codeOf({code:'x\n'.repeat(900)}).lines.length,400);
  assert.equal(presentationParts('```cm-ui\n{"type":"stats","items":[]}\n```')[0].spec.type,'stats');
});
