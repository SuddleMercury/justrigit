// Tiny Markdown renderer for the generated import guides (headings, lists, tables,
// blockquotes, code, bold/italic). Input is our own generated text, escaped first.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');

export function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^#{1,4} /.test(l)) { const n = l.match(/^#+/)[0].length; html += `<h${n + 1}>${inline(l.slice(n + 1))}</h${n + 1}>`; i++; continue; }
    if (/^---\s*$/.test(l)) { html += '<hr>'; i++; continue; }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s|:-]+\|$/.test(r));
      html += '<table>' + body.map((r, k) => `<tr>${cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('') + '</table>';
      continue;
    }
    if (/^> /.test(l)) {
      const q = [];
      while (i < lines.length && /^> ?/.test(lines[i]) && lines[i].trim()) { q.push(lines[i].replace(/^> ?/, '')); i++; }
      html += `<blockquote>${q.map(inline).join('<br>')}</blockquote>`;
      continue;
    }
    if (/^(\s*[-*] |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items = [];
      while (i < lines.length && /^(\s*[-*] |\d+\. )/.test(lines[i])) { items.push(lines[i].replace(/^(\s*[-*] |\d+\. )/, '')); i++; }
      html += `<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||> |---|\s*[-*] |\d+\. )/.test(lines[i])) { para.push(lines[i]); i++; }
    html += `<p>${inline(para.join(' '))}</p>`;
  }
  return html;
}
