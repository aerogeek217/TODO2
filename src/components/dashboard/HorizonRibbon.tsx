import { useCallback, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { PersistedTodoItem } from '../../models'
import { DragHandle } from '../shared/DragHandle'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import { useSortableRow, useSortableReorderHandler } from '../../hooks/use-sortable-row'
import styles from './HorizonRibbon.module.css'

export interface HorizonRow {
  defId: number
  label: string
  scheduled: PersistedTodoItem[]
  due: PersistedTodoItem[]
  total: number
}

interface Props {
  rows: HorizonRow[]
  selectedDefId: number | null
  onSelect: (defId: number) => void
  onSwap: (defId: number, anchor: { x: number; y: number }) => void
  onRowContext: (defId: number, anchor: { x: number; y: number }) => void
  onAdd: (anchor: { x: number; y: number }) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}

interface RowProps {
  row: HorizonRow
  selected: boolean
  maxTotal: number
  onSelect: (defId: number) => void
  onSwap: (defId: number, anchor: { x: number; y: number }) => void
  onRowContext: (defId: number, anchor: { x: number; y: number }) => void
}

function SortableRow({ row, selected, maxTotal, onSelect, onSwap, onRowContext }: RowProps) {
  const { attributes, listeners, setNodeRef, style, isDragging } = useSortableRow(row.defId)
  const fillPct = maxTotal > 0 ? Math.round((row.total / maxTotal) * 100) : 0
  const scheduledCount = row.scheduled.length
  const dueCount = row.due.length
  const scheduledPct = row.total > 0 ? (scheduledCount / row.total) * fillPct : 0
  const duePct = row.total > 0 ? (dueCount / row.total) * fillPct : 0

  const handleLabelClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSwap(row.defId, { x: rect.left, y: rect.bottom + 4 })
  }, [onSwap, row.defId])

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    onRowContext(row.defId, { x: e.clientX, y: e.clientY })
  }, [onRowContext, row.defId])

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${isDragging ? styles.rowDragging : ''}`}
      data-horizon-defid={row.defId}
      onContextMenu={handleContextMenu}
    >
      <DragHandle className={styles.dragHandle} attributes={attributes} listeners={listeners} ariaHidden={false} />
      <button
        type="button"
        className={styles.labelBtn}
        onClick={handleLabelClick}
        title="Swap list…"
      >
        {row.label}
      </button>
      <button
        type="button"
        className={styles.barWrap}
        onClick={() => onSelect(row.defId)}
        aria-pressed={selected}
        aria-label={`${row.label}: ${row.total} task${row.total === 1 ? '' : 's'} (${scheduledCount} scheduled, ${dueCount} due)`}
      >
        <div className={styles.barTrack}>
          <div
            className={styles.barScheduled}
            style={{ width: `${scheduledPct}%` }}
            title={`${scheduledCount} scheduled`}
          />
          <div
            className={styles.barDue}
            style={{ width: `${duePct}%` }}
            title={`${dueCount} due`}
          />
        </div>
      </button>
      <span className={styles.count}>{row.total}</span>
    </div>
  )
}

export function HorizonRibbon({
  rows,
  selectedDefId,
  onSelect,
  onSwap,
  onRowContext,
  onAdd,
  onReorder,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = useMemo(() => rows.map((r) => r.defId), [rows])
  const maxTotal = useMemo(() => rows.reduce((m, r) => Math.max(m, r.total), 0), [rows])

  const handleDragEnd = useSortableReorderHandler(rows, (r) => r.defId, onReorder)

  const handleAdd = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onAdd({ x: rect.left, y: rect.bottom + 4 })
  }, [onAdd])

  return (
    <div className={styles.container}>
      {rows.length === 0 ? (
        <div className={styles.empty}>Add a horizon to start.</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className={styles.rows}>
              {rows.map((row) => (
                <SortableRow
                  key={row.defId}
                  row={row}
                  selected={selectedDefId === row.defId}
                  maxTotal={maxTotal}
                  onSelect={onSelect}
                  onSwap={onSwap}
                  onRowContext={onRowContext}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <div className={styles.ribbonFooter}>
        <button type="button" className={styles.addBtn} onClick={handleAdd}>
          + Add list
        </button>
      </div>
    </div>
  )
}
