import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fixture from '../fixtures/v49-export.json'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImportText } from '../../data/import-pipeline'
import { FILE_SYNC_STATE_KEY } from '../../services/file-sync-state'
import { fileStorageService as svc } from '../../services/file-storage'
import type { SyncConflictInfo } from '../../services/file-storage'
import { resetDb } from '../helpers'

/**
 * CURRENT_DB_VERSION is past 49 (v50 Dates, v51 uid + completedAt, …), so a
 * v49 sync file is an *older* file. This drives
 * the real pipeline end-to-end (real Dexie, real `prepareImport` +
 * v50…CURRENT transforms, real restore, real backup
 * snapshots) with only the file handle faked, and checks the "user decides
 * before anything changes" rules for that file:
 *
 * - clean + synced browser → upgrade prompt (49 → CURRENT); cancel touches nothing;
 * - accept → the raw v49 text is backed up first, the browser gets the file's
 *   data with real `Date`s, and the file is rewritten at CURRENT;
 * - unsynced browser changes → conflict prompt; "Use file" backs up first too.
 */

const mockLoadFileHandle = vi.fn()
vi.mock('../../services/file-handle-idb', () => ({
  saveFileHandle: vi.fn().mockResolvedValue(undefined),
  loadFileHandle: (...args: unknown[]) => mockLoadFileHandle(...args) as unknown,
  clearFileHandle: vi.fn().mockResolvedValue(undefined),
}))

const SAVED_AT = '2026-10-01T10:00:00.000Z'
const FILE_TEXT = JSON.stringify({ ...fixture, savedAt: SAVED_AT }, null, 2)
const BROWSER_TASK = 'Browser-only task'

function makeHandle(text: string) {
  const write = vi.fn<(data: string) => Promise<void>>().mockResolvedValue(undefined)
  const handle = {
    kind: 'file',
    name: 'todo2-data.json',
    getFile: vi.fn().mockImplementation(async () =>
      new File([text], 'todo2-data.json', { type: 'application/json', lastModified: 1_000 })),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    createWritable: vi.fn().mockResolvedValue({
      write,
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }),
    isSameEntry: vi.fn(),
  }
  return { handle, write }
}

function setSyncState(state: { fileSavedAt: string | null; dirtySince: string | null }) {
  localStorage.setItem(FILE_SYNC_STATE_KEY, JSON.stringify(state))
}

async function seedBrowser() {
  const now = new Date()
  await db.canvases.add({ name: 'Browser canvas', sortOrder: 0, createdAt: now })
  await db.todos.add({ title: BROWSER_TASK, isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now })
}

async function fileBackups() {
  return (await db.backups.toArray()).filter((b) => b.data === FILE_TEXT)
}

beforeEach(async () => {
  await resetDb()
  localStorage.clear()
  vi.stubGlobal('showOpenFilePicker', vi.fn())
  await seedBrowser()
})

afterEach(async () => {
  await svc.disconnect()
  svc.onConfirmFileUpgrade(async () => false)
  svc.onConflict(async () => 'cancel')
  vi.unstubAllGlobals()
})

describe('v49 sync file opened by a post-v49 build (CURRENT ≥ 50)', () => {
  it('the build is past v49 and the fixture prepares as an upgrade', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThan(49)
    const prepared = prepareImportText(FILE_TEXT)
    expect(prepared).toMatchObject({ ok: true, sourceVersion: 49, upgraded: true, legacy: null })
  })

  it('clean + synced browser: asks 49 → CURRENT; cancel leaves file, browser and backups untouched', async () => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(FILE_TEXT)
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn().mockResolvedValue(false)
    svc.onConfirmFileUpgrade(ask)

    await svc.initialize()

    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 49, toVersion: CURRENT_DB_VERSION })
    expect(svc.status.paused?.reason).toBe('upgrade-cancelled')
    expect(write).not.toHaveBeenCalled()
    expect(await fileBackups()).toHaveLength(0)
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual([BROWSER_TASK])
  })

  it('accepting backs up the raw v49 text, loads the file with real Dates, and rewrites it at CURRENT', async () => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(FILE_TEXT)
    mockLoadFileHandle.mockResolvedValue(handle)
    svc.onConfirmFileUpgrade(async () => true)

    await svc.initialize()

    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)
    expect(await fileBackups()).toHaveLength(1)

    const todos = await db.todos.orderBy('id').toArray()
    expect(todos).toHaveLength(fixture.todos.length)
    expect(todos.some((t) => t.title === BROWSER_TASK)).toBe(false)
    for (const t of todos) expect(t.createdAt instanceof Date, `todo ${t.id} createdAt`).toBe(true)
    expect(todos[0]!.dueDate).toEqual(new Date('2026-10-16T00:00:00.000Z'))

    expect(write).toHaveBeenCalledTimes(1)
    const written = JSON.parse(write.mock.calls[0]![0]) as Record<string, unknown>
    expect(written.__schemaVersion).toBe(CURRENT_DB_VERSION)
    // The rewritten file imports at the current version without any upgrade.
    const reloaded = prepareImportText(write.mock.calls[0]![0])
    expect(reloaded).toMatchObject({ ok: true, sourceVersion: CURRENT_DB_VERSION, upgraded: false })
    if (!reloaded.ok) return
    expect(reloaded.data.todos.map((t) => t.title)).toEqual(todos.map((t) => t.title))
    // v51: the rewritten file carries the same uids / completedAt as the browser.
    expect(reloaded.data.todos.map((t) => t.uid)).toEqual(todos.map((t) => t.uid))
    expect(reloaded.data.todos.map((t) => t.completedAt)).toEqual(todos.map((t) => t.completedAt))
  })

  it('unsynced browser changes: conflict names v49 as the file schema; "Use file" backs up before restoring', async () => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: '2026-10-02T10:00:00.000Z' })
    const { handle, write } = makeHandle(FILE_TEXT)
    mockLoadFileHandle.mockResolvedValue(handle)
    let info: SyncConflictInfo | null = null
    svc.onConflict(async (i) => { info = i; return 'file' })
    const ask = vi.fn()
    svc.onConfirmFileUpgrade(ask)

    await svc.initialize()

    expect(info).toMatchObject({
      reason: 'browser-changes',
      browser: { taskCount: 1, schemaVersion: CURRENT_DB_VERSION },
      file: { taskCount: fixture.todos.length, schemaVersion: 49 },
    })
    expect(ask).not.toHaveBeenCalled()
    expect(await fileBackups()).toHaveLength(1)
    expect(await db.todos.count()).toBe(fixture.todos.length)
    expect(write).toHaveBeenCalledTimes(1)
    expect((JSON.parse(write.mock.calls[0]![0]) as Record<string, unknown>).__schemaVersion).toBe(CURRENT_DB_VERSION)
  })
})
