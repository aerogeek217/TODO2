/**
 * Platform detection + keyboard-shortcut label formatting.
 *
 * `isMacLike()` is true on macOS / iOS / iPadOS so that shortcut hints
 * show `⌘T` on those platforms and `Ctrl+T` everywhere else. We prefer
 * `navigator.userAgentData.platform` when available (UA-CH) and fall
 * back to `navigator.platform`.
 */

export function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platform =
    nav.userAgentData?.platform ||
    nav.platform ||
    ''
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform)
}

/**
 * Format a CodeMirror-style shortcut spec (`"Mod-t"`, `"Mod-Shift-k"`)
 * into a user-facing label. `Mod` becomes `⌘` on Mac-like platforms and
 * `Ctrl` elsewhere. Arrow and common named keys are passed through.
 */
export function formatShortcut(spec: string): string {
  const mac = isMacLike()
  const modLabel = mac ? '⌘' : 'Ctrl'
  const shiftLabel = mac ? '⇧' : 'Shift'
  const altLabel = mac ? '⌥' : 'Alt'
  const sep = mac ? '' : '+'

  const parts = spec.split('-').map((part, idx, arr) => {
    const isLast = idx === arr.length - 1
    if (part === 'Mod') return modLabel
    if (part === 'Shift') return shiftLabel
    if (part === 'Alt') return altLabel
    if (part === 'Ctrl') return 'Ctrl'
    if (part === 'Cmd') return '⌘'
    if (isLast && part.length === 1) return part.toUpperCase()
    return part
  })

  return parts.join(sep)
}
