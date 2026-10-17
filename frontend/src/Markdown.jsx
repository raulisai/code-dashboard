import React, {useState} from 'react';
import {Check, Copy} from 'lucide-react';

// Markdown mínimo y seguro (sin innerHTML): párrafos, títulos, listas, citas,
// bloques de código con botón copiar, `código`, **negrita**, *cursiva* y enlaces.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text, keyBase) {
  const parts = String(text).split(INLINE);
  return parts.map((part, index) => {
    const key = `${keyBase}-${index}`;
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code key={key}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (/^https?:\/\//.test(part)) return <a key={key} href={part} target="_blank" rel="noreferrer">{part}</a>;
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function CodeBlock({code, lang}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sin portapapeles */ } };
  return <div className="md-code"><div className="md-code-head"><span>{lang || 'código'}</span><button type="button" onClick={copy} aria-label="Copiar">{copied ? <Check size={14}/> : <Copy size={14}/>}</button></div><pre><code>{code}</code></pre></div>;
}

export default function Markdown({text}) {
  const blocks = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let index = 0, key = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(<CodeBlock key={key++} code={code.join('\n')} lang={fence[1]}/>);
      continue;
    }
    if (!line.trim()) { index++; continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) { const Tag = `h${Math.min(6, heading[1].length + 2)}`; blocks.push(<Tag key={key++}>{inline(heading[2], key)}</Tag>); index++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index])) {
        const content = lines[index].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = content.match(/^\[([ xX])\]\s+(.*)/);
        items.push(<li key={index} className={task ? 'md-task' : undefined}>{task ? <><input type="checkbox" readOnly checked={task[1] !== ' '}/>{inline(task[2], index)}</> : inline(content, index)}</li>);
        index++;
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key++}>{inline(quote.join(' '), key)}</blockquote>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) rows.push(lines[index++]);
      const cells = rows.filter(row => !/^\s*\|[\s:|-]+\|\s*$/.test(row)).map(row => row.trim().slice(1, -1).split('|').map(cell => cell.trim()));
      blocks.push(<div className="md-table" key={key++}><table><tbody>{cells.map((row, r) => <tr key={r}>{row.map((cell, c) => r === 0 ? <th key={c}>{inline(cell, `${r}${c}`)}</th> : <td key={c}>{inline(cell, `${r}${c}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^\s*(```|#{1,4}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(lines[index])) paragraph.push(lines[index++]);
    if (!paragraph.length) paragraph.push(lines[index++]);
    blocks.push(<p key={key++}>{paragraph.map((part, i) => <React.Fragment key={i}>{i > 0 && <br/>}{inline(part, `${key}-${i}`)}</React.Fragment>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
