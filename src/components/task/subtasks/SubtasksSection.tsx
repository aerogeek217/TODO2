import { useId, type Ref } from 'react'
import { subtaskCount } from '../../../utils/subtasks'
import type { MenuEntry } from '../../shared/MenuPopover'
import { SubtaskChecklist, type ChecklistAddDraft, type ChecklistItem } from './SubtaskChecklist'
import styles from './Subtasks.module.css'

/**
 * The task editor's **Subtasks** (cr28, T1): the label with `2 of 5` and a
 * thin progress bar, then the checklist — check, rename by a click on the
 * title, drag to reorder, ⋯ for the menu, an add row. What the callbacks
 * write is the host's (the store in edit mode, the pending rows in create
 * mode, where the ⋯ menu has no Make a task / Move).
 */
export function SubtasksSection({ items, onAdd, onRename, onSetDone, onRemove, onMove, extraMenuEntries, className, labelClassName, addDraftRef }: {
  items: readonly ChecklistItem[]
  onAdd: (title: string) => void
  onRename: (id: number, title: string) => void
  onSetDone: (id: number, done: boolean) => void
  onRemove: (id: number) => void
  onMove: (id: number, toIndex: number) => void
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
  className?: string
  labelClassName?: string
  addDraftRef?: Ref<ChecklistAddDraft>
}) {
  const labelId = useId()
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
      </div>
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
        addDraftRef={addDraftRef}
      />
    </section>
  )
}
