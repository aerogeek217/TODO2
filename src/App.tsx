import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router'
import { useCanvasStore } from './stores/canvas-store'
import { useTodoStore } from './stores/todo-store'
import { usePersonStore } from './stores/person-store'
import { useFilterStore } from './stores/filter-store'
import { useOrgStore } from './stores/org-store'
import { useSettingsStore } from './stores/settings-store'
import { useProjectStore } from './stores/project-store'
import { useFileStorageStore } from './stores/file-storage-store'
import { TopBar } from './components/layout/TopBar'
import { Sidebar } from './components/layout/Sidebar'
import { FileSyncBanner } from './components/layout/FileSyncBanner'
import { useUIStore } from './stores/ui-store'
import { CommandPalette } from './components/overlays/CommandPalette'
import { BulkConfirmDialog } from './components/overlays/BulkConfirmDialog'
import { QuickAddBar, type QuickAddDraft } from './components/overlays/QuickAddBar'
import { RecentTaskPill } from './components/overlays/RecentTaskPill'
import { UndoSnackbar } from './components/overlays/UndoSnackbar'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
import { useIsMobile } from './hooks/use-is-mobile'
import { useFloatingNoteStore } from './stores/floating-note-store'
import { useStatusStore } from './stores/status-store'
import { useTagStore } from './stores/tag-store'
import { formatShortcut } from './utils/platform'
import { ROUTE_CANVAS, ROUTE_LIST, ROUTE_CALENDAR, ROUTE_SETTINGS } from './routes'

import { createCommands, searchDynamicCommands } from './services/command-registry'
import { backupScheduler } from './services/backup-scheduler'
import { applyNlpMetadata } from './services/nlp-task-creator'
import { getFilterDefaults, supplementWithFilterDefaults } from './utils/filter-defaults'
import { applyRuntimeFilter } from './services/dashboard-lists'
import { criteriaToPredicate, predicateToCriteria } from './stores/filter-store'
import { ensureDefaultProject } from './services/ensure-default-project'
import { checkUnsupportedOldDB } from './services/migration-check'
import type { UnsupportedDBInfo } from './services/migration-check'
import { MigrationDialog } from './components/overlays/MigrationDialog'
import { KeyboardShortcutsModal } from './components/settings/KeyboardShortcutsModal'
import { BottomTabBar } from './components/layout/BottomTabBar'
import { FilterSheet } from './components/overlays/FilterSheet'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
const CanvasPage = lazy(() => import('./views/CanvasPage').then(m => ({ default: m.CanvasPage })))
const ListView = lazy(() => import('./views/ListView').then(m => ({ default: m.ListView })))
const CalendarView = lazy(() => import('./views/CalendarView').then(m => ({ default: m.CalendarView })))
const SettingsPage = lazy(() => import('./views/SettingsPage').then(m => ({ default: m.SettingsPage })))
import styles from './App.module.css'
import './styles/fonts.css'
import './styles/tokens.css'

function AppBulkConfirmDialog() {
  const { bulkConfirmation, clearBulkConfirmation, clearSelection, closeEditPopup } = useUIStore()
  if (!bulkConfirmation) return null
  return (
    <BulkConfirmDialog
      confirmation={bulkConfirmation}
      onConfirm={() => {
        const { action, ids, onConfirm: customHandler } = bulkConfirmation
        if (action === 'custom' && customHandler) {
          customHandler()
        } else if (action === 'delete') {
          const [first] = ids
          if (ids.length === 1 && first != null) {
            useTodoStore.getState().remove(first)
          } else {
            useTodoStore.getState().bulkRemove(ids)
          }
          closeEditPopup()
          clearSelection()
        } else {
          useTodoStore.getState().bulkSetCompleted(ids, action === 'complete')
        }
        clearBulkConfirmation()
      }}
      onCancel={() => {
        const { action, skipIds } = bulkConfirmation
        if (skipIds && skipIds.length > 0) {
          // "Cancel" acts on a subset (e.g. just the parent, not children)
          useTodoStore.getState().bulkSetCompleted(skipIds, action === 'complete')
        }
        clearBulkConfirmation()
      }}
    />
  )
}

