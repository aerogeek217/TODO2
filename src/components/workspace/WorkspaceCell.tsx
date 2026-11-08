import type { CSSProperties } from 'react'
import type { BandEdge, LayoutCell } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { AddWidgetButtons } from './AddWidgetFlow'
import { CloseIcon, PlusIcon } from '../shared/icons'
import { useWorkspaceDrag } from './workspace-drag'
import { FilledCell } from './FilledCell'
import styles from './WorkspaceCell.module.css'

export interface WorkspaceCellProps {
  /** A cell of a column's row, or (with `band`) of a band. */
  cell: LayoutCell
  /** Set when `cell` is in the band at that edge. */
  band?: BandEdge
  /** The id of its row (a column's row, or the band): what collapses. */
  rowId: string
  /** Its row is collapsed: the cell shows only its header. */
  collapsed: boolean
  /** Its row holds other cells too: collapsing folds the whole row. */
  multiRow?: boolean
  /** Its row fits its content (`isFitRow`): the widget shows its small face (D25 R). */
  fitRow?: boolean
  style?: CSSProperties
}

/** An empty cell (right after a split): kind buttons, "or drag a tab here", and a close ×. */
function EmptyCell({ cell, band, style }: { cell: LayoutCell; band?: BandEdge; style?: CSSProperties }) {
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const drag = useWorkspaceDrag()
  const over = drag?.hit?.kind === 'empty-cell' && drag.hit.cellId === cell.id && drag.accepts
  return (
    <section
      className={`${styles.emptyCell} ${over ? styles.emptyCellOver : ''}`}
      style={style}
      data-ws-cell={cell.id}
      data-ws-band={band}
      data-empty="true"
      aria-label="Empty cell"
    >
      <button type="button" className={styles.emptyClose} aria-label="Close empty cell" title="Close cell" onClick={() => closeCell(cell.id)}>
        <CloseIcon size={12} />
      </button>
      <span className={styles.emptyPlus}><PlusIcon size={16} /></span>
      <span className={styles.emptyTitle}>Add a widget</span>
      <div className={styles.kindRow}>
        <AddWidgetButtons target={{ kind: 'cell', cellId: cell.id }} buttonClassName={styles.kindButton} iconClassName={styles.kindButtonIcon} />
      </div>
      <span className={styles.emptyHint}>or drag a tab here</span>
    </section>
  )
}

/**
 * The column area of a layout whose panels are all in bands: the empty cell
 * block, whose widgets (or a dropped tab / panel) start the first column.
 */
export function EmptyColumnArea() {
  const drag = useWorkspaceDrag()
  const over = drag?.hit?.kind === 'empty-columns' && drag.accepts
  return (
    <section
      className={`${styles.emptyCell} ${styles.emptyColumns} ${over ? styles.emptyCellOver : ''}`}
      data-ws-columns-empty
      aria-label="No columns"
    >
      <span className={styles.emptyPlus}><PlusIcon size={16} /></span>
      <span className={styles.emptyTitle}>Add a widget</span>
      <div className={styles.kindRow}>
        <AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={styles.kindButton} iconClassName={styles.kindButtonIcon} />
      </div>
      <span className={styles.emptyHint}>or drag a tab here</span>
    </section>
  )
}

/** A cell, in a column's row or a band: an empty one after a split, else its tabs. */
export function WorkspaceCell(props: WorkspaceCellProps) {
  const { cell, band, style } = props
  if (cell.tabs.length === 0) return <EmptyCell cell={cell} band={band} style={style} />
  return <FilledCell {...props} />
}
