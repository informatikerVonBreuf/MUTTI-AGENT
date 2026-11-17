// Export DOCX d'une conversation ou d'une session thématique, sans dépendance : un document Office Open XML
// minimal (titres, paragraphes, citations) empaqueté dans une archive ZIP non compressée.
import {documentTitle, formatFullDate, slug} from './format.mjs';

const CRC_TABLE = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(bytes) { let crc = 0xFFFFFFFF; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }

// Archive ZIP « stockée » (méthode 0) : en-têtes locaux, répertoire central, fin de répertoire.
export function zip(files) {
  const encoder = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name), data = typeof content === 'string' ? encoder.encode(content) : content, crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true); entry.setUint16(14, 0x21, true); entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

const escapeXml = value => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (text, {bold = false, italic = false} = {}) => `<w:r>${bold || italic ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const paragraph = (text, style, options) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text, options)}</w:p>`;
// Markdown simple des réponses : titres « ### », gras « ** », références « [n] » conservées.
function markdownParagraphs(markdown) {
  return String(markdown || '').split(/\n{2,}/).map(block => block.trim()).filter(Boolean).map(block => {
    if (/^#{1,6}\s/.test(block)) return paragraph(block.replace(/^#{1,6}\s+/, ''), 'Heading3');
    const runs = block.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => part.startsWith('**') ? run(part.slice(2, -2), {bold: true}) : run(part.replace(/\n/g, ' ')));
    return `<w:p>${runs.join('')}</w:p>`;
  }).join('');
}

export function threadToDocx(thread, documents = []) {
  const byId = new Map(documents.map(doc => [doc.id, doc]));
  const title = thread.kind === 'thematic' ? thread.theme || thread.title : thread.title;
  const body = [paragraph(title, 'Title'),
    paragraph(`${thread.kind === 'thematic' ? 'Session thématique' : 'Conversation'} exportée depuis Folio — Archive vivante, le ${formatFullDate(new Date().toISOString())}.`, 'Subtitle'),
    paragraph('Les citations reproduisent mot pour mot des passages des rapports ; leur exactitude financière n’est pas garantie automatiquement.', null, {italic: true})];
  for (const message of thread.messages || []) {
    body.push(paragraph(`${message.role === 'user' ? 'Question' : 'Réponse de Folio'} — ${formatFullDate(message.createdAt)}`, 'Heading2'));
    body.push(message.role === 'user' ? paragraph(message.content.trim(), null, {italic: true}) : markdownParagraphs(message.content));
    if (message.role === 'assistant' && message.citationsVerified && message.citations?.length) {
      body.push(paragraph('Sources', 'Heading3'));
      message.citations.forEach((citation, index) => {
        const doc = byId.get(citation.documentId);
        body.push(`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${run(`${index + 1}. ${doc ? documentTitle(doc) : citation.title}${citation.page ? `, page ${citation.page}` : ''}`, {bold: true})}${citation.quote ? run(` — « ${citation.quote} »`) : ''}</w:p>`);
      });
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const style = (id, name, size, {bold = false, italic = false, color = '1F3B33', before = 0, after = 120} = {}) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="${before}" w:after="${after}"/></w:pPr><w:rPr><w:rFonts w:ascii="Palatino Linotype" w:hAnsi="Palatino Linotype"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Aptos" w:cs="Aptos"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${style('Title', 'Title', 44, {after: 160})}${style('Subtitle', 'Subtitle', 22, {italic: true, color: '5D6152'})}${style('Heading2', 'heading 2', 28, {bold: true, before: 280})}${style('Heading3', 'heading 3', 24, {bold: true, before: 200})}${style('Quote', 'Quote', 20, {color: '3E4A43'})}</w:styles>`;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['word/document.xml', document],
    ['word/styles.xml', styles],
  ];
  return zip(files);
}

export function downloadDocx(thread, documents) {
  const url = URL.createObjectURL(threadToDocx(thread, documents));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `folio-${slug(thread.kind === 'thematic' ? thread.theme || thread.title : thread.title)}.docx`;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
