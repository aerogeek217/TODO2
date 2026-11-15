import { useContext, useLayoutEffect } from 'react'
import { useElementSize } from '../../hooks/use-element-size'
import { hostedFace, WidgetFaceContext } from '../../hooks/use-widget-face'
import { WidgetNameLine } from './WidgetTopLine'
import styles from './OpenLargerPlaceholder.module.css'

/**
 * What a cell shows in place of its widget while the widget popup shows that
 * tab (Open larger; cr34 H1): **a tab has one live widget at a time**. Two
 * copies of one tab would share their drag-and-drop ids (a list's rows, a
 * calendar's entries and days) in the page's one `DndContext`, which keeps
 * one node per id — the copy that unmounts takes the ids with it, and a drop
 * is handled by both. So the cell's widget unmounts while the popup shows
 * its tab and mounts again when the popup closes.
 *
 * Quiet: the widget's name and that it is open larger, muted. Alone in its
 * cell (and not at the small face) it keeps a name line, which holds the
 * cell's controls slot as the widget's own top line did. Like a widget it
 * tells the cell its face (small / medium / large by its measured size), so
 * the cell's face follows a resize while its widget is away. Nothing here
 * takes a press — the popup's scrim covers the workspace while it shows.
 */
export function OpenLargerPlaceholder({ tabId, title, compact = false, minHeight }: {
  tabId: string
  /** The widget's title. */
  title: string
  /** The small face: one line, no name line. */
  compact?: boolean
  /** The height the body had with its widget, where its content sets it (a fit row, a phone cell): kept. */
  minHeight?: number
}) {
  const host = useContext(WidgetFaceContext)
  const [sizeRef, size] = useElementSize()
  // Only a measured face is told: until then the cell keeps the face its widget last showed.
  const measured = size.width > 0 || size.height > 0
  const face = host.forced ?? (measured ? hostedFace(size, host) : undefined)
  const onFace = host.onFace
  useLayoutEffect(() => { if (face) onFace?.(face) }, [face, onFace])
  return (
    <div
      ref={sizeRef}
      className={`${styles.placeholder} ${compact ? styles.compact : ''}`}
      style={minHeight != null ? { minHeight } : undefined}
      data-open-larger-placeholder={tabId}
    >
      {!compact && <WidgetNameLine name={title} />}
      <p className={styles.note}>“{title}” is open larger</p>
    </div>
  )
}
