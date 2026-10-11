import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PersistedTodoItem, Person } from '../../../models'
import type { LensTab } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useBuiltList } from '../../../hooks/use-built-list'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useFilterStore } from '../../../stores/filter-store'
import { useEffectiveListDefinition, useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useListOrderStore, useListRanks } from '../../../stores/list-order-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import {
  isUngroupedSectionKey,
  listSortComparator,
  truncateSections,
  type Section,
} from '../../../services/list-sections'
import { predicateToFilterDefaults } from '../../../utils/filter-defaults'
import {
  describeFilters,
  filterChips,
  hasNarrowingFilters,
  type FilterChip,
} from '../../../utils/filter-chips'
import { listOptionsSummary, PROMPT_LABEL, SORT_LABEL } from '../../../utils/list-options'
import { manualOrderComparator, planMove, seedRanks, type MoveTarget, type RankWrite } from '../../../utils/list-order'
import { nextScopedSelection, rowKey, type ScopedRow } from '../../../utils/scoped-selection'
import {
  dispatchCrossGroupMutation,
  resolveCrossGroupMutation,
  UNGROUPED_GROUP_KEY,
  type CrossGroupMutation,
} from '../../../utils/cross-group-drag'
import type { ListRowDragSource, ListRowDropTarget } from '../../../utils/list-row-drop'
import { RuntimeFilterPicker } from '../../canvas/RuntimeFilterPicker'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { ReassignDialog } from '../../overlays/ReassignDialog'
import { ChevronDownIcon, FunnelIcon, PlusIcon, SortIcon } from '../icons'
import { pointBelow } from './popover-point'
import { PredicateChips } from './PredicateChips'
import { useChipNames } from './filter-menu'
import { ListWidgetRow, type ListRowDragLook, type ListRowSelectMods } from './ListWidgetRow'
import { ListBulkBar } from './ListBulkBar'
import { SwitchToManualPopover } from './SwitchToManualPopover'
import { useListRowDrag, type ListRowDragState } from './use-list-row-drag'
import styles from './ListWidget.module.css'

/** What a list widget reports to its cell (tab count, Copy tasks). */
export interface ListWidgetResult {
  /** `N`, `shown of total` when screen filters or a hard cap hide tasks, or `—` while the prompt is unanswered. */
  countLabel: string
  /** The sections shown (after the hard cap), for Copy tasks. */
  sections: readonly Section[]
}

interface ListWidgetProps {
  tab: LensTab
  onResult?: (result: ListWidgetResult) => void
}

const EMPTY_SECTIONS: readonly Section[] = []

/** Tasks in the sections, each once. */
function uniqueCount(sections: readonly Section[]): number {
  const ids = new Set<number>()
  for (const s of sections) for (const t of s.todos) ids.add(t.id)
  return ids.size
}

/**
 * A workspace list widget: the list's prompt row, a filter row (screen
 * filters, then the list's own filters), its groups and a footer (hard-cap
 * line, Add task). Shows the list's unsaved draft when it has one; the screen
 * (top-bar) filter narrows it too (`composeScreenFilter`).
 */
export function ListWidget({ tab, onResult }: ListWidgetProps) {
  const listId = tab.config.listDefinitionId
  const definition = useEffectiveListDefinition(listId)
  if (listId == null || !definition) {
    return <div className={styles.empty}><span className={styles.emptyHint}>{listId == null ? 'No list configured' : 'This list was deleted'}</span></div>
  }
  return <ListWidgetBody tab={tab} definition={definition} onResult={onResult} />
}

/** Groupings whose groups take rows from each other (the value is reassigned). */
const CROSS_GROUP_AXES = new Set(['people', 'status', 'tag'])

/** A cross-group drop waiting for the reassign dialog (people groups). */
interface PendingReassign {
  todo: PersistedTodoItem
  fromLabel: string
  toLabel: string
  mutation: CrossGroupMutation
  rankWrites: RankWrite[]
}

/** A drop in a sorted list waiting for "Switch to manual order?". */
interface PendingSwitch {
  move: MoveTarget
  at: { x: number; y: number }
}

