import { flushSync } from 'react-dom'
import { prefersReducedMotion } from '../../utils/motion'

/**
 * Runs a workspace change inside a View Transition (D19): a cell's tab
 * change, a list group's collapse. Named parts (`viewTransitionName`: each
 * cell, each list group) slide and resize to their new place and crossfade —
 * 220 ms on the spring curve; the rest of the page is left out and changes
 * at once (`tokens.css`). Where the API is missing, or under reduced motion,
 * the change just happens.
 *
 * A layout switch runs none (cr34 answer 26): every cell is new, so nothing
 * morphs, and from a transition's start until its update has rendered the
 * browser shows the old picture frozen and sends every press to the root —
 * a layout's mount is long enough for that to lose presses.
 *
 * **Keep `update` synchronous** (cr34 H4): the page is frozen for as long as
 * it runs. While the animation itself runs, everything but the pictured
 * cells' contents takes presses as ever (`tokens.css`).
 */
export function withViewTransition(update: () => void): void {
  // Feature-detected: older engines (and JSDOM) have no `startViewTransition`.
  if (typeof (document as Partial<Document>).startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }
  document.startViewTransition(() => {
    update()
    flushSync(() => {})
  })
}

/** A `view-transition-name` from ids (a custom ident: anything else becomes `_`). Unique per document, or the transition is skipped. */
export function transitionName(prefix: string, ...ids: Array<string | number>): string {
  return [prefix, ...ids].join('-').replace(/[^a-zA-Z0-9_-]/g, '_')
}
