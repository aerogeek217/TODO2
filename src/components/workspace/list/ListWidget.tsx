import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { LensTab, ListZoom } from '../../../models/workspace-layout'
import type { PersistedListDefinition, RuntimeFilterField } from '../../../models/list-definition'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useBuiltList } from '../../../hooks/use-built-list'
import { useKeptTodos, useLeavingRows } from '../../../hooks/use-leaving-rows'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useListScreenFilter } from '../../../hooks/use-list-screen-filter'
import { screenHiderText, screenUnhideAction } from '../../shared/filters/screen-hides'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useEffectiveListDefinition, useIsListDirty } from '../../../hooks/use-list-draft'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useListOrderStore, useListRanks } from '../../../stores/list-order-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import {
  isUngroupedSectionKey,
  listSortComparator,
  type Section,
} from '../../../services/list-sections'
import { predicateToFilterDefaults } from '../../../utils/filter-defaults'
import { describeFilters, hasNarrowingFilters, predicateLineItems } from '../../../utils/filter-chips'
import { PROMPT_LABEL, sortSummary, withListSort } from '../../../utils/list-options'
import { manualOrderComparator, planMove, seedRanks, type MoveTarget, type RankWrite } from '../../../utils/list-order'
import { rowKey, type ScopedRow } from '../../../utils/scoped-selection'
import {
  resolveCrossGroupMutation,
  UNGROUPED_GROUP_KEY,
  type CrossGroupMutation,
} from '../../../utils/cross-group-drag'
import { dispatchCrossGroupMutation } from '../../../services/cross-group-mutation'
import type { ListRowDragSource, ListRowDropTarget } from '../../../utils/list-row-drop'
import { RuntimeFilterPicker } from './RuntimeFilterPicker'
import { ListFace } from './ListFace'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { EmptyState } from '../../shared/EmptyState'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { TaskRowGrid } from '../../task/TaskRowGrid'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { ReassignDialog } from '../../overlays/ReassignDialog'
import { ChevronDownIcon, PlusIcon, SortIcon } from '../../shared/icons'
import { useChipNames } from '../../shared/filters/filter-menu'
import { DropSlot, ListWidgetRow, type ListRowDragLook } from './ListWidgetRow'
import { ListBulkBar } from './ListBulkBar'
import { MenuPopover } from '../../shared/MenuPopover'
import { ListGroupHeader } from './ListGroupHeader'
import { groupPerson, listGroupMenu, type GroupPerson } from './person-group'
import { SwitchToManualPopover } from './SwitchToManualPopover'
import { ListFilterRow } from './ListFilterRow'
import { useScreenChips } from './use-screen-chips'
import { openEditList } from '../widget-hooks'
import { useListRowDrag, type ListRowDragState } from './use-list-row-drag'
import { TaskDropLandingContext } from '../../task/dnd/task-drop-landing'
import { hasMarkers } from '../../../utils/markers'
import { topLevelPredicate } from '../../../utils/predicate-expression'
import { resolvePriorityDrop, type PriorityDrop } from '../../../utils/priority-groups'
import { useToday } from '../../../hooks/use-today'
import { useFilterSettings } from '../../../hooks/use-filter-settings'
import { RefusalTooltip } from '../../shared/RefusalTooltip'
import { useDropRefusedCursor } from '../../../hooks/use-drop-refused-cursor'
import styles from './ListWidget.module.css'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import { LIST_SECTION_ATTR, LIST_WIDGET_ATTR, SELECTION_SCOPE_ATTR } from '../../../utils/dom-contract'
import { listTabZoom, setListTabZoom } from '../../../services/list-zoom'
import { zoomOnCtrlWheel } from './zoom-wheel'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { transitionName, withViewTransition } from '../../shared/view-transition'

/** The top bar's lens on one list, as its tab shows it while the list's filter line is hidden. */
export interface ListLensMark {
  /** The lens's name. */
  name: string
  /** The list ignores the lens (`ListDefinition.ignoreLens`). */
  ignored: boolean
  /** What the lens hides (or would hide) here. */
  hides: number
}

