import { flushSync } from 'react-dom'
import { prefersReducedMotion } from '../../utils/motion'

/**
 * Runs a workspace change inside a View Transition (D19): a layout switch, a
 * tab change, a group collapse. Named parts (`viewTransitionName`: each cell,
 * each list group) slide and resize to their new place and crossfade —
 * 220 ms on the spring curve; the rest of the page is left out and changes
 * at once (`tokens.css`). Where the API is missing, or under reduced motion,
 * the change just happens.
 *
 * **Keep `update` synchronous** (cr34 H4): from the transition's start until
 * `update` has run and React has rendered it, the browser shows the old
 * picture frozen and sends every press to the root element — a press made
 * then does nothing. So whatever must be awaited (a layout switch's read and
 * writes) runs first, and only the state change is handed here
 * (`workspace-store.load`'s `show`). An async `update` still works — the new
 * picture is taken once it has settled — but holds the page for as long.
 * While the animation itself runs, everything but the pictured cells'
 * contents takes presses as ever (`tokens.css`).
 */
export function withViewTransition(update: () => unknown): void {
  void viewTransition(update)
}

/**
 * `withViewTransition`, resolving once `update` has run and React has
 * rendered it (at once where no transition runs): for a caller with work to
 * do after the change shows.
 */
export function viewTransition(update: () => unknown): Promise<void> {
  // Feature-detected: older engines (and JSDOM) have no `startViewTransition`.
  if (typeof (document as Partial<Document>).startViewTransition !== 'function' || prefersReducedMotion()) {
    return Promise.resolve(update()).then(() => undefined)
  }
  return new Promise<void>((resolve) => {
    document.startViewTransition(async () => {
      try {
        await update()
        flushSync(() => {})
      } finally {
        resolve()
      }
    })
  })
}

/** A `view-transition-name` from ids (a custom ident: anything else becomes `_`). Unique per document, or the transition is skipped. */
export function transitionName(prefix: string, ...ids: Array<string | number>): string {
  return [prefix, ...ids].join('-').replace(/[^a-zA-Z0-9_-]/g, '_')
}
