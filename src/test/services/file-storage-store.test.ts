import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SyncConflictInfo, FileUpgradeInfo, SyncConflictChoice } from '../../services/file-storage'
import type { UnsupportedImportInfo } from '../../data/file-version'

// The store's wiring to the service, with the service's subscribe calls captured.
const wiring = vi.hoisted(() => ({
  status: [] as Array<(s: unknown) => void>,
  before: [] as Array<() => Promise<() => void>>,
  after: [] as Array<() => Promise<void>>,
  migration: null as null | ((info: unknown) => Promise<boolean>),
  conflict: null as null | ((info: unknown) => Promise<SyncConflictChoice>),
  upgrade: null as null | ((info: unknown) => Promise<boolean>),
}))

vi.mock('../../services/file-storage', () => ({
  fileStorageService: {
    isSupported: true,
    onStatusChange: (l: (s: unknown) => void) => { wiring.status.push(l); return () => {} },
    onBeforeImport: (l: () => Promise<() => void>) => { wiring.before.push(l); return () => {} },
    onAfterImport: (l: () => Promise<void>) => { wiring.after.push(l); return () => {} },
    onConfirmMigration: (h: (info: unknown) => Promise<boolean>) => { wiring.migration = h; return () => {} },
    onConflict: (h: (info: unknown) => Promise<SyncConflictChoice>) => { wiring.conflict = h; return () => {} },
    onConfirmFileUpgrade: (h: (info: unknown) => Promise<boolean>) => { wiring.upgrade = h; return () => {} },
  },
}))

const { useFileStorageStore, resetFileStoragePrompts } = await import('../../services/file-storage-store')

const conflictInfo = (fileName: string) => ({ fileName }) as SyncConflictInfo
const upgradeInfo: FileUpgradeInfo = { fileName: 'a.json', fromVersion: 49, toVersion: 62 }
const legacyInfo = { version: 12 } as unknown as UnsupportedImportInfo

beforeEach(() => {
  resetFileStoragePrompts()
  useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
})

describe('file-storage store — wiring', () => {
  it('subscribes once to each service event when created', () => {
    expect(wiring.status).toHaveLength(1)
    expect(wiring.before).toHaveLength(1)
    expect(wiring.after).toHaveLength(1)
    expect(wiring.migration && wiring.conflict && wiring.upgrade).toBeTruthy()
  })

  it('a status change lands in the store', () => {
    wiring.status[0]!({ isConnected: true, fileName: 'x.json', lastSavedAt: null, needsPermission: false, error: null, paused: null })
    expect(useFileStorageStore.getState()).toMatchObject({ isConnected: true, fileName: 'x.json' })
  })
})

describe('file-storage store — waiting questions', () => {
  it('a second conflict answers the first as cancelled instead of leaving it waiting', async () => {
    const first = wiring.conflict!(conflictInfo('first.json'))
    const second = wiring.conflict!(conflictInfo('second.json'))
    await expect(first).resolves.toBe('cancel')
    expect(useFileStorageStore.getState().pendingConflict?.fileName).toBe('second.json')
    useFileStorageStore.getState().resolveConflict('file')
    await expect(second).resolves.toBe('file')
    expect(useFileStorageStore.getState().pendingConflict).toBeNull()
  })

  it('a second upgrade or migration question answers the first with no', async () => {
    const upgrade1 = wiring.upgrade!(upgradeInfo)
    const upgrade2 = wiring.upgrade!(upgradeInfo)
    await expect(upgrade1).resolves.toBe(false)
    useFileStorageStore.getState().resolveFileUpgrade(true)
    await expect(upgrade2).resolves.toBe(true)

    const legacy1 = wiring.migration!(legacyInfo)
    const legacy2 = wiring.migration!(legacyInfo)
    await expect(legacy1).resolves.toBe(false)
    useFileStorageStore.getState().confirmLegacyImport()
    await expect(legacy2).resolves.toBe(true)
  })

  it('the test reset answers every waiting question as cancelled', async () => {
    const conflict = wiring.conflict!(conflictInfo('a.json'))
    const upgrade = wiring.upgrade!(upgradeInfo)
    const legacy = wiring.migration!(legacyInfo)
    resetFileStoragePrompts()
    await expect(conflict).resolves.toBe('cancel')
    await expect(upgrade).resolves.toBe(false)
    await expect(legacy).resolves.toBe(false)
    // Nothing left to answer: a later resolve is a no-op.
    useFileStorageStore.getState().resolveConflict('browser')
  })
})
