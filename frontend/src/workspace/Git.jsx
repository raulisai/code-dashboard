import React, {useEffect, useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, ChevronRight, FolderTree, GitBranch, GitCommitHorizontal, GitCompare, GitMerge, History, Pencil, Plus,
  RefreshCw, Rocket, RotateCcw, Save, Sparkles, Trash2, Undo2, Upload} from 'lucide-react';
import {api, post, setQuery, timeAgo, useLocation, usePolling} from '../lib.js';
import {Empty, ProviderMark, Sheet, Spinner, toast} from '../ui.jsx';

const CODE = {M: 'modificado', A: 'nuevo', D: 'borrado', R: 'renombrado', C: 'copiado', '?': 'nuevo', U: 'conflicto', T: 'tipo'};
const ACTIONS = {
  agent: ['Agente', null], edit: ['Editor', Pencil], files: ['Archivos', FolderTree], upload: ['Subida', Upload],
  pending: ['Cambios sin guardar', Save], restore: ['Restauración', History], undo: ['Deshacer', Undo2], revert: ['Reversión', RotateCcw],
  merge: ['Integración', GitMerge], init: ['Inicio', Sparkles], manual: ['Manual', GitCommitHorizontal],
};
const q = value => encodeURIComponent(value);
const fullDate = seconds => new Date(seconds * 1000).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});

function actor(commit) {
  if (commit.action === 'agent') return commit.provider === 'codex' ? 'Codex' : 'Claude';
  return (ACTIONS[commit.action] || ['Git'])[0];
}

function ActionIcon({commit, size = 30}) {
  if (commit.action === 'agent') return <ProviderMark provider={commit.provider === 'codex' ? 'codex' : 'claude'} size={size}/>;
  const Icon = (ACTIONS[commit.action] || [null, GitCommitHorizontal])[1] || GitCommitHorizontal;
  return <span className={`ver-icon a-${commit.action || 'git'}`} style={{width: size, height: size}}><Icon size={size * 0.5}/></span>;
}

function Badges({commit}) {
  return <span className="ver-badges">
    {commit.current && <span className="ver-badge now">Actual</span>}
    {commit.production && <span className="ver-badge live"><Rocket size={11}/>En producción</span>}
    {!commit.production && commit.deployed_at && <span className="ver-badge">Publicada</span>}
    {commit.only_here && <span className="ver-badge alt">Solo en esta rama</span>}
    {(commit.refs || []).map(ref => <span key={ref} className="ver-badge ref"><GitBranch size={11}/>{ref}</span>)}
  </span>;
}

function DiffView({title, data, onBack}) {
  return <div className="git">
    <div className="editor-bar"><button className="icon-btn" onClick={onBack} aria-label="Volver"><ArrowLeft size={18}/></button><span className="editor-path">{title}</span></div>
    {!data ? <div className="editor-empty"><Spinner/></div> : <pre className="diff-view">{(data.diff || 'Sin diferencias').split('\n').map((line, i) =>
      <div key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}>{line || ' '}</div>)}
      {data.truncated && <div className="hunk">… diferencia recortada por tamaño</div>}</pre>}
  </div>;
}

// Confirmación con opción de publicar a la vez (el rollback rápido llega también a la web).
function ActionSheet({action, project, onClose, onDone}) {
  const [busy, setBusy] = useState(false);
  const run = async deploy => {
    setBusy(true);
    try {
      const result = await post('/api/git', {project: project.name, ...action.body, deploy}, {timeout: 240000});
      toast(result.message, 'success');
      onDone(result);
    } catch (err) { toast(err.message, 'error'); setBusy(false); }
  };
  return <Sheet title={action.title} onClose={busy ? () => {} : onClose}>
    {action.text && <p className="muted">{action.text}</p>}
    <p className="ver-note"><History size={14}/>Antes se guarda lo que haya sin guardar. Nada se borra del historial: podrás volver cuando quieras.</p>
    <div className="sheet-actions ver-actions">
      <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
      <button className={action.danger ? 'btn danger' : 'btn primary'} onClick={() => run(false)} disabled={busy}>{busy ? <Spinner/> : null}{action.label}</button>
      {action.deploy && project.compose && <button className="btn" onClick={() => run(true)} disabled={busy}><Rocket size={15}/>{action.label} y publicar</button>}
    </div>
  </Sheet>;
}

