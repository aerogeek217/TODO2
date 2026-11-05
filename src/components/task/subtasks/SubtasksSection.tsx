import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { SUBTASK_TITLE_MAX } from '../../../models'
import { subtaskCount, subtaskTitle } from '../../../utils/subtasks'
import type { MenuEntry } from '../../shared/MenuPopover'
import { PopoverRoot } from '../../shared/PopoverRoot'
import updateStyles from '../status-updates/StatusUpdates.module.css'
import { SubtaskChecklist, type ChecklistItem } from './SubtaskChecklist'
import styles from './Subtasks.module.css'

/**
 * The + Add subtask popover, under its button, in the Add update popover's
 * look: the title and Cancel / Add. ⏎ adds and stays for the next line. Esc
 * (it, not the editor) and an outside click close it and add what was typed;
 * only Cancel drops it.
 */
function AddSubtaskPopover({ anchorRef, onAdd, onClose }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  onAdd: (title: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const cancelled = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'bottom-end',
    closeOnScroll: false,
    closeOnResize: false,
    consumeEscape: true,
    observeSize: true,
    onClose,
    caret: true,
  })
  useEffect(() => { inputRef.current?.focus() }, [])
  const clean = subtaskTitle(text)
  const addOnCloseRef = useLatestRef(() => {
    if (!cancelled.current && clean !== '') onAdd(clean)
  })
  // In the commit that closes it, so a click right behind the closing press (Create) reads the result.
  useLayoutEffect(() => () => addOnCloseRef.current(), [addOnCloseRef])
  const add = () => {
    if (clean === '') return
    onAdd(clean)
    setText('')
    inputRef.current?.focus()
  }
  return createPortal(
    <PopoverRoot
      ref={panelRef}
      caret={caret}
      className={updateStyles.addPopover}
      style={{ position: style.position, left: style.left, top: style.top }}
      role="dialog"
      aria-label="Add a subtask"
      // Portaled out of the editor, but React events still bubble to it: keep them here.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className={updateStyles.textInput}
        value={text}
        maxLength={SUBTASK_TITLE_MAX}
        placeholder="Add a subtask…"
        aria-label="New subtask"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          add()
        }}
      />
      <div className={updateStyles.popoverActions}>
        <button type="button" className={updateStyles.cancelButton} onClick={() => { cancelled.current = true; onClose() }}>Cancel</button>
        <button type="button" className={updateStyles.saveButton} onClick={add} disabled={clean === ''}>Add</button>
      </div>
    </PopoverRoot>,
    document.body,
  )
}

/**
 * The task editor's **Subtasks** (cr28, T1): the label with `2 of 5`, a thin
 * progress bar and + Add subtask, then the checklist — check, rename by a
 * click on the title, drag to reorder, ⋯ for the menu. What the callbacks
 * write is the host's (the store in edit mode, the pending rows in create
 * mode, where the ⋯ menu has no Make a task / Move).
 */
export function SubtasksSection({ items, onAdd, onRename, onSetDone, onRemove, onMove, extraMenuEntries, className, labelClassName }: {
  items: readonly ChecklistItem[]
  onAdd: (title: string) => void
  onRename: (id: number, title: string) => void
  onSetDone: (id: number, done: boolean) => void
  onRemove: (id: number) => void
  onMove: (id: number, toIndex: number) => void
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
  className?: string
  labelClassName?: string
}) {
  const labelId = useId()
  const [adding, setAdding] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const closeAdd = () => {
    setAdding(false)
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected) addButtonRef.current?.focus({ preventScroll: true })
    })
  }
  const count = subtaskCount(items)
  return (
    <section className={className} aria-labelledby={labelId} data-subtasks="">
      <div className={styles.headingRow}>
        <div className={`${labelClassName ?? ''} ${styles.heading}`} id={labelId}>
          Subtasks
          {count.total > 0 && <span className={styles.countText} data-subtask-count-text="">{count.done} of {count.total}</span>}
        </div>
        {count.total > 0 && (
          <span className={styles.bar} aria-hidden="true">
            <span className={styles.barFill} style={{ width: `${Math.round((count.done / count.total) * 100)}%` }} />
          </span>
        )}
        <button
          ref={addButtonRef}
          type="button"
          className={`${updateStyles.addButton} ${styles.addSubtask}`}
          aria-haspopup="dialog"
          aria-expanded={adding}
          data-open={adding ? 'true' : undefined}
          onClick={() => (adding ? closeAdd() : setAdding(true))}
        >
          + Add subtask
        </button>
      </div>
      {adding && <AddSubtaskPopover anchorRef={addButtonRef} onAdd={onAdd} onClose={closeAdd} />}
      <SubtaskChecklist
        items={items}
        density="editor"
        label="Subtasks"
        onAdd={onAdd}
        onRename={onRename}
        onSetDone={onSetDone}
        onRemove={onRemove}
        onMove={onMove}
        extraMenuEntries={extraMenuEntries}
        hideAddRow
      />
    </section>
  )
}
