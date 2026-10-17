export function presentationParts(value) {
  const text = String(value || ''), parts = []; let offset = 0, count = 0;
  const pattern = /```cm-ui\s*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push({text: text.slice(offset, match.index)});
    try {
      if (++count > 6 || match[1].length > 64000) throw Error();
      const spec = JSON.parse(match[1]);
      if (!spec || !['chart', 'table', 'html', 'file'].includes(spec.type)) throw Error();
      parts.push({spec});
    } catch { parts.push({text:'No se pudo mostrar una presentación con formato inválido.'}); }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({text: text.slice(offset).replace(/```cm-ui[\s\S]*$/, '')});
  return parts;
}

export function filePresentation(spec) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(spec.project || '')) return null;
  const path = String(spec.path || '');
  if (!path || path.length > 400 || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.git') || /[\\\0]/.test(path)) return null;
  const ext = path.split('.').at(-1).toLowerCase();
  if (!['png','jpg','jpeg','gif','webp','svg','pdf','txt','md','json','csv','html'].includes(ext)) return null;
  return {ext, path, query: new URLSearchParams({project:spec.project, path}).toString()};
}

export function chartValues(spec) {
  if (!Array.isArray(spec.labels) || !Array.isArray(spec.values)) return [];
  return spec.values.slice(0,80).map((value, i) => ({label:String(spec.labels[i] ?? i+1).slice(0,50), value:Number(value)})).filter(p => Number.isFinite(p.value) && Math.abs(p.value) <= 1e12);
}
