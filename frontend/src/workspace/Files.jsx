import React, {lazy, Suspense, useEffect, useState} from 'react';
import {ArrowLeft, ChevronRight, File, FilePlus2, Folder, FolderOpen, FolderPlus, MoreVertical, Pencil, RefreshCw, Save, Trash2, Upload} from 'lucide-react';
import {api, bytes, post} from '../lib.js';
import {Confirm, Empty, Sheet, Spinner, toast} from '../ui.jsx';

const Editor = lazy(() => import('./Editor.jsx'));
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i;

export default function Files({project, desktop}) {
  const name = project.name;
  const [tree, setTree] = useState({}), [open, setOpen] = useState({'': true});
  const [file, setFile] = useState(null), [content, setContent] = useState(''), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(null), [prompt, setPrompt] = useState(null), [confirm, setConfirm] = useState(null);
  const dirty = file && !file.binary && !file.image && content !== file.content;

  const loadDir = async path => {
    try { const result = await api(`/api/files/list?project=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`); setTree(t => ({...t, [path]: result.entries})); }
    catch (err) { toast(err.message, 'error'); }
  };
  useEffect(() => { setTree({}); setOpen({'': true}); setFile(null); loadDir(''); }, [name]);
  const refreshOpen = () => Object.keys(open).filter(path => open[path]).forEach(loadDir);
  const toggle = entry => {
    const next = !open[entry.path];
    setOpen(o => ({...o, [entry.path]: next}));
    if (next && !tree[entry.path]) loadDir(entry.path);
  };

  const openFile = async (path, force = false) => {
    if (dirty && !force && !confirmDiscard()) return;
    if (IMAGE.test(path)) { setFile({path, image: true}); setContent(''); return; }
    setLoading(true);
    try {
      const result = await api(`/api/files/read?project=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`);
      setFile(result); setContent(result.content);
    } catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };
  const confirmDiscard = () => window.confirm('Hay cambios sin guardar. ¿Descartarlos?');
  const save = async () => {
    if (!file || file.binary || file.image || file.truncated || saving) return;
    setSaving(true);
    try {
      const result = await post('/api/files/write', {project: name, path: file.path, content, mtime: file.mtime});
      setFile(f => ({...f, content, mtime: result.mtime, size: result.size}));
      toast('Guardado', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };
  const parentOf = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const operate = async (action, path, to) => {
    try {
      const result = await post('/api/files/op', {project: name, action, path, to});
      toast(result.message, 'success');
      await loadDir(parentOf(path));
      if (to) await loadDir(parentOf(to));
      if (action === 'delete' && file?.path === path) setFile(null);
      if (action === 'create') openFile(path, true);
    } catch (err) { toast(err.message, 'error'); }
  };
  const upload = async (event, dir) => {
    const chosen = [...(event.target.files || [])];
    event.target.value = '';
    if (!chosen.length) return;
    const form = new FormData();
    chosen.forEach(f => form.append('file', f));
    try { const result = await api(`/api/files/upload?project=${encodeURIComponent(name)}&dir=${encodeURIComponent(dir)}`, {method: 'POST', body: form, timeout: 120000}); toast(result.message, 'success'); loadDir(dir); }
    catch (err) { toast(err.message, 'error'); }
  };

  const renderDir = (path, depth) => {
    const entries = tree[path];
    if (!entries) return <div className="tree-loading" style={{paddingLeft: 14 + depth * 14}}><Spinner size={13}/></div>;
    if (!entries.length) return <div className="tree-empty" style={{paddingLeft: 14 + depth * 14}}>Vacío</div>;
    return entries.map(entry => <React.Fragment key={entry.path}>
      <div className={`tree-row ${file?.path === entry.path ? 'on' : ''} ${entry.heavy ? 'heavy' : ''}`} style={{paddingLeft: 8 + depth * 14}}>
        <button className="tree-main" onClick={() => entry.type === 'dir' ? toggle(entry) : openFile(entry.path)}>
          {entry.type === 'dir' ? <><ChevronRight size={13} className={open[entry.path] ? 'rot90' : ''}/>{open[entry.path] ? <FolderOpen size={15}/> : <Folder size={15}/>}</> : <><span className="tree-spacer"/><File size={15}/></>}
          <span className="tree-name">{entry.name}</span>{entry.type === 'file' && <small>{bytes(entry.size)}</small>}
        </button>
        <button className="ghost-icon tree-more" onClick={() => setMenu(entry)} aria-label={`Opciones de ${entry.name}`}><MoreVertical size={15}/></button>
      </div>
      {entry.type === 'dir' && open[entry.path] && renderDir(entry.path, depth + 1)}
    </React.Fragment>);
  };

  const showEditor = desktop || file;
  const treePanel = <div className="tree-panel">
    <div className="tree-toolbar"><b>Archivos</b><span className="grow"/>
      <button className="icon-btn" onClick={() => setPrompt({action: 'create', dir: '', label: 'Nuevo archivo', value: ''})} aria-label="Nuevo archivo"><FilePlus2 size={16}/></button>
      <button className="icon-btn" onClick={() => setPrompt({action: 'mkdir', dir: '', label: 'Nueva carpeta', value: ''})} aria-label="Nueva carpeta"><FolderPlus size={16}/></button>
      <label className="icon-btn" aria-label="Subir archivos"><Upload size={16}/><input type="file" multiple hidden onChange={e => upload(e, '')}/></label>
      <button className="icon-btn" onClick={refreshOpen} aria-label="Recargar"><RefreshCw size={16}/></button>
    </div>
    <div className="tree">{renderDir('', 0)}</div>
  </div>;

  const editorPanel = <div className="editor-panel">
    {file ? <>
      <div className="editor-bar">
        {!desktop && <button className="icon-btn" onClick={() => { if (!dirty || confirmDiscard()) setFile(null); }} aria-label="Volver a archivos"><ArrowLeft size={18}/></button>}
        <span className="editor-path" title={file.path}>{file.path}{dirty && <i className="dirty-dot" aria-label="Sin guardar"/>}</span>
        <span className="grow"/>
        {!file.binary && !file.image && <button className="icon-btn" onClick={() => openFile(file.path, true)} aria-label="Recargar del servidor"><RefreshCw size={16}/></button>}
        {!file.binary && !file.image && <button className="btn small primary" onClick={save} disabled={!dirty || saving || file.truncated}>{saving ? <Spinner size={13}/> : <Save size={14}/>}Guardar</button>}
      </div>
      {loading ? <div className="editor-empty"><Spinner/> Abriendo…</div>
        : file.image ? <div className="image-view"><img src={`/api/files/raw?project=${encodeURIComponent(name)}&path=${encodeURIComponent(file.path)}`} alt={file.path}/></div>
        : file.binary ? <Empty title="Archivo binario" text={`${bytes(file.size)} · no se puede editar en el navegador`}/>
        : <>{file.truncated && <div className="editor-warn">Archivo grande: vista de solo lectura de los primeros 2 MB.</div>}
          <Suspense fallback={<div className="editor-empty"><Spinner/> Cargando editor…</div>}><Editor path={file.path} value={content} readOnly={file.truncated} onChange={setContent} onSave={save}/></Suspense></>}
    </> : <Empty icon={<File/>} title="Ningún archivo abierto" text="Elige un archivo a la izquierda para verlo o editarlo."/>}
  </div>;

  return <div className={`files ${desktop ? 'split' : ''}`}>
    {(desktop || !file) && treePanel}
    {showEditor && editorPanel}
    {menu && <Sheet title={menu.name} onClose={() => setMenu(null)}>
      <div className="menu-list">
        {menu.type === 'dir' && <button onClick={() => { setPrompt({action: 'create', dir: menu.path, label: `Nuevo archivo en ${menu.name}`, value: ''}); setMenu(null); }}><FilePlus2 size={17}/>Nuevo archivo aquí</button>}
        {menu.type === 'dir' && <button onClick={() => { setPrompt({action: 'mkdir', dir: menu.path, label: `Nueva carpeta en ${menu.name}`, value: ''}); setMenu(null); }}><FolderPlus size={17}/>Nueva carpeta aquí</button>}
        {menu.type === 'dir' && <label className="menu-upload"><Upload size={17}/>Subir archivos aquí<input type="file" multiple hidden onChange={e => { upload(e, menu.path); setMenu(null); }}/></label>}
        <button onClick={() => { setPrompt({action: 'rename', path: menu.path, label: `Renombrar ${menu.name}`, value: menu.path}); setMenu(null); }}><Pencil size={17}/>Renombrar o mover</button>
        <button className="danger" onClick={() => { setConfirm(menu); setMenu(null); }}><Trash2 size={17}/>Eliminar</button>
      </div>
    </Sheet>}
    {prompt && <Sheet title={prompt.label} onClose={() => setPrompt(null)}>
      <form onSubmit={event => {
        event.preventDefault();
        const value = prompt.value.trim().replace(/^\/+/, '');
        if (!value) return;
        if (prompt.action === 'rename') operate('rename', prompt.path, value);
        else operate(prompt.action, prompt.dir ? `${prompt.dir}/${value}` : value);
        setPrompt(null);
      }}>
        <input className="input" autoFocus value={prompt.value} onChange={e => setPrompt({...prompt, value: e.target.value})} placeholder={prompt.action === 'mkdir' ? 'nombre-carpeta' : 'ruta/archivo.ext'} spellCheck={false} autoCapitalize="none"/>
        <div className="sheet-actions"><button type="button" className="btn" onClick={() => setPrompt(null)}>Cancelar</button><button className="btn primary">Aceptar</button></div>
      </form>
    </Sheet>}
    {confirm && <Confirm title={`¿Eliminar ${confirm.name}?`} danger confirmLabel="Eliminar" text={confirm.type === 'dir' ? 'Se borrará la carpeta con todo su contenido. No se puede deshacer.' : 'El archivo se borrará del servidor. No se puede deshacer.'}
      onCancel={() => setConfirm(null)} onConfirm={() => { operate('delete', confirm.path); setConfirm(null); }}/>}
  </div>;
}