/**
 * QuickAddBar wrapper — wires the bar to ui-store visibility, the live data
 * stores, and the full-editor handoff path.
 *
 * Submit (P4): mirrors `CanvasPage.handleAddTask` — `addTodo` for the row,
 * then `applyNlpMetadata` for parsed people/orgs/scheduled/deadline/
 * recurrence/tags. Default project follows the same setting
 * (`useSettingsStore().defaultProjectId`) the create-popup consults today,
 * so `Ctrl+Space` lands tasks in the same place across both surfaces.
 *
 * Details / Tab handoff: stashes `{ rawTitle }` in `ui-store.quickAddDraft`,
 * closes the bar (preserving the draft), and opens the create popup. The
 * popup reads the draft on mount and clears it via `closeEditPopup` on
 * close.
 */
function AppQuickAddBar() {
  const open = useUIStore((s) => s.quickAddOpen)
  const close = useUIStore((s) => s.closeQuickAdd)
  const draft = useUIStore((s) => s.quickAddDraft)
  const defaultProjectId = useSettingsStore((s) => s.defaultProjectId)
  const projects = useProjectStore((s) => s.projects)
  // List-widget handoff: if the draft carries a seeded projectId (the list's
  // predicate narrowed to a single project), prefer that over the user's
  // global default — so the chip the bar renders matches the project the
  // task will actually land in.
  const seedProjectId = draft?.defaults?.projectId
  const defaultProject = useMemo(
    () => {
      const id = seedProjectId ?? defaultProjectId
      return id != null ? projects.find((p) => p.id === id) : undefined
    },
    [seedProjectId, defaultProjectId, projects],
  )

  const handleSubmit = useCallback(async (submitted: QuickAddDraft) => {
    const { resolved } = submitted
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    // Filter-default seed: prefer an explicit list-predicate seed stashed on
    // `quickAddDraft.defaults` (from a list widget's "+ Add task" path) so a
    // canvas-level FAB invocation in a non-list context still falls through to
    // the active topbar filter. `supplementWithFilterDefaults` only fills
    // fields the user didn't type — so an `@person` or `/project` token always
    // wins over the seed.
    //
    // Runtime filter: ListView's saved-list path keeps the runtime-prompt pick
    // separate from the manual-criteria predicate (so saving captures only the
    // baseline). At submit time we want the runtime entity baked into the
    // defaults too, so a list keyed on `Tasks for {assignee}` adds new tasks
    // assigned to whoever the user picked.
    const draft = useUIStore.getState().quickAddDraft
    let fd = draft?.defaults
    if (!fd) {
      const filterStore = useFilterStore.getState()
      let baseFilters = filterStore.filters
      const { runtimeFilterSpec, runtimeFilterValue } = filterStore
      if (runtimeFilterSpec && runtimeFilterValue && runtimeFilterValue.length > 0) {
        const merged = applyRuntimeFilter(criteriaToPredicate(baseFilters), runtimeFilterSpec, runtimeFilterValue)
        baseFilters = predicateToCriteria(merged)
      }
      fd = getFilterDefaults(baseFilters)
    }
    supplementWithFilterDefaults(resolved, fd)
    // Mirror CanvasPage.handleAddTask: parse-cleaned title fed to addTodo,
    // then applyNlpMetadata for everything the resolver pulled out. Tags ride
    // through applyNlpMetadata's resolve-or-create path (`nlp-task-creator.ts`)
    // so we don't need to call `resolveTags` / `assignTag` ourselves.
    // QuickAddBar already seeds `submitted.project` from the `defaultProject`
    // prop when no `/project` token was typed, so we only need to fall back
    // when no default project exists at all — `ensureDefaultProject` returns
    // the first project on this canvas (handles the "user removed the default"
    // edge) or auto-creates an Inbox + persists it.
    const projectId = resolved.projectId ?? submitted.project?.id ?? (await ensureDefaultProject(canvasId))
    const id = await useTodoStore.getState().add(resolved.title || submitted.title, canvasId, projectId)
    await applyNlpMetadata(
      id,
      resolved,
      (tid) => useTodoStore.getState().todos.find((t) => t.id === tid),
      useTodoStore.getState().update,
      usePersonStore.getState().assignPerson,
      useOrgStore.getState().assignOrg,
    )
    // Seed-default tags ride a separate channel (resolved.tags is slug-based,
    // applyNlpMetadata calls resolveTags on it). Tag ids from a list-predicate
    // seed / active filter are already resolved against the registry so we
    // assign them directly. User-typed `#tag` tokens still take precedence —
    // applyNlpMetadata applied those above; this only adds the seed ids that
    // weren't already covered.
    if (fd.tagIds.length > 0) {
      const tagStore = useTagStore.getState()
      for (const tagId of fd.tagIds) {
        await tagStore.assignTag(id, tagId)
      }
    }
    useUIStore.getState().showRecentlyCreated(id)
    close()
  }, [close])

  const handleOpenFullEditor = useCallback((submitted: QuickAddDraft) => {
    // Preserve-draft handoff: set the seed, flip the bar closed without
    // clearing the draft, then open the popup. `closeQuickAdd` clears the
    // draft (we don't call it); `closeEditPopup` clears the draft when the
    // popup closes. We also preserve any `defaults` already on the draft so
    // a list-widget "+ Add task" → Tab handoff carries the list's predicate
    // seed into the full editor.
    const existing = useUIStore.getState().quickAddDraft
    useUIStore.setState({
      quickAddOpen: false,
      quickAddDraft: {
        rawTitle: submitted.rawTitle,
        ...(existing?.defaults ? { defaults: existing.defaults } : {}),
      },
    })
    useUIStore.getState().openCreatePopup()
  }, [])

  return (
    <QuickAddBar
      open={open}
      initialDraft={draft ?? undefined}
      defaultProject={defaultProject}
      onClose={close}
      onSubmit={handleSubmit}
      onOpenFullEditor={handleOpenFullEditor}
    />
  )
}