/** What a list widget reports to its cell (tab count, its menu's lens switch, Copy tasks). */
export interface ListWidgetResult {
  /**
   * The tab's count — `N`, `shown of total` when screen filters hide tasks,
   * or `—` while the prompt is unanswered — only while the list's filter
   * line is hidden; the line shows it otherwise.
   */
  countLabel?: string
  /** The top bar's lens on this list, while one applies there: the tab menu's switch; on the tab while the line is hidden. */
  lens?: ListLensMark & { listId: number }
  /** The sections shown, for Copy tasks. */
  sections: readonly Section[]
  /** The list shows group headers (Collapse all / Expand all groups apply). */
  grouped?: boolean
}

interface ListWidgetProps {
  tab: LensTab
  onResult?: (result: ListWidgetResult) => void
}

const EMPTY_SECTIONS: readonly Section[] = []

/** The runtime-filter prompt's one action: into the picker's field. */
const RUNTIME_PICK_ACTION: Record<RuntimeFilterField, string> = { person: 'Pick someone', status: 'Pick a status', tag: 'Pick a tag' }

/** Tasks in the sections, each once. */
function uniqueCount(sections: readonly Section[]): number {
  const ids = new Set<number>()
  for (const s of sections) for (const t of s.todos) ids.add(t.id)
  return ids.size
}

/**
 * A workspace list widget: the list's prompt row, a filter row (screen
 * filters, then the list's own filters), its groups and a footer (Add
 * task). Shows the list's unsaved draft when it has one; the screen
 * (top-bar) filter narrows it too (`composeScreenFilter`).
 */
export function ListWidget({ tab, onResult }: ListWidgetProps) {
  const listId = tab.config.listDefinitionId
  const definition = useEffectiveListDefinition(listId)
  // Its face (D25 R): the name and count when small, with the top rows when medium, the list itself when large.
  const [faceRef, face] = useWidgetFace()
  if (listId == null || !definition) {
    return <EmptyState illustration="list" title={listId == null ? 'No list configured' : 'This list was deleted'} />
  }
  if (face !== 'large') return <ListFace tab={tab} definition={definition} face={face} faceRef={faceRef} onResult={onResult} />
  return <ListWidgetBody tab={tab} definition={definition} onResult={onResult} faceRef={faceRef} />
}

/** Groupings whose groups take rows from each other (the value is reassigned). */
const CROSS_GROUP_AXES = new Set(['people', 'status', 'tag', 'priority'])

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

