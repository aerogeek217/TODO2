import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router'
import { useCanvasStore } from './stores/canvas-store'
import { useTodoStore } from './stores/todo-store'
import { usePersonStore } from './stores/person-store'
import { useFilterStore } from './stores/filter-store'
import { useTagStore } from './stores/tag-store'
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
import { UndoSnackbar } from './components/overlays/UndoSnackbar'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
import { useIsMobile } from './hooks/use-is-mobile'
import { useStickyNoteStore } from './stores/sticky-note-store'

import { createCommands, searchDynamicCommands } from './services/command-registry'
import { backupScheduler } from './services/backup-scheduler'
import { KeyboardShortcutsModal } from './components/settings/KeyboardShortcutsModal'
import { BottomTabBar } from './components/layout/BottomTabBar'
import { FilterSheet } from './components/overlays/FilterSheet'
const CanvasPage = lazy(() => import('./views/CanvasPage').then(m => ({ default: m.CanvasPage })))
const DashboardView = lazy(() => import('./views/DashboardView').then(m => ({ default: m.DashboardView })))
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
          if (ids.length === 1) {
            useTodoStore.getState().remove(ids[0])
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

function AppShell() {
  const { ensureDefault } = useCanvasStore()
  const { load: loadPeople } = usePersonStore()
  const { load: loadTags } = useTagStore()
  const { load: loadOrgs } = useOrgStore()
  const { load: loadSettings } = useSettingsStore()
  const { initialize: initFileStorage } = useFileStorageStore()
  const { openCreatePopup } = useUIStore()
  const isMobile = useIsMobile()
  const [initialized, setInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const showFab = location.pathname !== '/settings' && location.pathname !== '/calendar' && location.pathname !== '/dashboard'

  // Reset filter sheet when viewport transitions from mobile to desktop
  useEffect(() => {
    if (!isMobile) {
      useUIStore.getState().setFilterSheetOpen(false)
    }
  }, [isMobile])

  useEffect(() => {
    Promise.all([ensureDefault(), loadSettings()])
      .then(() => initFileStorage())
      .then(() => navigator.storage?.persist?.().catch(() => {}))
      .then(() => Promise.all([loadPeople(), loadTags(), loadOrgs(), useProjectStore.getState().loadAll()]))
      .then(async () => {
        // Purge expired completed tasks on startup
        const { completedRetentionDays } = useSettingsStore.getState()
        if (completedRetentionDays != null) {
          await useTodoStore.getState().loadAll()
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
  }, [ensureDefault, loadSettings, initFileStorage, loadPeople, loadTags, loadOrgs])

  const createStickyNote = useCallback(() => {
    if (location.pathname !== '/') return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (!canvasId) return
    const vp = useSettingsStore.getState().canvasViewport
    const el = document.querySelector('.react-flow')
    const w = el?.clientWidth ?? window.innerWidth
    const h = el?.clientHeight ?? window.innerHeight
    const zoom = vp?.zoom ?? 1
    const cx = (-(vp?.x ?? 0) + w / 2) / zoom
    const cy = (-(vp?.y ?? 0) + h / 2) / zoom
    useStickyNoteStore.getState().add(canvasId, cx - 120, cy - 100)
  }, [location.pathname])

  // Fit-to-view: dispatch a custom event that CanvasPage can listen to,
  // but we can directly use the React Flow instance via the DOM for simplicity.
  // The fitView button in the controls already exists; this wires Ctrl+0.
  const fitView = useCallback(() => {
    if (location.pathname !== '/') return
    // React Flow exposes fitView on the instance; trigger via a custom event
    window.dispatchEvent(new CustomEvent('canvas-fit-view'))
  }, [location.pathname])

  const toggleProjectNavigator = useCallback(() => {
    if (location.pathname !== '/') return
    useUIStore.getState().toggleProjectNavigator()
  }, [location.pathname])

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    openCreatePopup: () => openCreatePopup(),
    openPalette: () => setShowPalette(true),
    closePalette: () => setShowPalette(false),
    navigate,
    createStickyNote,
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
      openQuickAdd: () => openCreatePopup(),
      selectionCount,
      bulkSetCompleted: useTodoStore.getState().bulkSetCompleted,
      bulkSetStarred: useTodoStore.getState().bulkSetStarred,
      bulkSetPriority: useTodoStore.getState().bulkSetPriority,
      bulkRemove: useTodoStore.getState().bulkRemove,
      getSelectedIds: () => [...useUIStore.getState().selectedTodoIds],
      toggleStarredOnly: useFilterStore.getState().toggleStarredOnly,
      toggleHardDeadlineOnly: useFilterStore.getState().toggleHardDeadlineOnly,
      setPriorities: useFilterStore.getState().setPriorities,
      getPriorities: () => useFilterStore.getState().filters.priorities,
      clearAllFilters: useFilterStore.getState().clearAll,
      toggleShowCompleted: useFilterStore.getState().toggleShowCompleted,
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
        navigate('/')
      },
      focusProject: (projectId: number) => {
        const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
        if (!project) return
        useUIStore.getState().setPendingCanvasTarget({ x: project.positionX + 140, y: project.positionY + 100 })
        navigate('/')
      },
      fitView,
      createStickyNote: location.pathname === '/' ? createStickyNote : undefined,
      toggleProjectNavigator: location.pathname === '/' ? toggleProjectNavigator : undefined,
      openShortcutsModal: () => setShowShortcuts(true),
    }),
    [navigate, todos, projects, selectionCount, fitView, createStickyNote, toggleProjectNavigator, location.pathname]
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
            <Route path="/" element={isMobile ? <Navigate to="/dashboard" replace /> : <CanvasPage />} />
            <Route path="/dashboard" element={<DashboardView />} />
            <Route path="/list" element={<ListView />} />
            <Route path="/calendar" element={isMobile ? <Navigate to="/dashboard" replace /> : <CalendarView />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
        </div>
      </div>
      {showFab && (
        <div className={styles.fabGroup}>
          <button className={styles.fab} onClick={openCreatePopup} title="New Task (Ctrl+Space)">
            <svg width="16" height="16" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="14" y1="6" x2="14" y2="22" />
              <line x1="6" y1="14" x2="22" y2="14" />
            </svg>
          </button>
          {!isMobile && location.pathname === '/' && (
            <button className={styles.fab} onClick={createStickyNote} title="New Sticky Note (N)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
                <polyline points="14 3 14 9 21 9" />
              </svg>
            </button>
          )}
        </div>
      )}
      {!isMobile && showPalette && <CommandPalette commands={commands} onSearchDynamic={handleSearchDynamic} onClose={handleClosePalette} />}
      {!isMobile && showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      <AppBulkConfirmDialog />
      <UndoSnackbar />
      {isMobile && <FilterSheet />}
      {isMobile && <BottomTabBar />}
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}
