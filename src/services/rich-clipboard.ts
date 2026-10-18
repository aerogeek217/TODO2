/**
 * Rich clipboard writes: what rich copy (notes, task lists, the dashboard
 * summary, check-in emails) puts on the clipboard for OneNote / Word /
 * Outlook / Gmail — `text/html` and `text/plain` together.
 */

/** Wraps clipboard HTML in the body font the paste targets expect. */
export function wrapClipboardHtml(body: string): string {
  return `<div style="font-family: Calibri, 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.45;">${body}</div>`
}

/**
 * Writes rich HTML + plain text to the clipboard. Returns true on success.
 * Falls back to plain-text-only when `ClipboardItem` is unavailable or
 * rejects (older browsers, insecure contexts).
 */
export async function writeRichClipboard(html: string, plain: string): Promise<boolean> {
  try {
    const ClipItem = (globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (!ClipItem) throw new Error('ClipboardItem unsupported')
    const item = new ClipItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return true
  } catch {
    try {
      await navigator.clipboard.writeText(plain)
      return true
    } catch {
      return false
    }
  }
}
