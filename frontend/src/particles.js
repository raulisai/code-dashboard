// Nube de partículas de la esfera: formas deterministas por actividad y efectos animados por forma.
// Sin texturas, recursos externos ni aleatoriedad por frame; todo es puro para poder probarlo.

// Esfera de Fibonacci determinista.
export function spherePoints(count) {
  return Array.from({length: count}, (_, i) => {
    const y = 1 - 2 * (i + .5) / count, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
    return {x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, phase: i * 2.39996};
  });
}

const TAU = Math.PI * 2;
const frac = value => value - Math.floor(value);
const seq = (i, a, b) => frac(i * a + b);

// Forma según lo que hace el agente: tipo de herramienta (`classify`) o estado (`presence`).
const SHAPES = {web: 'globe', search: 'scan', read: 'page', edit: 'code', terminal: 'prompt', database: 'cylinder', server: 'pulse',
  docker: 'cube', package: 'cube', build: 'gear', git: 'helix', test: 'torus', agent: 'cluster', thinking: 'neural', respond: 'wave',
  chart: 'bars', visual: 'bars', table: 'grid', image: 'frame', queue: 'hourglass', approval: 'shield', stopping: 'core', error: 'shatter'};
export const shapeOf = kind => SHAPES[kind] || 'sphere';
export const SHAPE_NAMES = ['sphere', ...new Set(Object.values(SHAPES))];

// Acento de color de cada forma: sutil, se mezcla con la paleta azul de la esfera.
const TINTS = {code: '#c9b8ff', prompt: '#9fe8c9', page: '#d6e6ff', scan: '#9ee7ff', globe: '#8fd3ff', cylinder: '#7fe0d6', pulse: '#8ef0b0',
  cube: '#8cc4ff', gear: '#ffd9a0', helix: '#ffb896', torus: '#c8f29a', cluster: '#d7c6ff', neural: '#b9c8ff', wave: '#c4b5ff', bars: '#a8d8ff',
  grid: '#bfe0ff', frame: '#ffd6a8', hourglass: '#f3d9a4', shield: '#ffcf7a', core: '#ffb4a8', shatter: '#ff9e92'};
export const tintOf = shape => TINTS[shape] || '';

// Giro: número = vueltas sobre el eje vertical (rad/s); 'face' = de frente; 'sway' = de frente con vaivén.
// tilt = inclinación (null = oscilación libre); roll = giro en el plano (engranaje).
export const MOTION = {sphere: {yaw: .12, tilt: null}, neural: {yaw: .3, tilt: null}, globe: {yaw: .32, tilt: .3}, scan: {yaw: .62, tilt: .55},
  cube: {yaw: .38, tilt: .5}, helix: {yaw: .55, tilt: .18}, torus: {yaw: 1.1, tilt: .62}, wave: {yaw: .16, tilt: .95}, cluster: {yaw: .7, tilt: .4},
  code: {yaw: 'sway', tilt: .1}, prompt: {yaw: 'sway', tilt: .06}, page: {yaw: 'sway', tilt: .08}, cylinder: {yaw: .4, tilt: .42},
  pulse: {yaw: 'face', tilt: 0}, gear: {yaw: 'sway', tilt: .16, roll: .55}, bars: {yaw: 'sway', tilt: .1}, grid: {yaw: 'sway', tilt: .12},
  frame: {yaw: 'sway', tilt: .05}, hourglass: {yaw: .3, tilt: .14}, shield: {yaw: 'sway', tilt: .04}, core: {yaw: .9, tilt: .4}, shatter: {yaw: .08, tilt: .3}};

// Trazos: devuelve un punto a lo largo de una polilínea según s ∈ [0, 1).
function path(segments) {
  const lengths = segments.map(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1)), total = lengths.reduce((sum, value) => sum + value, 0);
  return s => {
    let distance = Math.min(.99999, Math.max(0, s)) * total;
    for (let j = 0; j < segments.length; j++) {
      if (distance <= lengths[j] || j === segments.length - 1) {
        const [x1, y1, x2, y2] = segments[j], f = lengths[j] ? Math.min(1, distance / lengths[j]) : 0;
        return {x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f};
      }
      distance -= lengths[j];
    }
    return {x: 0, y: 0};
  };
}
const polygon = points => path(points.map((point, j) => [...point, ...points[(j + 1) % points.length]]));