function AppShell() {
  const { ensureDefault } = useCanvasStore()
  const { ensureLoaded: loadPeople } = usePersonStore()
  const { ensureLoaded: loadOrgs } = useOrgStore()
  const { load: loadSettings } = useSettingsStore()
  const { initialize: initFileStorage } = useFileStorageStore()
  const isMobile = useIsMobile()
  const [initialized, setInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const showFab = location.pathname !== ROUTE_SETTINGS && location.pathname !== ROUTE_CALENDAR

  // Reset filter sheet when viewport transitions from mobile to desktop
  useEffect(() => {
    if (!isMobile) {
      useUIStore.getState().setFilterSheetOpen(false)
    }
  }, [isMobile])

  const lastPathRef = useRef(location.pathname)
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return
    lastPathRef.current = location.pathname
    useFilterStore.getState().clearAll()
  }, [location.pathname])

  useEffect(() => {
    Promise.all([ensureDefault(), loadSettings()])
      .then(() => initFileStorage())
      .then(() => navigator.storage?.persist?.().catch(() => {}))
      .then(() => Promise.all([loadPeople(), loadOrgs(), useProjectStore.getState().ensureAllLoaded(), useStatusStore.getState().ensureLoaded(), useTagStore.getState().ensureLoaded()]))
      .then(async () => {
        // Purge expired completed tasks on startup
        const { completedRetentionDays } = useSettingsStore.getState()
        if (completedRetentionDays != null) {
          await useTodoStore.getState().ensureAllLoaded()
          await useTodoStore.getState().purgeExpiredCompleted(completedRetentionDays)
        }
      })
      .then(() => {
        backupScheduler.start()
        setInitialized(true)
      })
      .catch((err) => {
        console.error('App initialization failed:', err)
        setInitError(err instanceof Error ? err.message : String(err))
      })
    return () => backupScheduler.stop()
  }, [ensureDefault, loadSettings, initFileStorage, loadPeople, loadOrgs])

  const createFloatingNote = useCallback(() => {
    if (location.pathname !== ROUTE_CANVAS) return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (!canvasId) return
    const vp = useSettingsStore.getState().canvasViewport
    const el = document.querySelector('.react-flow')
    const w = el?.clientWidth ?? window.innerWidth
    const h = el?.clientHeight ?? window.innerHeight
    const zoom = vp?.zoom ?? 1
    const cx = (-(vp?.x ?? 0) + w / 2) / zoom
    const cy = (-(vp?.y ?? 0) + h / 2) / zoom
    void useFloatingNoteStore.getState().add(canvasId, cx - 120, cy - 100)
  }, [location.pathname])

  // Fit-to-view: dispatch a custom event that CanvasPage can listen to,
  // but we can directly use the React Flow instance via the DOM for simplicity.
  // The fitView button in the controls already exists; this wires Ctrl+0.
  const fitView = useCallback(() => {
    if (location.pathname !== ROUTE_CANVAS) return
    // React Flow exposes fitView on the instance; trigger via a custom event
    window.dispatchEvent(new CustomEvent('canvas-fit-view'))
  }, [location.pathname])

  const toggleProjectNavigator = useCallback(() => {
    if (location.pathname !== ROUTE_CANVAS) return
    useUIStore.getState().toggleProjectNavigator()
  }, [location.pathname])

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    openPalette: () => setShowPalette(true),
    closePalette: () => setShowPalette(false),
    navigate,
    createFloatingNote,
    openShortcutsModal: () => setShowShortcuts(true),
    fitView,
    toggleProjectNavigator,
    enabled: !isMobile,
  })

  const handleClosePalette = useCallback(() => setShowPalette(false), [])

  const todos = useTodoStore((s) => s.todos)
  const projects = useProjectStore((s) => s.projects)
  const selectionCount = useUIStore((s) => s.selectedTodoIds.size)

  const commandCtx = useMemo(
    () => ({
      navigateTo: (path: string) => navigate(path),
      openQuickAdd: () => useUIStore.getState().openQuickAdd(),
      selectionCount,
      bulkSetCompleted: useTodoStore.getState().bulkSetCompleted,
      bulkSetStatus: useTodoStore.getState().bulkSetStatus,
      bulkRemove: useTodoStore.getState().bulkRemove,
      getSelectedIds: () => [...useUIStore.getState().selectedTodoIds],
      clearAllFilters: useFilterStore.getState().clearAll,
      setShowCompleted: useFilterStore.getState().setShowCompleted,
      getShowCompleted: () => useFilterStore.getState().filters.showCompleted,
      setDateRange: useFilterStore.getState().setDateRange,
      getTodos: () => todos,
      getProjects: () => projects,
      focusTask: (todoId: number) => {
        const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
        if (!todo?.projectId) return
        const project = useProjectStore.getState().projects.find((p) => p.id === todo.projectId)
        if (!project) return
        useUIStore.getState().setPendingCanvasTarget({ x: project.positionX + 140, y: project.positionY + 100 })
        useUIStore.getState().selectOneTodo(todoId)
        navigate(ROUTE_CANVAS)
      },
      focusProject: (projectId: number) => {
        const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
        if (!project) return
        useUIStore.getState().setPendingCanvasTarget({ x: project.positionX + 140, y: project.positionY + 100 })
        navigate(ROUTE_CANVAS)
      },
      fitView,
      createFloatingNote: location.pathname === ROUTE_CANVAS ? createFloatingNote : undefined,
      toggleProjectNavigator: location.pathname === ROUTE_CANVAS ? toggleProjectNavigator : undefined,
      openShortcutsModal: () => setShowShortcuts(true),
      getStatuses: () => useStatusStore.getState().statuses,
    }),
    [navigate, todos, projects, selectionCount, fitView, createFloatingNote, toggleProjectNavigator, location.pathname]
  )

  const commands = useMemo(() => createCommands(commandCtx), [commandCtx])
  const handleSearchDynamic = useCallback(
    (query: string) => searchDynamicCommands(query, commandCtx),
    [commandCtx]
  )

  if (initError) {
    return (
      <div className={styles.initError}>
        <h2>Failed to start TODO2</h2>
        <p>The database could not be opened. This can happen in private browsing mode, if storage is full, or if the database is corrupted.</p>
        <code>{initError}</code>
        <p>Try reloading the page, or clearing site data in your browser settings.</p>
      </div>
    )
  }

  if (!initialized) {
    return (
      <div className={styles.initLoading}>
        <div className={styles.spinner} />
        Loading…
      </div>
    )
  }

  return (
    <div className={styles.app}>
      {!isMobile && <Sidebar />}
      <div className={styles.mainColumn}>
        {!isMobile && <TopBar />}
        {!isMobile && <FileSyncBanner />}
        <div className={styles.content}>
        <Suspense fallback={null}>
          <Routes>
            <Route path={ROUTE_CANVAS} element={isMobile ? <Navigate to={ROUTE_LIST} replace /> : (
              <ErrorBoundary scope="Canvas">
                <CanvasPage />
              </ErrorBoundary>
            )} />
            <Route path="/dashboard" element={<Navigate to={ROUTE_CANVAS} replace />} />
            <Route path={ROUTE_LIST} element={<ListView />} />
            <Route path={ROUTE_CALENDAR} element={isMobile ? <Navigate to={ROUTE_LIST} replace /> : <CalendarView />} />
            <Route path={ROUTE_SETTINGS} element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={isMobile ? ROUTE_LIST : ROUTE_CANVAS} replace />} />
          </Routes>
        </Suspense>
        </div>
      </div>
      {showFab && (
        <div className={styles.fabGroup}>
          <button className={styles.fab} onClick={() => useUIStore.getState().openQuickAdd()} title={`New task (${formatShortcut('Mod-Space')})`}>
            <svg width="16" height="16" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="14" y1="6" x2="14" y2="22" />
              <line x1="6" y1="14" x2="22" y2="14" />
            </svg>
          </button>
        </div>
      )}
      {!isMobile && showPalette && <CommandPalette commands={commands} onSearchDynamic={handleSearchDynamic} onClose={handleClosePalette} />}
      {!isMobile && showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      <AppBulkConfirmDialog />
      <AppQuickAddBar />
      <RecentTaskPill />
      <UndoSnackbar />
      {isMobile && <FilterSheet />}
      {isMobile && <BottomTabBar />}
    </div>
  )
}

