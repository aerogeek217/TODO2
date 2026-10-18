import { create } from 'zustand'
import {
  fileStorageService,
  type FileStorageStatus,
  type SyncConflictInfo,
  type SyncConflictChoice,
  type FileUpgradeInfo,
} from './file-storage'
import { useNoteStore } from '../stores/note-store'
import { refreshAllStores } from '../stores/refresh-all'
import type { UnsupportedImportInfo } from '../data/file-version'
import { registerModuleReset } from '../utils/module-reset'

/**
 * The answers the service is waiting for, one per kind of question. A new
 * question of a kind already waiting answers the old one as cancelled first,
 * so its caller never hangs.
 */
let legacyImportResolve: ((confirmed: boolean) => void) | null = null
let conflictResolve: ((choice: SyncConflictChoice) => void) | null = null
let fileUpgradeResolve: ((confirmed: boolean) => void) | null = null
/** The launch question's answer: resolving it lets launch go on. */
let launchPermissionResolve: (() => void) | null = null

/**
 * Answers every waiting question as cancelled and forgets it, for tests that
 * share one module instance (the store's state is reset separately).
 */
export function resetFileStoragePrompts(): void {
  legacyImportResolve?.(false)
  conflictResolve?.('cancel')
  fileUpgradeResolve?.(false)
  launchPermissionResolve?.()
  legacyImportResolve = null
  conflictResolve = null
  fileUpgradeResolve = null
  launchPermissionResolve = null
}
registerModuleReset(resetFileStoragePrompts)

/**
 * The launch question (`LaunchPermissionDialog`): `ask` first, `waiting`
 * while the browser's own prompt is up, `refused` when the browser said no.
 */
export interface LaunchPermissionPrompt {
  fileName: string
  phase: 'ask' | 'waiting' | 'refused'
}

interface FileStorageState extends FileStorageStatus {
  isSupported: boolean
  isLoading: boolean
  pendingLegacyImport: UnsupportedImportInfo | null
  /** Set while the service waits for the user to pick a side (SyncConflictDialog). */
  pendingConflict: SyncConflictInfo | null
  /** Set while the service waits for consent to upgrade an older sync file. */
  pendingFileUpgrade: FileUpgradeInfo | null
  /** Set while launch waits for the user to grant access to the sync file or go on without it. */
  pendingLaunchPermission: LaunchPermissionPrompt | null
  /** The `error` text the user dismissed (the storage pill's Dismiss); it shows again if the error changes. */
  dismissedError: string | null
  dismissError: () => void
  initialize: () => Promise<void>
  openFile: () => Promise<void>
  createFile: () => Promise<void>
  disconnect: () => Promise<void>
  reconnect: () => Promise<void>
  retry: () => Promise<void>
  overwriteFileWithBrowser: () => Promise<void>
  confirmLegacyImport: () => void
  cancelLegacyImport: () => void
  resolveConflict: (choice: SyncConflictChoice) => void
  resolveFileUpgrade: (confirmed: boolean) => void
  /**
   * The launch question's Grant access: asks the browser (call it from the
   * click — it needs the user's gesture). Granted → the question closes and
   * the load decision runs (its prompts may follow), then launch goes on;
   * refused → the question shows that and waits.
   */
  grantLaunchPermission: () => void
  /** The launch question's Continue without the file: launch goes on with this browser's data, sync paused. */
  continueWithoutFile: () => void
}

