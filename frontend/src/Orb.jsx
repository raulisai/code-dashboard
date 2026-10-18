import React, {useEffect, useRef} from 'react';
import {MOTION, mixColor, neuralPairs, shapeFx, shapePoints, spherePoints, tintOf} from './particles.js';
import './orb.css';

const BASE = ['#4567a0', '#698cd0', '#9ebdff', '#d3e1ff', '#e5ddff'], TINT_WEIGHTS = [0, .18, .4, .55, .68];
const RIPPLE = {ok: '#dcecff', error: '#ffb4a8', done: '#bff3dc'};
const TAU = Math.PI * 2;
// Tiempo mínimo de cada forma de actividad: los pasos muy rápidos no parpadean (volver a la esfera es inmediato).
const DWELL = 1.4;
// Ángulo equivalente más cercano (mod 2π): las formas planas vuelven de frente sin dar vueltas de más.
const nearest = value => Math.round(value / TAU) * TAU;

/**
 * Esfera de partículas. `shape` (de particles.js) la transforma según la actividad con su animación propia;
 * `pulse` ({id, tone}) lanza una onda cuando termina un paso (ok, error o done).
 */
export default function Orb({className = '', state = 'idle', level = 0, shape = 'sphere', pulse = null}) {
  const canvas = useRef(null), live = useRef({state, level, shape, pulse}), wake = useRef(null);
  live.current = {state, level, shape, pulse};
  // Con movimiento reducido no hay bucle: se redibuja al cambiar de forma o estado.
  useEffect(() => { wake.current?.(); }, [state, shape]);
  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    if (!ctx) return;
    const small = className.includes('nav-orb'), count = small ? 220 : 1250, points = spherePoints(count);
    const current = points.map(p => ({x: p.x, y: p.y, z: p.z})), cache = {}, fx = {}, old = {};
    const screenX = new Float32Array(count), screenY = new Float32Array(count), pairs = small ? [] : neuralPairs(count);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, visible = true, width = 1, time = 0, last = 0, energy = 0, yaw = 0, roll = 0, rollSpeed = 0, tilt = .35, flash = 0, links = 0;
    let active = 'sphere', previous = '', weight = 1, previousWeight = 0, palette = BASE, fromPalette = BASE, toPalette = BASE, blend = 1;
    let ripple = 0, rippleTone = 'ok', pulseId = null, activeSince = 0, previousSince = 0;
    const targetsOf = name => cache[name] ||= shapePoints(name, count);
    const paletteOf = name => BASE.map((color, index) => mixColor(color, tintOf(name), TINT_WEIGHTS[index]));
    const draw = stamp => {
      frame = 0;
      const delta = last ? Math.min(.05, (stamp - last) / 1000) : 0; last = stamp;
      const {state: mode, level: target, pulse: step} = live.current, shape = small ? 'sphere' : live.current.shape || 'sphere', still = reduced.matches;
      if (shape !== active && (still || shape === 'sphere' || active === 'sphere' || time - activeSince >= DWELL)) {
        // La forma anterior apaga su efecto poco a poco mientras las partículas viajan a la nueva.
        previous = active; previousSince = activeSince; previousWeight = still ? 0 : weight; active = shape; activeSince = time; weight = 0; flash = still ? 0 : 1;
        fromPalette = palette; toPalette = paletteOf(shape); blend = still ? 1 : 0;
      }
      if (step && step.id !== pulseId) { pulseId = step.id; if (!still) { ripple = 1; rippleTone = step.tone || 'ok'; } }
      const motion = MOTION[active] || MOTION.sphere, targets = targetsOf(active), before = previousWeight > 0 && previous ? targetsOf(previous) : null;
      energy += ((mode === 'listening' ? target : mode === 'speaking' ? .35 + .2 * Math.sin(time * 7) : 0) - energy) * .18;
      const morph = still ? 1 : 1 - Math.exp(-delta * 2.6), ease = still ? 1 : Math.min(1, delta * 2);
      if (still) { if (typeof motion.yaw !== 'number') yaw = nearest(yaw); roll = nearest(roll); }
      else {
        time += delta; flash = Math.max(0, flash - delta * 1.4); ripple = Math.max(0, ripple - delta * 1.1);
        weight = Math.min(1, weight + delta * 1.6); previousWeight = Math.max(0, previousWeight - delta * 2.5); blend = Math.min(1, blend + delta * 1.8);
        // La esfera gira más rápido al trabajar; las formas planas quedan de frente, con vaivén si lo piden.
        const working = mode === 'working' || mode === 'thinking';
        if (typeof motion.yaw === 'number') yaw += delta * (active === 'sphere' && working ? .42 : motion.yaw);
        else yaw += (nearest(yaw) + (motion.yaw === 'sway' ? Math.sin(time * .5) * .28 : 0) - yaw) * ease;
        rollSpeed += ((motion.roll || 0) - rollSpeed) * ease; roll += rollSpeed * delta;
        if (!motion.roll) roll += (nearest(roll) - roll) * ease * .6;
      }
      tilt += ((motion.tilt ?? .35 + Math.sin(time * .17) * .25) - tilt) * ease;
      links += ((active === 'neural' ? 1 : 0) - links) * ease;
      palette = blend >= 1 ? toPalette : fromPalette.map((color, index) => mixColor(color, toPalette[index], blend));
      const ratio = Math.min(devicePixelRatio || 1, small ? 2 : 1.75), size = width * ratio;
      if (el.width !== Math.round(size)) { el.width = el.height = Math.round(size); }
      ctx.clearRect(0, 0, size, size);
      const radius = size * .365, center = size / 2, cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
      // Respiración: completa en la esfera, suave en las demás formas para no deformarlas; al pensar, remolino.
      const breathe = active === 'sphere' ? 1 : active === 'neural' ? 1.6 : .3, front = (1 - ripple) * 1.5, rippleColor = RIPPLE[rippleTone] || RIPPLE.ok;
      for (let i = 0; i < count; i++) {
        const p = points[i], c = current[i], goal = targets[i];
        c.x += (goal.x - c.x) * morph; c.y += (goal.y - c.y) * morph; c.z += (goal.z - c.z) * morph;
        let ox = 0, oy = 0, alpha = 0, scale = 1, color = '';
        if (weight > 0 && !still) {
          shapeFx(active, goal, i, time - activeSince, fx);
          ox += fx.dx * weight; oy += fx.dy * weight; alpha += fx.a * weight; scale += (fx.s - 1) * weight; if (weight > .5) color = fx.c;
        }
        if (before) {
          shapeFx(previous, before[i], i, time - previousSince, old);
          ox += old.dx * previousWeight; oy += old.dy * previousWeight; alpha += old.a * previousWeight; scale += (old.s - 1) * previousWeight;
        }
        const wave = (Math.sin(p.phase * .17 + time * .9) * .07 + Math.cos(p.y * 8 + time * .6) * .045) * breathe;
        const spread = 1 + wave + energy * .14 + flash * .08 * Math.sin(p.phase + time * 9);
        const lx = c.x + ox, ly = c.y + oy, rx = lx * cr - ly * sr, ry = lx * sr + ly * cr;
        const x = rx * cy - c.z * sy, z0 = rx * sy + c.z * cy, y = ry * ct - z0 * st, z = ry * st + z0 * ct;
        const depth = Math.max(0, Math.min(1, (z + 1) / 2)), perspective = 1 + z * .12;
        // En el lienzo y crece hacia abajo: se invierte para que «arriba» en las formas sea arriba en pantalla.
        let px = x * spread * perspective, py = -y * spread * perspective, boost = 0;
        if (ripple > 0) { boost = Math.exp(-(((Math.hypot(px, py) - front) / .14) ** 2)) * ripple; px *= 1 + boost * .05; py *= 1 + boost * .05; }
        px = center + px * radius; py = center + py * radius; screenX[i] = px; screenY[i] = py;
        const dot = (small ? .43 : .52 + depth * .7) * ratio * (1 + energy * .25) * Math.max(.2, scale) * (1 + boost * .7);
        ctx.globalAlpha = Math.max(0, Math.min(1, .15 + depth * .72 + flash * .15 + alpha * (.4 + depth * .6) + boost * .6));
        if (ctx.globalAlpha < .01) continue;
        ctx.fillStyle = boost > .45 ? rippleColor : color || palette[Math.min(4, Math.max(0, Math.floor(depth * 3 + .5 + .4 * Math.sin(p.phase + time) + Math.max(0, alpha) * 2)))];
        ctx.beginPath(); ctx.arc(px, py, dot, 0, TAU); ctx.fill();
        if (!small && (depth > .92 || alpha > .4 || boost > .5)) { ctx.globalAlpha = .08; ctx.beginPath(); ctx.arc(px, py, dot * 3, 0, TAU); ctx.fill(); }
      }
      // Pensando: sinapsis que se encienden entre partículas vecinas.
      if (links > .02) {
        ctx.lineWidth = .8 * ratio; ctx.strokeStyle = palette[3];
        for (let j = 0; j < pairs.length; j++) {
          const fire = Math.sin(time * 2.3 + j * 1.618);
          if (fire < .8 && !still) continue;
          const [a, b] = pairs[j];
          ctx.globalAlpha = links * (still ? .06 : (fire - .8) * 1.8);
          ctx.beginPath(); ctx.moveTo(screenX[a], screenY[a]); ctx.lineTo(screenX[b], screenY[b]); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (!document.hidden && visible && !reduced.matches) frame = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(frame); last = 0; if (!document.hidden && visible) draw(performance.now()); };
    wake.current = () => { if (reduced.matches) restart(); };
    const observer = new ResizeObserver(entries => { width = entries[0].contentRect.width || 1; restart(); }); observer.observe(el);
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; restart(); }); intersection.observe(el);
    document.addEventListener('visibilitychange', restart); reduced.addEventListener('change', restart);
    return () => { wake.current = null; cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', restart); reduced.removeEventListener('change', restart); };
  }, [className]);
  return <span className={`orb-visual ${className}`} data-state={state} data-shape={shape} aria-hidden="true"><canvas className="orb-particles" ref={canvas}/></span>;
}
