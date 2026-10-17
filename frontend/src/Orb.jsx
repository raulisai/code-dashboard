import React, {useEffect, useRef} from 'react';
import {spherePoints} from './particles.js';
import './orb.css';

export default function Orb({className = '', state = 'idle', level = 0}) {
  const canvas = useRef(null), live = useRef({state, level});
  live.current = {state, level};
  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    if (!ctx) return;
    const small = className.includes('nav-orb'), points = spherePoints(small ? 220 : 1250);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), palette = ['#4567a0', '#698cd0', '#9ebdff', '#d3e1ff', '#e5ddff'];
    let frame = 0, visible = true, width = 1, time = 0, last = 0, energy = 0, spin = 0;
    const draw = stamp => {
      frame = 0;
      const delta = last ? Math.min(.05, (stamp - last) / 1000) : 0; last = stamp;
      const {state: mode, level: target} = live.current;
      energy += ((mode === 'listening' ? target : mode === 'speaking' ? .35 + .2 * Math.sin(time * 7) : 0) - energy) * .18;
      const speed = mode === 'working' || mode === 'thinking' ? .42 : .12;
      if (!reduced.matches) { time += delta; spin += delta * speed; }
      const ratio = Math.min(devicePixelRatio || 1, small ? 2 : 1.75), size = width * ratio;
      if (el.width !== Math.round(size)) { el.width = el.height = Math.round(size); }
      ctx.clearRect(0, 0, size, size);
      const radius = size * .365, center = size / 2, cos = Math.cos(spin), sin = Math.sin(spin);
      const tilt = .35 + Math.sin(time * .17) * .25, ct = Math.cos(tilt), st = Math.sin(tilt);
      for (const p of points) {
        const wave = Math.sin(p.phase * .17 + time * .9) * .07 + Math.cos(p.y * 8 + time * .6) * .045;
        const spread = 1 + wave + energy * .14;
        const x = p.x * cos - p.z * sin, z0 = p.x * sin + p.z * cos;
        const y = p.y * ct - z0 * st, z = p.y * st + z0 * ct;
        const depth = (z + 1) / 2, perspective = 1 + z * .12;
        const px = center + x * radius * spread * perspective, py = center + y * radius * spread * perspective;
        const dot = (small ? .43 : .52 + depth * .7) * ratio * (1 + energy * .25);
        ctx.globalAlpha = .15 + depth * .72;
        ctx.fillStyle = palette[Math.min(4, Math.floor(depth * 3 + .5 + .4 * Math.sin(p.phase + time)))];
        ctx.beginPath(); ctx.arc(px, py, dot, 0, Math.PI * 2); ctx.fill();
        if (!small && depth > .92) { ctx.globalAlpha = .08; ctx.beginPath(); ctx.arc(px, py, dot * 3, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      if (!document.hidden && visible && !reduced.matches) frame = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(frame); last = 0; if (!document.hidden && visible) draw(performance.now()); };
    const observer = new ResizeObserver(entries => { width = entries[0].contentRect.width || 1; restart(); }); observer.observe(el);
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; restart(); }); intersection.observe(el);
    document.addEventListener('visibilitychange', restart); reduced.addEventListener('change', restart);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', restart); reduced.removeEventListener('change', restart); };
  }, [className]);
  return <span className={`orb-visual ${className}`} data-state={state} aria-hidden="true"><canvas className="orb-particles" ref={canvas}/></span>;
}
