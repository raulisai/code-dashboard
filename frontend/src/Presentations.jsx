import React, {useEffect, useMemo, useRef, useState} from 'react';
import DOMPurify from 'dompurify';
import {Download, Maximize2, X} from 'lucide-react';
import {api} from './lib.js';
import Markdown from './Markdown.jsx';
import {chartValues, filePresentation, presentationParts} from './presentations.js';

export function isolatedDocument(source) {
  const clean = DOMPurify.sanitize(String(source || '').slice(0,64000), {USE_PROFILES:{html:true,svg:true,svgFilters:true},
    FORBID_TAGS:['script','iframe','frame','object','embed','link','meta','base','form','audio','video','source','track'], FORBID_ATTR:['target','action','formaction','srcdoc','ping']});
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const el of doc.querySelectorAll('*')) for (const attr of [...el.attributes]) {
    if (/^(?:src|href|xlink:href)$/i.test(attr.name) && !attr.value.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(attr.value)) el.removeAttribute(attr.name);
  }
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0c1420;color:#dfebfc;font:15px system-ui}*{box-sizing:border-box}svg,img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #40516a}</style>${doc.body.innerHTML}`;
}

function Chart({spec}) {
  const [line, setLine] = useState(spec.variant === 'line');
  const points = chartValues(spec), low = Math.min(0,...points.map(p=>p.value)), high = Math.max(0,...points.map(p=>p.value));
  const scale = value => 165 - (value-low)/(high-low || 1)*135, step = 340/Math.max(1,points.length);
  return <><div className="chart-controls"><button onClick={()=>setLine(false)} aria-pressed={!line}>Barras</button><button onClick={()=>setLine(true)} aria-pressed={line}>Línea</button></div>
    {!points.length ? <p>Sin datos válidos.</p> : <svg className="presentation-chart" viewBox="0 0 400 205" role="img" aria-label={spec.title || 'Gráfico'}>
      <line x1="36" x2="380" y1={scale(0)} y2={scale(0)} stroke="#6682a6"/>
      <text x="4" y="23" fill="#91a8c7" fontSize="10">{high}</text><text x="4" y="169" fill="#91a8c7" fontSize="10">{low}</text>
      {line && <polyline points={points.map((p,i)=>`${40+(i+.5)*step},${scale(p.value)}`).join(' ')} fill="none" stroke="#9cbdff" strokeWidth="2.5"/>}
      {points.map((p,i)=><g key={i} tabIndex="0"><title>{`${p.label}: ${p.value}`}</title>{line ? <circle cx={40+(i+.5)*step} cy={scale(p.value)} r="3" fill="#c0d3ff"/> : <rect x={40+i*step+step*.12} y={Math.min(scale(p.value),scale(0))} width={step*.76} height={Math.max(1,Math.abs(scale(p.value)-scale(0)))} rx="3" fill="#89acfa"/>}
        {points.length <= 12 && <text x={40+(i+.5)*step} y="190" textAnchor="middle" fill="#9eb1cd" fontSize="10">{p.label.slice(0,12)}</text>}</g>)}
    </svg>}</>;
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
  if(error) return <p>{error}</p>;
  if(!data) return <p>Cargando archivo…</p>;
  if(file.ext==='html') return <iframe sandbox="" title={spec.title || 'Vista de archivo'} srcDoc={isolatedDocument(data.content)} className="presentation-frame"/>;
  if(file.ext==='md') return <Markdown text={String(data.content || '').slice(0,64000)}/>;
  return <pre>{String(data.content || '').slice(0,64000)}</pre>;
}

function Card({spec}) {
  const [expanded,setExpanded] = useState(false), dialog=useRef(null);
  useEffect(()=>{ if(!expanded || !dialog.current) return; const el=dialog.current; el.showModal(); return ()=>{if(el.open)el.close();}; },[expanded]);
  const title = String(spec.title || 'Presentación').slice(0,120), file = spec.type==='file' ? filePresentation(spec) : null;
  const content = <>{spec.type==='chart' ? <Chart spec={spec}/> : spec.type==='table' ? <div className="presentation-table"><table><thead><tr>{(Array.isArray(spec.columns)?spec.columns:[]).slice(0,12).map((c,i)=><th key={i}>{String(c)}</th>)}</tr></thead><tbody>{(Array.isArray(spec.rows)?spec.rows:[]).slice(0,100).map((row,i)=><tr key={i}>{(Array.isArray(row)?row:[]).slice(0,12).map((c,j)=><td key={j}>{String(c)}</td>)}</tr>)}</tbody></table></div>
      : spec.type==='file' ? <FileView spec={spec}/> : <iframe sandbox="" title={title} srcDoc={isolatedDocument(spec.html)} className="presentation-frame"/>}</>;
  return <article className="presentation-card"><header><b>{title}</b><span className="grow"/>{file && <a className="icon-btn" href={`/api/files/raw?${file.query}`} target="_blank" rel="noreferrer" aria-label="Abrir archivo"><Download size={16}/></a>}<button className="icon-btn" aria-label={`Ampliar ${title}`} onClick={()=>setExpanded(true)}><Maximize2 size={16}/></button></header>{content}
    {expanded && <dialog ref={dialog} className="presentation-expanded" aria-label={title} onCancel={()=>setExpanded(false)}><header><b>{title}</b><button className="round-btn" onClick={()=>setExpanded(false)} aria-label="Cerrar presentación"><X size={20}/></button></header><div>{content}</div></dialog>}
  </article>;
}

export default function Presentations({text, visualsOnly=false}) {
  const parts=useMemo(()=>presentationParts(text),[text]);
  return <div className="general-presentations">{parts.map((part,i)=>part.spec?<Card key={i} spec={part.spec}/>:!visualsOnly&&part.text.trim()?<Markdown key={i} text={part.text}/>:null)}</div>;
}
