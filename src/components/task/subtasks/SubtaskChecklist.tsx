import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type Announcements, type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SUBTASK_TITLE_MAX } from '../../../models'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import { ESCAPE_CLEARS_ATTR } from '../../../hooks/use-popover-anchor'
import { useSortableReorderHandler, useSortableRow } from '../../../hooks/use-sortable-row'
import { subtaskTitle } from '../../../utils/subtasks'
import { DragHandle } from '../../shared/DragHandle'
import { MoreIcon, PlusIcon } from '../../shared/icons'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import styles from './Subtasks.module.css'

/** A checklist line as the list shows it: a stored subtask (its id) or one waiting for Create (a local key). */
export interface ChecklistItem {
  id: number
  title: string
  isCompleted: boolean
}

export type ChecklistDensity = 'editor' | 'tight' | 'touch'

export interface SubtaskChecklistProps {
  items: readonly ChecklistItem[]
  /** Row height: `editor` (28px), `tight` (26px, the row's popover), `touch` (44px, the phone's sheet). */
  density: ChecklistDensity
  /** The list's accessible name. */
  label: string
  onAdd: (title: string) => void
  onRename: (id: number, title: string) => void
  onSetDone: (id: number, done: boolean) => void
  onRemove: (id: number) => void
  /** Given, the rows reorder by drag (a grip, or Space + ↑↓ on it): `toIndex` is 0-based. */
  onMove?: (id: number, toIndex: number) => void
  /** More ⋯ items after Rename (Make a task, Move to another task…), before Delete. */
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
  /** Focus the add field on mount. */
  autoFocusAdd?: boolean
  /** Rendered under the add row (a hint line). */
  footer?: ReactNode
}

const ADD_PLACEHOLDER = 'Add a subtask…'

/**
 * A task's checklist (cr28, T1 / T2): rows of `checkbox · title · ⋯`, then
 * an add row. Space on a checkbox checks it; a click on the title renames it
 * in place (⏎ saves, Esc cancels — the key stops there, so a dialog around
 * the list stays open; a blank title cancels too); ⋯ opens the subtask menu
 * (Rename · the host's extra items | Delete). The add row's ⏎ adds the line
 * and keeps the focus for the next; Esc in it with text clears the text
 * (`ESCAPE_CLEARS_ATTR`), empty it is the host's. With `onMove` the rows
 * drag to reorder (dnd-kit, the lenses' sortable row). What the callbacks
 * write is the host's (the store in the editor's edit mode and the popover,
 * pending rows in create mode).
 */
export function SubtaskChecklist({
  items, density, label, onAdd, onRename, onSetDone, onRemove, onMove, extraMenuEntries, autoFocusAdd, footer,
}: SubtaskChecklistProps) {
  const [renaming, setRenaming] = useState<number | null>(null)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const addRef = useRef<HTMLInputElement>(null)
  const moreButtons = useRef(new Map<number, HTMLButtonElement>())
  const menuAnchor = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (autoFocusAdd) addRef.current?.focus({ preventScroll: true })
  }, [autoFocusAdd])

  const add = () => {
    const title = subtaskTitle(draft)
    if (title === '') return
    onAdd(title)
    setDraft('')
  }

  const onAddKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Escape' && draft !== '') {
      // Clears first; the next Esc is the host's (the popover / editor closes).
      e.preventDefault()
      e.stopPropagation()
      setDraft('')
    }
  }

  const remove = (id: number) => {
    onRemove(id)
    // The row (and its ⋯) is gone: the focus goes to the add field.
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected) addRef.current?.focus({ preventScroll: true })
    })
  }

  const openMenu = (id: number) => {
    menuAnchor.current = moreButtons.current.get(id) ?? null
    setMenuFor(id)
  }

  const menuItem = menuFor != null ? items.find((i) => i.id === menuFor) : undefined
  const menuEntries: MenuEntry[] = menuItem ? [
    { kind: 'item', label: 'Rename', onSelect: () => setRenaming(menuItem.id) },
    ...(extraMenuEntries?.(menuItem) ?? []),
    { kind: 'separator' },
    { kind: 'item', label: 'Delete', danger: true, onSelect: () => remove(menuItem.id) },
  ] : []

  const row = (item: ChecklistItem, handle?: ReactNode, sortable?: SortableProps) => (
    <li
      key={item.id}
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={styles.item}
      data-subtask=""
      data-done={item.isCompleted ? '' : undefined}
      data-dragging={sortable?.isDragging ? '' : undefined}
    >
      {handle}
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={item.isCompleted}
        aria-label={`${item.isCompleted ? 'Uncheck' : 'Check'} ${item.title}`}
        onChange={(e) => onSetDone(item.id, e.target.checked)}
      />
      {renaming === item.id ? (
        <RenameField
          title={item.title}
          onSave={(title) => { if (title !== item.title) onRename(item.id, title); setRenaming(null) }}
          onCancel={() => setRenaming(null)}
          density={density}
        />
      ) : (
        <button
          type="button"
          className={styles.title}
          title={item.title}
          onClick={() => setRenaming(item.id)}
          aria-label={`Rename ${item.title}`}
        >
          {item.title}
        </button>
      )}
      <button
        type="button"
        ref={(el) => { if (el) moreButtons.current.set(item.id, el); else moreButtons.current.delete(item.id) }}
        className={styles.more}
        aria-label={`Subtask menu: ${item.title}`}
        aria-haspopup="menu"
        aria-expanded={menuFor === item.id}
        data-open={menuFor === item.id ? '' : undefined}
        onClick={() => openMenu(item.id)}
      >
        <MoreIcon size={14} />
      </button>
    </li>
  )

  const list = onMove
    ? <SortableList items={items} label={label} density={density} onMove={onMove} row={row} />
    : (
      <ul className={styles.list} aria-label={label} data-density={density}>
        {items.map((item) => row(item))}
      </ul>
    )

  return (
    <>
      {items.length > 0 && list}
      <div className={styles.addRow} data-density={density}>
        <span className={styles.addIcon} aria-hidden="true"><PlusIcon size={density === 'touch' ? 16 : 13} strokeWidth={2} /></span>
        <input
          ref={addRef}
          className={styles.addInput}
          value={draft}
          maxLength={SUBTASK_TITLE_MAX}
          placeholder={ADD_PLACEHOLDER}
          aria-label="New subtask"
          autoComplete="off"
          {...{ [ESCAPE_CLEARS_ATTR]: '' }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onAddKeyDown}
        />
      </div>
      {footer}
      {menuItem && (
        <MenuPopover
          anchorRef={menuAnchor}
          entries={menuEntries}
          label={`Subtask: ${menuItem.title}`}
          width={228}
          onClose={() => setMenuFor(null)}
        />
      )}
    </>
  )
}

