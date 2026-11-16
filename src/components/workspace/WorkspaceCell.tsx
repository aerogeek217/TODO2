import type { CSSProperties } from 'react'
import type { LayoutCell } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { AddWidgetButtons } from './AddWidgetFlow'
import { CloseIcon, PencilIcon, PlusIcon } from '../shared/icons'
import { FilledCell } from './FilledCell'
import { EditSlot } from './EditCard'
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

/**
 * An empty cell (a split's new cell, a close with no taker, a lone widget
 * removed). Outside the layout edit mode (E4: what's inside a cell changes
 * in place) a quiet placeholder — "Add a widget" and the kinds by group,
 * each added as its tab (`AddWidgetButtons`), and an **Edit layout** link
 * that opens the mode with this cell selected. In the mode (E3) a slot
 * (`EditSlot`): dashed, named by the rulers (`B4`), a click its kinds (or
 * the armed card moved here), a drop target, and a close × (Close cell).
 */
function EmptyCell({ cell, style }: { cell: LayoutCell; style?: CSSProperties }) {
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const editing = useWorkspaceStore((s) => s.editing != null)
  const selected = useWorkspaceStore((s) => s.editing?.selectedCellId === cell.id)
  return (
    <section
      className={editing ? styles.emptySlot : styles.emptyCell}
      style={style}
      data-ws-cell={cell.id}
      data-edit-selected={selected ? '' : undefined}
      data-ws-cell-title="Empty cell"
      data-empty="true"
      aria-label="Empty cell"
    >
      {editing ? (
        <>
          <EditSlot cell={cell} />
          <button type="button" className={styles.emptyClose} aria-label="Close empty cell" data-tooltip="Close cell" onClick={() => closeCell(cell.id)}>
            <CloseIcon size={12} />
          </button>
        </>
      ) : (
        <>
          <span className={styles.emptyPlus}><PlusIcon size={16} /></span>
          <span className={styles.emptyTitle}>Add a widget</span>
          <div className={styles.kindRow}>
            <AddWidgetButtons target={{ kind: 'cell', cellId: cell.id }} buttonClassName={styles.kindButton} iconClassName={styles.kindButtonIcon} />
          </div>
          <button
            type="button"
            className={styles.emptyEditLayout}
            data-tooltip="Change the grid: rows, columns and cells"
            onClick={() => { void useWorkspaceStore.getState().enterEdit({ cellId: cell.id }) }}
          >
            <PencilIcon size={12} />
            Edit layout
          </button>
        </>
      )}
    </section>
  )
}

/** A cell of the table: an empty one (after a split, or a close with no taker), else its tabs. */
export function WorkspaceCell(props: WorkspaceCellProps) {
  const { cell, style } = props
  if (cell.tabs.length === 0) return <EmptyCell cell={cell} style={style} />
  return <FilledCell {...props} />
}
