/**
 * Escapes text for HTML built as a string (clipboard HTML, emails, the
 * check-in preview). Covers `& < > " '`, so the result is safe both as
 * element text and inside a quoted attribute value.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const HTML_ENTITY_CHARS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

/** Inverse of `escapeHtml` (one pass, so `&amp;lt;` stays `&lt;`). */
export function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (m, name: string) => HTML_ENTITY_CHARS[name] ?? m)
}
