/**
 * Mint a fresh task `uid` (cr1 P4): an RFC 4122 v4 UUID.
 *
 * `crypto.randomUUID` needs a secure context; the offline single-file build
 * can be opened from origins where it is missing, so fall back to
 * `crypto.getRandomValues` (available everywhere) with the same format.
 */
export function newTodoUid(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