function CommitSheet({project, sha, blocked, onClose, onAction, onDiff}) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    api(`/api/git/commit?project=${q(project.name)}&rev=${q(sha)}`).then(row => alive && setData(row)).catch(err => { toast(err.message, 'error'); onClose(); });
    return () => { alive = false; };
  }, [sha]);
  const branchFrom = () => {
    const name = prompt('Nombre de la nueva rama (alternativa) a partir de esta versión:', `alternativa-${data.short}`);
    if (name) onAction({title: 'Crear rama desde esta versión', text: `Se crea la rama «${name.trim()}» con los archivos de ${data.short} y pasas a trabajar en ella.`,
      label: 'Crear y cambiar', body: {action: 'branch-create', name: name.trim(), rev: data.sha}});
  };
  return <Sheet title={data ? `Versión ${data.short}` : 'Versión'} onClose={onClose} wide>
    {!data ? <div className="editor-empty"><Spinner/></div> : <div className="ver-detail">
      <div className="ver-detail-head"><ActionIcon commit={data} size={36}/><div><b>{data.subject}</b>
        <small>{actor(data)} · {fullDate(data.time)} · <code>{data.short}</code></small><Badges commit={data}/></div></div>
      {data.body && <pre className="ver-body">{data.body}</pre>}
      {blocked && <p className="ver-warn"><AlertTriangle size={15}/>{blocked}</p>}
      <div className="ver-buttons">
        <button className="btn primary" disabled={!!blocked || data.same_as_current} onClick={() => onAction({title: 'Restaurar esta versión',
          text: `Todos los archivos del proyecto vuelven a quedar como en ${data.short} («${data.subject}»). Se crea una versión nueva; las posteriores siguen en el historial.`,
          label: 'Restaurar', deploy: true, body: {action: 'restore', rev: data.sha}})}><History size={16}/>{data.same_as_current ? 'Es la versión actual' : 'Restaurar esta versión'}</button>
        {data.parent && <button className="btn" disabled={!!blocked || !data.contained} title={data.contained ? '' : 'Esta versión no forma parte de la rama actual'} onClick={() => onAction({title: 'Deshacer solo este cambio',
          text: `Se quitan únicamente los cambios que hizo «${data.subject}». Lo que se hizo después se conserva.`, label: 'Deshacer cambio', deploy: true, body: {action: 'revert', rev: data.sha}})}>
          <RotateCcw size={16}/>Deshacer solo este cambio</button>}
        {!data.same_as_current && <button className="btn" onClick={() => onDiff({title: `Qué cambiaría al restaurar ${data.short}`, rev: data.sha, compare: true})}><GitCompare size={16}/>Comparar con la actual</button>}
        <button className="btn" disabled={!!blocked} onClick={branchFrom}><GitBranch size={16}/>Nueva rama desde aquí</button>
      </div>
      <div className="block-head"><h3>Archivos cambiados <span className="count">{data.changes.length}</span></h3>
        {data.changes.length > 0 && <button className="link-btn" onClick={() => onDiff({title: `Cambios de ${data.short}`, rev: data.sha})}>Ver todo</button>}</div>
      {data.changes.length ? <div className="git-files">{data.changes.map(file => <button key={file.path} onClick={() => onDiff({title: file.path, rev: data.sha, path: file.path})}>
        <span className={`git-code c${file.code}`}>{file.code}</span><span className="gf-path">{file.from ? `${file.from} → ` : ''}{file.path}</span>
        <small>{file.added != null ? <><i className="plus">+{file.added}</i> <i className="minus">−{file.deleted}</i></> : CODE[file.code] || ''}</small></button>)}</div>
        : <p className="muted">Esta versión no cambió archivos.</p>}
    </div>}
  </Sheet>;
}