function ListWidgetBody({ tab, definition, onResult, faceRef }: {
  tab: LensTab
  definition: PersistedListDefinition
  onResult?: (r: ListWidgetResult) => void
  /** Measures the widget's face (`useWidgetFace`). */
  faceRef: (el: HTMLElement | null) => void
}) {
  const isMobile = useIsMobile()
  // The tab's zoom (D25 C + I1): its own, else the Settings default. The phone has one density.
  const defaultZoom = useSettingsStore((s) => s.listZoom)
  const zoom: ListZoom = isMobile ? 'rows' : listTabZoom(tab, defaultZoom)
  const zoomRef = useLatestRef(isMobile ? null : zoom)
  const tabIdRef = useLatestRef(tab.id)
  const picks = useListWidgetStore((s) => s.picks[tab.id])
  const setPicks = useListWidgetStore((s) => s.setPicks)
  const collapsed = useListWidgetStore((s) => s.collapsed[tab.id])
  const toggleGroup = useListWidgetStore((s) => s.toggleGroup)
  const screenFor = useListScreenFilter(definition.id)
  // The lens as it applies to this list (none while the list ignores it).
  const lens = screenFor.ignoresLens ? undefined : screenFor.lens
  const unsaved = useIsListDirty(definition.id)
  const filterLineShown = definition.showFilterLine !== false || unsaved
  const screenChips = useScreenChips()
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const ranks = useListRanks(definition.id)
  const names = useChipNames()
  const today = useToday()
  const filterSettings = useFilterSettings()
  const scrollRef = useRef<HTMLDivElement>(null)
  const runtimeInputRef = useRef<HTMLInputElement>(null)
  // The drag hook reads the scroller through `scrollRef`; the edge fades track it; Ctrl + wheel over it zooms.
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    const stop = trackScrollEdges(el)
    const stopWheel = el ? zoomOnCtrlWheel(el, () => zoomRef.current, (z) => void setListTabZoom(tabIdRef.current, z)) : undefined
    return () => {
      scrollRef.current = null
      stop?.()
      stopWheel?.()
    }
  }, [zoomRef, tabIdRef])
  const widgetRef = useRef<HTMLDivElement | null>(null)
  const setWidgetEl = useCallback((el: HTMLDivElement | null) => {
    widgetRef.current = el
    faceRef(el)
  }, [faceRef])
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null)
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ section: Section; person: GroupPerson | null; at: { x: number; y: number } } | null>(null)

  // A row completed here lingers, then folds, before it drops out (D19; desktop rows).
  const shownIdsRef = useRef<ReadonlySet<number>>(new Set())
  const leaving = useLeavingRows((id) => shownIdsRef.current.has(id))
  const { list, baseCount, runtimeFilterPending, mergedPredicate, orderCandidates, kept, lensHides } = useBuiltList(
    definition,
    picks,
    screenFor.filters,
    isMobile ? undefined : leaving,
    screenFor.probe,
  )
  useEffect(() => { shownIdsRef.current = new Set(list?.todos.map((t) => t.id)) })
  // A kept row is built as it was (open); it shows as it is now (completed).
  const keptTodos = useKeptTodos(kept, leaving)

  const sections = list?.sections ?? EMPTY_SECTIONS
  const shown = useMemo(() => uniqueCount(sections), [sections])
  const total = list?.todos.length ?? 0
  const countLabel = runtimeFilterPending ? '—' : shown < baseCount ? `${shown} of ${baseCount}` : String(shown)

  const predicate = definition.membership.predicate
  const listItems = useMemo(() => predicateLineItems(predicate, names), [predicate, names])

  // + Add task: only when the merged predicate names people / status / tags
  // / markers to seed the new task with (an "is not" field or several
  // priorities seed nothing, but keep the button). An expression keeps it
  // too: only its top-level terms a chip could say seed (`topLevelPredicate`);
  // which side of an `or` a new task should meet is ambiguous.
  const seeding = mergedPredicate && topLevelPredicate(mergedPredicate)
  const canAddTask = mergedPredicate != null && seeding != null && (
    seeding.personIds != null
    || seeding.statusIds != null
    || (seeding.tags != null && seeding.tags.length > 0)
    || hasMarkers(seeding.markers)
    || mergedPredicate.expression != null
  )

  const groupedBy = definition.grouping
  const grouped = groupedBy !== 'none'
  const manual = definition.sort === 'manual'
  const collapsedKeys = useMemo(() => new Set(collapsed ?? []), [collapsed])

  // The lens on this list, while one applies at the top bar: shown while
  // it hides something here, or while the list ignores it (so it can be
  // turned back on).
  const lensName = screenFor.lens?.name
  const lensMark = useMemo<ListLensMark | undefined>(
    () => (lensName != null && !runtimeFilterPending && (screenFor.ignoresLens || lensHides > 0)
      ? { name: lensName, ignored: screenFor.ignoresLens, hides: lensHides }
      : undefined),
    [lensName, runtimeFilterPending, screenFor.ignoresLens, lensHides],
  )
  const toggleLens = useCallback(() => {
    void useListDefinitionStore.getState().setIgnoreLens(definition.id, !screenFor.ignoresLens)
  }, [definition.id, screenFor.ignoresLens])

  const onResultRef = useLatestRef(onResult)
  const tabCount = filterLineShown ? undefined : countLabel
  useEffect(() => {
    onResultRef.current?.({
      ...(tabCount != null ? { countLabel: tabCount } : {}),
      ...(lensMark ? { lens: { ...lensMark, listId: definition.id } } : {}),
      sections,
      grouped,
    })
  }, [tabCount, lensMark, definition.id, sections, grouped, onResultRef])

  // ── Selection: one widget at a time, rows addressed by occurrence ──
  const rows = useMemo<ScopedRow[]>(
    () => sections.flatMap((section) =>
      grouped && collapsedKeys.has(section.key) ? [] : section.todos.map((t) => ({ key: rowKey(section.key, t.id), todoId: t.id })),
    ),
    [sections, collapsedKeys, grouped],
  )
  const { inScope, selectedIds, cursorKey, onSelect: onRowSelect } = useWidgetSelection(tab.id, () => rows)

  // ── Drag: reorder (manual / switch to manual) and cross-group reassign ──
  const listId = definition.id
  const manualOrder = () => orderCandidates().sort(manualOrderComparator(ranks)).map((t) => t.id)
  const crossKey = (key: string) => (isUngroupedSectionKey(groupedBy, key) ? UNGROUPED_GROUP_KEY : key)
  /** A Priority group's drop: the flags it writes, or why it's refused (`null`: nothing to do). */
  const priorityDrop = (todo: PersistedTodoItem, sourceKey: string, targetKey: string): PriorityDrop | null =>
    resolvePriorityDrop(todo, sourceKey, targetKey, { today, urgentRange: filterSettings.urgentRange })
  const crossMutation = (todo: PersistedTodoItem, sourceKey: string, targetKey: string): CrossGroupMutation | null => {
    if (groupedBy !== 'priority') return resolveCrossGroupMutation(groupedBy, crossKey(sourceKey), crossKey(targetKey), todo.id)
    const drop = priorityDrop(todo, sourceKey, targetKey)
    // A refused drop writes nothing (its tooltip said why during the drag).
    return drop?.kind === 'write' ? { kind: 'priority', todoId: todo.id, flags: drop.flags, description: drop.description } : null
  }
  const landDrop = useContext(TaskDropLandingContext)
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
      const mutation = crossMutation(todo, source.sectionKey, target.sectionKey)
      if (!mutation) return
      // The row moves to its new group once the write lands (or after the question).
      landDrop('in-place')
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

  // A Priority drop that would be refused: no landing line or highlight, the
  // not-allowed cursor and a tooltip saying why (the Eisenhower's way).
  const refusal = (() => {
    if (groupedBy !== 'priority' || !drag?.target?.cross) return null
    const todo = list?.todos.find((t) => t.id === drag.source.todoId)
    const result = todo ? priorityDrop(todo, drag.source.sectionKey, drag.target.sectionKey) : null
    return result?.kind === 'refused' ? result.lines : null
  })()
  useDropRefusedCursor(refusal != null)
  const dropTarget = refusal ? null : drag?.target ?? null

  const switchToManual = () => {
    if (!pendingSwitch) return
    const order = orderCandidates()
      .sort(listSortComparator(definition.sort, {
        urgentRange: useSettingsStore.getState().urgentDueWithinDays,
        direction: definition.sortDirection,
        assignedPeopleMap,
        statuses: useStatusStore.getState().statuses,
      }))
      .map((t) => t.id)
    void useListOrderStore.getState().replaceList(listId, seedRanks(order, pendingSwitch.move))
    useListDraftStore.getState().edit(listId, (d) => withListSort(d, 'manual'))
    setPendingSwitch(null)
  }

  const renderSectionRows = (section: Section) => {
    const target = dropTarget?.sectionKey === section.key ? dropTarget : null
    const out: React.ReactNode[] = []
    let j = 0
    // Where the row would land: a blank slot, whatever the drop (D25 E4).
    const indicator = () => {
      if (!target || !drag) return
      if (target.cross) {
        out.push(<DropSlot key="drop-slot" />)
      } else if (manual) {
        if (target.index !== drag.source.index) out.push(<DropSlot key="drop-slot" />)
      } else {
        out.push(
          <DropSlot key="drop-slot" sorted>
            <span className={styles.dropHint} data-testid="sorted-drop-hint">
              <SortIcon size={12} /> Sorted by {sortSummary(definition.sort, definition.sortDirection).toLowerCase()} · drop to switch to manual
            </span>
          </DropSlot>,
        )
      }
    }
    section.todos.forEach((built, i) => {
      const todo = keptTodos?.get(built.id) ?? built
      const key = rowKey(section.key, todo.id)
      if (drag?.source.key !== key) {
        if (target?.index === j) indicator()
        j++
      }
      const people = assignedPeopleMap.get(todo.id)
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
          leaving={keptTodos?.has(todo.id) ? leaving.get(todo.id)?.phase : undefined}
          zoom={zoom}
          onSelect={onRowSelect}
          onOpenDetail={openEditPopup}
        />,
      )
    })
    if (target?.index === j) indicator()
    return out
  }

  const promptLabel = definition.runtimeFilter ? PROMPT_LABEL[definition.runtimeFilter.field] : ''

  let body: React.ReactNode
  if (runtimeFilterPending) {
    body = (
      <EmptyState
        illustration={definition.runtimeFilter?.field === 'person' ? 'person' : 'list'}
        title={`Pick a ${promptLabel.toLowerCase()} to show this list`}
        text={`Type in the ${promptLabel} field above. The pick is temporary and isn’t saved.`}
        action={{ label: RUNTIME_PICK_ACTION[definition.runtimeFilter?.field ?? 'person'], onClick: () => runtimeInputRef.current?.focus() }}
      />
    )
  } else if (total === 0) {
    if (baseCount > 0) {
      body = (
        <EmptyState
          illustration="list"
          title="No tasks match"
          text={`All ${baseCount} ${baseCount === 1 ? 'task' : 'tasks'} in this list ${baseCount === 1 ? 'is' : 'are'} hidden by ${screenHiderText(screenChips.length > 0, lens)}.`}
          action={screenUnhideAction(screenChips.length)}
        />
      )
    } else if (hasNarrowingFilters(predicate)) {
      body = (
        <EmptyState
          illustration="list"
          title="No tasks match"
          text={describeFilters(listItems)}
          action={{
            label: 'Edit filters',
            onClick: () => openEditList(tab.id, definition.id),
          }}
        />
      )
    } else {
      body = <EmptyState illustration="list" title="No tasks in this list" />
    }
  } else {
    const sourceLabel = drag ? sections.find((s) => s.key === drag.source.sectionKey)?.label : undefined
    const groups = (
      grouped ? sections.map((section) => {
        const isCollapsed = collapsedKeys.has(section.key)
        const crossTarget = dropTarget?.cross === true && dropTarget.sectionKey === section.key
        const person = isMobile ? null : groupPerson(groupedBy, section)
        const header = (
          <button
            type="button"
            className={`${styles.groupHeader} ${person && !drag ? styles.groupHeaderWithAction : ''}`}
            aria-expanded={!isCollapsed}
            onClick={() => withViewTransition(() => toggleGroup(tab.id, section.key))}
          >
            <span className={styles.groupChevron}><ChevronDownIcon /></span>
            <span className={styles.swatch} style={{ background: section.accentColor ?? 'var(--color-text-muted)' }} aria-hidden="true" />
            <span className={styles.groupName} data-testid="list-group-name">{section.label}</span>
            <span className={styles.groupCount}>{section.todos.length}</span>
            <span className={styles.groupRule} aria-hidden="true" />
            {crossTarget && sourceLabel != null && (
              <span className={styles.groupDropPreview} data-testid="cross-group-preview">{sourceLabel} → {section.label}</span>
            )}
          </button>
        )
        return (
          <div
            key={section.key}
            className={`${styles.group} ${isCollapsed ? styles.groupCollapsed : ''} ${crossTarget ? styles.groupDropTarget : ''}`}
            data-list-group={section.key}
            // A grouped body's rows draw no hairline (D25 A1; TaskRow / MobileTaskRow styles).
            data-row-group=""
            style={isMobile ? undefined : { viewTransitionName: transitionName('ws-group', tab.id, section.key) }}
            {...{ [LIST_SECTION_ATTR]: section.key }}
          >
            {isMobile ? header : (
              <ListGroupHeader
                person={person}
                showAction={!drag}
                onOpenMenu={(at) => setHeaderMenu({ section, person, at })}
              >
                {header}
              </ListGroupHeader>
            )}
            {!isCollapsed && renderSectionRows(section)}
          </div>
        )
      }) : sections.map((section) => (
        <div key={section.key} {...{ [LIST_SECTION_ATTR]: section.key }}>
          {renderSectionRows(section)}
        </div>
      ))
    )
    body = isMobile ? <div className={styles.body}>{groups}</div> : (
      <TaskRowGrid
        className={styles.body}
        zoom={zoom}
        detailsWidth={tab.viewState?.detailsWidth}
        onDetailsWidthChange={(detailsWidth) => void useWorkspaceStore.getState().patchTabViewState(tab.id, 'lens', { detailsWidth })}
      >
        {groups}
      </TaskRowGrid>
    )
  }

  const footerHeight = canAddTask ? 32 : 0
  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2

  return (
    <div
      ref={setWidgetEl}
      className={`${styles.widget} ${isMobile ? styles.touch : ''}`}
      {...{ [LIST_WIDGET_ATTR]: tab.id }}
      data-list-host={tab.id}
      data-zoom={isMobile ? undefined : zoom}
      {...{ [SELECTION_SCOPE_ATTR]: isMobile ? undefined : tab.id }}
      // The list the palette's Zoom List In / Out act on: the one last pressed or focused in.
      onPointerDownCapture={() => useUIStore.getState().setActiveListTab(tab.id)}
      onFocusCapture={() => useUIStore.getState().setActiveListTab(tab.id)}
      // Phones: the filter chips (a shared stylesheet) get their touch height.
      data-touch-chips={isMobile ? '' : undefined}
    >
      {definition.runtimeFilter && (
        <RuntimeFilterPicker
          inputRef={runtimeInputRef}
          spec={definition.runtimeFilter}
          value={picks}
          onChange={(ids) => setPicks(tab.id, ids)}
        />
      )}
      <ListFilterRow tabId={tab.id} definition={definition} count={countLabel} lens={lensMark} onToggleLens={toggleLens} />
      <div ref={setScrollEl} className={styles.scroll}>
        {body}
      </div>
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
          <span className={styles.addTaskIcon} aria-hidden="true"><PlusIcon size={12} strokeWidth={2} /></span>
          Add task
        </button>
      )}
      {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={footerHeight + 12} />}
      {refusal && drag?.pointer && (
        <RefusalTooltip lines={refusal} pointer={drag.pointer} boundsRef={widgetRef} followPointer testId="list-drop-refusal" />
      )}
      {pendingSwitch && (
        <SwitchToManualPopover
          listName={definition.name}
          sortLabel={sortSummary(definition.sort, definition.sortDirection)}
          at={pendingSwitch.at}
          onConfirm={switchToManual}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
      {headerMenu && (
        <MenuPopover
          point={headerMenu.at}
          label={`${headerMenu.section.label} group`}
          closeOnScroll
          restoreFocus
          entries={listGroupMenu(sections.find((s) => s.key === headerMenu.section.key) ?? headerMenu.section, headerMenu.person)}
          onClose={() => setHeaderMenu(null)}
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
