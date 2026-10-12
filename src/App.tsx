import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { createHashRouter, RouterProvider, Routes, Route, Navigate, useLocation } from 'react-router'
import { useTodoStore } from './stores/todo-store'
import { usePersonStore } from './stores/person-store'
import { useFilterStore } from './stores/filter-store'
import { useSettingsStore } from './stores/settings-store'
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
import { useStatusStore } from './stores/status-store'
import { useTagStore } from './stores/tag-store'
import { formatShortcut } from './utils/platform'
import { LEGACY_ROUTES, ROUTE_SETTINGS, ROUTE_WORKSPACE } from './routes'

import { createCommands, searchDynamicCommands } from './services/command-registry'
import { backupScheduler } from './services/backup-scheduler'
import { applyNlpMetadata } from './services/nlp-task-creator'
import { getFilterDefaults, supplementWithFilterDefaults } from './utils/filter-defaults'
import { checkUnsupportedOldDB } from './services/migration-check'
import type { UnsupportedDBInfo } from './services/migration-check'
import { MigrationDialog } from './components/overlays/MigrationDialog'
import { SyncConflictDialog } from './components/overlays/SyncConflictDialog'
import { FileUpgradeDialog } from './components/overlays/FileUpgradeDialog'
import { PurgeCompletedDialog } from './components/overlays/PurgeCompletedDialog'
import { listExpiredCompleted } from './services/purge-completed'
import type { PersistedTodoItem } from './models'
import { KeyboardShortcutsModal } from './components/settings/KeyboardShortcutsModal'
import { BottomTabBar } from './components/layout/BottomTabBar'
import { FilterSheet } from './components/overlays/FilterSheet'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
const SettingsPage = lazy(() => import('./views/SettingsPage').then(m => ({ default: m.SettingsPage })))
const SettingsModal = lazy(() => import('./components/settings/SettingsModal').then(m => ({ default: m.SettingsModal })))
const WorkspacePage = lazy(() => import('./views/WorkspacePage').then(m => ({ default: m.WorkspacePage })))
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
 * Submit: `addTodo` for the row, then `applyNlpMetadata` for parsed
 * people / due date / recurrence / tags / status.
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
  const handleSubmit = useCallback(async (submitted: QuickAddDraft) => {
    const { resolved } = submitted
    // Filter-default seed: prefer an explicit list-predicate seed stashed on
    // `quickAddDraft.defaults` (from a list widget's "+ Add task" path); any
    // other invocation falls through to the active top-bar filter.
    // `supplementWithFilterDefaults` only fills fields the user didn't type —
    // so an `@person` token always wins over the seed. (A list widget's seed
    // already carries its prompt picks.)
    const draft = useUIStore.getState().quickAddDraft
    const fd = draft?.defaults ?? getFilterDefaults(useFilterStore.getState().filters)
    supplementWithFilterDefaults(resolved, fd)
    // Parse-cleaned title fed to addTodo, then applyNlpMetadata for everything
    // the resolver pulled out. Tags ride through applyNlpMetadata's
    // resolve-or-create path (`nlp-task-creator.ts`).
    const id = await useTodoStore.getState().add(resolved.title || submitted.title)
    await applyNlpMetadata(
      id,
      resolved,
      (tid) => useTodoStore.getState().todos.find((t) => t.id === tid),
      useTodoStore.getState().update,
      usePersonStore.getState().assignPerson,
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
    // A focus filter / the Focus list's "+ Add task": the task starts in focus
    // so it shows where it was added.
    if (fd.focus) {
      const created = useTodoStore.getState().todos.find((t) => t.id === id)
      if (created) await useTodoStore.getState().update({ ...created, focus: true })
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
      onClose={close}
      onSubmit={handleSubmit}
      onOpenFullEditor={handleOpenFullEditor}
    />
  )
}

/**
 * Launch prompt for completed tasks past the retention setting.
 * Lists the tasks that were expired at launch (`launchUids` — uids survive a
 * sync-file restore, ids don't) and are still expired now. Read from the
 * database, not `useTodoStore.todos` (which may not be loaded yet), and
 * re-read whenever the store reloads. Waits while a sync-file prompt is
 * open. Closing it in any way ("Not now" included) skips it until the next
 * launch.
 */
function StartupPurgePrompt({ launchUids, onClose }: { launchUids: ReadonlySet<string>; onClose: () => void }) {
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const retentionDays = useSettingsStore((s) => s.completedRetentionDays)
  const fileSyncPrompt = useFileStorageStore(
    (s) => s.pendingLegacyImport != null || s.pendingConflict != null || s.pendingFileUpgrade != null,
  )
  const [tasks, setTasks] = useState<PersistedTodoItem[]>([])
  useEffect(() => {
    if (fileSyncPrompt || retentionDays == null) return
    let cancelled = false
    listExpiredCompleted(retentionDays, launchUids)
      .then((rows) => { if (!cancelled) setTasks(rows) })
      .catch((err) => console.warn('[purge] could not read expired tasks', err))
    return () => { cancelled = true }
  }, [launchUids, retentionDays, fileSyncPrompt, todosVersion])
  if (fileSyncPrompt || retentionDays == null || tasks.length === 0) return null
  return <PurgeCompletedDialog tasks={tasks} retentionDays={retentionDays} onDone={onClose} onDismiss={onClose} />
}

/**
 * `#/settings`: the Settings page on mobile; on desktop a deep link that
 * opens the workspace with the Settings modal open.
 */
function SettingsRoute() {
  const isMobile = useIsMobile()
  if (isMobile) return <SettingsPage />
  return <SettingsDeepLink />
}

function SettingsDeepLink() {
  useEffect(() => {
    useUIStore.getState().openSettings()
  }, [])
  return <Navigate to={ROUTE_WORKSPACE} replace />
}

function AppShell() {
  const { ensureLoaded: loadPeople } = usePersonStore()
  const { load: loadSettings } = useSettingsStore()
  const { initialize: initFileStorage } = useFileStorageStore()
  const isMobile = useIsMobile()
  const [initialized, setInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  /** uids of the completed tasks past retention at launch (for the purge prompt). */
  const [purgeLaunchUids, setPurgeLaunchUids] = useState<ReadonlySet<string> | null>(null)
  const location = useLocation()
  // Desktop: quick add lives in the sidebar. Mobile: a floating + above the tab bar.
  const showFab = isMobile && location.pathname !== ROUTE_SETTINGS

  // Reset filter sheet when viewport transitions from mobile to desktop; the
  // Settings modal is desktop only (mobile has the Settings page).
  useEffect(() => {
    if (!isMobile) {
      useUIStore.getState().setFilterSheetOpen(false)
    } else {
      useUIStore.getState().closeSettings()
    }
  }, [isMobile])
  const settingsOpen = useUIStore((s) => s.settingsOpen)

  const lastPathRef = useRef(location.pathname)
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return
    lastPathRef.current = location.pathname
    useFilterStore.getState().clearAll()
  }, [location.pathname])

  useEffect(() => {
    loadSettings()
      .then(() => initFileStorage())
      .then(() => navigator.storage?.persist?.().catch(() => {}))
      .then(() => Promise.all([loadPeople(), useStatusStore.getState().ensureLoaded(), useTagStore.getState().ensureLoaded()]))
      .then(async () => {
        // Completed tasks past retention are never purged silently —
        // remember which ones were expired at launch and ask
        // (`StartupPurgePrompt`). Runs after the sync file was loaded (or its
        // prompts answered), so the list reflects the data the user kept.
        const { completedRetentionDays } = useSettingsStore.getState()
        if (completedRetentionDays != null) {
          const expired = await listExpiredCompleted(completedRetentionDays)
          if (expired.length > 0) setPurgeLaunchUids(new Set(expired.map((t) => t.uid)))
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
  }, [loadSettings, initFileStorage, loadPeople])

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    openPalette: () => setShowPalette(true),
    closePalette: () => setShowPalette(false),
    openSettings: () => useUIStore.getState().openSettings(),
    openShortcutsModal: () => setShowShortcuts(true),
    enabled: !isMobile,
  })

  const handleClosePalette = useCallback(() => setShowPalette(false), [])

  const todos = useTodoStore((s) => s.todos)
  const selectionCount = useUIStore((s) => s.selectedTodoIds.size)

  const commandCtx = useMemo(
    () => ({
      openSettings: () => useUIStore.getState().openSettings(),
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
      focusTask: (todoId: number) => {
        useUIStore.getState().selectOneTodo(todoId)
        useUIStore.getState().openEditPopup(todoId)
      },
      openShortcutsModal: () => setShowShortcuts(true),
      getStatuses: () => useStatusStore.getState().statuses,
    }),
    [todos, selectionCount]
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
            <Route path={ROUTE_WORKSPACE} element={
              <ErrorBoundary scope="Workspace">
                <WorkspacePage />
              </ErrorBoundary>
            } />
            {LEGACY_ROUTES.map((path) => (
              <Route key={path} path={path} element={<Navigate to={ROUTE_WORKSPACE} replace />} />
            ))}
            <Route path={ROUTE_SETTINGS} element={<SettingsRoute />} />
            <Route path="*" element={<Navigate to={ROUTE_WORKSPACE} replace />} />
          </Routes>
        </Suspense>
        </div>
      </div>
      {showFab && (
        <div className={styles.fabGroup}>
          <button className={styles.fab} onClick={() => useUIStore.getState().openQuickAdd()} aria-label="Quick add" title={`Quick add (${formatShortcut('Mod-Space')})`}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="9" y1="3" x2="9" y2="15" />
              <line x1="3" y1="9" x2="15" y2="9" />
            </svg>
          </button>
        </div>
      )}
      {!isMobile && showPalette && <CommandPalette commands={commands} onSearchDynamic={handleSearchDynamic} onClose={handleClosePalette} />}
      {!isMobile && showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {!isMobile && settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}

      <AppBulkConfirmDialog />
      {purgeLaunchUids && (
        <StartupPurgePrompt launchUids={purgeLaunchUids} onClose={() => setPurgeLaunchUids(null)} />
      )}
      <AppQuickAddBar />
      <RecentTaskPill />
      <UndoSnackbar />
      {isMobile && <FilterSheet />}
      {isMobile && <BottomTabBar />}
    </div>
  )
}

/**
 * Data router (hash history) around the whole shell: one splat route whose
 * element renders the shell's own `<Routes>`. A data router is what makes
 * `useBlocker` available (navigation prompts for unsaved changes).
 */
function createAppRouter() {
  return createHashRouter([{ path: '*', element: <AppShell /> }])
}

export default function App() {
  const [router] = useState(createAppRouter)
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
      <RouterProvider router={router} />
      <FileMigrationOverlay />
    </ErrorBoundary>
  )
}

/**
 * Sync-file prompts raised by `fileStorageService` while it waits for the user
 * (below-floor file, browser/file conflict, older-file upgrade). Rendered
 * outside AppShell so they show even while startup is still pending.
 */
function FileMigrationOverlay() {
  const pending = useFileStorageStore((s) => s.pendingLegacyImport)
  const confirm = useFileStorageStore((s) => s.confirmLegacyImport)
  const cancel = useFileStorageStore((s) => s.cancelLegacyImport)
  const conflict = useFileStorageStore((s) => s.pendingConflict)
  const resolveConflict = useFileStorageStore((s) => s.resolveConflict)
  const upgrade = useFileStorageStore((s) => s.pendingFileUpgrade)
  const resolveFileUpgrade = useFileStorageStore((s) => s.resolveFileUpgrade)

  if (pending) {
    return (
      <MigrationDialog
        mode="legacy-import"
        info={pending}
        onProceed={confirm}
        onCancel={cancel}
      />
    )
  }
  if (conflict) return <SyncConflictDialog info={conflict} onChoose={resolveConflict} />
  if (upgrade) {
    return (
      <FileUpgradeDialog
        info={upgrade}
        onConfirm={() => resolveFileUpgrade(true)}
        onCancel={() => resolveFileUpgrade(false)}
      />
    )
  }
  return null
}
