import { useId } from 'react'
import { subtaskCount } from '../../../utils/subtasks'
import type { MenuEntry } from '../../shared/MenuPopover'
import { SubtaskChecklist, type ChecklistItem } from './SubtaskChecklist'
import styles from './Subtasks.module.css'

/**
 * The task layout's **Subtasks** (cr28, T1; boards BJ, BL — the task
 * editor and the review card, second in the writing): the label — always
 * shown —, with `2 of 5` and a thin progress bar once there is a subtask,
 * then the checklist — check, rename by a click on the title, drag to
 * reorder (`onMove`), ⋯ for the menu — and **+ Add subtask** as its last
 * line (⏎ adds and keeps the line for the next). The checkboxes and the
 * add line's plus start at the label's left edge (the grip hangs in the
 * gutter). The list and its add line
 * scroll inside the section past ~260px. What the
 * callbacks write is the host's (the store in edit mode, the pending rows
 * in create mode, where the ⋯ menu has no Make a task / Move);
 * `commitRef` (create mode) adds a line still being typed before the host
 * reads its rows.
 */
export function SubtasksSection({ items, onAdd, onRename, onSetDone, onRemove, onMove, extraMenuEntries, className, labelClassName, commitRef }: {
  items: readonly ChecklistItem[]
  onAdd: (title: string) => void
  onRename: (id: number, title: string) => void
  onSetDone: (id: number, done: boolean) => void
  onRemove: (id: number) => void
  onMove?: (id: number, toIndex: number) => void
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
  className?: string
  labelClassName?: string
  commitRef?: { current: (() => void) | null }
}) {
  const labelId = useId()
  const count = subtaskCount(items)
  return (
    <section className={className} aria-labelledby={labelId} data-subtasks="" data-empty={count.total === 0 || undefined}>
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
      <div className={styles.sectionScroll}>
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
          addPlaceholder="Add subtask"
          commitRef={commitRef}
        />
      </div>
    </section>
  )
}
