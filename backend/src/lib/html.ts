/**
 * The compose editor is a contenteditable, so `body` arrives as an HTML
 * fragment. These helpers turn it into the two parts an email needs.
 *
 * The sanitiser is deliberately small: it strips the tags and attributes that
 * could execute, which is what matters for content we store and re-render. A
 * production system would use a vetted library (DOMPurify / sanitize-html)
 * rather than regexes - noted as a trade-off in the README.
 */

const BLOCKED_ELEMENTS = /<\s*(script|iframe|object|embed|link|meta|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const BLOCKED_VOID_ELEMENTS = /<\s*(script|iframe|object|embed|link|meta|style)\b[^>]*\/?>/gi;
/** Inline event handlers: onclick=..., onerror=... */
const EVENT_HANDLERS = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
/** javascript: and data: URLs in href/src. */
const DANGEROUS_URLS = /\s(href|src)\s*=\s*(?:"\s*(?:javascript|data):[^"]*"|'\s*(?:javascript|data):[^']*')/gi;

export function sanitizeHtml(input: string): string {
  return input
    .replace(BLOCKED_ELEMENTS, '')
    .replace(BLOCKED_VOID_ELEMENTS, '')
    .replace(EVENT_HANDLERS, '')
    .replace(DANGEROUS_URLS, '');
}

/** Plain-text alternative part, preserving line structure from block tags. */
export function htmlToText(input: string): string {
  return input
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Short single-line summary used for the list rows. */
export function toPreview(input: string, maxLength = 160): string {
  const text = htmlToText(input).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
