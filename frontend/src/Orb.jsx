import React, {useEffect, useRef} from 'react';
import {shapePoints, spherePoints} from './particles.js';
import './orb.css';

// Velocidad de giro e inclinación de cada forma (la esfera respira; el anillo de pruebas corre).
const MOTION = {sphere: {speed: .12, tilt: null}, globe: {speed: .32, tilt: .3}, scan: {speed: .62, tilt: .55}, cube: {speed: .38, tilt: .5},
  helix: {speed: .55, tilt: .18}, torus: {speed: 1.1, tilt: .62}, wave: {speed: .16, tilt: .95}, cluster: {speed: .7, tilt: .4}};

export default function Orb({className = '', state = 'idle', level = 0, shape = 'sphere'}) {
  const canvas = useRef(null), live = useRef({state, level, shape}), wake = useRef(null);
  live.current = {state, level, shape};
  // Con movimiento reducido no hay bucle: se redibuja al cambiar de forma o estado.
  useEffect(() => { wake.current?.(); }, [state, shape]);
  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    if (!ctx) return;
    const small = className.includes('nav-orb'), count = small ? 220 : 1250, points = spherePoints(count);
    const current = points.map(p => ({x: p.x, y: p.y, z: p.z})), cache = {};
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), palette = ['#4567a0', '#698cd0', '#9ebdff', '#d3e1ff', '#e5ddff'];
    let frame = 0, visible = true, width = 1, time = 0, last = 0, energy = 0, spin = 0, tilt = .35, flash = 0, previousShape = 'sphere';
    const draw = stamp => {
      frame = 0;
      const delta = last ? Math.min(.05, (stamp - last) / 1000) : 0; last = stamp;
      const {state: mode, level: target} = live.current, shape = small ? 'sphere' : live.current.shape || 'sphere';
      const motion = MOTION[shape] || MOTION.sphere, targets = cache[shape] ||= shapePoints(shape, count);
      energy += ((mode === 'listening' ? target : mode === 'speaking' ? .35 + .2 * Math.sin(time * 7) : 0) - energy) * .18;
      const thinking = mode === 'thinking', speed = shape === 'sphere' ? (mode === 'working' || thinking ? .42 : .12) : motion.speed;
      const still = reduced.matches, morph = still ? 1 : 1 - Math.exp(-delta * 2.6);
      if (shape !== previousShape) { flash = still ? 0 : 1; previousShape = shape; }
      if (!still) { time += delta; spin += delta * speed; flash = Math.max(0, flash - delta * 1.4); }
      const baseTilt = motion.tilt ?? .35 + Math.sin(time * .17) * .25;
      tilt += (baseTilt - tilt) * (still ? 1 : Math.min(1, delta * 2));
      const ratio = Math.min(devicePixelRatio || 1, small ? 2 : 1.75), size = width * ratio;
      if (el.width !== Math.round(size)) { el.width = el.height = Math.round(size); }
      ctx.clearRect(0, 0, size, size);
      const radius = size * .365, center = size / 2, cos = Math.cos(spin), sin = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
      // Banda de escaneo para investigar/revisar; destello al cambiar de forma.
      const scanning = shape === 'globe' || shape === 'scan', band = Math.sin(time * 1.5) * .95;
      const ripple = shape === 'sphere' ? 1 : .3, swirl = thinking && shape === 'sphere' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const p = points[i], c = current[i], goal = targets[i];
        c.x += (goal.x - c.x) * morph; c.y += (goal.y - c.y) * morph; c.z += (goal.z - c.z) * morph;
        const wave = (Math.sin(p.phase * .17 + time * .9) * .07 + Math.cos(p.y * 8 + time * .6) * .045) * ripple * swirl;
        const spread = 1 + wave + energy * .14 + flash * .08 * Math.sin(p.phase + time * 9);
        let lift = c.y;
        if (shape === 'wave') { const d = Math.hypot(c.x, c.z); lift += Math.sin(d * 11 - time * 4.2) * .11 * (1 - d * .5); }
        const x = c.x * cos - c.z * sin, z0 = c.x * sin + c.z * cos;
        const y = lift * ct - z0 * st, z = lift * st + z0 * ct;
        const depth = Math.max(0, Math.min(1, (z + 1) / 2)), perspective = 1 + z * .12;
        const px = center + x * radius * spread * perspective, py = center + y * radius * spread * perspective;
        const lit = scanning ? Math.max(0, 1 - Math.abs(c.y - band) * 7) : 0;
        const dot = (small ? .43 : .52 + depth * .7) * ratio * (1 + energy * .25 + lit * .5);
        ctx.globalAlpha = Math.min(1, .15 + depth * .72 + lit * .45 + flash * .15);
        ctx.fillStyle = palette[Math.min(4, Math.floor(depth * 3 + .5 + .4 * Math.sin(p.phase + time) + lit * 2))];
        ctx.beginPath(); ctx.arc(px, py, dot, 0, Math.PI * 2); ctx.fill();
        if (!small && (depth > .92 || lit > .7)) { ctx.globalAlpha = .08; ctx.beginPath(); ctx.arc(px, py, dot * 3, 0, Math.PI * 2); ctx.fill(); }
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
