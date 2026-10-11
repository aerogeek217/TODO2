import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { toggleItem } from '../../../utils/filter'
import { StatusIcon } from '../StatusIcon'
import topBar from '../../layout/TopBar.module.css'
import { DateRangeDropdown } from './DateRangeDropdown'
import {
  useFilterChipBarState,
  type EntityKey,
  type FilterChipBarProps,
} from './FilterChipBar.shared'

interface FilterDropdownProps {
  label: React.ReactNode
  active: boolean
  allSelected: boolean
  noneSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onOpen?: () => void
  onClose?: () => void
  searchable?: boolean
  children: React.ReactNode | ((searchText: string) => React.ReactNode)
}

function FilterDropdown({
  label,
  active,
  allSelected,
  noneSelected,
  onSelectAll,
  onDeselectAll,
  onOpen,
  onClose,
  searchable,
  children,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    setOpen(false)
    setSearchText('')
    onClose?.()
  }, [onClose])

  // Portal + flip + clamp: when this chip-row sits inside the list editor
  // modal (via ListFilterEditor), the dialog body's `overflow: auto` used to
  // clip the panel and force the user to scroll inside the modal. Routing
  // through usePopoverAnchor + createPortal mirrors the IconSelect fix
  // (triage-2026-04-27 batch2 P3 / item 3) for the rest of the editor's
  // dropdowns. usePopoverAnchor also subsumes the prior `useRightEdgeFlip`
  // X-axis flip and adds a Y-axis flip when there's no room below.
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: handleClose,
  })

  const handleToggle = useCallback(() => {
    if (open) {
      handleClose()
    } else {
      setOpen(true)
      onOpen?.()
    }
  }, [open, onOpen, handleClose])

  useEffect(() => {
    if (open && searchable) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open, searchable])

  const rendered = typeof children === 'function' ? children(searchText) : children

  return (
    <div className={topBar.dropdownWrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={`${topBar.filterChip} ${active ? topBar.filterChipActive : ''}`}
        onClick={handleToggle}
        aria-expanded={open}
      >
        {label}
        <span className={`${topBar.chevron} ${open ? topBar.chevronOpen : ''}`}>&#9662;</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={topBar.dropdownPanel}
          style={{ position: style.position, left: style.left, top: style.top }}
        >
          <div className={topBar.dropdownActions}>
            <button
              type="button"
              className={`${topBar.dropdownAction} ${allSelected ? topBar.dropdownActionDisabled : ''}`}
              onClick={allSelected ? undefined : onSelectAll}
            >
              Select all
            </button>
            <span className={topBar.dropdownActionSep}>/</span>
            <button
              type="button"
              className={`${topBar.dropdownAction} ${noneSelected ? topBar.dropdownActionDisabled : ''}`}
              onClick={noneSelected ? undefined : onDeselectAll}
            >
              Deselect all
            </button>
          </div>
          <div className={topBar.dropdownDivider} />
          {searchable && (
            <div className={topBar.dropdownSearchWrapper}>
              <input
                ref={searchRef}
                className={topBar.dropdownSearchInput}
                type="text"
                placeholder="Search..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchText) setSearchText('')
                    else handleClose()
                  }
                }}
              />
            </div>
          )}
          <div className={searchable ? topBar.dropdownItemsScrollable : undefined}>{rendered}</div>
        </div>,
        document.body,
      )}
    </div>
  )
}

interface EntityDropdownItemsProps {
  searchText: string
  entities: { id?: number; name: string; color?: string; icon?: string }[]
  isChecked: (id: number) => boolean
  onToggle: (id: number) => void
  namePrefix?: string
  showDot?: boolean
}

