import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import DOMPurify from 'dompurify';
import {Check, Download, ImageOff, Maximize2, TrendingDown, TrendingUp, X} from 'lucide-react';
import {api} from './lib.js';
import Markdown from './Markdown.jsx';
import {chartValues, codeOf, filePresentation, imageSources, presentationParts, progressOf, statItems} from './presentations.js';
import './live.css';

export function isolatedDocument(source) {
  const clean = DOMPurify.sanitize(String(source || '').slice(0,64000), {USE_PROFILES:{html:true,svg:true,svgFilters:true},
    FORBID_TAGS:['script','iframe','frame','object','embed','link','meta','base','form','audio','video','source','track'], FORBID_ATTR:['target','action','formaction','srcdoc','ping']});
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const el of doc.querySelectorAll('*')) for (const attr of [...el.attributes]) {
    if (/^(?:src|href|xlink:href)$/i.test(attr.name) && !attr.value.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(attr.value)) el.removeAttribute(attr.name);
  }
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0c1420;color:#dfebfc;font:15px system-ui}*{box-sizing:border-box}svg,img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #40516a}</style>${doc.body.innerHTML}`;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = t => 1 - (1 - t) ** 3;
const formatters = {};
const format = (value, decimals = 0) => (formatters[decimals] ||= new Intl.NumberFormat('es-MX', {maximumFractionDigits: decimals})).format(value);
const decimalsOf = value => Math.min(2, (String(value).split('.')[1] || '').length);
const SERIES = ['#8fb4ff', '#9fe8c9', '#c9b8ff', '#ffd59a', '#7fe0d6', '#ffb4a8', '#c8f29a', '#d6e6ff'];

