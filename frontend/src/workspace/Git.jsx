import React, {useEffect, useState} from 'react';
import {ArrowLeft, GitBranch, GitCommitHorizontal, RefreshCw} from 'lucide-react';
import {api, post} from '../lib.js';
import {Empty, Spinner, toast} from '../ui.jsx';

const CODE = {M: 'modificado', A: 'nuevo', D: 'borrado', R: 'renombrado', '?': 'nuevo', U: 'conflicto'};

export default function Git({project, active}) {
  const [status, setStatus] = useState(null), [diff, setDiff] = useState(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => { try { setStatus(await api(`/api/git?project=${encodeURIComponent(project.name)}`)); } catch (err) { toast(err.message, 'error'); } };
  useEffect(() => { if (active) load(); }, [project.name, active]);
  const showDiff = async path => {
    setDiff({path, loading: true});
    try { setDiff({path, ...(await api(`/api/git/diff?project=${encodeURIComponent(project.name)}&path=${encodeURIComponent(path)}`))}); }
    catch (err) { toast(err.message, 'error'); setDiff(null); }
  };
  const commit = async event => {
    event.preventDefault();
    setBusy(true);
    try { const result = await post('/api/git', {project: project.name, action: 'commit', message}, {timeout: 90000}); toast(result.message, 'success'); setMessage(''); load(); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  if (!status) return <div className="editor-empty"><Spinner/> Leyendo repositorio…</div>;
  if (diff) return <div className="git">
    <div className="editor-bar"><button className="icon-btn" onClick={() => setDiff(null)} aria-label="Volver"><ArrowLeft size={18}/></button><span className="editor-path">{diff.path}</span></div>
    {diff.loading ? <div className="editor-empty"><Spinner/></div> : <pre className="diff-view">{(diff.diff || 'Sin diferencias').split('\n').map((line, i) => <div key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}>{line || ' '}</div>)}</pre>}
  </div>;
  return <div className="git">
    <div className="git-head"><GitBranch size={16}/><b>{status.repo ? status.branch : 'Sin repositorio git'}</b><span className="grow"/><button className="icon-btn" onClick={load} aria-label="Recargar"><RefreshCw size={15}/></button></div>
    <form className="commit-box" onSubmit={commit}>
      <input className="input" value={message} onChange={e => setMessage(e.target.value)} placeholder={status.repo ? 'Mensaje del commit' : 'Mensaje del primer commit (crea el repositorio)'}/>
      <button className="btn primary" disabled={busy || !message.trim() || (status.repo && !status.files.length)}>{busy ? <Spinner/> : <GitCommitHorizontal size={16}/>}Commit</button>
    </form>
    {status.repo && <section className="block">
      <div className="block-head"><h3>Cambios <span className="count">{status.files.length}</span></h3></div>
      {status.files.length ? <div className="git-files">{status.files.map(file => <button key={file.path} onClick={() => showDiff(file.path)}>
        <span className={`git-code c${file.code.trim()[0] || 'M'}`}>{file.code.trim() || 'M'}</span><span className="gf-path">{file.path}</span><small>{CODE[file.code.trim()[0]] || ''}</small></button>)}</div>
        : <Empty title="Todo confirmado" text="No hay cambios pendientes de commit."/>}
    </section>}
    {status.repo && status.commits.length > 0 && <section className="block">
      <div className="block-head"><h3>Historial</h3></div>
      <div className="commit-list">{status.commits.map(c => <div key={c.sha}><code>{c.sha}</code><span>{c.subject}</span><small>{c.author} · {c.when}</small></div>)}</div>
    </section>}
  </div>;
}
