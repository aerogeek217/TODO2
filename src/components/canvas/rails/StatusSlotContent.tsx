import { useCallback, useMemo, useState } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { useStatusStore } from '../../../stores/status-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { StatusIcon } from '../../shared/StatusIcon'
import { CanvasContextMenu } from '../../overlays/CanvasContextMenu'
import type { ContextMenuItem } from '../../../models/context-menu'
import { DraggableTaskRow } from '../shared/DraggableTaskRow'
import { selectStatusBreakdown } from '../../../services/stats/status-breakdown'
import type { Person, PersistedTodoItem } from '../../../models'
import styles from './StatusSlotContent.module.css'

/** `'unset'` represents the "No status" bucket; a number is a real `statusId`. */
type SelectedStatusKey = number | 'unset' | null

interface RowContextMenu { x: number; y: number; key: SelectedStatusKey }

/**
 * Rail/float widget body for the `status` widget kind. Renders a stacked
 * hero bar (segments proportional to per-status open counts) above a legend
 * row per status (icon · label · count · percent). Driven by
 * `selectStatusBreakdown` over the live todo + status stores.
 *
 * Click parity with HorizonsSlotContent: clicking a legend row (or hero
 * segment) selects that status and reveals its open tasks below the legend;
 * clicking the same row again deselects. Right-click opens a
 * `CanvasContextMenu` with row-relevant items.
 */
export function StatusSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  // todosVersion bumps on field-only edits (e.g. statusId change) where the
  // `todos` array reference is stable — subscribe so the breakdown reflows.
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const [selectedKey, setSelectedKey] = useState<SelectedStatusKey>(null)
  const [rowMenu, setRowMenu] = useState<RowContextMenu | null>(null)

  const entries = useMemo(
    () => selectStatusBreakdown(todos, statuses),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todos, todosVersion, statuses],
  )

  const total = entries.reduce((sum, e) => sum + e.count, 0)

  const selectedTodos = useMemo<PersistedTodoItem[]>(() => {
    if (selectedKey === null) return []
    return todos.filter((t) => {
      if (t.isCompleted) return false
      if (selectedKey === 'unset') return t.statusId == null
      return t.statusId === selectedKey
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, todosVersion, selectedKey])

  const handleSelect = useCallback((key: SelectedStatusKey) => {
    setSelectedKey((prev) => (prev === key ? null : key))
  }, [])

  const handleRowContext = useCallback((e: React.MouseEvent, key: SelectedStatusKey) => {
    e.preventDefault()
    e.stopPropagation()
    setRowMenu({ x: e.clientX, y: e.clientY, key })
  }, [])

  const rowMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!rowMenu) return []
    const isSelected = selectedKey === rowMenu.key
    return [
      {
        label: isSelected ? 'Hide tasks' : 'Show tasks',
        action: () => setSelectedKey(isSelected ? null : rowMenu.key),
      },
    ]
  }, [rowMenu, selectedKey])

  const assignedPeopleMapCast = assignedPeopleMap as Map<number, Person[]>
  const selectedEntry = useMemo(() => {
    if (selectedKey === null) return null
    return entries.find((e) => (e.id ?? 'unset') === selectedKey) ?? null
  }, [entries, selectedKey])

  if (total === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>No open tasks</div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.heroBar} role="img" aria-label={`${total} open tasks by status`}>
          {entries.map((e) => {
            if (e.count === 0) return null
            const key: SelectedStatusKey = e.id ?? 'unset'
            return (
              <button
                type="button"
                key={e.id ?? 'none'}
                className={styles.heroSegment}
                style={{ flexGrow: e.count, background: e.color }}
                title={`${e.label}: ${e.count}`}
                aria-label={`${e.label}: ${e.count}`}
                aria-pressed={selectedKey === key}
                onClick={() => handleSelect(key)}
                onContextMenu={(ev) => handleRowContext(ev, key)}
              />
            )
          })}
        </div>
        <div className={styles.legendRows}>
          {entries.map((e) => {
            const pct = total > 0 ? Math.round((e.count / total) * 100) : 0
            const key: SelectedStatusKey = e.id ?? 'unset'
            const isSelected = selectedKey === key
            return (
              <button
                type="button"
                key={e.id ?? 'none'}
                className={`${styles.legendRow} ${isSelected ? styles.legendRowSelected : ''}`}
                aria-pressed={isSelected}
                onClick={() => handleSelect(key)}
                onContextMenu={(ev) => handleRowContext(ev, key)}
                data-status-key={e.id ?? 'unset'}
              >
                <span className={styles.legendIcon} style={{ color: e.color }}>
                  <StatusIcon icon={e.icon} filled />
                </span>
                <span className={styles.legendLabel}>{e.label}</span>
                <span className={styles.legendCount}>{e.count}</span>
                <span className={styles.legendPct}>{pct}%</span>
              </button>
            )
          })}
        </div>
      </div>
      {selectedKey !== null && (
        <div className={styles.body}>
          {selectedTodos.length === 0 ? (
            <div className={styles.bodyEmpty}>
              No tasks for {selectedEntry?.label ?? 'status'}
            </div>
          ) : (
            selectedTodos.map((todo) => (
              <DraggableTaskRow
                key={todo.id}
                todo={todo}
                assignedPeople={assignedPeopleMapCast.get(todo.id)}
                onOpenDetail={openEditPopup}
                surface="lens"
                showContext
              />
            ))
          )}
        </div>
      )}
      {rowMenu && (
        <CanvasContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={rowMenuItems}
          onClose={() => setRowMenu(null)}
        />
      )}
    </div>
  )
}