// Código: líneas con sangría y fichas de colores (palabra clave, nombre, texto), escritas en orden de lectura.
const CODE = [[0, [.22, .34, .12]], [1, [.3, .5]], [2, [.16, .2, .38]], [2, [.44, .18]], [1, [.12]], [1, [.26, .3, .14]], [2, [.5, .16]], [1, [.2]], [0, [.08]]];
const TOKEN_COLORS = ['#c9b8ff', '#9ebdff', '#9fe8c9'];
const CODE_TOKENS = [];
let codeLength = 0;
CODE.forEach(([indent, lengths], line) => {
  let x = -.86 + indent * .16;
  lengths.forEach((length, index) => {
    CODE_TOKENS.push({x, y: .72 - line * .18, length, color: TOKEN_COLORS[index === 0 ? 0 : index === lengths.length - 1 ? 2 : 1]});
    x += length + .06; codeLength += length;
  });
});
/** Punto del código en la posición de lectura k ∈ [0, 1]. */
export function codeAt(k) {
  let distance = Math.min(.9999, Math.max(0, k)) * codeLength;
  for (const token of CODE_TOKENS) { if (distance <= token.length) return {x: token.x + distance, y: token.y, color: token.color}; distance -= token.length; }
  const last = CODE_TOKENS.at(-1);
  return {x: last.x + last.length, y: last.y, color: last.color};
}

const PROMPT = path([[-.84, -.3, -.66, -.42], [-.66, -.42, -.84, -.54]]);
const OUTPUT = [[.62, 1.2], [.44, .8], [.26, 1.45], [.08, .6], [-.1, 1.02]];
const SHEET = polygon([[-.56, .74], [.36, .74], [.56, .54], [.56, -.74], [-.56, -.74]]), FOLD = path([[.36, .74, .36, .54], [.36, .54, .56, .54]]);
const PAGE_LINES = [.82, .9, .66, .86, .54, .88, .7, .8, .42];
const COLUMNS = [[-.82, .46], [-.24, .5], [.38, .44]];
const FRAME = polygon([[-.82, .58], [.82, .58], [.82, -.58], [-.82, -.58]]);
const SHIELD = polygon([[-.56, .6], [0, .74], [.56, .6], [.54, .1], [.36, -.42], [0, -.78], [-.36, -.42], [-.54, .1]]);
const tooth = value => Math.max(0, Math.min(1, (value + .25) / .5));