function ListWidgetBody({ tab, definition, onResult }: { tab: LensTab; definition: PersistedListDefinition; onResult?: (r: ListWidgetResult) => void }) {
  const isMobile = useIsMobile()
  const picks = useListWidgetStore((s) => s.picks[tab.id])
  const setPicks = useListWidgetStore((s) => s.setPicks)
  const collapsed = useListWidgetStore((s) => s.collapsed[tab.id])
  const toggleGroup = useListWidgetStore((s) => s.toggleGroup)
  const screen = useFilterStore((s) => s.filters)
  const screenActive = useFilterStore((s) => s.isActive)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const inScope = useUIStore((s) => s.selectionScope === tab.id)
  const selectedIds = useUIStore((s) => s.selectedTodoIds)
  const cursorKey = useUIStore((s) => (s.selectionScope === tab.id ? s.selectionCursorKey : null))
  const ranks = useListRanks(definition.id)
  const names = useChipNames()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null)
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null)

  const { list, baseCount, runtimeFilterPending, mergedPredicate, orderCandidates } = useBuiltList(
    definition,
    picks,
    screenActive ? screen : undefined,
  )

  const sections = list?.sections ?? EMPTY_SECTIONS
  const hardCap = definition.maxTasks != null && (definition.limitMode ?? 'hard') === 'hard' ? definition.maxTasks : null
  const { displaySections, truncatedCount } = useMemo(
    () => (hardCap != null ? truncateSections([...sections], hardCap) : { displaySections: [...sections], truncatedCount: 0 }),
    [sections, hardCap],
  )
  const shown = useMemo(() => uniqueCount(displaySections), [displaySections])
  const total = list?.todos.length ?? 0
  const countLabel = runtimeFilterPending ? '—' : shown < baseCount ? `${shown} of ${baseCount}` : String(shown)

  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult }, [onResult])
  useEffect(() => {
    onResultRef.current?.({ countLabel, sections: displaySections })
  }, [countLabel, displaySections])

  const predicate = definition.membership.predicate
  const listChips = useMemo(() => filterChips(predicate, names), [predicate, names])
  const screenChips = useMemo(() => (screenActive ? filterChips(screen, names, true) : []), [screenActive, screen, names])
  const showFilterRow = listChips.length > 0 || screenChips.length > 0

  // + Add task: only when the merged predicate names people / status / tags
  // / a project / focus to seed the new task with.
  const canAddTask = mergedPredicate != null && (
    mergedPredicate.projectIds != null
    || mergedPredicate.personIds != null
    || mergedPredicate.statusIds != null
    || (mergedPredicate.tags != null && mergedPredicate.tags.length > 0)
    || mergedPredicate.focus === true
  )

  const groupedBy = definition.grouping
  const grouped = groupedBy !== 'none'
  const manual = definition.sort === 'manual'
  const collapsedKeys = useMemo(() => new Set(collapsed ?? []), [collapsed])

  // ── Selection: one widget at a time, rows addressed by occurrence ──
  const rows = useMemo<ScopedRow[]>(
    () => displaySections.flatMap((section) =>
      grouped && collapsedKeys.has(section.key) ? [] : section.todos.map((t) => ({ key: rowKey(section.key, t.id), todoId: t.id })),
    ),
    [displaySections, collapsedKeys, grouped],
  )
  const rowsRef = useLatestRef(rows)
  const onRowSelect = useCallback((key: string, _todoId: number, mods: ListRowSelectMods) => {
    const ui = useUIStore.getState()
    const next = nextScopedSelection(
      { scope: ui.selectionScope, ids: ui.selectedTodoIds, anchorKey: ui.selectionAnchorKey },
      tab.id,
      rowsRef.current,
      key,
      mods.shift ? 'range' : mods.ctrl ? 'toggle' : 'one',
    )
    if (next) ui.setScopedSelection(tab.id, next)
  }, [tab.id, rowsRef])

  // ── Drag: reorder (manual / switch to manual) and cross-group reassign ──
  const listId = definition.id
  const manualOrder = () => orderCandidates().sort(manualOrderComparator(ranks)).map((t) => t.id)
  const crossKey = (key: string) => (isUngroupedSectionKey(groupedBy, key) ? UNGROUPED_GROUP_KEY : key)
  const handleDrop = (source: ListRowDragSource, target: ListRowDropTarget) => {
    const section = sections.find((s) => s.key === target.sectionKey)
    const todo = list?.todos.find((t) => t.id === source.todoId)
    if (!section || !todo) return
    const others = section.todos.filter((t) => t.id !== source.todoId)
    const move: MoveTarget = {
      todoId: source.todoId,
      prevId: others[target.index - 1]?.id ?? null,
      nextId: others[target.index]?.id ?? null,
    }
    if (target.cross) {
      const mutation = resolveCrossGroupMutation(groupedBy, crossKey(source.sectionKey), crossKey(target.sectionKey), todo.id)
      if (!mutation) return
      const rankWrites = manual ? planMove(manualOrder(), ranks, move) : []
      if (mutation.kind === 'people') {
        const label = (key: string) => sections.find((s) => s.key === key)?.label ?? key
        setPendingReassign({ todo, fromLabel: label(source.sectionKey), toLabel: label(target.sectionKey), mutation, rankWrites })
        return
      }
      void applyCrossGroup(listId, mutation, rankWrites)
      return
    }
    if (target.index === source.index) return
    if (manual) {
      void useListOrderStore.getState().setRanks(listId, planMove(manualOrder(), ranks, move))
      return
    }
    // A sorted list: ask first, at the drop line.
    const line = scrollRef.current?.querySelector('[data-drop-line]')?.getBoundingClientRect()
    const box = scrollRef.current?.getBoundingClientRect()
    setPendingSwitch({
      move,
      at: line ? { x: line.left, y: line.bottom + 6 } : { x: box?.left ?? 0, y: box?.top ?? 0 },
    })
  }
  const drag = useListRowDrag({
    tabId: tab.id,
    scrollRef,
    canCross: grouped && CROSS_GROUP_AXES.has(groupedBy),
    onDrop: handleDrop,
  })

  const switchToManual = () => {
    if (!pendingSwitch) return
    const order = orderCandidates().sort(listSortComparator(definition.sort)).map((t) => t.id)
    void useListOrderStore.getState().replaceList(listId, seedRanks(order, pendingSwitch.move))
    useListDraftStore.getState().edit(listId, (d) => ({ ...d, sort: 'manual' }))
    setPendingSwitch(null)
  }

  const renderSectionRows = (section: Section) => {
    const target = drag?.target?.sectionKey === section.key ? drag.target : null
    const out: React.ReactNode[] = []
    let j = 0
    const indicator = () => {
      if (!target || !drag) return
      if (target.cross) {
        out.push(<div key="drop-line" className={styles.dropLine} data-drop-line="" />)
      } else if (manual) {
        if (target.index !== drag.source.index) out.push(<div key="drop-slot" className={styles.dropSlot} data-drop-slot="" />)
      } else {
        out.push(
          <div key="drop-line" className={`${styles.dropLine} ${styles.dropLineSorted}`} data-drop-line="">
            <span className={styles.dropHint} data-testid="sorted-drop-hint">
              <SortIcon size={12} /> Sorted by {SORT_LABEL[definition.sort].toLowerCase()} · drop to switch to manual
            </span>
          </div>,
        )
      }
    }
    section.todos.forEach((todo, i) => {
      const key = rowKey(section.key, todo.id)
      if (drag?.source.key !== key) {
        if (target?.index === j) indicator()
        j++
      }
      let people: Person[] | undefined = assignedPeopleMap.get(todo.id)
      // A person's own group doesn't repeat their chip on its rows.
      if (groupedBy === 'people' && people && section.key.startsWith('person-')) {
        const groupPersonId = Number(section.key.slice('person-'.length))
        people = people.filter((p) => p.id !== groupPersonId)
      }
      if (isMobile) {
        out.push(<MobileTaskRow key={key} todo={todo} assignedPeople={people} onOpenDetail={openEditPopup} />)
        return
      }
      const prev = section.todos[i - 1]
      const next = section.todos[i + 1]
      out.push(
        <ListWidgetRow
          key={key}
          todo={todo}
          assignedPeople={people}
          tabId={tab.id}
          sectionKey={section.key}
          rowKey={key}
          selected={inScope && selectedIds.has(todo.id)}
          selFirst={!(prev && selectedIds.has(prev.id))}
          selLast={!(next && selectedIds.has(next.id))}
          cursor={cursorKey === key}
          look={rowLook(drag, key, manual)}
          onSelect={onRowSelect}
          onOpenDetail={openEditPopup}
        />,
      )
    })
    if (target?.index === j) indicator()
    return out
  }

  const promptLabel = definition.runtimeFilter
    ? (definition.runtimeFilter.label?.trim() || PROMPT_LABEL[definition.runtimeFilter.field])
    : ''

  let body: React.ReactNode
  if (runtimeFilterPending) {
    body = (
      <EmptyState
        title={`Pick a ${promptLabel.toLowerCase()} to show this list`}
        hint={`Type in the ${promptLabel} field above. The pick is temporary and isn’t saved.`}
      />
    )
  } else if (total === 0) {
    if (baseCount > 0) {
      body = (
        <EmptyState
          title="No tasks match"
          hint={`All ${baseCount} ${baseCount === 1 ? 'task' : 'tasks'} in this list ${baseCount === 1 ? 'is' : 'are'} hidden by the screen filter.`}
          action={{ label: screenChips.length === 1 ? 'Clear screen filter' : 'Clear screen filters', onClick: () => useFilterStore.getState().clearAll() }}
        />
      )
    } else if (hasNarrowingFilters(predicate)) {
      body = (
        <EmptyState
          title="No tasks match"
          hint={describeFilters(listChips)}
          action={{
            label: 'Edit filters',
            onClick: (el) => useListWidgetStore.getState().openPopover({ kind: 'options', listDefinitionId: definition.id, at: pointBelow(el) }),
          }}
        />
      )
    } else {
      body = <EmptyState title="No tasks in this list" />
    }
  } else {
    const sourceLabel = drag ? sections.find((s) => s.key === drag.source.sectionKey)?.label : undefined
    body = (
      <div ref={bodyRef} className={styles.body}>
        {grouped ? displaySections.map((section) => {
          const isCollapsed = collapsedKeys.has(section.key)
          const crossTarget = drag?.target?.cross === true && drag.target.sectionKey === section.key
          return (
            <div
              key={section.key}
              className={`${styles.group} ${isCollapsed ? styles.groupCollapsed : ''} ${crossTarget ? styles.groupDropTarget : ''}`}
              data-list-group={section.key}
              data-list-section={section.key}
            >
              <button
                type="button"
                className={styles.groupHeader}
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(tab.id, section.key)}
              >
                <span className={styles.groupChevron}><ChevronDownIcon /></span>
                <span className={styles.swatch} style={{ background: section.accentColor ?? 'var(--color-text-muted)' }} aria-hidden="true" />
                <span className={styles.groupName} style={{ color: section.accentColor ?? 'var(--color-text-secondary)' }} data-testid="list-group-name">{section.label}</span>
                <span className={styles.groupCount}>{section.todos.length}</span>
                {crossTarget && sourceLabel != null && (
                  <span className={styles.groupDropPreview} data-testid="cross-group-preview">{sourceLabel} → {section.label}</span>
                )}
              </button>
              {!isCollapsed && renderSectionRows(section)}
            </div>
          )
        }) : displaySections.map((section) => (
          <div key={section.key} data-list-section={section.key}>
            {renderSectionRows(section)}
          </div>
        ))}
      </div>
    )
  }

  const footerHeight = (truncatedCount > 0 ? 30 : 0) + (canAddTask ? 32 : 0)
  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2

  return (
    <div
      className={`${styles.widget} ${isMobile ? styles.touch : ''}`}
      data-list-widget={tab.id}
      data-selection-scope={isMobile ? undefined : tab.id}
    >
      {definition.runtimeFilter && (
        <RuntimeFilterPicker
          spec={definition.runtimeFilter}
          value={picks}
          onChange={(ids) => setPicks(tab.id, ids)}
        />
      )}
      {showFilterRow && (
        <ListFilterRow tabId={tab.id} definition={definition} screenChips={screenChips} hasListChips={listChips.length > 0} />
      )}
      <div
        ref={scrollRef}
        className={styles.scroll}
        onClick={(e) => {
          // A click on empty space clears this widget's selection.
          if (inScope && (e.target === e.currentTarget || e.target === bodyRef.current)) {
            useUIStore.getState().clearSelection()
          }
        }}
      >
        {body}
      </div>
      {truncatedCount > 0 && (
        <div className={styles.capLine}>
          Showing {shown} of {total} —
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => useListDraftStore.getState().edit(definition.id, (d) => ({ ...d, limitMode: 'scroll' }))}
          >
            switch to scroll
          </button>
        </div>
      )}
      {canAddTask && (
        <button
          type="button"
          className={styles.addTask}
          title="Add a task to this list"
          onClick={() => {
            if (!mergedPredicate) return
            useUIStore.getState().openQuickAdd({ defaults: predicateToFilterDefaults(mergedPredicate) })
          }}
        >
          <PlusIcon /> Add task
        </button>
      )}
      {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={footerHeight + 12} />}
      {pendingSwitch && (
        <SwitchToManualPopover
          listName={definition.name}
          sortLabel={SORT_LABEL[definition.sort]}
          at={pendingSwitch.at}
          onConfirm={switchToManual}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
      {pendingReassign && (
        <ReassignDialog
          taskTitle={pendingReassign.todo.title}
          fromLabel={pendingReassign.fromLabel}
          toLabel={pendingReassign.toLabel}
          onConfirm={() => {
            const { mutation, rankWrites } = pendingReassign
            setPendingReassign(null)
            void applyCrossGroup(listId, mutation, rankWrites)
          }}
          onCancel={() => setPendingReassign(null)}
        />
      )}
    </div>
  )
}

