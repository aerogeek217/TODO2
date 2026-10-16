import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import { usePopoverAnchor, type PopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { NlpPopup } from '../../shared/NlpPopup'
import { closeNotesPopup, pickNotesPopupRow, type NotesPopupState } from './notes-nlp'
import styles from './NotesEditor.module.css'

interface AnchorRect { left: number; top: number; right: number; bottom: number }

/**
 * The trigger character's box in the viewport, or null when it is scrolled
 * out of the editor's visible area (or not rendered).
 */
function measureAnchor(editor: EditorView, pos: number): AnchorRect | null {
  const box = editor.coordsAtPos(pos, 1)
  if (!box) return null
  const scroller = editor.scrollDOM.getBoundingClientRect()
  if (box.bottom <= scroller.top || box.top >= scroller.bottom) return null
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
}

const sameRect = (a: AnchorRect | null, b: AnchorRect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom)

const OFFSCREEN: PopoverAnchor = { kind: 'point', x: -9999, y: -9999 }

/**
 * The notes editor's `@ # /` popup: `NlpPopup` portalled to the body, under
 * the trigger character (flips above near the bottom edge, clamped to the
 * viewport). It follows the caret line through every kind of scroll and
 * layout shift (a frame loop while open) and closes once the line scrolls
 * out of the editor.
 */
export function NotesNlpPopup({ editor, popup }: { editor: EditorView; popup: NotesPopupState }) {
  const pos = popup.lineFrom + popup.view.anchor
  const posRef = useLatestRef(pos)
  const [rect, setRect] = useState<AnchorRect | null>(() => measureAnchor(editor, pos))

  useEffect(() => {
    let raf = 0
    let last: AnchorRect | null = null
    let first = true
    const tick = () => {
      const next = measureAnchor(editor, posRef.current)
      if (!next && !first) {
        editor.dispatch({ effects: closeNotesPopup.of(null) })
        return
      }
      first = false
      if (!sameRect(next, last)) {
        last = next
        setRect(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [editor, posRef])

  const { panelRef, style } = usePopoverAnchor({
    anchor: rect ? { kind: 'rect', ...rect } : OFFSCREEN,
    open: true,
    // The frame loop tracks the caret; keys belong to the editor extension.
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    onClose: () => {},
    contentKey: `${popup.view.mode}|${popup.view.header}|${popup.view.rows.length}|${popup.view.hint ?? ''}`,
  })

  return createPortal(
    <NlpPopup
      view={popup.view}
      selectedIndex={popup.selectedIndex}
      onPick={(row) => pickNotesPopupRow(editor, row)}
      popupRef={panelRef}
      className={styles.nlpPopup}
      style={{ position: style.position, left: style.left, top: style.top }}
    />,
    document.body,
  )
}