export default function App() {
  const [unsupportedDBInfo, setUnsupportedDBInfo] = useState<UnsupportedDBInfo | null>(null)
  const [dbVersionChecked, setDbVersionChecked] = useState(false)

  useEffect(() => {
    checkUnsupportedOldDB()
      .then(info => {
        setUnsupportedDBInfo(info)
        setDbVersionChecked(true)
      })
      .catch(() => setDbVersionChecked(true))
  }, [])

  if (!dbVersionChecked) {
    return (
      <div className={styles.initLoading}>
        <div className={styles.spinner} />
        Loading…
      </div>
    )
  }

  if (unsupportedDBInfo) {
    return <MigrationDialog mode="schema-upgrade" info={unsupportedDBInfo} onProceed={() => setUnsupportedDBInfo(null)} />
  }

  return (
    <ErrorBoundary scope="App">
      <HashRouter>
        <AppShell />
      </HashRouter>
      <FileMigrationOverlay />
    </ErrorBoundary>
  )
}

function FileMigrationOverlay() {
  const pending = useFileStorageStore((s) => s.pendingLegacyImport)
  const confirm = useFileStorageStore((s) => s.confirmLegacyImport)
  const cancel = useFileStorageStore((s) => s.cancelLegacyImport)

  if (!pending) return null

  return (
    <MigrationDialog
      mode="legacy-import"
      info={pending}
      onProceed={confirm}
      onCancel={cancel}
    />
  )
}
