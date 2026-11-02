import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import { useLensHideCounts } from '../../../hooks/use-lens-counts'
import { useSortableReorderHandler, useSortableRow } from '../../../hooks/use-sortable-row'
import { deleteLens } from '../../../services/lenses'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { predicateLineItems, type FilterChipNames } from '../../../utils/filter-chips'
import { LENS_NAME_MAX, waitingStatusId, type Lens } from '../../../utils/lens'
import { DragHandle } from '../../shared/DragHandle'
import { ChevronDownIcon, PlusIcon } from '../../shared/icons'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { lensSummary } from '../../shared/filters/lens-text'
import { useStackedLayer } from './settings-layer'
import sectionStyles from './sections.module.css'
import styles from './LensesSection.module.css'

/**
 * Settings › Tasks › Lenses: the lenses — named screen filters picked in
 * the top bar — each a row (name, its filters in a line, "In use" on the
 * top bar's pick) that opens into its editor: the list filter row's chips,
 * + Filter and pickers (with their "is not" switch), how many open tasks it
 * keeps right now, Rename · Duplicate · Delete (deleting the picked lens
 * puts the top bar on No lens; Undo brings both back). + New lens adds one.
 * A row's grip drags it to a new place (pointer, or the keyboard: Space,
 * the arrows, Space; Esc cancels the drag, not Settings) — the order is the
 * top bar picker's; an open lens drags open. Every change is saved at once
 * as one undo step with the snackbar. The presets are seeded on the first
 * open. Desktop only.
 */
