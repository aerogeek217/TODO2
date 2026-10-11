import { useEffect, useMemo, useRef } from 'react'
import type { PersistedTodoItem, Person } from '../../../models'
import type { LensTab } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useBuiltList } from '../../../hooks/use-built-list'
import { useFilterStore } from '../../../stores/filter-store'
import { useEffectiveListDefinition, useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { truncateSections, type Section } from '../../../services/list-sections'
import { predicateToFilterDefaults } from '../../../utils/filter-defaults'
import {
  describeFilters,
  filterChips,
  hasNarrowingFilters,
  type FilterChip,
} from '../../../utils/filter-chips'
import { listOptionsSummary, PROMPT_LABEL } from '../../../utils/list-options'
import { RuntimeFilterPicker } from '../../canvas/RuntimeFilterPicker'
import { DraggableTaskRow } from '../../canvas/shared/DraggableTaskRow'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { ChevronDownIcon, FunnelIcon, PlusIcon } from '../icons'
import { pointBelow } from './popover-point'
import { PredicateChips } from './PredicateChips'
import { useChipNames } from './filter-menu'
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
  const names = useChipNames()

  const { list, baseCount, runtimeFilterPending, mergedPredicate } = useBuiltList(
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
  // / a project to seed the new task with.
  const canAddTask = mergedPredicate != null && (
    mergedPredicate.projectIds != null
    || mergedPredicate.personIds != null
    || mergedPredicate.statusIds != null
    || (mergedPredicate.tags != null && mergedPredicate.tags.length > 0)
  )

  const groupedBy = definition.grouping
  const grouped = groupedBy !== 'none'
  const collapsedKeys = new Set(collapsed ?? [])

  const renderRow = (todo: PersistedTodoItem, section: Section) => {
    let people: Person[] | undefined = assignedPeopleMap.get(todo.id)
    // A person's own group doesn't repeat their chip on its rows.
    if (groupedBy === 'people' && people && section.key.startsWith('person-')) {
      const groupPersonId = Number(section.key.slice('person-'.length))
      people = people.filter((p) => p.id !== groupPersonId)
    }
    return isMobile ? (
      <MobileTaskRow key={`${section.key}-${todo.id}`} todo={todo} assignedPeople={people} onOpenDetail={openEditPopup} />
    ) : (
      <DraggableTaskRow
        key={`${section.key}-${todo.id}`}
        todo={todo}
        assignedPeople={people}
        onOpenDetail={openEditPopup}
        surface="lens"
      />
    )
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
    body = (
      <div className={styles.body}>
        {grouped ? displaySections.map((section) => {
          const isCollapsed = collapsedKeys.has(section.key)
          return (
            <div key={section.key} className={`${styles.group} ${isCollapsed ? styles.groupCollapsed : ''}`} data-list-group={section.key}>
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
              </button>
              {!isCollapsed && section.todos.map((todo) => renderRow(todo, section))}
            </div>
          )
        }) : displaySections.map((section) => section.todos.map((todo) => renderRow(todo, section)))}
      </div>
    )
  }

  return (
    <div className={`${styles.widget} ${isMobile ? styles.touch : ''}`} data-list-widget={tab.id}>
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
      <div className={styles.scroll}>{body}</div>
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
    </div>
  )
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