/** Reassigns the grouped field (replace semantics), then saves the landing spot in a manual list. */
async function applyCrossGroup(listDefinitionId: number, mutation: CrossGroupMutation, rankWrites: RankWrite[]): Promise<void> {
  await dispatchCrossGroupMutation(mutation)
  if (rankWrites.length > 0) await useListOrderStore.getState().setRanks(listDefinitionId, rankWrites)
}

/** How a row looks while a row of its widget is dragged. */
function rowLook(drag: ListRowDragState | null, key: string, manual: boolean): ListRowDragLook {
  if (!drag) return 'idle'
  const { source, target } = drag
  const reordering = manual && !target?.cross
  if (key !== source.key) return reordering ? 'dim' : 'idle'
  if (!reordering) return 'origin'
  // Manual order: the row's slot stays where it is until the pointer picks another spot.
  return target && target.index !== source.index ? 'gone' : 'slot'
}

function EmptyState({ title, hint, action }: {
  title: string
  hint?: string
  action?: { label: string; onClick: (el: HTMLElement) => void }
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>{title}</span>
      {hint && <span className={styles.emptyHint}>{hint}</span>}
      {action && (
        <button type="button" className={styles.emptyAction} onClick={(e) => action.onClick(e.currentTarget)}>
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Value-only text for a screen chip (dates keep their field name). */
function screenChipText(chip: FilterChip): string {
  return chip.field === 'dates' ? `${chip.label} ${chip.value}` : chip.value
}

/**
 * Screen filter chips (read-only, set in the top bar), then the list's own
 * filter chips (editing them makes the list unsaved), + Filter, and the
 * group · sort summary that opens List options.
 */
function ListFilterRow({ tabId, definition, screenChips, hasListChips }: {
  tabId: string
  definition: PersistedListDefinition
  screenChips: readonly FilterChip[]
  hasListChips: boolean
}) {
  const popover = useListWidgetStore((s) => s.popover)
  const open = useListWidgetStore((s) => s.openPopover)
  const optionsOpen = popover?.kind === 'options' && popover.tabId === tabId
  // Clicking the summary while its popover is open closes it (the popover's
  // outside-click handler already did) instead of reopening it.
  const wasOpen = useRef(false)
  const id = definition.id

  return (
    <div className={styles.filterRow} data-testid="list-filter-row">
      <div className={styles.chips}>
        <PredicateChips
          predicate={definition.membership.predicate}
          onChange={(predicate) => useListDraftStore.getState().edit(id, (d) => ({ ...d, membership: { kind: 'custom', predicate } }))}
          before={(
            <>
              {screenChips.map((chip) => (
                <span key={`screen-${chip.field}`} className={styles.screenChip} title="Screen filter · set in the top bar" data-testid="screen-filter-chip">
                  <FunnelIcon />
                  {screenChipText(chip)}
                </span>
              ))}
              {screenChips.length > 0 && hasListChips && <span className={styles.chipSep} aria-hidden="true" />}
            </>
          )}
        />
      </div>
      <button
        type="button"
        className={`${styles.summary} ${optionsOpen ? styles.summaryOpen : ''}`}
        aria-haspopup="dialog"
        aria-expanded={optionsOpen}
        title="List options"
        onMouseDown={() => { wasOpen.current = optionsOpen }}
        onClick={(e) => {
          if (wasOpen.current) {
            wasOpen.current = false
            return
          }
          open({ kind: 'options', listDefinitionId: id, tabId, at: pointBelow(e.currentTarget, 'end') })
        }}
      >
        {listOptionsSummary(definition.grouping, definition.sort)}
        <ChevronDownIcon />
      </button>
    </div>
  )
}
