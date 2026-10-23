/** What Tab stops on: enabled controls, links and anything with a tab stop of its own. */
export const TABBABLE =
  'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** A panel's tabbable controls in order; where the browser lays out, only the rendered ones. */
export function tabbables(panel: HTMLElement): HTMLElement[] {
  const all = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE))
  if (panel.getClientRects().length === 0) return all
  return all.filter((el) => el.getClientRects().length > 0 || el === document.activeElement)
}

/**
 * Tab past the last tabbable control of `from` (Shift+Tab before its first)
 * goes on into `to` (e.g. the top bar's filter tray and the panel hanging
 * from it: one Tab cycle).
 */
export function tabAcross(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  from: HTMLElement | null,
  to: HTMLElement | null,
): void {
  if (e.key !== 'Tab' || !from || !to) return
  const items = tabbables(from)
  const active = document.activeElement
  const atEdge = e.shiftKey ? active === from || active === items.at(0) : active === items.at(-1)
  if (!atEdge) return
  const into = tabbables(to)
  const next = e.shiftKey ? into.at(-1) : into.at(0)
  e.preventDefault()
  ;(next ?? to).focus()
}
