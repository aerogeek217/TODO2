import { useEffect, type RefObject } from 'react'
import { isInLayerAbove, isPageTarget } from '../utils/dom-layers'
import { carryOnAfterLeave } from './use-editor-leave'
import { useLatestRef } from './use-latest-ref'

/**
 * The close events of a non-modal editor that holds a copy until its Save
 * (Edit list, the widget editors): Esc and a press elsewhere, each asking
 * it to close (`requestClose`, which closes at once while unchanged and
 * asks while it has changes — `use-editor-leave`). What counts as inside
 * is each editor's own; the event plumbing is this one.
 */

/**
 * Esc asks the editor to close when the key comes from inside `panel` (or
 * with nothing focused) and nothing inside handled it first — a menu or a
 * filter picker opened from it, the expression field putting its text back,
 * the close question take their own Esc. Bubble phase, after those layers.
 * `leaveLayersAbove`: a key from a layer stacked above the panel
 * (`isInLayerAbove`) is that layer's too (the widget editors).
 */
export function useEscapeCloses(
  panel: RefObject<HTMLElement | null>,
  requestClose: () => unknown,
  { leaveLayersAbove = false }: { leaveLayersAbove?: boolean } = {},
): void {
  const requestRef = useLatestRef(requestClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = panel.current
      const inside = el != null && e.target instanceof Node && el.contains(e.target)
      if (!inside && !isPageTarget(e.target)) return
      if (leaveLayersAbove && el && e.target instanceof Node && isInLayerAbove(el, e.target)) return
      e.preventDefault()
      e.stopPropagation()
      requestRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel, requestRef, leaveLayersAbove])
}

/**
 * A press elsewhere (`isElsewhere(target)`) asks the editor to close. A
 * press it lets close goes on to what it pressed; one it holds (it asked) is
 * swallowed, its click too — a tab's alone is made again once the answer is
 * Save or Discard (`carryOnAfterLeave`). A real press starts with
 * pointerdown (decided there) and its mousedown follows; a lone mousedown
 * (no pointer events) is decided itself. Capture phase on the document,
 * after an expression field's own hold (on the window), which stops the
 * press first.
 */
export function usePressElsewhereCloses(isElsewhere: (target: EventTarget | null) => boolean, requestClose: () => boolean): void {
  const elsewhereRef = useLatestRef(isElsewhere)
  const requestRef = useLatestRef(requestClose)
  useEffect(() => {
    let pointerDecided = false
    let held = false
    const onPress = (e: Event) => {
      if (e.type === 'mousedown' && pointerDecided) {
        pointerDecided = false
        if (held) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      pointerDecided = e.type === 'pointerdown'
      held = elsewhereRef.current(e.target) && requestRef.current()
      if (!held) return
      if (e.type === 'mousedown') e.preventDefault()
      e.stopPropagation()
      // A tab pressed: it switches once the question was answered Save or Discard.
      carryOnAfterLeave(e.target)
    }
    const onClick = (e: MouseEvent) => {
      if (!held) return
      held = false
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('mousedown', onPress, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('mousedown', onPress, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [elsewhereRef, requestRef])
}
