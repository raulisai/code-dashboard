import React, {useState} from 'react';
import {ArrowUpCircle, ChevronRight, Clock3, ListTodo, RotateCcw, Square, Trash2} from 'lucide-react';
import {useApp} from '../App.jsx';
import {navigate, post, providerLabel, taskLabel} from '../lib.js';
import {Empty, ProviderMark, StatusPill, toast} from '../ui.jsx';
import {Approval} from '../workspace/Agent.jsx';

export default function Queue() {
  const {state, refresh} = useApp();
  const [project, setProject] = useState(() => new URLSearchParams(location.search).get('project') || '');
  const rows = state.task_records.filter(t => !project || t.project === project).slice().reverse();
  const groups = [
    ['working', 'Trabajando ahora', rows.filter(t => t.status === 'working')],
    ['espera', 'En cola', rows.filter(t => t.status === 'espera').reverse()],
    ['done', 'Recientes', rows.filter(t => t.status === 'terminado' || t.status === 'error').slice(0, 30)],
  ];
  const act = async (body, ok) => {
    try { const result = await post('/api/tasks', body); toast(ok || result.message, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
  };
  const answer = async (approval, decision, remember) => {
    try { await post('/api/approvals', {run_id: approval.run_id, request_id: approval.id, decision, remember}); refresh(); } catch (err) { toast(err.message, 'error'); }
  };
  return <div className="page-pad">
    <header className="page-title"><div><div className="eyebrow">AGENTES</div><h1>Cola de peticiones</h1>
      <p className="muted">Cada mensaje es una petición. Se atiende una por proyecto y agente a la vez; las demás esperan su turno y salen solas en cuanto el agente queda libre.</p></div>
      <select className="select" value={project} onChange={e => setProject(e.target.value)} aria-label="Filtrar por proyecto"><option value="">Todos los proyectos</option>{state.projects.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</select>
    </header>
    <div className="status-line"><span className={state.tmux_ok ? 'dot on' : 'dot bad'}/>{state.automation?.last_message}</div>
    {(state.approvals || []).length > 0 && <section className="block"><div className="block-head"><h2>Esperan tu aprobación</h2></div>
      {state.approvals.map(approval => <div key={approval.id} className="approval-wrap"><a className="link-small" href={`/p/${approval.project}?chat=${approval.chat_id || 'main'}`} onClick={e => { e.preventDefault(); navigate(`/p/${approval.project}?chat=${approval.chat_id || 'main'}`); }}>{approval.project}<ChevronRight size={12}/></a><Approval approval={approval} onAnswer={answer}/></div>)}
    </section>}
    {groups.map(([key, title, list]) => <section className="block" key={key}>
      <div className="block-head"><h2>{title} <span className="count">{list.length}</span></h2></div>
      {list.length ? <div className="task-list">{list.map(task => <div className={`task-row ${task.status}`} key={task.id}>
        <ProviderMark provider={task.provider} size={28}/>
        <button className="task-main" onClick={() => navigate(`/p/${task.project}?chat=${task.chat_id || 'main'}`)}>
          <b>{task.title || '(sin título)'}</b>
          <small>{task.project} · {providerLabel(task.provider)} · {task.started_at || task.date}{task.priority === 'alta' ? ' · prioridad alta' : ''}</small>
          {task.result && task.status !== 'working' && <small className={task.status === 'error' ? 'err-text' : 'muted'}>{task.result}</small>}
        </button>
        <StatusPill status={task.status}>{taskLabel(task.status)}</StatusPill>
        <div className="row-actions">
          {task.status === 'working' && <button className="icon-btn danger" onClick={() => act({action: 'stop', id: task.id})} aria-label="Detener"><Square size={14}/></button>}
          {task.status === 'espera' && task.priority !== 'alta' && <button className="icon-btn" onClick={() => act({action: 'dispatch', id: task.id})} aria-label="Priorizar" title="Mover al frente"><ArrowUpCircle size={16}/></button>}
          {(task.status === 'error' || task.status === 'terminado') && <button className="icon-btn" onClick={() => act({action: 'retry', id: task.id}, 'Petición devuelta a la cola')} aria-label="Repetir" title="Volver a enviar"><RotateCcw size={15}/></button>}
          {task.status !== 'working' && <button className="icon-btn" onClick={() => act({action: 'delete', id: task.id})} aria-label="Eliminar"><Trash2 size={15}/></button>}
        </div>
      </div>)}</div> : <Empty icon={key === 'espera' ? <Clock3/> : <ListTodo/>} title={key === 'working' ? 'Ningún agente trabajando' : key === 'espera' ? 'No hay nada en cola' : 'Sin historial'}/>}
    </section>)}
  </div>;
}