/** The rename field, in the title's place: ⏎ saves, Esc cancels (and stops there), blur saves. */
function RenameField({ title, onSave, onCancel, density }: {
  title: string
  onSave: (title: string) => void
  onCancel: () => void
  density: ChecklistDensity
}) {
  const [value, setValue] = useState(title)
  const ref = useRef<HTMLInputElement>(null)
  // Whether the field already finished (⏎ / Esc), so the blur that follows writes nothing twice.
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.select()
  }, [])
  const save = () => {
    if (done.current) return
    done.current = true
    const clean = subtaskTitle(value)
    if (clean === '') onCancel()
    else onSave(clean)
  }
  return (
    <input
      ref={ref}
      className={styles.titleInput}
      value={value}
      maxLength={SUBTASK_TITLE_MAX}
      aria-label="Subtask title"
      autoComplete="off"
      data-density={density}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          done.current = true
          onCancel()
        }
      }}
    />
  )
}

interface SortableProps {
  setNodeRef: (el: HTMLElement | null) => void
  style: React.CSSProperties
  isDragging: boolean
}

/** The list with dnd-kit's sortable rows (the editor): a grip per row is the activator. */
function SortableList({ items, label, density, onMove, row }: {
  items: readonly ChecklistItem[]
  label: string
  density: ChecklistDensity
  onMove: (id: number, toIndex: number) => void
  row: (item: ChecklistItem, handle: ReactNode, sortable: SortableProps) => ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = useMemo(() => items.map((i) => i.id), [items])
  const itemId = useCallback((i: ChecklistItem) => i.id, [])
  const move = useCallback((from: number, to: number) => {
    const item = items[from]
    if (item) onMove(item.id, to)
  }, [items, onMove])
  const onDragEnd = useSortableReorderHandler(items, itemId, move)
  const announcements = useMemo((): Announcements => {
    const name = (id: UniqueIdentifier) => items.find((i) => i.id === id)?.title ?? 'subtask'
    const position = (id: UniqueIdentifier) => ids.indexOf(Number(id)) + 1
    return {
      onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
      onDragOver: ({ active, over }) => (over
        ? `${name(active.id)} is at position ${position(over.id)} of ${ids.length}.`
        : `${name(active.id)} is no longer over the list.`),
      onDragEnd: ({ active, over }) => (over
        ? `${name(active.id)} dropped at position ${position(over.id)} of ${ids.length}.`
        : `${name(active.id)} dropped.`),
      onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
    }
  }, [items, ids])
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ announcements }} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={styles.list} aria-label={label} data-density={density}>
          {items.map((item) => <SortableRow key={item.id} item={item} row={row} />)}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ item, row }: {
  item: ChecklistItem
  row: (item: ChecklistItem, handle: ReactNode, sortable: SortableProps) => ReactNode
}) {
  const { setNodeRef, attributes, listeners, style, isDragging } = useSortableRow(item.id)
  const handle = (
    <DragHandle className={styles.grip} attributes={attributes} listeners={listeners} ariaHidden={false} label={`Move ${item.title}`} />
  )
  return <>{row(item, handle, { setNodeRef, style, isDragging })}</>
}
