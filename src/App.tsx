import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { createHashRouter, RouterProvider, Routes, Route, Navigate, useLocation } from 'react-router'
import { useTodoStore } from './stores/todo-store'
import { usePersonStore } from './stores/person-store'
import { useFilterStore } from './stores/filter-store'
import { useSettingsStore } from './stores/settings-store'
import { useFileStorageStore } from './services/file-storage-store'
import { fileStorageService } from './services/file-storage'
import { TopBar } from './components/layout/TopBar'
import { removeLegacySyncKeys } from './components/layout/sync-status'
import { useUIStore } from './stores/ui-store'
import { CommandPalette } from './components/overlays/CommandPalette'
import { BulkConfirmDialog } from './components/overlays/BulkConfirmDialog'
import { QuickAddBar, type QuickAddDraft, type QuickAddPreset } from './components/overlays/QuickAddBar'
import { RecentTaskPill } from './components/overlays/RecentTaskPill'
import { UndoSnackbar } from './components/overlays/UndoSnackbar'
import { ConfirmPromptHost } from './components/overlays/ConfirmPromptHost'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
import { useIsMobile } from './hooks/use-is-mobile'
import { useStatusStore } from './stores/status-store'
import { useShortcutLabel } from './hooks/use-shortcut-label'
import { LEGACY_ROUTES, ROUTE_SETTINGS, ROUTE_WORKSPACE } from './routes'

import { createCommands, searchDynamicCommands } from './services/command-registry'
import { openTaskCounts } from './services/checkin-email/recipients'
import { currentCheckinTaskCounts, sendPersonCheckin } from './services/checkin-email/person-checkin'
import { backupScheduler } from './data/backup-scheduler'
import { CURRENT_DB_VERSION, findDatabaseTooNew } from './data/database'
import { runAppStartup } from './services/app-startup'
import { createQuickAddTask } from './services/create-task'
import { getFilterDefaults, markerFlags, withoutMarkers } from './utils/filter-defaults'
import { checkTooNewDB, checkUnsupportedOldDB } from './services/migration-check'
import type { TooNewDBInfo, UnsupportedDBInfo } from './services/migration-check'
import { DatabaseTooNewDialog, MigrationDialog } from './components/overlays/MigrationDialog'
import { SyncConflictDialog } from './components/overlays/SyncConflictDialog'
import { FileUpgradeDialog } from './components/overlays/FileUpgradeDialog'
import { StartupPurgePrompt } from './components/overlays/StartupPurgePrompt'
import { LaunchPermissionDialog } from './components/overlays/LaunchPermissionDialog'
import { expiredCompletedUids } from './services/purge-completed'
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

/**
 * The command palette, mounted while it shows: its commands read the stores
 * when they run or search (`getState`), so the shell never re-renders for a
 * task write or a selection click.
 */
function AppCommandPalette({ onClose, openShortcutsModal }: { onClose: () => void; openShortcutsModal: () => void }) {
  const selectionCount = useUIStore((s) => s.selectedTodoIds.size)
  const shortcutOverrides = useSettingsStore((s) => s.shortcutOverrides)

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
      getTodos: () => useTodoStore.getState().todos,
      focusTask: (todoId: number) => {
        useUIStore.getState().selectOneTodo(todoId)
        useUIStore.getState().openEditPopup(todoId)
      },
      openShortcutsModal,
      getStatuses: () => useStatusStore.getState().statuses,
      openCheckinDialog: (personIds?: number[]) => useUIStore.getState().openCheckinDialog(personIds),
      sendPersonCheckin: (personId: number) => { void sendPersonCheckin(personId) },
      openCheckinImport: () => useUIStore.getState().openCheckinImport(),
      getPeople: () => usePersonStore.getState().people,
      getOpenTaskCounts: () => openTaskCounts(useTodoStore.getState().todos, usePersonStore.getState().assignedPeopleMap),
      getCheckinTaskCounts: () => currentCheckinTaskCounts(useSettingsStore.getState().checkinTaskFilter),
    }),
    [selectionCount, openShortcutsModal],
  )

  // The palette's key hints follow the user's shortcut changes.
  const commands = useMemo(() => createCommands(commandCtx, shortcutOverrides), [commandCtx, shortcutOverrides])
  const handleSearchDynamic = useCallback(
    (query: string) => searchDynamicCommands(query, commandCtx),
    [commandCtx],
  )
  return <CommandPalette commands={commands} onSearchDynamic={handleSearchDynamic} onClose={onClose} />
}

