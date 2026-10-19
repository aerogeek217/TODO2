import { useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { MARKER_KEYS, type MarkersFilter } from '../../../models'
import { StatusIcon } from '../StatusIcon'
import { ClearableField } from '../ClearableField'
import { PickerEntityMenu } from '../EntityMenu'
import picker from './FilterPicker.module.css'
import { HotIcon, MarkerIcon } from '../MarkerIcons'
import { HOT_LABEL, MARKER_COLOR, MARKER_LABELS, MARKERS_LABEL, activeMarkers, isHotFilter, toggleHot, toggleMarker } from '../../../utils/markers'
import markerStyles from './MarkersPanel.module.css'
import { byName } from '../../../utils/sort-order'

/**
 * Bodies of the filter pickers, shared by the top bar's filter buttons
 * (`FilterChipBar`) and the list widgets' filter chips. Each renders inside
 * a caller-owned popover panel (`picker.dropdownPanel`). The date filters
 * have their own component, `DateFilterPanel`.
 */

interface SelectionPanelBodyProps {
  allSelected: boolean
  noneSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  /** A search box above the items (controlled). */
  search?: {
    text: string
    setText: (text: string) => void
    /** Escape on an empty search box. */
    onEscape: () => void
  }
  searchInputRef?: RefObject<HTMLInputElement | null>
  children: ReactNode
}

/** Select all / Deselect all, an optional search box (× clears it), then the items. */
export function SelectionPanelBody({ allSelected, noneSelected, onSelectAll, onDeselectAll, search, searchInputRef, children }: SelectionPanelBodyProps) {
  const ownSearchRef = useRef<HTMLInputElement>(null)
  const searchRef = searchInputRef ?? ownSearchRef
  return (
    <>
      <div className={picker.dropdownActions}>
        <button
          type="button"
          className={`${picker.dropdownAction} ${allSelected ? picker.dropdownActionDisabled : ''}`}
          onClick={allSelected ? undefined : onSelectAll}
        >
          Select all
        </button>
        <span className={picker.dropdownActionSep}>/</span>
        <button
          type="button"
          className={`${picker.dropdownAction} ${noneSelected ? picker.dropdownActionDisabled : ''}`}
          onClick={noneSelected ? undefined : onDeselectAll}
        >
          Deselect all
        </button>
      </div>
      <div className={picker.dropdownDivider} />
      {search && (
        <div className={picker.dropdownSearchWrapper}>
          <ClearableField
            value={search.text}
            onClear={() => search.setText('')}
            inputRef={searchRef}
            label="Clear search"
          >
            <input
              ref={searchRef}
              className={picker.dropdownSearchInput}
              type="text"
              placeholder="Search..."
              value={search.text}
              onChange={(e) => search.setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (search.text) search.setText('')
                  else search.onEscape()
                }
              }}
            />
          </ClearableField>
        </div>
      )}
      <div className={search ? picker.dropdownItemsScrollable : undefined}>{children}</div>
    </>
  )
}

interface EntityDropdownItemsProps {
  searchText: string
  entities: readonly { id?: number; name: string; color?: string; icon?: string }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  namePrefix?: string
  showDot?: boolean
  /** Show the leading "None" row (id 0). Default true. */
  withNone?: boolean
  /**
   * The rows are people / tags: a right-click on one opens its Show tasks ·
   * Edit… · Delete… menu over the picker (without ticking it); Show tasks
   * runs `onShowTasks` first (the host closes the picker).
   */
  entityMenu?: 'person' | 'tag'
  onShowTasks?: () => void
}

/** A right-click's press keeps the focus where it is (the picker's search box). */
function keepFocusOnRightPress(e: MouseEvent) {
  if (e.button === 2) e.preventDefault()
}

