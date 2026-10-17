import React, {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, CircleDot, Info, Loader2, X} from 'lucide-react';
import {projectHue, providerLabel} from './lib.js';
export {default as VoiceButton} from './VoiceInput.jsx';

export function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('cm:toast', {detail: {message, type, id: Math.random()}}));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = event => {
      const item = event.detail;
      setItems(list => [...list.slice(-2), item]);
      setTimeout(() => setItems(list => list.filter(x => x.id !== item.id)), item.type === 'error' ? 6000 : 3200);
    };
    window.addEventListener('cm:toast', add);
    return () => window.removeEventListener('cm:toast', add);
  }, []);
  return <div className="toaster" role="status" aria-live="polite">{items.map(item => <div key={item.id} className={`toast ${item.type}`}>
    {item.type === 'error' ? <AlertTriangle size={16}/> : item.type === 'success' ? <CheckCircle2 size={16}/> : <Info size={16}/>}
    <span>{item.message}</span>
    <button className="ghost-icon" onClick={() => setItems(list => list.filter(x => x.id !== item.id))} aria-label="Cerrar"><X size={14}/></button>
  </div>)}</div>;
}

export const Spinner = ({size = 16, className = ''}) => <Loader2 size={size} className={`spin ${className}`}/>;

export function Empty({icon, title, text, children}) {
  return <div className="empty">{icon || <CircleDot/>}<b>{title}</b>{text && <span>{text}</span>}{children}</div>;
}

export function Sheet({title, onClose, children, wide = false}) {
  useEffect(() => {
    const key = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <div className="sheet-grip"/>
      <header className="sheet-head"><h2>{title}</h2><button className="ghost-icon" onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header>
      <div className="sheet-body">{children}</div>
    </section>
  </div>;
}

export function Confirm({title, text, confirmLabel = 'Confirmar', danger = false, onConfirm, onCancel, children}) {
  return <Sheet title={title} onClose={onCancel}>
    {text && <p className="muted">{text}</p>}
    {children}
    <div className="sheet-actions"><button className="btn" onClick={onCancel}>Cancelar</button><button className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm} autoFocus>{confirmLabel}</button></div>
  </Sheet>;
}

export function ProviderMark({provider, size = 22}) {
  return <span className={`provider-mark ${provider}`} style={{width: size, height: size, fontSize: size * 0.5}} aria-label={providerLabel(provider)}>{provider === 'codex' ? 'Cx' : 'Cl'}</span>;
}

export function ProviderPicker({value, onChange, compact = false}) {
  return <div className={compact ? 'segmented compact' : 'segmented'} role="radiogroup" aria-label="Agente">
    {['claude', 'codex'].map(provider => <button key={provider} type="button" role="radio" aria-checked={value === provider} className={value === provider ? 'on' : ''} onClick={() => onChange(provider)}>
      <ProviderMark provider={provider} size={compact ? 16 : 18}/>{providerLabel(provider)}
    </button>)}
  </div>;
}

export function Monogram({name, size = 44}) {
  const hue = projectHue(name);
  return <span className="monogram" style={{width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 75% 32%))`}}>{String(name).slice(0, 2).toUpperCase()}</span>;
}

export function Meter({label, value, detail, percent, tone}) {
  return <div className={`meter ${tone || ''}`}>
    <div className="meter-top"><span>{label}</span><b>{value}</b></div>
    <div className="meter-track"><i style={{width: `${Math.max(2, Math.min(100, percent || 0))}%`}}/></div>
    {detail && <small>{detail}</small>}
  </div>;
}

export function StatusPill({status, children}) {
  return <span className={`pill ${status}`}>{status === 'working' || status === 'running' ? <span className="pulse-dot"/> : null}{children}</span>;
}
