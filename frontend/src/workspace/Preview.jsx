import React, {useEffect, useState} from 'react';
import {ExternalLink, Globe2, Monitor, RotateCw, Rocket, Smartphone} from 'lucide-react';
import {Empty} from '../ui.jsx';

export default function Preview({project, onDeploy, desktop}) {
  const urls = project.urls?.length ? project.urls : [project.url];
  const [base, setBase] = useState(urls[0]);
  const [path, setPath] = useState('/'), [draft, setDraft] = useState('/');
  const [version, setVersion] = useState(0), [device, setDevice] = useState('fill');
  useEffect(() => { if (!urls.includes(base)) setBase(urls[0]); }, [urls.join(',')]);
  // Recarga automática cuando el agente termina o acaba un despliegue de este proyecto.
  useEffect(() => {
    const reload = event => { if (event.detail?.project === project.name) setTimeout(() => setVersion(v => v + 1), 1500); };
    window.addEventListener('cm:run-finished', reload);
    window.addEventListener('cm:job-finished', reload);
    return () => { window.removeEventListener('cm:run-finished', reload); window.removeEventListener('cm:job-finished', reload); };
  }, [project.name]);
  const deployed = (project.container_details || []).length > 0;
  const go = event => { event.preventDefault(); const next = draft.startsWith('/') ? draft : `/${draft}`; setPath(next); setDraft(next); setVersion(v => v + 1); };
  const src = base + path;
  let sameOrigin = false;
  try { sameOrigin = new URL(src, location.href).origin === location.origin; } catch { sameOrigin = true; }
  return <div className="preview">
    <form className="preview-bar" onSubmit={go}>
      <button type="button" className="icon-btn" onClick={() => setVersion(v => v + 1)} aria-label="Recargar"><RotateCw size={16}/></button>
      <div className="url-field">
        <Globe2 size={14}/>
        {urls.length > 1 ? <select value={base} onChange={e => { setBase(e.target.value); setVersion(v => v + 1); }}>{urls.map(url => <option key={url} value={url}>{url.replace('https://', '')}</option>)}</select>
          : <span className="url-host">{base.replace('https://', '')}</span>}
        <input value={draft} onChange={e => setDraft(e.target.value)} aria-label="Ruta" spellCheck={false} autoCapitalize="none"/>
      </div>
      {desktop && <button type="button" className="icon-btn" onClick={() => setDevice(device === 'fill' ? 'phone' : 'fill')} aria-label="Cambiar tamaño" title={device === 'fill' ? 'Ver como celular' : 'Ancho completo'}>{device === 'fill' ? <Smartphone size={16}/> : <Monitor size={16}/>}</button>}
      <a className="icon-btn" href={src} target="_blank" rel="noreferrer" aria-label="Abrir en otra pestaña"><ExternalLink size={16}/></a>
    </form>
    {sameOrigin ? <Empty icon={<Globe2/>} title="Este es el propio panel" text="Abre Codex Manager en otra pestaña. Su acceso está protegido contra la incrustación en marcos."><a className="btn" href={src} target="_blank" rel="noreferrer">Abrir en otra pestaña</a></Empty> : deployed ? <div className={`preview-stage ${device}`}>
      <iframe key={`${src}#${version}`} src={src} title={`Vista previa de ${project.name}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" allow="clipboard-write; fullscreen"/>
    </div> : <Empty icon={<Rocket/>} title="Todavía no está publicado" text="Despliégalo para ver la vista previa aquí.">
      <button className="btn primary" onClick={onDeploy}><Rocket size={16}/>Desplegar ahora</button>
    </Empty>}
  </div>;
}
