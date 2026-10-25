import { flushSync } from 'react-dom'

/**
 * Runs a workspace change inside a View Transition (D19): a layout switch, a
 * tab change, a group collapse. Named parts (`viewTransitionName`: each cell,
 * each list group) slide and resize to their new place, the rest crossfades —
 * 220 ms on the spring curve (`tokens.css`). Where the API is missing, or
 * under reduced motion, the change just happens.
 *
 * `update` may be async (a layout switch reads the layout first): the new
 * picture is taken once it has settled and React has rendered it.
 */
export function withViewTransition(update: () => unknown): void {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Feature-detected: older engines (and JSDOM) have no `startViewTransition`.
  if (typeof (document as Partial<Document>).startViewTransition !== 'function' || reduced) {
    void update()
    return
  }
  document.startViewTransition(async () => {
    await update()
    flushSync(() => {})
  })
}

/** A `view-transition-name` from ids (a custom ident: anything else becomes `_`). Unique per document, or the transition is skipped. */
export function transitionName(prefix: string, ...ids: Array<string | number>): string {
  return [prefix, ...ids].join('-').replace(/[^a-zA-Z0-9_-]/g, '_')
}
