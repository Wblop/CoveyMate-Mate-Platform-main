export interface InsightRichTextSource {
  readonly sourceName?: string | null;
  readonly publisher?: string | null;
  readonly headline?: string | null;
  readonly sourceUrl?: string | null;
  readonly position?: number | null;
}

const QUOTED_PHRASE_PATTERN = /(?<!\*)("[^"]{8,220}"|“[^”]{8,220}”)(?!\*)/g;

export function renderInsightRichText(value: string, sources: readonly InsightRichTextSource[] = []): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }

  return renderInlineHtml(autoFormatInlineText(trimmed, sources), 0);
}

export function renderInsightMarkdownPreview(markdown: string, sources: readonly InsightRichTextSource[] = []): string {
  const normalized = (markdown ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return '<p>No draft content yet. Add article copy to preview it here.</p>';
  }

  const blocks: string[] = [];
  const paragraphLines: string[] = [];
  const listItems: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push(`<p>${renderInsightRichText(paragraphLines.join(' ').trim(), sources)}</p>`);
    paragraphLines.length = 0;
  };

  const flushList = (): void => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInsightRichText(item, sources)}</li>`).join('')}</ul>`);
    listItems.length = 0;
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`);
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${escapeHtml(line.slice(4).trim())}</h3>`);
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join('');
}

function autoFormatInlineText(value: string, sources: readonly InsightRichTextSource[]): string {
  const linked = linkSourceMentions(value, sources);
  return linked.replace(QUOTED_PHRASE_PATTERN, '*$1*');
}

function linkSourceMentions(value: string, sources: readonly InsightRichTextSource[]): string {
  if (sources.length === 0) {
    return value;
  }

  let updated = value;
  const orderedSources = [...sources].sort((left, right) => (left.position ?? 0) - (right.position ?? 0));

  for (const source of orderedSources) {
    const sourceUrl = (source.sourceUrl ?? '').trim();
    if (!isSafeHttpUrl(sourceUrl) || updated.includes(sourceUrl)) {
      continue;
    }

    for (const term of buildSourceLinkTerms(source)) {
      const linked = linkFirstMatch(updated, term, sourceUrl);
      if (linked !== updated) {
        updated = linked;
        break;
      }
    }
  }

  return updated;
}

function buildSourceLinkTerms(source: InsightRichTextSource): string[] {
  return [...new Set([source.publisher, source.sourceName].map((value) => (value ?? '').trim()).filter((value) => value.length >= 4))]
    .sort((left, right) => right.length - left.length);
}

function linkFirstMatch(value: string, term: string, url: string): string {
  if (!value || !term) {
    return value;
  }

  const lowerValue = value.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let searchIndex = 0;

  while (searchIndex < value.length) {
    const index = lowerValue.indexOf(lowerTerm, searchIndex);
    if (index < 0) {
      return value;
    }

    const before = index > 0 ? value[index - 1] : '';
    const after = index + term.length < value.length ? value[index + term.length] : '';
    const insideExistingLink = value.lastIndexOf('[', index) > value.lastIndexOf(']', index);
    const hasWordBoundaryBefore = !before || /[^\p{L}\p{N}]/u.test(before);
    const hasWordBoundaryAfter = !after || /[^\p{L}\p{N}]/u.test(after);

    if (!insideExistingLink && hasWordBoundaryBefore && hasWordBoundaryAfter) {
      return `${value.slice(0, index)}[${value.slice(index, index + term.length)}](${url})${value.slice(index + term.length)}`;
    }

    searchIndex = index + term.length;
  }

  return value;
}

function renderInlineHtml(value: string, depth: number): string {
  if (depth > 4 || !value) {
    return escapeHtml(value);
  }

  let html = '';

  for (let index = 0; index < value.length;) {
    const link = tryReadMarkdownLink(value, index);
    if (link) {
      html += `<a href="${escapeAttribute(link.url)}" target="_blank" rel="noopener noreferrer">${renderInlineHtml(link.text, depth + 1)}</a>`;
      index += link.consumedLength;
      continue;
    }

    const emphasis = tryReadEmphasis(value, index);
    if (emphasis) {
      html += `<em>${renderInlineHtml(emphasis.text, depth + 1)}</em>`;
      index += emphasis.consumedLength;
      continue;
    }

    html += escapeHtml(value[index] ?? '');
    index += 1;
  }

  return html;
}

function tryReadMarkdownLink(value: string, startIndex: number): { consumedLength: number; text: string; url: string } | null {
  if (startIndex >= value.length || value[startIndex] !== '[') {
    return null;
  }

  const closingBracketIndex = value.indexOf(']', startIndex + 1);
  if (closingBracketIndex <= startIndex + 1 || closingBracketIndex + 1 >= value.length || value[closingBracketIndex + 1] !== '(') {
    return null;
  }

  const closingParenthesisIndex = value.indexOf(')', closingBracketIndex + 2);
  if (closingParenthesisIndex <= closingBracketIndex + 2) {
    return null;
  }

  const text = value.slice(startIndex + 1, closingBracketIndex).trim();
  const url = value.slice(closingBracketIndex + 2, closingParenthesisIndex).trim();
  if (!text || !isSafeHttpUrl(url)) {
    return null;
  }

  return {
    consumedLength: closingParenthesisIndex - startIndex + 1,
    text,
    url
  };
}

function tryReadEmphasis(value: string, startIndex: number): { consumedLength: number; text: string } | null {
  if (startIndex >= value.length) {
    return null;
  }

  const marker = value[startIndex];
  if ((marker !== '*' && marker !== '_') || startIndex + 2 >= value.length || value[startIndex + 1] === marker) {
    return null;
  }

  let closingIndex = value.indexOf(marker, startIndex + 1);
  while (closingIndex > startIndex) {
    const text = value.slice(startIndex + 1, closingIndex);
    if (text && !text.includes('\n') && !text.startsWith(' ') && !text.endsWith(' ')) {
      return {
        consumedLength: closingIndex - startIndex + 1,
        text
      };
    }

    closingIndex = value.indexOf(marker, closingIndex + 1);
  }

  return null;
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
