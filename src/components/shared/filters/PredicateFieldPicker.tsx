import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { emptyFilterClauses, PREDICATE_SEARCH_TEXT_MAX, type FilterClauses } from '../../../models/filter-predicate'
import type { DateField } from '../../../models/app-view'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import type { ListFilterField, PopoverPoint } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { entityPickerSelection, isNegated, withIdFilter } from '../../../utils/filter-negation'
import { NO_TAGS_LABEL } from '../../../utils/filter-labels'
import { EntityDropdownItems, MarkersPanelBody, SelectionPanelBody } from './FilterPanels'
import { DateFilterPanel } from './DateFilterPanel'
import { DATE_FILTER_POPOVER_CLASS } from './date-filter-popover'
import { PICKER_TITLE, pickerLabel } from './picker-label'
import { ENTITY_ID_FIELD } from './FilterChipBar.shared'
import { ClearableField } from '../ClearableField'
import picker from './FilterPicker.module.css'
import styles from './ListFilterChips.module.css'

type EntityField = 'people' | 'tags' | 'status'

interface PickerBodyProps<T extends FilterClauses> {
  field: ListFilterField
  /** The clauses edited: a predicate's own, or one of its or groups'. */
  predicate: T
  onChange: (next: T) => void
  /** Adding this filter: an entity picker starts with nothing ticked (the first pick narrows to it). */
  adding?: boolean
  /** The date type the date panel opens on (a date chip's); default the first that filters, else Due. */
  dateField?: DateField
  onClose: () => void
}

export interface PredicateFieldPickerProps<T extends FilterClauses> extends PickerBodyProps<T> {
  /** Viewport point the panel hangs from. */
  at: PopoverPoint
  /** Esc closes the picker only, not what it was opened from (e.g. a dialog). Default: it goes on. */
  consumeEscape?: boolean
}

/**
 * The picker for one filter field of a list's predicate (or of one of its
 * or groups) in a popover — the same pickers the top bar's filter buttons
 * open (entity checklist, date range, text).
 */
export function PredicateFieldPicker<T extends FilterClauses>({ at, consumeEscape = false, ...body }: PredicateFieldPickerProps<T>) {
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: at.x, y: at.y },
    open: true,
    placement: at.align === 'start' ? 'bottom-start' : 'bottom-end',
    closeOnScroll: false,
    consumeEscape,
    onClose: body.onClose,
  })
  const dates = body.field === 'dates'
  return createPortal(
    <div
      ref={panelRef}
      className={dates ? DATE_FILTER_POPOVER_CLASS : `${picker.dropdownPanel} ${styles.pickerPanel}`}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={pickerLabel(body.field)}
      data-testid="list-filter-picker"
    >
      <PredicateFieldPickerBody {...body} />
    </div>,
    document.body,
  )
}

/**
 * One field's picker body, without a popover around it (a list editor draws
 * it in place under the chip).
 */
export function PredicateFieldPickerBody<T extends FilterClauses>({ field, predicate: stored, onChange, adding = false, dateField, onClose }: PickerBodyProps<T>) {
  // Stored clauses may predate some fields; read them with their defaults.
  const predicate = useMemo((): T => ({ ...emptyFilterClauses(), ...stored }), [stored])

  // Several updates can fire from one gesture (e.g. the date Clear): each
  // builds on the last one sent, not on this render's clauses.
  const latest = useRef(predicate)
  useEffect(() => { latest.current = predicate }, [predicate])
  const replace = useCallback((change: (p: T) => T) => {
    const next = change(latest.current)
    latest.current = next
    onChange(next)
  }, [onChange])
  const update = useCallback((patch: Partial<FilterClauses>) => replace((p) => ({ ...p, ...patch })), [replace])

  if (field === 'dates') {
    // Picking a type or clearing keeps the panel open.
    return <DateFilterPanel dates={predicate.dates} initialField={dateField} onChange={(d) => update({ dates: d })} autoFocus />
  }
  if (field === 'text') return <TextPicker predicate={predicate} update={update} onClose={onClose} />
  // Several markers can be set, so picking one keeps the picker open.
  if (field === 'markers') return <MarkersPanelBody value={predicate.markers ?? null} onChange={(markers) => update({ markers })} />
  return <EntityPicker field={field} predicate={predicate} adding={adding} replace={replace} onClose={onClose} />
}


function EntityPicker<T extends FilterClauses>({ field, predicate, adding, replace, onClose }: {
  field: EntityField
  predicate: T
  adding: boolean
  replace: (change: (p: T) => T) => void
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

  const allIds = [0, ...entities.flatMap((e) => (e.id == null ? [] : [e.id]))]
  // The ids and the switch are written together: the last "is not" tick
  // removed drops the stored switch, and the picker stays on Is not.
  const set = (next: Set<number> | null, not = negated) => {
    if (not) setPendingNot(true)
    replace((p) => withIdFilter(p, key, next ? [...next] : null, not))
  }
  const sel = entityPickerSelection(ids, negated, preview, allIds)

  const toggle = (id: number) => {
    if (sel.previewing) setPreview(false)
    set(sel.toggled(id))
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
      allSelected={sel.allSelected}
      noneSelected={sel.noneSelected}
      onSelectAll={() => { setPreview(false); set(sel.all) }}
      onDeselectAll={() => { setPreview(false); set(sel.none) }}
      search={{ text: searchText, setText: setSearchText, onEscape: onClose }}
      searchInputRef={searchRef}
    >
      {field === 'tags' && entities.length === 0 ? (
        <div className={picker.dropdownEmpty}>No tags yet</div>
      ) : (
        <EntityDropdownItems
          searchText={searchText}
          entities={entities}
          label={PICKER_TITLE[field]}
          isChecked={sel.isChecked}
          onToggle={toggle}
          namePrefix={field === 'people' ? '@' : field === 'tags' ? '#' : undefined}
          showDot={field !== 'people'}
          noneLabel={field === 'tags' ? NO_TAGS_LABEL : undefined}
          entityMenu={field === 'people' ? 'person' : field === 'tags' ? 'tag' : undefined}
          onShowTasks={onClose}
          onSearchClear={() => setSearchText('')}
        />
      )}
    </SelectionPanelBody>
  )
}

function TextPicker({ predicate, update, onClose }: {
  predicate: FilterClauses
  update: (patch: Partial<FilterClauses>) => void
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
