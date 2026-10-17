import React, {useEffect, useState} from 'react';
import {ArchiveRestore, Check, Loader2, Trash2} from 'lucide-react';
import {api, navigate, post, usePolling} from './lib.js';
import {Sheet, toast} from './ui.jsx';
import {useApp} from './App.jsx';

export default function ProjectDelete({project, onClose}) {
  const {refresh} = useApp();
  const [preview, setPreview] = useState(null), [name, setName] = useState(''), [error, setError] = useState('');
  const [job, setJob] = useState(null), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  useEffect(() => { api(`/api/projects/delete-preview?project=${encodeURIComponent(project.name)}`).then(setPreview).catch(err => setError(err.message)); }, [project.name]);
  usePolling(async () => {
    if (!job || result) return;
    try {
      const data = await api(`/api/jobs/${job}`);
      if (data.status === 'running') return;
      setResult(data); setBusy(false); await refresh();
      if (data.status === 'done') toast('Proyecto eliminado. Puedes recuperarlo desde la papelera.', 'success');
      else setError(data.output?.slice(-800) || 'No se pudo completar la eliminación. Revisa el proyecto antes de reintentar.');
    } catch (err) { setError(err.message); }
  }, 1200, [job, result]);
  const submit = async event => {
    event.preventDefault(); if (name !== project.name || busy || preview?.busy) return;
    setBusy(true); setError('');
    try { const data = await post('/api/projects', {action: 'delete', name: project.name, confirmation: name}); setJob(data.job_id); }
    catch (err) { setBusy(false); setError(err.message); }
  };
  return <Sheet title={result?.status === 'done' ? 'Proyecto eliminado' : `Eliminar ${project.name}`} onClose={() => { if (!busy) onClose(); }}>
    {result?.status === 'done' ? <div className="project-delete-done"><Check size={30}/><p>La web está apagada y el proyecto ya no aparece en tu lista.</p><p className="muted">Sus archivos están en la papelera. Los datos en volúmenes Docker se conservan.</p><button className="btn primary" onClick={() => { onClose(); navigate('/'); }}>Volver a mis proyectos</button></div>
      : <form onSubmit={submit} className="project-delete-form">
        <p>Se apagará su web, se retirarán sus contenedores y se cerrarán sus terminales. Las peticiones pendientes se cancelarán.</p>
        <div className="delete-recovery"><ArchiveRestore size={18}/><span>Los archivos se guardan en una papelera recuperable. Los volúmenes de datos se conservan.</span></div>
        {preview?.containers.length > 0 && <p className="muted">Contenedores: {preview.containers.join(', ')}</p>}
        {preview?.busy && <div className="voice-error">Hay un agente o despliegue activo. Deténlo y vuelve a abrir este diálogo para eliminar el proyecto.</div>}
        {!preview && !error && <p className="muted">Comprobando proyecto…</p>}
        <label className="field"><span>Escribe <strong>{project.name}</strong> para confirmar</span><input className="input" aria-label="Nombre para confirmar eliminación" value={name} onChange={event => setName(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
        {error && <div className="voice-error" role="alert">{error}</div>}
        {busy && <p className="muted" role="status">Eliminando el proyecto… Puedes dejar esta pantalla abierta para ver el resultado.</p>}
        <div className="sheet-actions"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn danger" disabled={!preview || preview.busy || name !== project.name || busy}>{busy ? <Loader2 className="spin" size={16}/> : <Trash2 size={16}/>}Eliminar proyecto</button></div>
      </form>}
  </Sheet>;
}

export function ProjectTrash() {
  const {refresh} = useApp();
  const [rows, setRows] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => { api('/api/projects/trash').then(data => setRows(data.projects)).catch(err => setError(err.message)); }, []);
  const restore = async row => {
    setBusy(row.id); setError('');
    try { const data = await post('/api/projects', {action: 'restore', archive_id: row.id}); toast(data.message, 'success'); setRows(list => list.filter(item => item.id !== row.id)); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };
  return <section className="block project-trash"><div className="block-head"><h2>Papelera de proyectos</h2></div><p className="muted">Recupera los archivos de un proyecto eliminado. Después podrás desplegarlo para volver a publicar su web.</p>
    {error && <div className="voice-error">{error}</div>}
    {rows?.length ? rows.map(row => <div className="trash-row" key={row.id}><div><b>{row.project}</b><small>{row.deleted_at ? new Date(row.deleted_at * 1000).toLocaleString() : ''}</small></div><button className="btn small" disabled={!!busy} onClick={() => restore(row)}>{busy === row.id ? <Loader2 size={15} className="spin"/> : <ArchiveRestore size={15}/>}Restaurar</button></div>) : <p className="muted">{rows ? 'La papelera está vacía.' : 'Cargando papelera…'}</p>}
  </section>;
}
