import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DateAnchor, TodoPredicate } from '../../../models'
import { PREDICATE_SEARCH_TEXT_MAX } from '../../../models/filter-predicate'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { toggleItem } from '../../../utils/filter'
import { MARKERS_LABEL } from '../../../utils/markers'
import { EntityDropdownItems, DateRangePanelBody, MarkersPanelBody, SelectionPanelBody } from './FilterPanels'
import { DEFAULT_PREDICATE } from './FilterChipBar.shared'
import picker from './FilterPicker.module.css'
import styles from './ListFilterChips.module.css'

type EntityField = 'people' | 'tags' | 'status'

const ID_KEY: Record<EntityField, 'personIds' | 'tags' | 'statusIds'> = {
  people: 'personIds',
  tags: 'tags',
  status: 'statusIds',
}

export interface PredicateFieldPickerProps {
  field: ListFilterField
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  /** Viewport point the panel hangs from. */
  at: PopoverPoint
  /**
   * Adding this filter: an entity picker starts with nothing ticked (the
   * first pick narrows to it) and a date picker starts on `dateField`.
   */
  adding?: boolean
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
  const update = useCallback((patch: Partial<TodoPredicate>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onChange(next)
  }, [onChange])

  return createPortal(
    <div
      ref={panelRef}
      className={`${picker.dropdownPanel} ${styles.pickerPanel}`}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={`${PICKER_TITLE[field]} filter`}
      data-testid="list-filter-picker"
    >
      {field === 'dates' ? (
        <DatesPicker predicate={predicate} presetField={adding ? dateField : undefined} update={update} onClose={onClose} />
      ) : field === 'text' ? (
        <TextPicker predicate={predicate} update={update} onClose={onClose} />
      ) : field === 'markers' ? (
        // Several markers can be ticked, so picking one keeps the picker open.
        <MarkersPanelBody value={predicate.markers ?? null} onChange={(markers) => update({ markers })} />
      ) : (
        <EntityPicker field={field} predicate={predicate} adding={adding} update={update} onClose={onClose} />
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
  dates: 'Date',
  text: 'Text',
}

function EntityPicker({ field, predicate, adding, update, onClose }: {
  field: EntityField
  predicate: TodoPredicate
  adding: boolean
  update: (patch: Partial<TodoPredicate>) => void
  onClose: () => void
}) {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const entities = field === 'people' ? people : field === 'tags' ? tags : statuses
  const key = ID_KEY[field]
  const raw = predicate[key] ?? null
  const ids = raw ? new Set(raw) : null
  // Nothing filtered yet: show every row unticked; the first pick narrows to it.
  const [preview, setPreview] = useState(adding && ids == null)
  const [searchText, setSearchText] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { searchRef.current?.focus() }, [])

  const withNone = field !== 'tags'
  const allIds = [...(withNone ? [0] : []), ...entities.map((e) => e.id!)]
  const set = (next: Set<number> | null) => update({ [key]: next ? [...next] : null })

  const toggle = (id: number) => {
    if (preview) {
      setPreview(false)
      set(new Set([id]))
      return
    }
    set(toggleItem(ids, id, allIds))
  }

  return (
    <SelectionPanelBody
      allSelected={!preview && ids == null}
      noneSelected={preview || (ids != null && ids.size === 0)}
      onSelectAll={() => { setPreview(false); set(null) }}
      onDeselectAll={() => { setPreview(false); set(new Set()) }}
      search={{ text: searchText, setText: setSearchText, onEscape: onClose }}
      searchInputRef={searchRef}
    >
      {field === 'tags' && entities.length === 0 ? (
        <div className={picker.dropdownEmpty}>No tags yet</div>
      ) : (
        <EntityDropdownItems
          searchText={searchText}
          entities={entities}
          isChecked={(id) => !preview && (ids == null || ids.has(id))}
          onToggle={toggle}
          namePrefix={field === 'people' ? '@' : field === 'tags' ? '#' : undefined}
          showDot={field !== 'people'}
          withNone={withNone}
        />
      )}
    </SelectionPanelBody>
  )
}

function DatesPicker({ predicate, presetField, update, onClose }: {
  predicate: TodoPredicate
  presetField: DateField | undefined
  update: (patch: Partial<TodoPredicate>) => void
  onClose: () => void
}) {
  // The field shown before a range is set (adding "Follow-up date" on a list
  // whose stored field is due). It's written together with the range.
  const hasRange = predicate.dateRangeStart != null || predicate.dateRangeEnd != null
  const [field, setField] = useState<DateField>(!hasRange && presetField ? presetField : predicate.dateField)
  const fieldRef = useRef(field)
  const active = hasRange || predicate.hasDeadline != null || (predicate.hasFollowup ?? null) != null
  return (
    <DateRangePanelBody
      active={active}
      dateField={field}
      startAnchor={predicate.dateRangeStart}
      endAnchor={predicate.dateRangeEnd}
      includeNoDate={predicate.dateRangeIncludeNoDate}
      hasDeadline={predicate.hasDeadline}
      hasFollowup={predicate.hasFollowup ?? null}
      onChangeDateField={(f) => { fieldRef.current = f; setField(f) }}
      onChangeAnchors={(start: DateAnchor | null, end: DateAnchor | null) => update({ dateField: fieldRef.current, dateRangeStart: start, dateRangeEnd: end })}
      onChangeIncludeNoDate={(dateRangeIncludeNoDate) => update({ dateRangeIncludeNoDate })}
      onChangeHasDeadline={(hasDeadline) => update({ hasDeadline })}
      onChangeHasFollowup={(hasFollowup) => update({ hasFollowup })}
      onCleared={onClose}
    />
  )
}

function TextPicker({ predicate, update, onClose }: {
  predicate: TodoPredicate
  update: (patch: Partial<TodoPredicate>) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <label className={styles.textPicker}>
      <span className={styles.textPickerLabel}>Text contains</span>
      <input
        ref={inputRef}
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
    </label>
  )
}
