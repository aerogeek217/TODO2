import { create } from 'zustand'
import { fileStorageService, type FileStorageStatus } from '../services/file-storage'
import { refreshAllStores } from './refresh-all'
import type { UnsupportedImportInfo } from '../services/migration-check'

let legacyImportResolve: ((confirmed: boolean) => void) | null = null

interface FileStorageState extends FileStorageStatus {
  isSupported: boolean
  isLoading: boolean
  pendingLegacyImport: UnsupportedImportInfo | null
  initialize: () => Promise<void>
  openFile: () => Promise<void>
  createFile: () => Promise<void>
  disconnect: () => Promise<void>
  reconnect: () => Promise<void>
  confirmLegacyImport: () => void
  cancelLegacyImport: () => void
}

export const useFileStorageStore = create<FileStorageState>((set) => {
  // Subscribe to service status changes
  fileStorageService.onStatusChange((status) => set(status))
  // Refresh all Zustand stores after a file import
  fileStorageService.onAfterImport(refreshAllStores)
  // Handle legacy-import confirmation requests from the service
  fileStorageService.onConfirmMigration((info) => {
    return new Promise<boolean>((resolve) => {
      legacyImportResolve = resolve
      set({ pendingLegacyImport: info })
    })
  })

  return {
    // Initial state
    isConnected: false,
    fileName: null,
    lastSavedAt: null,
    needsPermission: false,
    error: null,
    isSupported: fileStorageService.isSupported,
    isLoading: false,
    pendingLegacyImport: null,

    initialize: async () => {
      set({ isLoading: true })
      try {
        await fileStorageService.initialize()
      } catch {
        set({ error: 'Failed to initialize file storage' })
      } finally {
        set({ isLoading: false })
      }
    },

    openFile: async () => {
      set({ isLoading: true, error: null })
      try {
        await fileStorageService.openFile()
      } catch {
        set({ error: 'Failed to open file' })
      } finally {
        set({ isLoading: false })
      }
    },

    createFile: async () => {
      set({ isLoading: true, error: null })
      try {
        await fileStorageService.createFile()
      } catch {
        set({ error: 'Failed to create file' })
      } finally {
        set({ isLoading: false })
      }
    },

    disconnect: async () => {
      await fileStorageService.disconnect()
    },

    reconnect: async () => {
      set({ isLoading: true })
      try {
        await fileStorageService.reconnect()
      } catch {
        set({ error: 'Failed to reconnect to file' })
      } finally {
        set({ isLoading: false })
      }
    },

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
  }
})