function Timeline({project, status, viewRef, setViewRef, onOpen, onAction, reloadKey}) {
  const [data, setData] = useState(null), [more, setMore] = useState(false);
  const load = async (skip = 0) => {
    const result = await api(`/api/git/log?project=${q(project.name)}&ref=${q(viewRef)}&skip=${skip}&limit=40`);
    setData(previous => skip && previous ? {...result, commits: [...previous.commits, ...result.commits]} : result);
  };
  useEffect(() => { setData(null); load().catch(err => toast(err.message, 'error')); }, [project.name, viewRef]);
  useEffect(() => { if (data) load().catch(() => {}); }, [reloadKey]);
  if (!data) return <div className="editor-empty"><Spinner/> Leyendo historial…</div>;
  return <>
    {viewRef && <div className="ver-viewing"><GitBranch size={15}/><span>Viendo la rama <b>{viewRef}</b></span><span className="grow"/>
      {viewRef !== status.branch && <button className="btn small" disabled={!!status.blocked} onClick={() => onAction({title: `Cambiar a la rama ${viewRef}`,
        text: `Los archivos del proyecto pasan a ser los de «${viewRef}». La rama actual (${status.branch || 'sin rama'}) se conserva tal cual.`, label: 'Cambiar', deploy: true, body: {action: 'switch', name: viewRef}})}>Cambiar a esta</button>}
      <button className="btn small" onClick={() => setViewRef('')}>Volver a la actual</button></div>}
    {data.commits.length ? <ol className="ver-timeline">{data.commits.map(commit => <li key={commit.sha} className={commit.current ? 'current' : ''}>
      <button onClick={() => onOpen(commit.sha)}>
        <ActionIcon commit={commit}/>
        <span className="ver-main"><b>{commit.subject}</b>
          <small>{actor(commit)} · {timeAgo(commit.time)} · <code>{commit.short}</code>{commit.files ? <> · {commit.files} arch. <i className="plus">+{commit.added}</i> <i className="minus">−{commit.deleted}</i></> : null}</small>
          <Badges commit={commit}/></span>
        <ChevronRight size={16} className="ver-chevron"/>
      </button></li>)}</ol>
      : <Empty title="Sin versiones" text="La primera acción en el proyecto creará la primera versión."/>}
    {data.more && <button className="btn ver-more" disabled={more} onClick={async () => { setMore(true); try { await load(data.commits.length); } finally { setMore(false); } }}>{more ? <Spinner/> : null}Cargar versiones anteriores</button>}
  </>;
}

function Branches({project, status, onAction, onView, reloadKey}) {
  const [data, setData] = useState(null), [name, setName] = useState('');
  useEffect(() => { api(`/api/git/branches?project=${q(project.name)}`).then(setData).catch(err => toast(err.message, 'error')); }, [project.name, reloadKey]);
  const clean = name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._/-]+/g, '-').replace(/^[-./]+|[-./]+$/g, '');
  const create = event => {
    event.preventDefault();
    onAction({title: 'Nueva rama', text: `Se crea «${clean}» desde la versión actual y pasas a trabajar en ella. La rama ${status.branch || 'actual'} queda intacta para comparar o volver.`,
      label: 'Crear y cambiar', body: {action: 'branch-create', name: clean}, after: () => setName('')});
  };
  if (!data) return <div className="editor-empty"><Spinner/> Leyendo ramas…</div>;
  return <>
    <p className="muted ver-intro">Cada rama es una alternativa del proyecto: prueba ideas sin perder la versión buena y cámbiate o intégrala cuando quieras.</p>
    <form className="commit-box" onSubmit={create}>
      <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre, p. ej. diseño-oscuro" aria-label="Nombre de la nueva rama"/>
      <button className="btn primary" disabled={!clean || !!status.blocked}><Plus size={16}/>Crear</button>
    </form>
    <div className="ver-branches">{data.branches.map(branch => <div key={branch.name} className={branch.current ? 'ver-branch current' : 'ver-branch'}>
      <div className="ver-branch-head"><GitBranch size={16}/><b>{branch.name}</b>{branch.current && <span className="ver-badge now">Actual</span>}
        {branch.production && <span className="ver-badge live"><Rocket size={11}/>En producción</span>}</div>
      <small className="muted">{branch.subject} · {timeAgo(branch.time)} · <code>{branch.short}</code></small>
      {!branch.current && <small className="ver-ahead">{branch.ahead ? `${branch.ahead} versión(es) propia(s)` : 'Sin versiones propias'}{branch.behind ? ` · no tiene ${branch.behind} de ${data.current || 'la actual'}` : ''}</small>}
      <div className="ver-branch-actions">
        <button className="btn small" onClick={() => onView(branch.name)}><History size={14}/>Historial</button>
        {!branch.current && <>
          <button className="btn small primary" disabled={!!status.blocked} onClick={() => onAction({title: `Cambiar a ${branch.name}`,
            text: `Los archivos pasan a ser los de «${branch.name}». ${data.current ? `La rama ${data.current} se conserva.` : ''}`, label: 'Cambiar', deploy: true, body: {action: 'switch', name: branch.name}})}>Cambiar a esta</button>
          {data.current && branch.ahead > 0 && <button className="btn small" disabled={!!status.blocked} onClick={() => onAction({title: `Integrar ${branch.name} en ${data.current}`,
            text: `Los cambios de «${branch.name}» se suman a «${data.current}». Si las dos tocan las mismas líneas no se integra nada y te avisamos.`, label: 'Integrar', deploy: true, body: {action: 'merge', name: branch.name}})}><GitMerge size={14}/>Integrar</button>}
          <button className="btn small danger-soft" onClick={() => onAction({title: `Eliminar la rama ${branch.name}`, danger: true,
            text: branch.ahead ? `Tiene ${branch.ahead} versión(es) que no están en ${data.current || 'la actual'}. Se quitará de la lista, pero quedará archivada en el repositorio.` : 'Se quitará de la lista; sus versiones quedan archivadas en el repositorio.',
            label: 'Eliminar', body: {action: 'branch-delete', name: branch.name}})} aria-label={`Eliminar ${branch.name}`}><Trash2 size={14}/></button>
        </>}
      </div>
    </div>)}</div>
  </>;
}

