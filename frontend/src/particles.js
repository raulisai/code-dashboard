// Esfera de Fibonacci determinista: sin texturas, recursos externos ni aleatoriedad por frame.
export function spherePoints(count) {
  return Array.from({length: count}, (_, i) => {
    const y = 1 - 2 * (i + .5) / count, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
    return {x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, phase: i * 2.39996};
  });
}

// Formas de la esfera según lo que hace el agente (tipo de herramienta de `classify`).
const SHAPES = {web: 'globe', read: 'scan', docker: 'cube', package: 'cube', build: 'cube', git: 'helix', test: 'torus', edit: 'wave', agent: 'cluster'};
export const shapeOf = kind => SHAPES[kind] || 'sphere';

const frac = value => value - Math.floor(value);
const TAU = Math.PI * 2;
/** Posición objetivo (radio ~1) de cada partícula para una forma; deterministas para poder probarlas. */
export function shapePoints(shape, count) {
  const sphere = spherePoints(count);
  return sphere.map((p, i) => {
    const u = frac(i * .6180339887 + .13), v = frac(i * .7548776662 + .37), a = u * TAU;
    switch (shape) {
      case 'globe': {
        // Meridianos y paralelos: un planeta de alambre mientras investiga en la web.
        if (i % 2) { const lat = (((i >> 1) % 5) - 2) * Math.PI / 6, r = Math.cos(lat); return {x: Math.cos(a) * r, y: Math.sin(lat), z: Math.sin(a) * r}; }
        const lon = ((i >> 1) % 8) * Math.PI / 8, lat = (u - .5) * Math.PI;
        return {x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon)};
      }
      case 'scan': {
        // Átomo: núcleo y tres órbitas inclinadas, como un radar que revisa el código.
        if (i % 7 === 0) return {x: p.x * .22, y: p.y * .22, z: p.z * .22};
        const tilt = (i % 3) * Math.PI / 3, x = Math.cos(a), z = Math.sin(a) * .34;
        return {x: x * Math.cos(tilt) * .98, y: x * Math.sin(tilt) * .98, z: z};
      }
      case 'cube': {
        // Contenedor: partículas en las caras de un cubo.
        const face = i % 6, s = .66, m = (u * 2 - 1) * s, n = (v * 2 - 1) * s, sign = face % 2 ? -s : s;
        return face < 2 ? {x: sign, y: m, z: n} : face < 4 ? {x: m, y: sign, z: n} : {x: m, y: n, z: sign};
      }
      case 'helix': {
        // Doble hélice con peldaños: ramas de Git entrelazadas.
        const t = u * 2 - 1, angle = u * TAU * 2.2;
        if (i % 6 === 0) { const step = Math.round(u * 16) / 16, ang = step * TAU * 2.2, k = v * 2 - 1;
          return {x: Math.cos(ang) * .42 * k, y: (step * 2 - 1) * .95, z: Math.sin(ang) * .42 * k}; }
        const side = i % 2 ? Math.PI : 0;
        return {x: Math.cos(angle + side) * .42, y: t * .95, z: Math.sin(angle + side) * .42};
      }
      case 'torus': {
        // Anillo que gira rápido mientras corren las pruebas.
        const b = v * TAU, r = .68 + Math.cos(b) * .24;
        return {x: Math.cos(a) * r, y: Math.sin(b) * .24, z: Math.sin(a) * r};
      }
      case 'wave': {
        // Disco plano: al editar se le añaden ondas en el dibujo.
        const r = Math.sqrt(u) * 1.02;
        return {x: Math.cos(v * TAU) * r, y: 0, z: Math.sin(v * TAU) * r};
      }
      case 'cluster': {
        // Tres esferas pequeñas: subagentes trabajando a la vez.
        const k = (i % 3) * TAU / 3;
        return {x: Math.cos(k) * .56 + p.x * .34, y: Math.sin(k) * .56 + p.y * .34, z: p.z * .34};
      }
      default: return {x: p.x, y: p.y, z: p.z};
    }
  });
}