export function LensesSection() {
  const lenses = useSettingsStore((s) => s.lenses)
  const seeded = useSettingsStore((s) => s.lensPresetsSeeded)
  const activeLensId = useSettingsStore((s) => s.activeLensId)
  const statusesLoaded = useStatusStore((s) => s.loaded)
  const statuses = useStatusStore((s) => s.statuses)
  const names = useChipNames()
  const counts = useLensHideCounts(lenses)
  const [openId, setOpenId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // While a lens is held, Esc cancels the drag (dnd-kit's), not Settings.
  useStackedLayer(dragging)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = useMemo(() => lenses.map((l) => l.id), [lenses])
  const lensId = useCallback((l: Lens) => l.id, [])
  const moveLens = useCallback((from: number, to: number) => void useSettingsStore.getState().moveLens(from, to), [])
  const onDragEnd = useSortableReorderHandler(lenses, lensId, moveLens)
  const announcements = useMemo((): Announcements => {
    const name = (id: UniqueIdentifier) => lenses.find((l) => l.id === id)?.name ?? 'lens'
    const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1
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
  }, [lenses, ids])

  // The presets, once: Not waiting needs the statuses read.
  useEffect(() => {
    if (!seeded && statusesLoaded) void useSettingsStore.getState().seedLensPresets(waitingStatusId(statuses))
  }, [seeded, statusesLoaded, statuses])

  const addLens = async () => {
    const id = await useSettingsStore.getState().addLens('New lens')
    if (id) {
      setOpenId(id)
      setRenaming(id)
    }
  }

  return (
    <div className={sectionStyles.section}>
      <p className={styles.intro}>
        A lens is a saved filter with a name, picked in the top bar: every widget shows only what it keeps, on every
        layout. Edit it like a list’s filters — the same pickers, with their “is not” switch for what to
        leave out. Filters set in the top bar apply on top of it.
      </p>
      {lenses.length === 0 && <p className={styles.empty}>No lenses yet.</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{ announcements }}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={(e) => {
          setDragging(false)
          onDragEnd(e)
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className={styles.list} data-testid="lens-list">
            {lenses.map((lens) => (
              <LensRow
                key={lens.id}
                lens={lens}
                names={names}
                inUse={lens.id === activeLensId}
                keeps={counts.open - (counts.hides.get(lens.id) ?? 0)}
                open={counts.open}
                expanded={openId === lens.id}
                renaming={renaming === lens.id}
                onToggle={() => {
                  setOpenId(openId === lens.id ? null : lens.id)
                  setRenaming(null)
                }}
                onRename={(on) => setRenaming(on ? lens.id : null)}
                onDuplicated={(id) => setOpenId(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button type="button" className={`${sectionStyles.button} ${sectionStyles.buttonPrimary} ${styles.newLens}`} onClick={() => void addLens()}>
        <PlusIcon size={12} strokeWidth={2} /> New lens
      </button>
    </div>
  )
}

interface LensRowProps {
  lens: Lens
  names: FilterChipNames
  /** It is the top bar's pick. */
  inUse: boolean
  /** Open tasks it keeps now, of `open`. */
  keeps: number
  open: number
  expanded: boolean
  renaming: boolean
  onToggle: () => void
  onRename: (on: boolean) => void
  onDuplicated: (id: string) => void
}

/** One lens: its row (the grip first), and — open — its editor; the whole of it drags. */
function LensRow({ lens, names, inUse, keeps, open, expanded, renaming, onToggle, onRename, onDuplicated }: LensRowProps) {
  const editorId = useId()
  const { setNodeRef, attributes, listeners, style, isDragging } = useSortableRow(lens.id)
  const summary = useMemo(() => lensSummary(lens, names), [lens, names])
  const hasChips = useMemo(() => predicateLineItems(lens.predicate, names).length > 0, [lens.predicate, names])
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.lens} ${expanded ? styles.lensOpen : ''} ${isDragging ? styles.lensDragging : ''}`}
      data-lens-id={lens.id}
    >
      <div className={styles.head}>
        <DragHandle className={styles.grip} attributes={attributes} listeners={listeners} ariaHidden={false} label={`Move ${lens.name}`} />
        {renaming ? (
          <RenameField lens={lens} onDone={() => onRename(false)} />
        ) : (
          <button
            type="button"
            className={styles.headButton}
            aria-expanded={expanded}
            aria-controls={expanded ? editorId : undefined}
            onClick={onToggle}
          >
            <span className={styles.name}>{lens.name}</span>
            <span className={styles.summary}>{summary}</span>
            {inUse && <span className={styles.used} title="Picked in the top bar">In use</span>}
            <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}><ChevronDownIcon /></span>
          </button>
        )}
      </div>
      {expanded && (
        <div id={editorId} className={styles.editor}>
          <div className={styles.chips} data-testid="lens-filter">
            <PredicateChips
              predicate={lens.predicate}
              onChange={(next) => void useSettingsStore.getState().setLensPredicate(lens.id, next)}
              addLabel="Add a filter to this lens"
              layout="stack"
              inDialog
              before={hasChips ? undefined : <span className={styles.noFilter}>No filter — every task</span>}
            />
          </div>
          <div className={styles.foot}>
            <span data-testid="lens-keeps">
              Keeps <b>{keeps} of {open}</b> open tasks right now
            </span>
            <span className={styles.actions}>
              <button type="button" className={styles.link} onClick={() => onRename(true)}>Rename</button>
              <button
                type="button"
                className={styles.link}
                onClick={async () => {
                  const id = await useSettingsStore.getState().duplicateLens(lens.id)
                  if (id) onDuplicated(id)
                }}
              >
                Duplicate
              </button>
              <button type="button" className={`${styles.link} ${styles.danger}`} onClick={() => void deleteLens(lens.id)}>Delete</button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** The lens's name, edited in place: Enter or leaving saves (a blank name changes nothing), Esc cancels. */
function RenameField({ lens, onDone }: { lens: Lens; onDone: () => void }) {
  const [value, setValue] = useState(lens.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) void useSettingsStore.getState().renameLens(lens.id, value)
    onDone()
  }
  return (
    <input
      ref={inputRef}
      className={styles.nameInput}
      aria-label="Lens name"
      value={value}
      maxLength={LENS_NAME_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          // The field's own Esc: Settings stays open.
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
