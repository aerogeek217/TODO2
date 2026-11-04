import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PersistedTodoItem } from '../../../models'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useSubtasks, useSubtaskStore } from '../../../stores/subtask-store'
import { subtaskCount } from '../../../utils/subtasks'
import type { MenuEntry } from '../../shared/MenuPopover'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { SubtaskChecklist, type ChecklistItem } from './SubtaskChecklist'
import { storedSubtaskMenuEntries } from './subtask-menu'
import styles from './Subtasks.module.css'

/**
 * A task row's checklist popover (cr28, T2), opened by the row's `2/5`
 * count: the task's title and count, the checklist (tight rows: check,
 * rename, ⋯), the add row, a hint line and Open task. Anchored under the
 * count by `usePopoverAnchor` (flipped / clamped, a caret); Esc closes it
 * and stops there (the task dialog behind stays), so does an outside click.
 * Opens with the focus on the first open subtask's checkbox (Space checks
 * it), or in the add field when every one is done, there is none, or
 * `focusAdd` (the menu's Add subtask…); on close the focus goes back to the
 * count, unless something else took it. Every write goes through the
 * subtask store (its own undo step each).
 */
export function SubtasksPopover({ todo, anchorRef, anchorIsInside = true, onClose, onOpenDetail, focusAdd = false, extraMenuEntries = storedSubtaskMenuEntries }: {
  todo: PersistedTodoItem
  anchorRef: RefObject<HTMLElement | null>
  /** `false` when the anchor isn't the count (the row, for a task without a checklist): a click on it closes the popover. */
  anchorIsInside?: boolean
  onClose: () => void
  onOpenDetail?: (todoId: number) => void
  focusAdd?: boolean
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
}) {
  const subtasks = useSubtasks(todo.id)
  const count = subtaskCount(subtasks)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'bottom-start',
    closeOnScroll: false,
    closeOnResize: false,
    consumeEscape: true,
    observeSize: true,
    anchorIsInside,
    onClose,
    caret: true,
  })
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    panelRef(el)
  }, [panelRef])

  // Remember what had the focus (the count), then focus the first open
  // subtask's checkbox — or the add field.
  const wantsAdd = focusAdd || subtasks.length === 0 || count.done === count.total
  // As it was on open: the effect runs once, the checklist's later changes don't move the focus.
  const wantsAddOnOpen = useRef(wantsAdd)
  useLayoutEffect(() => {
    const previous = document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !containerRef.current?.contains(previous)) {
      returnFocusRef.current = previous
    } else if (anchorRef.current) {
      returnFocusRef.current = anchorRef.current
    }
    if (wantsAddOnOpen.current) return
    const first = containerRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:checked)')
    first?.focus({ preventScroll: true })
  }, [anchorRef])
  useLayoutEffect(() => {
    const container = containerRef.current
    return () => {
      const target = returnFocusRef.current
      const active = document.activeElement
      const focusIsOurs = !active || active === document.body || !active.isConnected || !!container?.contains(active)
      if (target && target.isConnected && focusIsOurs) target.focus({ preventScroll: true })
    }
  }, [])

  const store = () => useSubtaskStore.getState()

  return (
    <PopoverRoot
      ref={setPanel}
      caret={caret}
      className={styles.popover}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={`Subtasks of ${todo.title}`}
      data-subtasks-popover=""
      // Portaled out of the row, but React events still bubble to it: keep them here.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className={styles.popoverHead}>
        <span className={styles.popoverTitle}>{todo.title}</span>
        <span className={styles.popoverCount} data-subtask-count-text="">{count.done} of {count.total}</span>
      </div>
      <div className={styles.popoverBody}>
        <SubtaskChecklist
          items={subtasks}
          density="tight"
          label="Subtasks"
          autoFocusAdd={wantsAdd}
          onAdd={(title) => { void store().add(todo.id, title) }}
          onRename={(id, title) => { void store().rename(id, title) }}
          onSetDone={(id, done) => { void store().setDone(id, done) }}
          onRemove={(id) => { void store().remove(id) }}
          extraMenuEntries={extraMenuEntries}
        />
      </div>
      <div className={styles.popoverFoot}>
        <span>Space checks · ⏎ adds · Esc closes</span>
        {onOpenDetail && (
          <button type="button" className={styles.openLink} onClick={() => { onClose(); onOpenDetail(todo.id) }}>
            Open task
          </button>
        )}
      </div>
    </PopoverRoot>
  )
}