/** Posición objetivo (radio ~1) de cada partícula para una forma; k/g/c alimentan sus efectos. */
export function shapePoints(shape, count) {
  const sphere = spherePoints(count);
  return sphere.map((p, i) => {
    const u = seq(i, .6180339887, .13), v = seq(i, .7548776662, .37), w = seq(i, .569840291, .71), a = u * TAU, r = i % 20;
    switch (shape) {
      case 'globe': {
        // Meridianos y paralelos: un planeta de alambre mientras investiga en la web.
        if (i % 2) { const lat = (((i >> 1) % 5) - 2) * Math.PI / 6, radius = Math.cos(lat); return {x: Math.cos(a) * radius, y: Math.sin(lat), z: Math.sin(a) * radius}; }
        const lon = ((i >> 1) % 8) * Math.PI / 8, lat = (u - .5) * Math.PI;
        return {x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon)};
      }
      case 'scan': {
        // Átomo: núcleo y tres órbitas inclinadas, como un radar que busca en el código.
        if (i % 7 === 0) return {x: p.x * .22, y: p.y * .22, z: p.z * .22};
        const tilt = (i % 3) * Math.PI / 3, x = Math.cos(a), z = Math.sin(a) * .34;
        return {x: x * Math.cos(tilt) * .98, y: x * Math.sin(tilt) * .98, z, k: u};
      }
      case 'cube': {
        // Contenedor: partículas en las caras de un cubo; las caras se encienden por turnos.
        const face = i % 6, s = .66, m = (u * 2 - 1) * s, n = (v * 2 - 1) * s, sign = face % 2 ? -s : s;
        return {...(face < 2 ? {x: sign, y: m, z: n} : face < 4 ? {x: m, y: sign, z: n} : {x: m, y: n, z: sign}), g: face};
      }
      case 'helix': {
        // Doble hélice con peldaños: ramas de Git entrelazadas; la luz sube por las hebras.
        const t = u * 2 - 1, angle = u * TAU * 2.2;
        if (i % 6 === 0) { const step = Math.round(u * 16) / 16, turn = step * TAU * 2.2, k = v * 2 - 1;
          return {x: Math.cos(turn) * .42 * k, y: (step * 2 - 1) * .95, z: Math.sin(turn) * .42 * k, k: step}; }
        const side = i % 2 ? Math.PI : 0;
        return {x: Math.cos(angle + side) * .42, y: t * .95, z: Math.sin(angle + side) * .42, k: u};
      }
      case 'torus': {
        // Anillo que gira rápido mientras corren las pruebas, con un cometa que lo recorre.
        const b = v * TAU, radius = .68 + Math.cos(b) * .24;
        return {x: Math.cos(a) * radius, y: Math.sin(b) * .24, z: Math.sin(a) * radius, k: u};
      }
      case 'wave': {
        // Disco con ondas: está respondiendo.
        const radius = Math.sqrt(u) * 1.02;
        return {x: Math.cos(v * TAU) * radius, y: 0, z: Math.sin(v * TAU) * radius};
      }
      case 'cluster': {
        // Tres esferas pequeñas: subagentes trabajando a la vez; laten por turnos.
        const g = i % 3, k = g * TAU / 3;
        return {x: Math.cos(k) * .56 + p.x * .34, y: Math.sin(k) * .56 + p.y * .34, z: p.z * .34, g};
      }
      case 'code': {
        // Escribiendo código: líneas con sangría que se escriben con un cursor.
        if (i % 31 === 0) return {x: -.86, y: .72, z: 0, k: v, g: 1};
        const at = codeAt(u);
        return {x: at.x, y: at.y + (v - .5) * .035, z: (w - .5) * .08, k: u, c: at.color};
      }
      case 'prompt': {
        // Terminal: salida que sube, el indicador «>», el comando que se escribe y el cursor «_».
        if (r < 11) { const line = Math.floor(seq(i, .4142135, .2) * 5), [y, length] = OUTPUT[line];
          return {x: -.82 + u * length, y: y + (v - .5) * .03, z: (w - .5) * .06, g: 10 + line, k: u}; }
        if (r < 13) { const at = PROMPT(u); return {x: at.x, y: at.y + (v - .5) * .02, z: (w - .5) * .05, g: 2}; }
        if (r < 18) return {x: -.56 + u * 1.04, y: -.42 + (v - .5) * .035, z: (w - .5) * .06, g: 3, k: u};
        return {x: .56 + u * .18, y: -.53 + (v - .5) * .025, z: (w - .5) * .04, g: 4};
      }
      case 'page': {
        // Leyendo: una hoja con la esquina doblada y un haz que baja línea a línea.
        if (r < 7) { const at = SHEET(u); return {x: at.x, y: at.y, z: (w - .5) * .04, g: 0}; }
        if (r < 8) { const at = FOLD(u); return {x: at.x, y: at.y, z: (w - .5) * .04, g: 0}; }
        const line = Math.floor(v * PAGE_LINES.length);
        return {x: -.42 + u * PAGE_LINES[line] * .9, y: .5 - line * .135 + (w - .5) * .025, z: (w - .5) * .05, g: 1};
      }
      case 'cylinder': {
        // Base de datos: cilindro con anillos y una consulta que lo recorre.
        if (r < 9) return {x: Math.cos(a) * .62, y: (v - .5) * 1.44, z: Math.sin(a) * .62, g: 0};
        if (r < 17) { const band = [.72, .24, -.24, -.72][i % 4]; return {x: Math.cos(a) * .62, y: band, z: Math.sin(a) * .62, g: 1}; }
        const radius = Math.sqrt(v) * .6;
        return {x: Math.cos(a) * radius, y: .72, z: Math.sin(a) * radius, g: 2};
      }
      case 'pulse': {
        // Servidor: monitor con latido que recorre la línea.
        if (i % 5 === 0) return {x: Math.cos(a) * .98, y: Math.sin(a) * .98, z: 0, g: 1};
        return {x: u * 2 - 1, y: (v - .5) * .02, z: (w - .5) * .06, g: 0, k: u};
      }
      case 'gear': {
        // Compilando: engranaje con dientes, aro, cubo y radios que gira en su plano.
        if (r < 8) { const radius = .6 + .17 * tooth(Math.cos(a * 10)); return {x: Math.cos(a) * radius, y: Math.sin(a) * radius, z: (w - .5) * .1, g: 0}; }
        if (r < 10) { const flank = (Math.PI / 2 + Math.floor(v * 20) * Math.PI) / 10, radius = .6 + u * .17;
          return {x: Math.cos(flank) * radius, y: Math.sin(flank) * radius, z: (w - .5) * .1, g: 0}; }
        if (r < 13) return {x: Math.cos(a) * .44, y: Math.sin(a) * .44, z: (w - .5) * .08, g: 1};
        if (r < 16) return {x: Math.cos(a) * .17, y: Math.sin(a) * .17, z: (w - .5) * .08, g: 1};
        const spoke = Math.floor(v * 6) * TAU / 6, along = .17 + w * .27;
        return {x: Math.cos(spoke) * along, y: Math.sin(spoke) * along, z: 0, g: 2};
      }
      case 'bars': {
        // Preparando una gráfica: barras que suben y bajan sobre su eje.
        if (i % 9 === 0) return {x: u * 1.72 - .86, y: -.7, z: (w - .5) * .04, g: -1};
        const bar = Math.floor(v * 5);
        return {x: -.68 + bar * .34 + (u - .5) * .2, y: -.66 + w * 1.2, z: (seq(i, .3, .1) - .5) * .12, g: bar, k: w};
      }
      case 'grid': {
        // Armando una tabla: cabecera y celdas que se llenan fila a fila.
        if (i % 12 === 0) return {x: u * 1.66 - .83, y: .5, z: 0, g: -1};
        const cell = Math.floor(v * 18), row = Math.floor(cell / 3), [x0, width] = COLUMNS[cell % 3];
        const fill = row === 0 ? .8 : .35 + .6 * seq(cell, .618, .3);
        return {x: x0 + u * width * fill, y: .64 - row * .25 + (w - .5) * (row === 0 ? .05 : .03), z: (w - .5) * .05, g: row, k: (cell + u) / 18};
      }
      case 'frame': {
        // Preparando una imagen: marco, sol y montañas que se revelan de abajo arriba.
        if (r < 7) { const at = FRAME(u); return {x: at.x, y: at.y, z: (w - .5) * .04, g: 0}; }
        if (r < 10) { const radius = Math.sqrt(v) * .13; return {x: .4 + Math.cos(a) * radius, y: .27 + Math.sin(a) * radius, z: 0, g: 1}; }
        const [p0, p1, p2] = r < 16 ? [[-.82, -.58], [-.22, .2], [.38, -.58]] : [[.02, -.58], [.42, -.06], [.82, -.58]];
        let s1 = u, s2 = v;
        if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
        return {x: p0[0] + (p1[0] - p0[0]) * s1 + (p2[0] - p0[0]) * s2, y: p0[1] + (p1[1] - p0[1]) * s1 + (p2[1] - p0[1]) * s2, z: (w - .5) * .05, g: 2};
      }
      case 'hourglass': {
        // En cola: reloj de arena con un hilo de arena que cae.
        if (r < 12) { const up = r % 2 ? 1 : -1, y = .07 + v * .73, radius = .05 + (y - .07) * .64; return {x: Math.cos(a) * radius, y: y * up, z: Math.sin(a) * radius, g: 0}; }
        if (r < 15) return {x: Math.cos(a) * .52, y: r % 2 ? .8 : -.8, z: Math.sin(a) * .52, g: 0};
        if (r < 17) return {x: (w - .5) * .02, y: .05 - v * .62, z: 0, g: 1, k: v};
        const height = v * .22, radius = (.22 - height) * 1.6 * Math.sqrt(w);
        return {x: Math.cos(a) * radius, y: -.78 + height, z: Math.sin(a) * radius, g: 2};
      }
      case 'shield': {
        // Esperando tu permiso: escudo con cerradura que respira.
        if (r < 11) { const at = SHIELD(u); return {x: at.x, y: at.y, z: (w - .5) * .05, g: 0}; }
        if (r < 16) { const at = SHIELD(u); return {x: at.x * .74, y: at.y * .74 + .02, z: (w - .5) * .04, g: 1}; }
        if (r < 18) { const radius = Math.sqrt(v) * .1; return {x: Math.cos(a) * radius, y: .14 + Math.sin(a) * radius, z: 0, g: 2}; }
        return {x: (u - .5) * .07 * (1 - v), y: .08 - v * .3, z: 0, g: 2};
      }
      case 'core': {
        // Deteniendo: la nube se recoge en un núcleo con un anillo que se apaga.
        if (i % 7 === 0) return {x: Math.cos(a) * .62, y: 0, z: Math.sin(a) * .62, g: 1};
        return {x: p.x * .36, y: p.y * .36, z: p.z * .36, g: 0};
      }
      case 'shatter': {
        // Error: la esfera se agrieta y tiembla.
        const push = 1 + (w - .5) * .24 + (Math.sin(p.phase * 3.1) > .7 ? .12 : 0);
        return {x: p.x * push, y: p.y * push, z: p.z * push};
      }
      default: return {x: p.x, y: p.y, z: p.z};
    }
  });
}