export const useFileStorageStore = create<FileStorageState>((set, get) => {
  // Subscribed for the app's lifetime (the store is created once).
  fileStorageService.onStatusChange((status) => set(status))
  // Hold note saves while a file import replaces the data, then refresh
  // every Zustand store
  fileStorageService.onBeforeImport(() => useNoteStore.getState().holdForDataReplace())
  fileStorageService.onAfterImport(refreshAllStores)
  // Handle legacy-import confirmation requests from the service
  fileStorageService.onConfirmMigration((info) => {
    return new Promise<boolean>((resolve) => {
      legacyImportResolve?.(false)
      legacyImportResolve = resolve
      set({ pendingLegacyImport: info })
    })
  })
  fileStorageService.onConflict((info) => {
    return new Promise<SyncConflictChoice>((resolve) => {
      conflictResolve?.('cancel')
      conflictResolve = resolve
      set({ pendingConflict: info })
    })
  })
  fileStorageService.onConfirmFileUpgrade((info) => {
    return new Promise<boolean>((resolve) => {
      fileUpgradeResolve?.(false)
      fileUpgradeResolve = resolve
      set({ pendingFileUpgrade: info })
    })
  })

  fileStorageService.onLaunchPermission((info) => {
    return new Promise<void>((resolve) => {
      launchPermissionResolve?.()
      launchPermissionResolve = resolve
      set({ pendingLaunchPermission: { fileName: info.fileName, phase: 'ask' } })
    })
  })

  const withLoading = async (fn: () => Promise<void>, errorMessage: string) => {
    set({ isLoading: true })
    try {
      await fn()
    } catch (err) {
      console.warn(`[file-storage] ${errorMessage}`, err)
      set({ error: errorMessage })
    } finally {
      set({ isLoading: false })
    }
  }

  return {
    // Initial state
    isConnected: false,
    fileName: null,
    lastSavedAt: null,
    needsPermission: false,
    error: null,
    paused: null,
    isSupported: fileStorageService.isSupported,
    isLoading: false,
    pendingLegacyImport: null,
    pendingConflict: null,
    pendingFileUpgrade: null,
    pendingLaunchPermission: null,
    dismissedError: null,

    dismissError: () => set((s) => ({ dismissedError: s.error })),

    initialize: () => withLoading(() => fileStorageService.initialize(), 'Failed to initialize file storage'),

    openFile: async () => {
      set({ error: null })
      await withLoading(() => fileStorageService.openFile(), 'Failed to open file')
    },

    createFile: async () => {
      set({ error: null })
      await withLoading(() => fileStorageService.createFile(), 'Failed to create file')
    },

    disconnect: async () => {
      await fileStorageService.disconnect()
    },

    reconnect: () => withLoading(() => fileStorageService.reconnect(), 'Failed to reconnect to file'),

    retry: () => withLoading(() => fileStorageService.retry(), 'Failed to read file'),

    overwriteFileWithBrowser: () =>
      withLoading(() => fileStorageService.overwriteFileWithBrowser(), 'Failed to save to file'),

    confirmLegacyImport: () => {
      legacyImportResolve?.(true)
      legacyImportResolve = null
      set({ pendingLegacyImport: null })
    },

    cancelLegacyImport: () => {
      legacyImportResolve?.(false)
      legacyImportResolve = null
      set({ pendingLegacyImport: null })
    },

    resolveConflict: (choice) => {
      conflictResolve?.(choice)
      conflictResolve = null
      set({ pendingConflict: null })
    },

    resolveFileUpgrade: (confirmed) => {
      fileUpgradeResolve?.(confirmed)
      fileUpgradeResolve = null
      set({ pendingFileUpgrade: null })
    },

    grantLaunchPermission: () => {
      const answer = launchPermissionResolve
      const prompt = get().pendingLaunchPermission
      if (!answer || !prompt) return
      set({ pendingLaunchPermission: { ...prompt, phase: 'waiting' } })
      // Still this question (not answered by Continue meanwhile, not reset)?
      const current = () => launchPermissionResolve === answer
      void withLoading(
        () => fileStorageService.reconnect({ onGranted: () => { if (current()) set({ pendingLaunchPermission: null }) } }),
        'Failed to reconnect to file',
      ).then(() => {
        if (!current()) return
        if (get().needsPermission) {
          set({ pendingLaunchPermission: { ...prompt, phase: 'refused' } })
          return
        }
        launchPermissionResolve = null
        set({ pendingLaunchPermission: null })
        answer()
      })
    },

    continueWithoutFile: () => {
      const answer = launchPermissionResolve
      launchPermissionResolve = null
      set({ pendingLaunchPermission: null })
      answer?.()
    },
  }
})
