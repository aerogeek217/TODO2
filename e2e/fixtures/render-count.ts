import type { Page } from '@playwright/test'

/**
 * Counts how often named React components render, with no app code: a
 * stand-in for the React DevTools hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`),
 * installed before the app loads, walks each committed fiber tree the way
 * DevTools does — a fiber rendered when it is new, or when it was redone in
 * this commit and did work (the `PerformedWork` flag); a subtree whose child
 * list wasn't redone was skipped. Component names are the dev server's
 * (function names), so this works against `npm run dev` only.
 *
 * For checks like "a divider drag re-renders no task row": reset, act, read.
 */

declare global {
  interface Window {
    __renderCounts?: Record<string, number>
  }
}

/** Installs the counter for components named `names` (call before the first `goto`). */
export async function installRenderCounter(page: Page, names: readonly string[]): Promise<void> {
  await page.addInitScript((watched) => {
    interface Fiber {
      type: unknown
      flags: number
      child: Fiber | null
      sibling: Fiber | null
      alternate: Fiber | null
    }
    const PERFORMED_WORK = 1
    const names = new Set(watched)
    const counts: Record<string, number> = Object.fromEntries(watched.map((n) => [n, 0]))
    window.__renderCounts = counts
    const nameOf = (type: unknown): string | undefined => {
      if (typeof type === 'function') return (type as { displayName?: string; name?: string }).displayName ?? type.name
      if (type && typeof type === 'object' && 'type' in type) return nameOf((type as { type: unknown }).type)
      return undefined
    }
    const visit = (next: Fiber, prev: Fiber | null) => {
      const name = nameOf(next.type)
      if (name && names.has(name) && (prev === null || (next !== prev && (next.flags & PERFORMED_WORK) !== 0))) {
        counts[name] = (counts[name] ?? 0) + 1
      }
      // Children redone in this commit (or new); an unchanged child list was skipped.
      if (prev !== null && next.child === prev.child) return
      for (let c = next.child; c; c = c.sibling) visit(c, prev === null ? null : c.alternate)
    }
    const renderers = new Map<number, unknown>()
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true,
      value: {
        renderers,
        supportsFiber: true,
        isDisabled: false,
        checkDCE() {},
        inject(internals: unknown) {
          const id = renderers.size + 1
          renderers.set(id, internals)
          return id
        },
        onCommitFiberRoot(_id: number, root: { current: Fiber }) {
          visit(root.current, root.current.alternate)
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        setStrictMode() {},
      },
    })
  }, [...names])
}

/** Sets every count back to 0. */
export async function resetRenderCounts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const counts = window.__renderCounts
    if (counts) for (const k of Object.keys(counts)) counts[k] = 0
  })
}

/** The renders counted since the last reset, by component name. */
export async function readRenderCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...(window.__renderCounts ?? {}) }))
}
