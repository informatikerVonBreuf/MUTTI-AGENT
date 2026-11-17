// Export Markdown d’une conversation ou d’une session thématique, construit uniquement à partir des messages
// enregistrés et des citations contrôlées par le serveur.
import {documentTitle, formatFullDate, slug} from './format.mjs';

export function threadToMarkdown(thread, documents = []) {
  const byId = new Map(documents.map(doc => [doc.id, doc]));
  const lines = [`# ${thread.kind === 'thematic' ? thread.theme || thread.title : thread.title}`, ''];
  lines.push(`> ${thread.kind === 'thematic' ? 'Session thématique' : 'Conversation'} exportée depuis Folio — Archive vivante, le ${formatFullDate(new Date().toISOString())}.`);
  lines.push('> Les citations reproduisent mot pour mot des passages des rapports ; leur exactitude financière n’est pas garantie automatiquement.', '');
  for (const message of thread.messages || []) {
    lines.push(`## ${message.role === 'user' ? 'Question' : 'Réponse de Folio'} — ${formatFullDate(message.createdAt)}`, '', message.content.trim(), '');
    if (message.role === 'assistant' && message.citationsVerified && message.citations?.length) {
      lines.push('### Sources', '');
      message.citations.forEach((citation, index) => {
        const doc = byId.get(citation.documentId);
        const title = doc ? documentTitle(doc) : citation.title;
        lines.push(`${index + 1}. ${title}${citation.page ? `, page ${citation.page}` : ''}${citation.quote ? ` — « ${citation.quote} »` : ''}`);
      });
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function downloadThread(thread, documents) {
  const blob = new Blob([threadToMarkdown(thread, documents)], {type: 'text/markdown;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `folio-${slug(thread.kind === 'thematic' ? thread.theme || thread.title : thread.title)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
