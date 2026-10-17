import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Pause, Play, RefreshCw, Search} from 'lucide-react';
import {api} from '../lib.js';
import {Empty, Spinner} from '../ui.jsx';

const logTime = value => { if (!value) return ''; const date = new Date(value); return isNaN(date) ? value.slice(11, 19) : date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}); };

export default function Console({project, active}) {
  const containers = project.container_details || [];
  const [selected, setSelected] = useState(''), [tail, setTail] = useState(200), [live, setLive] = useState(true);
  const [entries, setEntries] = useState(null), [error, setError] = useState(''), [filter, setFilter] = useState(''), [tick, setTick] = useState(0), [loading, setLoading] = useState(false);
  const box = useRef(null), stick = useRef(true);
  useEffect(() => { setEntries(null); stick.current = true; }, [project.name, selected]);
  useEffect(() => {
    if (!containers.length || !active) return;
    let stopped = false, timer;
    const load = async () => {
      setLoading(true);
      try { const result = await api(`/api/logs?project=${encodeURIComponent(project.name)}&container=${encodeURIComponent(selected)}&tail=${tail}`); if (!stopped) { setEntries(result.entries || []); setError(''); } }
      catch (err) { if (!stopped) setError(err.message); }
      finally { if (!stopped) setLoading(false); }
      if (!stopped && live) timer = setTimeout(load, 3000);
    };
    load();
    return () => { stopped = true; clearTimeout(timer); };
  }, [project.name, selected, tail, live, tick, containers.length, active]);
  useLayoutEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [entries, filter]);
  const visible = (entries || []).filter(entry => !filter || entry.text.toLowerCase().includes(filter.toLowerCase()));
  const services = [...new Set(containers.map(c => c.service || c.name))];
  if (!containers.length) return <Empty title="Sin contenedores" text="Despliega el proyecto para ver aquí los logs de la aplicación."/>;
  return <div className="console">
    <div className="console-bar">
      <div className="tabs-scroll"><button className={!selected ? 'on' : ''} onClick={() => setSelected('')}>Todos</button>
        {containers.map(c => <button key={c.id} className={selected === c.id ? 'on' : ''} onClick={() => setSelected(c.id)}><span className={c.state === 'running' ? 'dot on' : 'dot'}/>{c.service || c.name}</button>)}</div>
      <div className="console-tools">
        <label className="search small"><Search size={14}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar…"/></label>
        <select className="select" value={tail} onChange={e => setTail(Number(e.target.value))} aria-label="Líneas">{[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n} líneas</option>)}</select>
        <button className={live ? 'icon-btn on' : 'icon-btn'} onClick={() => setLive(!live)} aria-label={live ? 'Pausar' : 'Reanudar'}>{live ? <Pause size={15}/> : <Play size={15}/>}</button>
        <button className="icon-btn" onClick={() => setTick(t => t + 1)} aria-label="Recargar"><RefreshCw size={15} className={loading ? 'spin' : ''}/></button>
      </div>
    </div>
    {error && <div className="timeline-error">{error}</div>}
    <div className="log-view" ref={box} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {entries === null ? <div className="log-empty"><Spinner/> Cargando logs…</div>
        : visible.length ? visible.map((entry, i) => <div className={`log-line ${entry.stream}`} key={i}><time title={entry.time}>{logTime(entry.time)}</time>
          {!selected && services.length > 1 && <span className={`log-service s${services.indexOf(entry.service) % 6}`}>{entry.service}</span>}<span className="log-text">{entry.text}</span></div>)
        : <div className="log-empty">{filter ? 'Ninguna línea coincide.' : 'Sin salida registrada.'}</div>}
    </div>
  </div>;
}
