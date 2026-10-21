/** What Tab stops on: enabled controls, links and anything with a tab stop of its own. */
export const TABBABLE =
  'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** A panel's tabbable controls in order; where the browser lays out, only the rendered ones. */
export function tabbables(panel: HTMLElement): HTMLElement[] {
  const all = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE))
  if (panel.getClientRects().length === 0) return all
  return all.filter((el) => el.getClientRects().length > 0 || el === document.activeElement)
}