/** Números que viajan suavemente a su nuevo valor; al aparecer, desde cero. */
export function useTween(values, duration = 750) {
  const [shown, setShown] = useState(() => reducedMotion() ? values : values.map(() => 0));
  const from = useRef(shown), frame = useRef(0), key = values.join('|');
  useEffect(() => {
    if (reducedMotion()) { from.current = values; setShown(values); return undefined; }
    const start = performance.now(), origin = from.current;
    const step = now => {
      const k = easeOut(Math.min(1, (now - start) / duration));
      const next = values.map((value, index) => (origin[index] ?? 0) + (value - (origin[index] ?? 0)) * k);
      from.current = next; setShown(next);
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [key]);
  return values.map((_, index) => shown[index] ?? 0);
}

// Orden de aparición: los elementos de cada tanda nueva entran escalonados desde 0.
function useBirths(count) {
  const births = useRef([]), start = births.current.length;
  for (let i = start; i < count; i++) births.current[i] = i - start;
  return births.current;
}
// Marca (contador) por posición cuando su valor cambia respecto al render anterior: sirve de key para destellar.
function useChanges(values) {
  const memory = useRef({values: null, marks: {}});
  const {values: before, marks} = memory.current;
  if (before) for (const [key, value] of Object.entries(values)) if (key in before && before[key] !== value) marks[key] = (marks[key] || 0) + 1;
  memory.current.values = values;
  return marks;
}

function Chart({spec}) {
  const variant = ['line', 'area', 'donut'].includes(spec.variant) ? spec.variant : 'bar';
  const [line, setLine] = useState(variant === 'line' || variant === 'area');
  const points = chartValues(spec), shown = useTween(points.map(point => point.value)), unit = String(spec.unit || '').slice(0, 8);
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (!points.length) return <p className="presentation-empty">Sin datos válidos.</p>;
  if (variant === 'donut') return <Donut points={points} shown={shown} unit={unit} label={spec.title}/>;
  const low = Math.min(0, ...points.map(p => p.value)), high = Math.max(0, ...points.map(p => p.value)), decimals = Math.max(...points.map(p => decimalsOf(p.value)));
  const scale = value => 170 - (value - low) / (high - low || 1) * 140, step = 348 / points.length, x = i => 38 + (i + .5) * step;
  const coords = shown.map((value, i) => `${x(i)},${scale(value)}`).join(' ');
  return <>{variant !== 'area' && <div className="chart-controls"><button onClick={() => setLine(false)} aria-pressed={!line}>Barras</button><button onClick={() => setLine(true)} aria-pressed={line}>Línea</button></div>}
    <svg className="presentation-chart" viewBox="0 0 400 205" role="img" aria-label={spec.title || 'Gráfico'}>
      <defs>
        <linearGradient id={`bar${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#b7cdff"/><stop offset="1" stopColor="#5f86d6"/></linearGradient>
        <linearGradient id={`area${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#8fb4ff" stopOpacity=".42"/><stop offset="1" stopColor="#8fb4ff" stopOpacity="0"/></linearGradient>
      </defs>
      {[0, .5, 1].map(f => <line key={f} className="chart-grid" x1="36" x2="388" y1={30 + f * 140} y2={30 + f * 140}/>)}
      <line x1="36" x2="388" y1={scale(0)} y2={scale(0)} stroke="#6682a6"/>
      <text x="2" y="34" className="chart-axis">{format(high, decimals)}</text><text x="2" y="172" className="chart-axis">{format(low, decimals)}</text>
      {line && variant === 'area' && <polygon className="chart-area" points={`${x(0)},${scale(0)} ${coords} ${x(points.length - 1)},${scale(0)}`} fill={`url(#area${id})`}/>}
      {line && <polyline className="chart-line" points={coords} fill="none" stroke="#9cbdff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>}
      {points.map((p, i) => <g key={i} tabIndex="0" className="chart-point"><title>{`${p.label}: ${format(p.value, decimals)}${unit}`}</title>
        {line ? <circle cx={x(i)} cy={scale(shown[i])} r={i === points.length - 1 ? 4 : 3} className={i === points.length - 1 ? 'chart-dot last' : 'chart-dot'}/>
          : <rect x={38 + i * step + step * .14} y={Math.min(scale(shown[i]), scale(0))} width={step * .72} height={Math.max(1, Math.abs(scale(shown[i]) - scale(0)))} rx="3" fill={`url(#bar${id})`}/>}
        {points.length <= 12 && <text x={x(i)} y={Math.min(scale(shown[i]), scale(0)) - 5} textAnchor="middle" className="chart-value">{format(shown[i], decimals)}{unit}</text>}
        {points.length <= 12 && <text x={x(i)} y="192" textAnchor="middle" className="chart-label">{p.label.slice(0, 12)}</text>}</g>)}
    </svg></>;
}

function Donut({points, shown, unit, label}) {
  const total = shown.reduce((sum, value) => sum + Math.max(0, value), 0) || 1, final = points.reduce((sum, p) => sum + Math.max(0, p.value), 0) || 1;
  const circumference = 2 * Math.PI * 52; let offset = 0;
  return <div className="donut">
    <svg viewBox="0 0 140 140" role="img" aria-label={label || 'Gráfico circular'}>
      <circle cx="70" cy="70" r="52" className="donut-track"/>
      {shown.map((value, i) => { const length = Math.max(0, value) / total * circumference * Math.min(1, total / final); const dash = <circle key={i} cx="70" cy="70" r="52" className="donut-arc"
        stroke={SERIES[i % SERIES.length]} strokeDasharray={`${Math.max(0, length - 1.5)} ${circumference}`} strokeDashoffset={-offset}><title>{`${points[i].label}: ${format(points[i].value, 2)}${unit}`}</title></circle>; offset += length; return dash; })}
      <text x="70" y="68" textAnchor="middle" className="donut-total">{format(total, 0)}</text><text x="70" y="84" textAnchor="middle" className="donut-unit">{unit || 'total'}</text>
    </svg>
    <ul className="donut-legend">{points.map((p, i) => <li key={i}><i style={{background: SERIES[i % SERIES.length]}}/><span>{p.label}</span><b>{Math.round(Math.max(0, p.value) / final * 100)} %</b></li>)}</ul>
  </div>;
}

function TableView({spec}) {
  const columns = (Array.isArray(spec.columns) ? spec.columns : []).slice(0, 12).map(String);
  const rows = (Array.isArray(spec.rows) ? spec.rows : []).slice(0, 100).map(row => (Array.isArray(row) ? row : []).slice(0, 12).map(cell => cell == null ? '' : String(cell)));
  const numeric = columns.map((_, j) => rows.length > 0 && rows.every(row => !row[j] || /^[-+]?[\d.,]+\s*%?$/.test(row[j])));
  const births = useBirths(rows.length), marks = useChanges(Object.fromEntries(rows.flatMap((row, i) => row.map((cell, j) => [`${i}:${j}`, cell]))));
  return <div className="presentation-table"><table><thead><tr>{columns.map((c, i) => <th key={i} className={numeric[i] ? 'num' : ''}>{c}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i} className="row-enter" style={{'--i': Math.min(births[i] ?? 0, 24)}}>{row.map((cell, j) => { const mark = marks[`${i}:${j}`];
      return <td key={`${j}:${mark || 0}`} className={`${numeric[j] ? 'num' : ''} ${mark ? 'cell-changed' : ''}`}>{cell}</td>; })}</tr>)}</tbody></table></div>;
}

function Spark({values}) {
  const low = Math.min(...values), high = Math.max(...values), points = values.map((value, i) => `${(i / (values.length - 1)) * 100},${26 - (value - low) / (high - low || 1) * 22}`);
  return <svg className="stat-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d={`M${points.join('L')}`} pathLength="1"/></svg>;
}

function StatsView({spec}) {
  const items = statItems(spec), shown = useTween(items.map(item => item.numeric ? item.value : 0), 900);
  const marks = useChanges(Object.fromEntries(items.map((item, i) => [i, String(item.value)])));
  return <div className="stat-grid">{items.map((item, i) => <div className="stat" key={`${i}:${marks[i] || 0}`} data-changed={marks[i] ? 'true' : undefined} style={{'--i': i}}>
    <span className="stat-label">{item.label}</span>
    <b className="stat-value">{item.numeric ? format(shown[i], decimalsOf(item.value)) : item.value}{item.unit && <small>{item.unit}</small>}</b>
    {item.delta !== null && <span className={`stat-delta ${item.delta >= 0 ? 'up' : 'down'}`}>{item.delta >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}{format(Math.abs(item.delta), 2)}</span>}
    {item.trend.length > 1 && <Spark values={item.trend}/>}
  </div>)}</div>;
}

function ProgressView({spec}) {
  const {value, steps} = progressOf(spec), [shown] = useTween([value ?? 0], 800);
  return <div className="progress-view">
    {value !== null && <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="progress-track"><i style={{width: `${shown}%`}}/></div><b>{Math.round(shown)} %</b></div>}
    {!!steps.length && <ol className="progress-steps">{steps.map((step, i) => <li key={i} className={step.status} style={{'--i': i}}>
      <span className="step-mark" key={step.status}>{step.status === 'done' ? <Check size={12}/> : step.status === 'error' ? <X size={12}/> : step.status === 'running' ? <span className="ring"/> : null}</span>{step.label}</li>)}</ol>}
  </div>;
}

function LiveImage({image, index}) {
  const [state, setState] = useState('loading');
  return <figure className={`live-image ${state}`} style={{'--i': index}}>
    <img className="presentation-image" src={image.src} alt={image.alt} decoding="async" onLoad={() => setState('ready')} onError={() => setState('error')}/>
    {state === 'error' && <span className="image-error"><ImageOff size={18}/>No se pudo cargar la imagen</span>}
    {image.caption && <figcaption>{image.caption}</figcaption>}
  </figure>;
}

function ImageView({spec}) {
  const images = imageSources(spec);
  if (!images.length) return <p className="presentation-empty">Imagen no disponible.</p>;
  return <div className={images.length > 1 ? 'image-gallery' : 'image-single'}>{images.map((image, i) => <LiveImage key={image.src} image={image} index={i}/>)}</div>;
}

function CodeView({spec}) {
  const {language, lines} = codeOf(spec), births = useBirths(lines.length);
  return <div className="code-view" data-language={language || undefined}><pre><code>{lines.map((line, i) =>
    <span className="code-line" key={i} style={{'--i': Math.min(births[i] ?? 0, 40)}}><i aria-hidden="true">{i + 1}</i>{line || ' '}{'\n'}</span>)}</code></pre></div>;
}

function FileView({spec}) {
  const file = filePresentation(spec), [data, setData] = useState(null), [error,setError] = useState('');
  const query = file?.query, image = file && ['png','jpg','jpeg','gif','webp','svg'].includes(file.ext);
  useEffect(()=>{
    let alive=true;
    if(query && !image && file.ext!=='pdf') api(`/api/files/read?${query}`).then(result=>{if(alive)setData(result);}).catch(err=>{if(alive)setError(err.message);});
    return ()=>{alive=false;};
  },[query]);
  if(!file) return <p>Archivo no admitido.</p>;
  if(error) return <p>{error}</p>;
  if(image) return <img className="presentation-image" src={`/api/files/raw?${query}`} alt={spec.title || file.path} onError={()=>setError('No se pudo cargar el archivo')}/>;
  if(file.ext==='pdf') return <p><a href={`/api/files/raw?${query}`} target="_blank" rel="noreferrer">Abrir PDF en el visor del navegador</a></p>;
  if(!data) return <p>Cargando archivo…</p>;
  if(file.ext==='html') return <iframe sandbox="" title={spec.title || 'Vista de archivo'} srcDoc={isolatedDocument(data.content)} className="presentation-frame"/>;
  if(file.ext==='md') return <Markdown text={String(data.content || '').slice(0,64000)}/>;
  return <pre>{String(data.content || '').slice(0,64000)}</pre>;
}

function Content({spec, title}) {
  switch (spec.type) {
    case 'chart': return <Chart spec={spec}/>;
    case 'table': return <TableView spec={spec}/>;
    case 'stats': return <StatsView spec={spec}/>;
    case 'progress': return <ProgressView spec={spec}/>;
    case 'image': return <ImageView spec={spec}/>;
    case 'code': return <CodeView spec={spec}/>;
    case 'file': return <FileView spec={spec}/>;
    default: return <iframe sandbox="" title={title} srcDoc={isolatedDocument(spec.html)} className="presentation-frame"/>;
  }
}

const DEFAULT_TITLES = {chart: 'Gráfica', table: 'Tabla', stats: 'Datos', progress: 'Progreso', image: 'Imagen', code: 'Código', file: 'Archivo'};
function Card({spec, version = 0}) {
  const [expanded,setExpanded] = useState(false), dialog=useRef(null);
  useEffect(()=>{ if(!expanded || !dialog.current) return; const el=dialog.current; el.showModal(); return ()=>{if(el.open)el.close();}; },[expanded]);
  const title = String(spec.title || DEFAULT_TITLES[spec.type] || 'Presentación').slice(0,120), file = spec.type==='file' ? filePresentation(spec) : null;
  return <article className="presentation-card" data-type={spec.type}>
    {version > 0 && <i className="card-pulse" key={version} aria-hidden="true"/>}
    <header><b>{title}</b><span className="grow"/>{file && <a className="icon-btn" href={`/api/files/raw?${file.query}`} target="_blank" rel="noreferrer" aria-label="Abrir archivo"><Download size={16}/></a>}<button className="icon-btn" aria-label={`Ampliar ${title}`} onClick={()=>setExpanded(true)}><Maximize2 size={16}/></button></header>
    <Content spec={spec} title={title}/>
    {expanded && <dialog ref={dialog} className="presentation-expanded" aria-label={title} onCancel={()=>setExpanded(false)}><header><b>{title}</b><button className="round-btn" onClick={()=>setExpanded(false)} aria-label="Cerrar presentación"><X size={20}/></button></header><div><Content spec={spec} title={title}/></div></dialog>}
  </article>;
}

const DRAFT_LABELS = {chart: 'Preparando una gráfica', table: 'Armando una tabla', stats: 'Calculando datos', progress: 'Actualizando el progreso',
  image: 'Preparando una imagen', code: 'Escribiendo código', html: 'Diseñando una vista', file: 'Abriendo un archivo'};
/** Tarjeta fantasma mientras el agente escribe el bloque: anticipa la forma de lo que va a mostrar. */
export function DraftCard({type}) {
  const label = DRAFT_LABELS[type] || 'Preparando una vista';
  return <article className="presentation-card draft-card" data-type={type} aria-busy="true" aria-label={label}>
    <header><b>{label}</b></header>
    {type === 'chart' || type === 'stats' || type === 'progress' ? <div className="draft-bars">{[.5, .8, .35, .95, .6, .75, .45].map((h, i) => <i key={i} style={{'--h': h, '--i': i}}/>)}</div>
      : type === 'image' ? <div className="draft-image"/>
      : <div className="draft-lines">{[.9, .7, .82, .55, .76].map((w, i) => <i key={i} style={{'--w': w, '--i': i}}/>)}</div>}
  </article>;
}

/** Vista en vivo del agente general: lo que va mostrando mientras trabaja y el resultado visual al terminar. */
export function LiveStage({cards, drafting, running, onClose}) {
  const scroller = useRef(null), count = cards.length + (drafting ? 1 : 0);
  useEffect(() => { const element = scroller.current; if (element && count) element.scrollTo({top: element.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth'}); }, [count]);
  return <section className="general-canvas" aria-label="Vista en vivo">
    <header className="canvas-head"><span className={`canvas-dot ${running ? 'on' : ''}`} aria-hidden="true"/>{running ? 'En vivo' : 'Resultado'}<span className="grow"/>
      <button className="canvas-close" onClick={onClose} aria-label="Ocultar vista en vivo" title="Ocultar"><X size={15}/></button></header>
    <div className="canvas-scroll" ref={scroller}>{cards.map(card => <Card key={card.key} spec={card.spec} version={card.version}/>)}{drafting && <DraftCard type={drafting}/>}</div>
  </section>;
}

export default function Presentations({text, visualsOnly=false, textOnly=false}) {
  const parts=useMemo(()=>presentationParts(text),[text]);
  return <div className="general-presentations">{parts.map((part,i)=>part.spec?(textOnly?null:<Card key={i} spec={part.spec}/>):!visualsOnly&&part.text.trim()?<Markdown key={i} text={part.text}/>:null)}</div>;
}
