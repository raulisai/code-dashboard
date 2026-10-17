import React, {useEffect, useRef, useState} from 'react';
import {Brain, Check, ChevronDown, X} from 'lucide-react';
import {api} from '../lib.js';
import {Spinner} from '../ui.jsx';

let cachedCatalog = null, cachedAt = 0;

export const effortLabel = value => ({low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra'}[value] || 'Automático');

export default function ModelPicker({provider, model, effort, onChange, configured}) {
  const [catalog, setCatalog] = useState(() => cachedCatalog), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    let alive = true;
    if (cachedCatalog && Date.now() - cachedAt < 60000) return;
    api('/api/models').then(data => { cachedCatalog = data; cachedAt = Date.now(); if (alive) setCatalog(data); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!open || !dialog.current) return;
    const el = dialog.current; el.showModal();
    return () => { if (el.open) el.close(); };
  }, [open]);
  const models = catalog?.[provider] || [];
  const selected = models.find(row => row.id === model);
  const defaultRow = models.find(row => [configured || catalog?.defaults?.[provider]].some(id => id && (row.id === id || row.resolved === id)));
  const actual = selected || defaultRow;
  useEffect(() => {
    if (catalog && model && !selected) onChange('', '');
    else if (catalog && effort && !actual?.efforts?.includes(effort)) onChange(model, '');
  }, [catalog, provider, model, effort, selected, actual]);
  const levels = actual?.efforts || [];
  const selectedEffort = levels.includes(effort) ? effort : '';
  const choose = value => {
    const next = models.find(row => row.id === value) || models.find(row => (configured || catalog?.defaults?.[provider]) === row.id || (configured || catalog?.defaults?.[provider]) === row.resolved);
    onChange(value, next?.efforts?.includes(effort) ? effort : '');
  };
  return <div className="model-control">
    <button type="button" className="model-trigger" onClick={() => setOpen(true)} aria-label="Escoger modelo y esfuerzo" aria-haspopup="dialog" aria-expanded={open}>
      <Brain size={14}/><span>{selected?.name || 'Escoger modelo'}</span><small>{effortLabel(selectedEffort)}</small><ChevronDown size={13}/>
    </button>
    {open && <dialog ref={dialog} className="model-dialog" aria-label="Modelo y esfuerzo" onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="model-panel">
        <header><div><b>Escoger modelo</b><p>Para el próximo mensaje de este chat</p></div><button type="button" className="icon-btn" aria-label="Cerrar selector" onClick={() => setOpen(false)}><X size={19}/></button></header>
        {!catalog && !error && <p><Spinner/> Cargando modelos…</p>}
        {error && <p className="error">{error}</p>}
        <div className="model-options" role="radiogroup" aria-label="Modelo">
          <button type="button" role="radio" aria-checked={!selected} onClick={() => choose('')}><span><b>Predeterminado</b><small>{defaultRow?.name || 'Usar la configuración del agente'}</small></span>{!selected && <Check size={16}/>}</button>
          {models.map(row => <button type="button" role="radio" aria-checked={model === row.id} key={row.id} onClick={() => choose(row.id)}><span><b>{row.name}</b><small>{row.efforts?.length ? `${row.efforts.length} ${row.efforts.length === 1 ? 'nivel' : 'niveles'} de esfuerzo` : 'Esfuerzo gestionado por el modelo'}</small></span>{model === row.id && <Check size={16}/>}</button>)}
        </div>
        <section className="effort-section"><b>Esfuerzo de razonamiento</b><p>{levels.length ? 'Cuánto profundiza antes de responder. Más esfuerzo puede tardar más.' : 'Este modelo gestiona su esfuerzo automáticamente.'}</p>
          <div className="effort-options" role="radiogroup" aria-label="Esfuerzo">{['', ...levels].map(level => <button type="button" key={level} role="radio" aria-checked={selectedEffort === level} onClick={() => onChange(selected?.id || '', level)}>{effortLabel(level)}</button>)}</div>
        </section>
        <button type="button" className="btn primary model-done" onClick={() => setOpen(false)}>Listo</button>
      </div>
    </dialog>}
  </div>;
}