const bump = (d, at, width, height) => height * Math.exp(-(((d - at) / width) ** 2));
const ekg = d => bump(d, -.3, .05, .09) + bump(d, -.05, .018, -.07) + bump(d, 0, .022, .48) + bump(d, .045, .022, -.2) + bump(d, .28, .07, .14);

/**
 * Efecto animado de una partícula; t = segundos desde que la nube tomó esta forma. Escribe en `out`:
 * dx/dy desplazamiento, a = brillo extra (−1 apaga), s = escala del punto, c = color propio.
 */
export function shapeFx(shape, p, i, t, out) {
  out.dx = 0; out.dy = 0; out.a = 0; out.s = 1; out.c = p.c || '';
  switch (shape) {
    case 'globe': case 'scan': {
      const lit = Math.max(0, 1 - Math.abs(p.y - Math.sin(t * 1.5) * .95) * 7);
      out.a = lit * .45; out.s = 1 + lit * .5; return out;
    }
    case 'cube': { out.a = Math.max(0, Math.sin(t * 2.2 - p.g * 1.05)) * .3 - .05; return out; }
    case 'helix': { const lit = frac(p.k * 2 - t * .5) < .12; out.a = lit ? .45 : 0; out.s = lit ? 1.3 : 1; return out; }
    case 'torus': { const lag = frac(p.k - t * .45); out.a = lag < .18 ? .5 * (1 - lag / .18) : -.1; return out; }
    case 'wave': { const d = Math.hypot(p.x, p.z); out.dy = Math.sin(d * 11 - t * 4.2) * .11 * (1 - d * .5); return out; }
    case 'cluster': { out.a = .25 * Math.max(0, Math.sin(t * 2.4 - p.g * 2.1)); out.s = 1 + out.a; return out; }
    case 'code': {
      // t cuenta desde que empezó a escribir: arranca con algo de código y completa la página en ~8 s.
      const head = .25 + frac(t / 9) * 1.05;
      if (p.g === 1) {
        const at = codeAt(Math.min(head, 1));
        out.dx = at.x + .02 - p.x; out.dy = at.y + (p.k - .5) * .13 - p.y; out.a = Math.sin(t * 7) > -.2 ? .55 : -1; out.c = '#efe9ff'; return out;
      }
      const lag = head - p.k;
      out.a = lag < 0 ? -.85 : lag < .025 ? .45 : 0; out.s = lag >= 0 && lag < .025 ? 1.6 : 1; return out;
    }
    case 'prompt': {
      const cycle = frac(t * .16);
      if (p.g === 3) { out.a = p.k < cycle * 2.4 ? .15 : -.9; out.c = '#e8f1ff'; return out; }
      if (p.g === 4) { out.a = Math.sin(t * 7.5) > 0 ? .5 : -1; out.c = '#c8f7e2'; return out; }
      if (p.g === 2) { out.a = .25; out.c = '#9fe8c9'; return out; }
      const glow = (1 - frac(t * .5 + (p.g - 10) * .17)) ** 3;
      out.a = -.45 + glow * .9; out.s = 1 + glow * .25; return out;
    }
    case 'page': {
      const beam = .74 - frac(t * .3) * 1.56, near = Math.abs(p.y - beam) < .05;
      out.a = near ? .6 : p.y > beam ? .08 : -.25; out.s = near ? 1.45 : 1; return out;
    }
    case 'cylinder': {
      const near = Math.abs(p.y - (.72 - frac(t * .45) * 1.6)) < .08;
      out.a = near ? .55 : p.g === 0 ? -.35 : 0; out.s = near ? 1.35 : 1; return out;
    }
    case 'pulse': {
      if (p.g === 1) { out.a = -.55; return out; }
      const d = p.x - (frac(t * .5) * 2.8 - 1.4), trail = d < 0 ? Math.exp(d * 3.2) : Math.exp(-d * 30);
      out.dy = ekg(d); out.a = -.5 + trail * .9; out.s = 1 + trail * .35; return out;
    }
    case 'gear': { if (p.g === 0) out.a = .12 * Math.sin(t * 3 + i); return out; }
    case 'bars': {
      if (p.g < 0) { out.a = -.2; return out; }
      const height = .25 + .75 * Math.abs(Math.sin(t * 1.05 + p.g * 1.3)) * (.65 + .35 * Math.sin(t * .6 + p.g));
      out.dy = -(1 - height) * p.k * 1.2; out.a = p.k > .96 ? .35 : 0; return out;
    }
    case 'grid': {
      if (p.g <= 0) { out.a = p.g === 0 ? .3 : -.2; return out; }
      const lag = .2 + frac(t / 7) * 1.1 - p.k;
      out.a = lag < 0 ? -.8 : lag < .05 ? .5 : 0; out.s = lag >= 0 && lag < .05 ? 1.35 : 1; return out;
    }
    case 'frame': {
      if (p.g === 0) { out.a = .1; return out; }
      const shown = (p.y + .58) / 1.16 < .25 + frac(t / 6) * 1.1;
      out.a = !shown ? -.8 : p.g === 1 ? .35 + .2 * Math.sin(t * 3) : 0; return out;
    }
    case 'hourglass': {
      if (p.g === 1) { const grain = frac(p.k * 3 - t * 1.4) < .35; out.a = grain ? .5 : -.9; out.s = 1.2; return out; }
      out.a = p.g === 2 ? .15 + .1 * Math.sin(t * 2 + p.x * 9) : -.15; return out;
    }
    case 'shield': {
      const breath = Math.sin(t * 2.1);
      out.a = p.g === 2 ? .3 + .25 * breath : p.g === 1 ? -.3 + .2 * breath : .1 * breath; return out;
    }
    case 'core': { out.a = p.g === 1 ? -.4 : .1; return out; }
    case 'shatter': {
      out.dx = Math.sin(t * 19 + i) * .008; out.dy = Math.cos(t * 23 + i * 1.7) * .008; out.a = Math.sin(t * 3 + i) > .96 ? .3 : -.1; return out;
    }
    default: return out;
  }
}

/** Pares de vecinos en la esfera de Fibonacci (i, i+21, i+34): las «sinapsis» al pensar. */
export function neuralPairs(count, step = 5) {
  const pairs = [];
  for (let i = 0; i < count; i += step) for (const offset of [21, 34]) if (i + offset < count) pairs.push([i, i + offset]);
  return pairs;
}

// Mezcla dos colores #rrggbb.
export function mixColor(from, to, amount) {
  if (!to || amount <= 0) return from;
  const parse = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from), b = parse(to), k = Math.min(1, amount);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * k).toString(16).padStart(2, '0')).join('')}`;
}
