import { create } from 'zustand'
import { fileStorageService, type FileStorageStatus } from '../services/file-storage'
import { useCanvasStore } from './canvas-store'
import { useSettingsStore } from './settings-store'
import { useTodoStore } from './todo-store'
import { useProjectStore } from './project-store'
import { usePersonStore } from './person-store'
import { useListInsetStore } from './list-inset-store'
import { useOrgStore } from './org-store'
import { useNoteStore } from './note-store'
import { useFloatingNoteStore } from './floating-note-store'
import { useFloatingCalendarStore } from './floating-calendar-store'
import { useTaskboardStore } from './taskboard-store'
import { useStatusStore } from './status-store'
import { useUndoStore } from './undo-store'
import { useFilterStore } from './filter-store'
import type { UnsupportedImportInfo } from '../services/migration-check'

async function refreshAllStores() {
  useUndoStore.getState().clear()
  useFilterStore.getState().clearAll()
  await useCanvasStore.getState().ensureDefault()
  await useSettingsStore.getState().load()
  const canvasId = useCanvasStore.getState().selectedCanvasId
  await Promise.all([
    useTodoStore.getState().loadAll(),
    useProjectStore.getState().loadAll(),
    usePersonStore.getState().load(),
    useOrgStore.getState().load(),
    useOrgStore.getState().loadPersonOrgMap(),
    useStatusStore.getState().load(),
    useTaskboardStore.getState().load(),
    useNoteStore.getState().load(),
    ...(canvasId != null ? [
      useListInsetStore.getState().loadByCanvas(canvasId),
      useFloatingNoteStore.getState().loadByCanvas(canvasId),
      useFloatingCalendarStore.getState().loadByCanvas(canvasId),
    ] : []),
  ])
  // Reload assignment maps after entities and todos are loaded
  const todoIds = useTodoStore.getState().todos.map(t => t.id)
  if (todoIds.length > 0) {
    await Promise.all([
      usePersonStore.getState().loadAssignments(todoIds),
      useOrgStore.getState().loadAssignments(todoIds),
    ])
  }
}

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

export { refreshAllStores }