function AppBulkConfirmDialog() {
  const bulkConfirmation = useUIStore((s) => s.bulkConfirmation)
  if (!bulkConfirmation) return null
  const { clearBulkConfirmation, clearSelection, closeEditPopup } = useUIStore.getState()
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
            closeEditPopup()
            clearSelection()
          } else {
            // Cleared only once the delete goes ahead: cancelling at the
            // "Continue without a backup?" question keeps the selection.
            void useTodoStore.getState().bulkRemove(ids, {
              beforeDelete: () => { closeEditPopup(); clearSelection() },
            })
          }
        } else {
          useTodoStore.getState().bulkSetCompleted(ids, action === 'complete')
        }
        clearBulkConfirmation()
      }}
      onCancel={clearBulkConfirmation}
    />
  )
}

/**
 * QuickAddBar wrapper — wires the bar to ui-store visibility, the live data
 * stores, and the full-editor handoff path.
 *
 * Submit: `createQuickAddTask` with the defaults of where the bar was
 * opened.
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
  // Resolves false when the task couldn't be stored: the bar then stays open.
  const handleSubmit = useCallback(async (submitted: QuickAddDraft): Promise<boolean> => {
    // Defaults: an explicit list-predicate seed stashed on
    // `quickAddDraft.defaults` (a list widget's "+ Add task"), else the
    // active top-bar filter.
    // A preset marker whose chip was removed is not seeded.
    const draft = useUIStore.getState().quickAddDraft
    const fd = withoutMarkers(
      draft?.defaults ?? getFilterDefaults(useFilterStore.getState().filters),
      submitted.removedPresetMarkers ?? [],
    )
    const id = await createQuickAddTask(submitted, fd)
    if (id == null) return false
    useUIStore.getState().showRecentlyCreated(id)
    return true
  }, [])

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
        ...(existing?.defaults
          ? { defaults: withoutMarkers(existing.defaults, submitted.removedPresetMarkers ?? []) }
          : {}),
      },
    })
    useUIStore.getState().openCreatePopup()
  }, [])

  // An explicit seed (a list's "+ Add task", an Eisenhower quadrant's "+")
  // shows its markers (each with a ×) and its source as chips.
  const preset = useMemo<QuickAddPreset | undefined>(() => {
    if (!draft?.defaults && !draft?.source) return undefined
    return { ...markerFlags(draft.defaults), ...(draft.source ? { source: draft.source } : {}) }
  }, [draft])

  return (
    <QuickAddBar
      open={open}
      initialDraft={draft ?? undefined}
      preset={preset}
      onClose={close}
      onSubmit={handleSubmit}
      onOpenFullEditor={handleOpenFullEditor}
    />
  )
}

/** Both sets of uids (the prompt lists every task either asks about). */
function mergeUids(prev: ReadonlySet<string> | null, next: ReadonlySet<string>): ReadonlySet<string> {
  return prev ? new Set([...prev, ...next]) : next
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
  const isMobile = useIsMobile()
  const [initialized, setInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  /** Launch stopped because a newer version saved the database (where the version check before it couldn't see that). */
  const [initTooNew, setInitTooNew] = useState<TooNewDBInfo | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  /** uids of the completed tasks past retention at launch (for the purge prompt). */
  const [purgeLaunchUids, setPurgeLaunchUids] = useState<ReadonlySet<string> | null>(null)
  /** uids the purge prompt already asked about this launch (any answer): a later file load doesn't ask again. */
  const purgeAskedRef = useRef(new Set<string>())
  /** Set once launch's completed-task check began reading: a sync-file load from then on gets its own check. */
  const purgeCheckStartedRef = useRef(false)
  /** While launch waits for the sync file's permission answer the start screen shows no spinner. */
  const launchQuestion = useFileStorageStore((s) => s.pendingLaunchPermission != null)
  const location = useLocation()
  // Desktop: New task leads the top bar. Mobile: a floating + above the tab bar.
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
    removeLegacySyncKeys()
    // Waits at the sync file's step for the launch question's answer when
    // the file needs permission (`runAppStartup`).
    runAppStartup({ onPurgeCheck: () => { purgeCheckStartedRef.current = true } })
      .then(({ expiredUids }) => {
        // Completed tasks past retention are never purged silently — the
        // prompt asks about the ones expired once the sync file was loaded
        // (or its prompts answered), so the list reflects the data kept.
        if (expiredUids) setPurgeLaunchUids((prev) => mergeUids(prev, expiredUids))
        setInitialized(true)
      })
      .catch((err) => {
        console.error('App initialization failed:', err)
        const tooNew = findDatabaseTooNew(err)
        if (tooNew) setInitTooNew({ storedVersion: tooNew.storedVersion, buildVersion: CURRENT_DB_VERSION })
        setInitError(err instanceof Error ? err.message : String(err))
      })
    return () => backupScheduler.stop()
  }, [])

  // A sync file loaded once launch's check began (Grant access, Attach /
  // Open file, a retry or a resolved conflict) replaced the data: ask about
  // its expired tasks too — those the prompt hasn't already asked about this
  // launch — unless the loaded data says the prompt showed within its
  // interval (`expiredCompletedUids`). A load before that is covered by
  // launch's own check. Runs after the stores reloaded (an earlier
  // subscriber), so the interval is the loaded data's.
  useEffect(() => {
    return fileStorageService.onAfterImport(async () => {
      if (!purgeCheckStartedRef.current) return
      try {
        const expired = await expiredCompletedUids()
        const fresh = [...(expired ?? [])].filter((uid) => !purgeAskedRef.current.has(uid))
        if (fresh.length > 0) setPurgeLaunchUids((prev) => mergeUids(prev, new Set(fresh)))
      } catch (err) {
        console.warn('[purge] could not read expired tasks', err)
      }
    })
  }, [])

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    openPalette: () => setShowPalette(true),
    closePalette: () => setShowPalette(false),
    openSettings: () => useUIStore.getState().openSettings(),
    openShortcutsModal: () => setShowShortcuts(true),
    // Nothing to act on before launch is done (the launch question is up, the stores load).
    enabled: !isMobile && initialized,
  })

  const handleClosePalette = useCallback(() => setShowPalette(false), [])
  const openShortcutsModal = useCallback(() => setShowShortcuts(true), [])

  const quickAddKeys = useShortcutLabel('quick-add')

  if (initTooNew) return <DatabaseTooNewDialog info={initTooNew} />

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
    // The start screen; the launch question (`LaunchPermissionDialog`) shows over it.
    if (launchQuestion) return <div className={styles.initLoading} data-testid="start-screen" />
    return (
      <div className={styles.initLoading} data-testid="start-screen">
        <div className={styles.spinner} />
        Loading…
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <div className={styles.mainColumn}>
        {!isMobile && <TopBar />}
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
          <button className={styles.fab} onClick={() => useUIStore.getState().openQuickAdd()} aria-label="Quick add" title={`Quick add (${quickAddKeys})`}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="9" y1="3" x2="9" y2="15" />
              <line x1="3" y1="9" x2="15" y2="9" />
            </svg>
          </button>
        </div>
      )}
      {!isMobile && showPalette && <AppCommandPalette onClose={handleClosePalette} openShortcutsModal={openShortcutsModal} />}
      {!isMobile && showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {!isMobile && settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}

      <AppBulkConfirmDialog />
      {purgeLaunchUids && (
        <StartupPurgePrompt
          launchUids={purgeLaunchUids}
          onClose={() => {
            for (const uid of purgeLaunchUids) purgeAskedRef.current.add(uid)
            setPurgeLaunchUids(null)
          }}
        />
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
  const [tooNewDBInfo, setTooNewDBInfo] = useState<TooNewDBInfo | null>(null)
  const [dbVersionChecked, setDbVersionChecked] = useState(false)

  useEffect(() => {
    Promise.all([checkUnsupportedOldDB(), checkTooNewDB()])
      .then(([info, tooNew]) => {
        setUnsupportedDBInfo(info)
        setTooNewDBInfo(tooNew)
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

  // Saved by a newer version: nothing here may open it.
  if (tooNewDBInfo) return <DatabaseTooNewDialog info={tooNewDBInfo} />

  if (unsupportedDBInfo) {
    return <MigrationDialog mode="schema-upgrade" info={unsupportedDBInfo} onProceed={() => setUnsupportedDBInfo(null)} />
  }

  return (
    <ErrorBoundary scope="App">
      <RouterProvider router={router} />
      <FileMigrationOverlay />
      <ConfirmPromptHost />
    </ErrorBoundary>
  )
}

/**
 * Sync-file prompts raised by `fileStorageService` while it waits for the user
 * (permission at launch, below-floor file, browser/file conflict, older-file
 * upgrade). Rendered outside AppShell so they show even while startup is
 * still pending.
 */
function FileMigrationOverlay() {
  const pending = useFileStorageStore((s) => s.pendingLegacyImport)
  const confirm = useFileStorageStore((s) => s.confirmLegacyImport)
  const cancel = useFileStorageStore((s) => s.cancelLegacyImport)
  const conflict = useFileStorageStore((s) => s.pendingConflict)
  const resolveConflict = useFileStorageStore((s) => s.resolveConflict)
  const upgrade = useFileStorageStore((s) => s.pendingFileUpgrade)
  const resolveFileUpgrade = useFileStorageStore((s) => s.resolveFileUpgrade)
  const launchPermission = useFileStorageStore((s) => s.pendingLaunchPermission)

  if (launchPermission) return <LaunchPermissionDialog prompt={launchPermission} />
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