function Changes({project, status, onDiff, onSaved}) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const commit = async event => {
    event.preventDefault(); setBusy(true);
    try { const result = await post('/api/git', {project: project.name, action: 'commit', message}, {timeout: 90000}); toast(result.message, 'success'); setMessage(''); onSaved(); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  return <>
    <p className="muted ver-intro">{status.auto_commit ? 'Lo que cambies desde la terminal o mientras trabaja un agente se guarda solo en la siguiente acción. Puedes guardarlo ya con un nombre.' : 'El guardado automático está desactivado en Ajustes: guarda las versiones aquí.'}</p>
    <form className="commit-box" onSubmit={commit}>
      <input className="input" value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe esta versión" aria-label="Mensaje de la versión"/>
      <button className="btn primary" disabled={busy || !message.trim() || !status.files.length}>{busy ? <Spinner/> : <Save size={16}/>}Guardar</button>
    </form>
    {status.files.length ? <div className="git-files">{status.files.map(file => <button key={file.path} onClick={() => onDiff({title: file.path, path: file.path})}>
      <span className={`git-code c${file.code.trim()[0] || 'M'}`}>{file.code.trim() || 'M'}</span><span className="gf-path">{file.path}</span><small>{CODE[file.code.trim()[0]] || ''}</small></button>)}</div>
      : <Empty title="Todo guardado" text="No hay cambios pendientes: la versión actual coincide con los archivos."/>}
  </>;
}

export default function Git({project, active}) {
  const {query} = useLocation();
  const [status, setStatus] = useState(null), [tab, setTab] = useState('history'), [viewRef, setViewRef] = useState('');
  const [open, setOpen] = useState(''), [diff, setDiff] = useState(null), [action, setAction] = useState(null), [reloadKey, setReloadKey] = useState(0);
  const lastHead = useRef('');
  const load = async () => {
    try {
      const next = await api(`/api/git?project=${q(project.name)}`);
      setStatus(next);
      // Un agente o el editor crearon una versión nueva: refrescar historial y ramas.
      if (lastHead.current && next.head !== lastHead.current) setReloadKey(k => k + 1);
      lastHead.current = next.head || '';
    } catch (err) { toast(err.message, 'error'); }
  };
  usePolling(() => active ? load() : null, 6000, [project.name, active]);
  useEffect(() => { setStatus(null); setViewRef(''); setTab('history'); lastHead.current = ''; }, [project.name]);
  useEffect(() => {
    const version = query.get('version');
    if (active && version && /^[0-9a-f]{4,64}$/.test(version)) { setTab('history'); setOpen(version); setQuery('version', ''); }
  }, [active, query.get('version')]);
  const refresh = () => { load(); setReloadKey(k => k + 1); };
  const showDiff = async ({title, rev = '', path = '', compare = false}) => {
    setDiff({title, data: null});
    try { setDiff({title, data: await api(`/api/git/diff?project=${q(project.name)}&rev=${q(rev)}&path=${q(path)}${compare ? '&compare=1' : ''}`)}); }
    catch (err) { toast(err.message, 'error'); setDiff(null); }
  };
  const ask = next => { setAction(next); };
  const done = () => { action?.after?.(); setAction(null); setOpen(''); if (action?.body?.action === 'switch') setViewRef(''); refresh(); };

  if (!status) return <div className="editor-empty"><Spinner/> Leyendo versiones…</div>;
  if (diff) return <DiffView title={diff.title} data={diff.data} onBack={() => setDiff(null)}/>;
  if (!status.repo) return <div className="git"><Empty icon={<History/>} title="Este proyecto aún no tiene versiones"
    text={status.auto_commit ? 'Se activarán solas con la próxima acción (agente, editor o despliegue), o actívalas ahora.' : 'Actívalas para poder volver a cualquier versión.'}>
    <button className="btn primary" onClick={async () => { try { toast((await post('/api/git', {project: project.name, action: 'init'}, {timeout: 120000})).message, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); } }}>
      <Sparkles size={16}/>Activar versiones</button></Empty></div>;

  const undo = status.undo;
  return <div className="git versions">
    <div className="ver-head">
      <div className="ver-head-row">
        <button className="ver-branch-chip" onClick={() => setTab('branches')} title="Ver ramas"><GitBranch size={15}/><b>{status.branch || (status.detached ? 'Sin rama' : 'main')}</b>
          {status.branches > 1 && <span className="count">{status.branches}</span>}</button>
        {status.short && <code>{status.short}</code>}
        {status.deployed && <span className="ver-badge live" title={`Publicada ${timeAgo(status.deployed.at)}`}><Rocket size={11}/>{status.deployed.sha === status.head ? 'Publicada' : `En producción ${status.deployed.sha.slice(0, 7)}`}</span>}
        <span className="grow"/>
        <button className="icon-btn" onClick={refresh} aria-label="Recargar"><RefreshCw size={15}/></button>
      </div>
      <button className="btn ver-undo" disabled={!undo || !!status.blocked} onClick={() => ask({title: undo.pending ? 'Deshacer los cambios sin guardar' : 'Deshacer el último cambio',
        text: undo.pending ? `Los cambios sin guardar quedan en el historial por si los necesitas y los archivos vuelven a ${undo.short} («${undo.subject}»).`
          : `Vuelves a la versión ${undo.short} («${undo.subject}», ${timeAgo(undo.time)}). Puedes repetirlo para seguir retrocediendo.`, label: 'Deshacer', deploy: true, body: {action: 'undo'}})}>
        <Undo2 size={17}/><span><b>{undo?.pending ? 'Deshacer cambios sin guardar' : 'Deshacer último cambio'}</b><small>{undo ? `Volver a ${undo.short} · ${undo.subject}` : 'No hay una versión anterior'}</small></span></button>
      {status.blocked && <p className="ver-warn"><AlertTriangle size={15}/>{status.blocked}</p>}
      {status.operation && <p className="ver-warn"><AlertTriangle size={15}/>Hay {status.operation} a medias en el repositorio. Termínala desde la terminal o pide al agente que la resuelva.</p>}
      {status.detached && <p className="ver-warn"><AlertTriangle size={15}/>Estás en una versión suelta, fuera de cualquier rama. Crea una rama para no perder lo que hagas aquí.</p>}
      {!status.auto_commit && <p className="ver-note"><Save size={14}/>Guardado automático desactivado (Ajustes → Versiones).</p>}
    </div>
    <div className="segmented ver-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><History size={15}/>Historial</button>
      <button role="tab" aria-selected={tab === 'branches'} className={tab === 'branches' ? 'on' : ''} onClick={() => setTab('branches')}><GitBranch size={15}/>Ramas</button>
      <button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}><Pencil size={15}/>Cambios{status.files.length ? <span className="count">{status.files.length}</span> : null}</button>
    </div>
    {tab === 'history' && <Timeline project={project} status={status} viewRef={viewRef} setViewRef={setViewRef} onOpen={setOpen} onAction={ask} reloadKey={reloadKey}/>}
    {tab === 'branches' && <Branches project={project} status={status} onAction={ask} onView={name => { setViewRef(name === status.branch ? '' : name); setTab('history'); }} reloadKey={reloadKey}/>}
    {tab === 'changes' && <Changes project={project} status={status} onDiff={showDiff} onSaved={refresh}/>}
    {open && !action && <CommitSheet project={project} sha={open} blocked={status.blocked} onClose={() => setOpen('')} onAction={ask} onDiff={showDiff}/>}
    {action && <ActionSheet action={action} project={project} onClose={() => setAction(null)} onDone={done}/>}
  </div>;
}
