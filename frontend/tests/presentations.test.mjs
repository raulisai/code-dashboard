import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationParts, filePresentation, chartValues} from '../src/presentations.js';
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
