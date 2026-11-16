import { useRef, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router'
import { ROUTE_WORKSPACE } from '../../routes'
import { useFilterStore } from '../../stores/filter-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { TodoPredicate } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { FilterChipBar } from '../shared/filters/FilterChipBar'
import { LayoutControls } from '../workspace/LayoutControls'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { StoragePill } from './StoragePill'
import { GearIcon, PlusIcon } from '../shared/icons'
import { useShortcutLabel } from '../../hooks/use-shortcut-label'
import styles from './TopBar.module.css'
import { FOLD_PART, FOLD_SEARCH_ATTR, tabsFolded, useTopBarFold } from './use-top-bar-fold'
import { useTopBarCentre } from './use-top-bar-centre'
import { ShowFilteredTasksButton } from './ShowFilteredTasksButton'
import { TopBarFilterField } from './TopBarFilterField'
import { FilterPauseButton } from './FilterPauseButton'
import { FILTER_ROW_ATTR } from '../../utils/dom-contract'
import { FilteredTasksPanel } from '../overlays/FilteredTasksPanel'
import { tabAcross } from '../../utils/focusables'
import { AmbienceSky } from '../ambience/AmbienceSky'
import { TallyMarks } from './TallyMarks'

/**
 * The most layouts shown as tabs: more than a bar can hold anyway, so past
 * it the picker shows from the start and no tab per layout is mounted.
 */
const MAX_LAYOUT_TABS = 30

/**
 * What the layout tabs show, for their width (not their order): the names,
 * the open one, and the `Couldn't save · Retry` control while it shows. Past
 * `MAX_LAYOUT_TABS` the names don't matter (the picker shows).
 */
function layoutTabsKey(s: ReturnType<typeof useWorkspaceStore.getState>): string {
  const open = String(s.activeLayoutId)
  if (s.layouts.length > MAX_LAYOUT_TABS) return `many|${open}`
  const names = [...s.layouts.map((l) => l.name)].sort().join('/')
  return `${s.layouts.length}|${names}|${open}|${s.writeFailed ? 'failed' : ''}`
}

export function TopBar() {
  const quickAddKeys = useShortcutLabel('quick-add')
  const settingsKeys = useShortcutLabel('open-settings')
  const filters = useFilterStore((s) => s.filters)
  const isActive = useFilterStore((s) => s.isActive)
  // Paused (the funnel), the filter stays but applies nothing: the tray isn't red.
  const paused = useFilterStore((s) => s.paused)
  const filtering = isActive && !paused
  // The filtered-tasks panel: while it is open the tray — the field, the
  // Filter menu — is its filter editor.
  const panelOpen = useUIStore((s) => s.filterPanelOpen)
  const trayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const filterPredicate = useMemo<TodoPredicate>(() => criteriaToPredicate(filters), [filters])
  const handleFilterChange = useCallback((next: TodoPredicate) => {
    useFilterStore.getState().setAllFilters(predicateToCriteria(next))
  }, [])

  const location = useLocation()
  const isWorkspace = location.pathname === ROUTE_WORKSPACE
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  // The bar never wraps or overflows: measured, the field narrows first
  // (its pills fade with `+N more`), then the layout tabs fold into the
  // layout picker, then the field narrows further. The filtered-tasks panel
  // changes none of it.
  const barRef = useRef<HTMLElement | null>(null)
  const tabsKey = useWorkspaceStore(layoutTabsKey)
  const manyLayouts = useWorkspaceStore((s) => s.layouts.length > MAX_LAYOUT_TABS)
  // The counter shows while a filter is on, or the panel is open (it stays
  // the panel's toggle when Clear all empties the filter).
  const showTasksButton = isActive || panelOpen
  // The tray gains or loses Show N tasks, or its counter says paused: measured again then.
  const { fold, search } = useTopBarFold(barRef, tabsKey, `${isWorkspace}|${showTasksButton}|${paused}`)
  // The tray: in the middle of the bar at rest; grown by the counter it
  // keeps its left edge (nothing moves under the caret) until it would
  // reach the right zone.
  const spacerRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const centre = useTopBarCentre(barRef, spacerRef, trayRef, rightRef)

  return (
    <>
      <header
        ref={barRef}
        className={styles.topBar}
        data-fold={fold}
        // A press on the bar outside the tray closes the panel first; the
        // press then does its own thing. (In the page, not in a layer the
        // bar's controls portaled out: a picker, a menu.)
        onMouseDownCapture={(e) => {
          const target = e.target as Node
          if (panelOpen && e.currentTarget.contains(target) && !trayRef.current?.contains(target)) {
            useUIStore.getState().closeFilterPanel()
          }
        }}
      >
        {/* Ambience: the sky over the glass, under the controls (absolute: the fold skips it). */}
        <AmbienceSky />
        {isWorkspace && (
          <div className={styles.layoutSlot} data-fold-part={FOLD_PART.layout}>
            <LayoutControls mode={tabsFolded(fold) || manyLayouts ? 'menu' : 'tabs'} />
          </div>
        )}
        {/* The centring gap: puts the filter tray in the middle of the bar
            (`useTopBarCentre`); free space to the fold. */}
        <div ref={spacerRef} className={styles.centreGap} style={{ width: centre }} data-fold-part={FOLD_PART.centre} aria-hidden="true" />

        <div
          ref={trayRef}
          className={`${styles.tray} ${filtering ? styles.trayActive : ''} ${panelOpen ? styles.trayPanelOpen : ''}`}
          data-fold-part={FOLD_PART.tray}
          role="group"
          aria-label="Screen filters — apply to every widget"
          {...{ [FILTER_ROW_ATTR]: '' }}
          data-filtered={filtering || undefined}
          data-filter-paused={paused || undefined}
          onKeyDown={panelOpen ? (e) => tabAcross(e, trayRef.current, panelRef.current) : undefined}
        >
          <FilterPauseButton active={isActive} />
          <TopBarFilterField width={search} panelOpen={panelOpen} foldAttr={FOLD_SEARCH_ATTR} />
          <FilterChipBar
            predicate={filterPredicate}
            onChange={handleFilterChange}
            onClearAll={() => useFilterStore.getState().clearAll()}
            consumeEscape={panelOpen}
          />
          {showTasksButton && <ShowFilteredTasksButton open={panelOpen} />}
        </div>

        {/* Today's tally: in the free stretch after the tray (absolute: the fold and the centring skip it). */}
        <TallyMarks barRef={barRef} spacerRef={spacerRef} trayRef={trayRef} rightRef={rightRef} />

        <div ref={rightRef} className={styles.right} data-fold-part={FOLD_PART.spring}>
          <StoragePill />
          <button
            type="button"
            className={`${styles.gear} ${settingsOpen ? styles.gearOpen : ''}`}
            onClick={() => useUIStore.getState().openSettings()}
            aria-label="Settings"
            data-tooltip="Settings"
            data-tooltip-shortcut={settingsKeys}
          >
            <GearIcon />
          </button>
          <button
            type="button"
            className={styles.newTask}
            onClick={() => useUIStore.getState().openQuickAdd()}
            aria-label="New task"
            data-tooltip="New task"
            data-tooltip-shortcut={quickAddKeys}
          >
            <PlusIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </header>
      {panelOpen && <FilteredTasksPanel trayRef={trayRef} topBarRef={barRef} panelRef={panelRef} />}
    </>
  )
}
