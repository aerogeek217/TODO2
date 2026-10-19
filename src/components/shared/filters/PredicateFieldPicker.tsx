import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TodoPredicate } from '../../../models'
import { PREDICATE_SEARCH_TEXT_MAX } from '../../../models/filter-predicate'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { isNegated, withIdFilter } from '../../../utils/filter-negation'
import { MARKERS_LABEL } from '../../../utils/markers'
import { EntityDropdownItems, MarkersPanelBody, SelectionPanelBody } from './FilterPanels'
import { DateFilterPanel } from './DateFilterPanel'
import { DATE_FILTER_DIALOG_LABEL, DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { DEFAULT_PREDICATE, ENTITY_ID_FIELD, entityTicked, entityToggle } from './FilterChipBar.shared'
import { ClearableField } from '../ClearableField'
import picker from './FilterPicker.module.css'
import styles from './ListFilterChips.module.css'

type EntityField = 'people' | 'tags' | 'status'

export interface PredicateFieldPickerProps {
  field: ListFilterField
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  /** Viewport point the panel hangs from. */
  at: PopoverPoint
  /** Adding this filter: an entity picker starts with nothing ticked (the first pick narrows to it). */
  adding?: boolean
  /** The date type the date panel opens on (a date chip's); default the first that filters, else Due. */
  dateField?: DateField
  onClose: () => void
}

/**
 * The picker for one filter field of a list's predicate — the same pickers
 * the top bar's filter buttons open (entity checklist, date range, text).
 */
export function PredicateFieldPicker({ field, predicate: stored, onChange, at, adding = false, dateField, onClose }: PredicateFieldPickerProps) {
  // A stored predicate may predate some fields; read it with their defaults.
  const predicate = useMemo(() => ({ ...DEFAULT_PREDICATE, ...stored }), [stored])
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: at.x, y: at.y },
    open: true,
    placement: at.align === 'start' ? 'bottom-start' : 'bottom-end',
    closeOnScroll: false,
    onClose,
  })

  // Several updates can fire from one gesture (e.g. the date Clear): each
  // builds on the last one sent, not on this render's predicate.
  const latest = useRef(predicate)
  useEffect(() => { latest.current = predicate }, [predicate])
  const replace = useCallback((change: (p: TodoPredicate) => TodoPredicate) => {
    const next = change(latest.current)
    latest.current = next
    onChange(next)
  }, [onChange])
  const update = useCallback((patch: Partial<TodoPredicate>) => replace((p) => ({ ...p, ...patch })), [replace])

  const dates = field === 'dates'
  return createPortal(
    <div
      ref={panelRef}
      className={dates ? DATE_FILTER_POPOVER_CLASS : `${picker.dropdownPanel} ${styles.pickerPanel}`}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={dates ? DATE_FILTER_DIALOG_LABEL : `${PICKER_TITLE[field]} filter`}
      data-testid="list-filter-picker"
    >
      {dates ? (
        // Picking a type or clearing keeps the panel open.
        <DateFilterPanel dates={predicate.dates} initialField={dateField} onChange={(d) => update({ dates: d })} autoFocus />
      ) : field === 'text' ? (
        <TextPicker predicate={predicate} update={update} onClose={onClose} />
      ) : field === 'markers' ? (
        // Several markers can be ticked, so picking one keeps the picker open.
        <MarkersPanelBody value={predicate.markers ?? null} onChange={(markers) => update({ markers })} />
      ) : (
        <EntityPicker field={field} predicate={predicate} adding={adding} replace={replace} onClose={onClose} />
      )}
    </div>,
    document.body,
  )
}

const PICKER_TITLE: Record<ListFilterField, string> = {
  people: 'People',
  tags: 'Tags',
  status: 'Status',
  markers: MARKERS_LABEL,
  dates: 'Dates',
  text: 'Text',
}

function EntityPicker({ field, predicate, adding, replace, onClose }: {
  field: EntityField
  predicate: TodoPredicate
  adding: boolean
  replace: (change: (p: TodoPredicate) => TodoPredicate) => void
  onClose: () => void
}) {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const entities = field === 'people' ? people : field === 'tags' ? tags : statuses
  const key = ENTITY_ID_FIELD[field]
  const raw = predicate[key] ?? null
  const ids = raw ? new Set(raw) : null
  // "Is": nothing filtered yet shows every row unticked; the first pick
  // narrows to it. "Is not" with nothing ticked is no filter, so the picker
  // holds that mode itself until the first tick.
  const [preview, setPreview] = useState(adding && ids == null)
  const [pendingNot, setPendingNot] = useState(false)
  const negated = isNegated(predicate, key) || (pendingNot && ids == null)
  const [searchText, setSearchText] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { searchRef.current?.focus() }, [])

  const withNone = field !== 'tags'
  const allIds = [...(withNone ? [0] : []), ...entities.map((e) => e.id!)]
  // The ids and the switch are written together: the last "is not" tick
  // removed drops the stored switch, and the picker stays on Is not.
  const set = (next: Set<number> | null, not = negated) => {
    if (not) setPendingNot(true)
    replace((p) => withIdFilter(p, key, next ? [...next] : null, not))
  }
  const showPreview = preview && !negated

  const toggle = (id: number) => {
    if (showPreview) {
      setPreview(false)
      set(new Set([id]))
      return
    }
    set(entityToggle(ids, negated, id, allIds))
  }
  const setMode = (not: boolean) => {
    setPendingNot(not)
    // Back to "is" with nothing filtered: the preview again when adding.
    if (!not && ids == null) setPreview(adding)
    if (ids != null) set(ids, not)
  }

  return (
    <SelectionPanelBody
      mode={{ field: PICKER_TITLE[field], negated, onChange: setMode }}
      allSelected={negated ? ids != null && allIds.every((id) => ids.has(id)) : !showPreview && ids == null}
      noneSelected={negated ? ids == null : showPreview || (ids != null && ids.size === 0)}
      onSelectAll={() => { setPreview(false); set(negated ? new Set(allIds) : null) }}
      onDeselectAll={() => { setPreview(false); set(negated ? null : new Set()) }}
      search={{ text: searchText, setText: setSearchText, onEscape: onClose }}
      searchInputRef={searchRef}
    >
      {field === 'tags' && entities.length === 0 ? (
        <div className={picker.dropdownEmpty}>No tags yet</div>
      ) : (
        <EntityDropdownItems
          searchText={searchText}
          entities={entities}
          isChecked={(id) => !showPreview && entityTicked(ids, negated, id)}
          onToggle={toggle}
          namePrefix={field === 'people' ? '@' : field === 'tags' ? '#' : undefined}
          showDot={field !== 'people'}
          withNone={withNone}
          entityMenu={field === 'people' ? 'person' : field === 'tags' ? 'tag' : undefined}
          onShowTasks={onClose}
        />
      )}
    </SelectionPanelBody>
  )
}

function TextPicker({ predicate, update, onClose }: {
  predicate: TodoPredicate
  update: (patch: Partial<TodoPredicate>) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <div className={styles.textPicker}>
      <label htmlFor={inputId} className={styles.textPickerLabel}>Text contains</label>
      <ClearableField
        value={predicate.searchText}
        onClear={() => update({ searchText: '' })}
        inputRef={inputRef}
        label="Clear text filter"
      >
        <input
          ref={inputRef}
          id={inputId}
          className={picker.dropdownSearchInput}
          type="text"
          value={predicate.searchText}
          maxLength={PREDICATE_SEARCH_TEXT_MAX}
          placeholder="Title, notes, people, tags…"
          onChange={(e) => update({ searchText: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
      </ClearableField>
    </div>
  )
}