function EntityDropdownItems({
  searchText,
  entities,
  isChecked,
  onToggle,
  namePrefix,
  showDot = true,
}: EntityDropdownItemsProps) {
  const q = searchText.toLowerCase()
  const showNone = !q || 'none'.includes(q)
  const filtered = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .toSorted((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      {showNone && (
        <label className={topBar.dropdownItem} onClick={() => onToggle(0)}>
          <span className={`${topBar.check} ${isChecked(0) ? topBar.checked : ''}`} />
          <span className={topBar.noneLabel}>None</span>
        </label>
      )}
      {filtered.map((entity) => (
        <label key={entity.id} className={topBar.dropdownItem} onClick={() => onToggle(entity.id!)}>
          <span className={`${topBar.check} ${isChecked(entity.id!) ? topBar.checked : ''}`} />
          {entity.icon ? (
            <span className={topBar.dotIcon} style={{ color: entity.color }}>
              <StatusIcon icon={entity.icon} filled />
            </span>
          ) : showDot && entity.color ? (
            <span className={topBar.dot} style={{ background: entity.color }} />
          ) : null}
          {namePrefix}
          {entity.name}
        </label>
      ))}
      {q && !showNone && filtered.length === 0 && (
        <div className={topBar.dropdownEmpty}>No matches</div>
      )}
    </>
  )
}

interface EntityChipDropdownProps {
  entityKey: EntityKey
  label: React.ReactNode
  isActive: boolean
  noneSelected: boolean
  previewEmpty: EntityKey | null
  setPreviewEmpty: (k: EntityKey | null) => void
  setIds: (next: Set<number> | null) => void
  searchable?: boolean
  children: React.ReactNode | ((searchText: string) => React.ReactNode)
}

/**
 * Wraps the preview-empty open/close pattern repeated by every chip
 * (Project / People / Tags / Status). On open, if the chip has no
 * active filter, we stamp `previewEmpty` so the dropdown renders with all
 * items unchecked — the first click commits only the clicked entity.
 * Select-all clears `previewEmpty` along with the id list.
 */
function EntityChipDropdown({
  entityKey,
  label,
  isActive,
  noneSelected,
  previewEmpty,
  setPreviewEmpty,
  setIds,
  searchable,
  children,
}: EntityChipDropdownProps) {
  return (
    <FilterDropdown
      label={label}
      active={isActive || previewEmpty === entityKey}
      allSelected={!isActive && previewEmpty !== entityKey}
      noneSelected={noneSelected}
      onSelectAll={() => {
        setPreviewEmpty(null)
        setIds(null)
      }}
      onDeselectAll={() => {
        setPreviewEmpty(null)
        setIds(new Set())
      }}
      onOpen={() => {
        if (!isActive) setPreviewEmpty(entityKey)
      }}
      onClose={() => {
        if (previewEmpty === entityKey) setPreviewEmpty(null)
      }}
      searchable={searchable}
    >
      {children}
    </FilterDropdown>
  )
}

export function FilterChipBarDesktop({
  predicate,
  onChange,
  showClearAll = true,
  onClearExtra,
  onClearAll,
}: FilterChipBarProps) {
  const [previewEmpty, setPreviewEmpty] = useState<EntityKey | null>(null)
  const resetDensityState = useCallback(() => setPreviewEmpty(null), [])

  const s = useFilterChipBarState(predicate, onChange, onClearAll, onClearExtra, resetDensityState)
  const {
    p,
    people,
    projects,
    statuses,
    sortedTags,
    allTagIds,
    personIdsSet,
    projectIdsSet,
    statusIdsSet,
    tagIdsSet,
    peopleActive,
    projectsActive,
    statusActive,
    tagsActive,
    dateActive,
    active,
    update,
    setPersonIds,
    setProjectIds,
    setStatusIds,
    setTags,
    clearAll,
  } = s

  const handlePersonToggle = (personId: number) => {
    if (previewEmpty === 'people') {
      setPreviewEmpty(null)
      setPersonIds(new Set([personId]))
      return
    }
    const allIds = [0, ...people.map((x) => x.id!)]
    setPersonIds(toggleItem(personIdsSet, personId, allIds))
  }
  const handleProjectToggle = (projectId: number) => {
    if (previewEmpty === 'project') {
      setPreviewEmpty(null)
      setProjectIds(new Set([projectId]))
      return
    }
    const allIds = [0, ...projects.map((x) => x.id!)]
    setProjectIds(toggleItem(projectIdsSet, projectId, allIds))
  }
  const handleStatusToggle = (statusId: number) => {
    if (previewEmpty === 'status') {
      setPreviewEmpty(null)
      setStatusIds(new Set([statusId]))
      return
    }
    const allIds = [0, ...statuses.map((s) => s.id!)]
    setStatusIds(toggleItem(statusIdsSet, statusId, allIds))
  }
  const handleTagToggle = (tagId: number) => {
    if (previewEmpty === 'tags') {
      setPreviewEmpty(null)
      setTags(new Set([tagId]))
      return
    }
    setTags(toggleItem(tagIdsSet, tagId, allTagIds))
  }

  const isPersonChecked = (id: number) =>
    previewEmpty === 'people' ? false : personIdsSet === null || personIdsSet.has(id)
  const isProjectChecked = (id: number) =>
    previewEmpty === 'project' ? false : projectIdsSet === null || projectIdsSet.has(id)
  const isStatusChecked = (id: number) =>
    previewEmpty === 'status' ? false : statusIdsSet === null || statusIdsSet.has(id)
  const isTagChecked = (id: number) =>
    previewEmpty === 'tags' ? false : tagIdsSet === null || tagIdsSet.has(id)

  const peopleNone = previewEmpty === 'people' || (personIdsSet !== null && personIdsSet.size === 0)
  const projectsNone = previewEmpty === 'project' || (projectIdsSet !== null && projectIdsSet.size === 0)
  const statusNone = previewEmpty === 'status' || (statusIdsSet !== null && statusIdsSet.size === 0)
  const tagsNone = previewEmpty === 'tags' || (tagIdsSet !== null && tagIdsSet.size === 0)

  return (
    <>
      {projects.length > 0 && (
        <EntityChipDropdown
          entityKey="project"
          label={
            <>
              <svg
                className={topBar.filterIconSvg}
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 4.5l6-3 6 3v7l-6 3-6-3z" />
                <path d="M2 4.5l6 3 6-3M8 7.5v7" />
              </svg>
              {' '}Project
            </>
          }
          isActive={projectsActive}
          noneSelected={projectsNone}
          previewEmpty={previewEmpty}
          setPreviewEmpty={setPreviewEmpty}
          setIds={setProjectIds}
          searchable
        >
          {(searchText: string) => (
            <EntityDropdownItems
              searchText={searchText}
              entities={projects}
              isChecked={isProjectChecked}
              onToggle={handleProjectToggle}
            />
          )}
        </EntityChipDropdown>
      )}

      {people.length > 0 && (
        <EntityChipDropdown
          entityKey="people"
          label={
            <>
              <span className={topBar.filterIcon}>@</span> People
            </>
          }
          isActive={peopleActive}
          noneSelected={peopleNone}
          previewEmpty={previewEmpty}
          setPreviewEmpty={setPreviewEmpty}
          setIds={setPersonIds}
          searchable
        >
          {(searchText: string) => (
            <EntityDropdownItems
              searchText={searchText}
              entities={people}
              isChecked={isPersonChecked}
              onToggle={handlePersonToggle}
              namePrefix="@"
              showDot={false}
            />
          )}
        </EntityChipDropdown>
      )}

      {sortedTags.length > 0 && (
        <EntityChipDropdown
          entityKey="tags"
          label={
            <>
              <span className={topBar.filterIcon}>#</span> Tags
            </>
          }
          isActive={tagsActive}
          noneSelected={tagsNone}
          previewEmpty={previewEmpty}
          setPreviewEmpty={setPreviewEmpty}
          setIds={setTags}
          searchable
        >
          {(searchText: string) => {
            const q = searchText.toLowerCase()
            const filtered = q
              ? sortedTags.filter((t) => t.name.toLowerCase().includes(q))
              : sortedTags
            if (filtered.length === 0) {
              return (
                <div className={topBar.dropdownEmpty}>{q ? 'No matches' : 'No tags yet'}</div>
              )
            }
            return (
              <>
                {filtered.map((tag) => (
                  <label
                    key={tag.id}
                    className={topBar.dropdownItem}
                    onClick={() => handleTagToggle(tag.id!)}
                  >
                    <span
                      className={`${topBar.check} ${isTagChecked(tag.id!) ? topBar.checked : ''}`}
                    />
                    {tag.color && (
                      <span className={topBar.dot} style={{ background: tag.color }} />
                    )}
                    #{tag.name}
                  </label>
                ))}
              </>
            )
          }}
        </EntityChipDropdown>
      )}

      <DateRangeDropdown
        active={dateActive}
        dateField={p.dateField}
        startAnchor={p.dateRangeStart}
        endAnchor={p.dateRangeEnd}
        includeNoDate={p.dateRangeIncludeNoDate}
        hasDeadline={p.hasDeadline}
        hasFollowup={p.hasFollowup ?? null}
        onChangeDateField={(dateField) => update({ dateField })}
        onChangeAnchors={(dateRangeStart, dateRangeEnd) => update({ dateRangeStart, dateRangeEnd })}
        onChangeIncludeNoDate={(dateRangeIncludeNoDate) => update({ dateRangeIncludeNoDate })}
        onChangeHasDeadline={(hasDeadline) => update({ hasDeadline })}
        onChangeHasFollowup={(hasFollowup) => update({ hasFollowup })}
      />

      {statuses.length > 0 && (
        <EntityChipDropdown
          entityKey="status"
          label={
            <>
              <span className={topBar.filterIcon}>&#x25C9;</span> Status
            </>
          }
          isActive={statusActive}
          noneSelected={statusNone}
          previewEmpty={previewEmpty}
          setPreviewEmpty={setPreviewEmpty}
          setIds={setStatusIds}
          searchable
        >
          {(searchText: string) => (
            <EntityDropdownItems
              searchText={searchText}
              entities={statuses}
              isChecked={isStatusChecked}
              onToggle={handleStatusToggle}
            />
          )}
        </EntityChipDropdown>
      )}

      <button
        type="button"
        className={`${topBar.filterChip} ${p.showCompleted ? topBar.filterChipActive : ''}`}
        onClick={() => update({ showCompleted: !p.showCompleted })}
        role="switch"
        aria-checked={p.showCompleted}
      >
        <span className={topBar.filterIcon}>✓</span> Show completed
      </button>

      {showClearAll && active && (
        <button
          type="button"
          className={topBar.clearFilters}
          onClick={clearAll}
          title="Clear all filters"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1.5 2h13l-5 6.5V14l-3-2V8.5L1.5 2z" />
            <line x1="2" y1="14" x2="14" y2="2" stroke="var(--color-overdue)" strokeWidth="2" />
          </svg>
        </button>
      )}
    </>
  )
}
