/**
 * Work to run when the page is hidden (`visibilitychange` to hidden) or
 * unloaded (`pagehide`): the notes' pending saves, so closing the tab right
 * after typing keeps what was typed. A callback must start its write
 * synchronously — nothing after the handler is guaranteed to run.
 */

const callbacks = new Set<() => void>()
let installed = false

function runAll(): void {
  for (const run of [...callbacks]) {
    try {
      run()
    } catch (e) {
      console.error('Failed to save before the page was hidden:', e)
    }
  }
}

function install(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') runAll()
  })
  window.addEventListener('pagehide', runAll)
}

/** Runs `run` whenever the page is hidden or unloaded, until the returned function is called. */
export function onPageHide(run: () => void): () => void {
  install()
  callbacks.add(run)
  return () => { callbacks.delete(run) }
}
