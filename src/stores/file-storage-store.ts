import { create } from 'zustand'
import {
  fileStorageService,
  type FileStorageStatus,
  type SyncConflictInfo,
  type SyncConflictChoice,
  type FileUpgradeInfo,
} from '../services/file-storage'
import { useNoteStore } from './note-store'
import { refreshAllStores } from './refresh-all'
import type { UnsupportedImportInfo } from '../data/file-version'

let legacyImportResolve: ((confirmed: boolean) => void) | null = null
let conflictResolve: ((choice: SyncConflictChoice) => void) | null = null
let fileUpgradeResolve: ((confirmed: boolean) => void) | null = null

interface FileStorageState extends FileStorageStatus {
  isSupported: boolean
  isLoading: boolean
  pendingLegacyImport: UnsupportedImportInfo | null
  /** Set while the service waits for the user to pick a side (SyncConflictDialog). */
  pendingConflict: SyncConflictInfo | null
  /** Set while the service waits for consent to upgrade an older sync file. */
  pendingFileUpgrade: FileUpgradeInfo | null
  /** The `error` text the user dismissed (the warning strip's ×); it shows again if the error changes. */
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
}

export const useFileStorageStore = create<FileStorageState>((set) => {
  // Subscribe to service status changes
  fileStorageService.onStatusChange((status) => set(status))
  // Hold note saves while a file import replaces the data, then refresh
  // every Zustand store
  fileStorageService.onBeforeImport(() => useNoteStore.getState().holdForDataReplace())
  fileStorageService.onAfterImport(refreshAllStores)
  // Handle legacy-import confirmation requests from the service
  fileStorageService.onConfirmMigration((info) => {
    return new Promise<boolean>((resolve) => {
      legacyImportResolve = resolve
      set({ pendingLegacyImport: info })
    })
  })
  fileStorageService.onConflict((info) => {
    return new Promise<SyncConflictChoice>((resolve) => {
      conflictResolve = resolve
      set({ pendingConflict: info })
    })
  })
  fileStorageService.onConfirmFileUpgrade((info) => {
    return new Promise<boolean>((resolve) => {
      fileUpgradeResolve = resolve
      set({ pendingFileUpgrade: info })
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
  }
})
