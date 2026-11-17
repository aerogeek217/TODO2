/**
 * dnd-kit 6 tells neither `DndContext`'s props nor its monitors that a drag
 * ended when it ends before the render its start scheduled has committed: the
 * end handler builds its event from the sensor context, which a layout effect
 * fills after that render, and with no event it calls nothing. A quick flick —
 * pressed, moved past the activation distance, let go — on a busy workspace
 * does it, and the drag's own state then outlives the drag (a list kept
 * drawing its drop slot under the pointer until the widget remounted).
 *
 * Watches the ways dnd-kit's pointer sensor ends a drag — the release, a
 * pointer cancel, Esc, the window resized or hidden — and, once dnd-kit has
 * had its turn (it ends a drag synchronously inside that event, so the next
 * task is after it), calls `orphaned` if `isCurrent` says this drag is still
 * on. Returns the function that stops watching (call it when the drag ends).
 */
export function watchDragRelease(isCurrent: () => boolean, orphaned: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const check = () => {
    if (timer != null) return
    timer = setTimeout(() => {
      timer = null
      if (isCurrent()) orphaned()
    }, 0)
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') check() }
  const onVisibility = () => { if (document.visibilityState === 'hidden') check() }
  window.addEventListener('pointerup', check, true)
  window.addEventListener('pointercancel', check, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', check)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    if (timer != null) clearTimeout(timer)
    timer = null
    window.removeEventListener('pointerup', check, true)
    window.removeEventListener('pointercancel', check, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', check)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