/** Checkable entity rows (plus a leading "None" row, id 0), filtered by `searchText`. */
export function EntityDropdownItems({
  searchText,
  entities,
  isChecked,
  onToggle,
  namePrefix,
  showDot = true,
  withNone = true,
  entityMenu,
  onShowTasks,
}: EntityDropdownItemsProps) {
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const q = searchText.toLowerCase()
  const showNone = withNone && (!q || 'none'.includes(q))
  const filtered = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .toSorted(byName)
  const onRowContextMenu = (id: number | undefined) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (id != null && id !== 0) setMenu({ id, x: e.clientX, y: e.clientY })
  }
  return (
    <>
      {showNone && (
        <label className={picker.dropdownItem} onClick={() => onToggle(0)} onContextMenu={entityMenu ? onRowContextMenu(0) : undefined}>
          <span className={`${picker.check} ${isChecked(0) ? picker.checked : ''}`} />
          <span className={picker.noneLabel}>None</span>
        </label>
      )}
      {filtered.map((entity) => (
        <label
          key={entity.id}
          className={picker.dropdownItem}
          onClick={() => onToggle(entity.id!)}
          onMouseDown={entityMenu ? keepFocusOnRightPress : undefined}
          onContextMenu={entityMenu ? onRowContextMenu(entity.id) : undefined}
        >
          <span className={`${picker.check} ${isChecked(entity.id!) ? picker.checked : ''}`} />
          {entity.icon ? (
            <span className={picker.dotIcon} style={{ color: entity.color }}>
              <StatusIcon icon={entity.icon} filled />
            </span>
          ) : showDot && entity.color ? (
            <span className={picker.dot} style={{ background: entity.color }} />
          ) : null}
          {namePrefix}
          {entity.name}
        </label>
      ))}
      {q && !showNone && filtered.length === 0 && (
        <div className={picker.dropdownEmpty}>No matches</div>
      )}
      {menu && entityMenu && (
        <PickerEntityMenu
          kind={entityMenu}
          id={menu.id}
          point={{ x: menu.x, y: menu.y }}
          onShowTasks={onShowTasks}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

const TICK = (
  <svg className={markerStyles.tick} width="12" height="12" viewBox="0 0 16 16" aria-hidden>
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * The Priority filter: Hot, then Focus / Urgent / Important checkboxes. A task
 * must be hot, or have every ticked marker (strict AND). Ticking Hot clears
 * and disables the single markers. Ticking keeps the picker open.
 */
export function MarkersPanelBody({ value, onChange }: {
  value: MarkersFilter | null
  onChange: (v: MarkersFilter | null) => void
}) {
  const hot = isHotFilter(value)
  const ticked = activeMarkers(value)
  return (
    <div className={markerStyles.panel} role="group" aria-label={MARKERS_LABEL}>
      <button
        type="button"
        className={`${picker.dropdownItem} ${markerStyles.row} ${hot ? markerStyles.rowOn : ''}`}
        role="checkbox"
        aria-checked={hot}
        onClick={() => onChange(toggleHot(value))}
      >
        <span className={markerStyles.glyph} style={{ color: 'var(--color-danger)' }}><HotIcon /></span>
        <span className={markerStyles.label}>{HOT_LABEL}</span>
        {hot && TICK}
      </button>
      <div className={markerStyles.separator} role="separator" />
      {MARKER_KEYS.map((key) => {
        const on = ticked.includes(key)
        return (
          <button
            key={key}
            type="button"
            className={`${picker.dropdownItem} ${markerStyles.row} ${on ? markerStyles.rowOn : ''} ${hot ? markerStyles.rowDisabled : ''}`}
            role="checkbox"
            aria-checked={on}
            aria-disabled={hot || undefined}
            onClick={() => { if (!hot) onChange(toggleMarker(value, key)) }}
          >
            <span className={markerStyles.glyph} style={{ color: MARKER_COLOR[key] }}><MarkerIcon marker={key} /></span>
            <span className={markerStyles.label}>{MARKER_LABELS[key]}</span>
            {on && TICK}
          </button>
        )
      })}
      <p className={markerStyles.note}>
        {hot
          ? 'Hot already combines these. Clear Hot to pick them one by one.'
          : 'Tasks must have everything ticked (strict AND). Urgent includes urgent by due date.'}
      </p>
    </div>
  )
}
