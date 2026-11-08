import type { CSSProperties } from 'react'
import type { LayoutCell } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { AddWidgetButtons } from './AddWidgetFlow'
import { CloseIcon, PlusIcon } from '../shared/icons'
import { FilledCell } from './FilledCell'
import styles from './WorkspaceCell.module.css'

export interface WorkspaceCellProps {
  /** A cell of the layout's table. */
  cell: LayoutCell
  /** The ids of the row tracks it covers: what Collapse row collapses. */
  rowTrackIds: readonly string[]
  /** Every row track it covers is collapsed: the cell shows only its header. */
  collapsed: boolean
  /** It lies in a row track that fits its content (`isFitTrack`): the widget shows its small face (D25 R). */
  fitRow?: boolean
  style?: CSSProperties
}

/** An empty cell (right after a split): kind buttons, "or drag a tab here", and a close ×. */
function EmptyCell({ cell, style }: { cell: LayoutCell; style?: CSSProperties }) {
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  return (
    <section
      className={styles.emptyCell}
      style={style}
      data-ws-cell={cell.id}
      data-ws-cell-title="Empty cell"
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

/** A cell of the table: an empty one (after a split, or a close with no taker), else its tabs. */
export function WorkspaceCell(props: WorkspaceCellProps) {
  const { cell, style } = props
  if (cell.tabs.length === 0) return <EmptyCell cell={cell} style={style} />
  return <FilledCell {...props} />
}
