import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { buildExportData } from '../../data/export-data'
import { prepareImport } from '../../data/import-pipeline'
import { browserMatchesFile, browserTaskCount, importDataEqual } from '../../services/file-sync-compare'
import { readFileSyncState, writeFileSyncState, clearFileSyncState, fileContentId, FILE_SYNC_STATE_KEY } from '../../services/file-sync-state'
import { resetDb, makeTodo } from '../helpers'

beforeEach(async () => {
  await resetDb()
  localStorage.clear()
})

async function seed() {
  await db.todos.add(makeTodo({ id: 1, notes: 'n', dueDate: new Date('2026-10-15') }))
  await db.settings.add({ key: 'themeMode', value: 'dark' })
}

async function currentFileData() {
  // Simulate the sync file: export → JSON → prepare, exactly like a load.
  const prepared = prepareImport(JSON.parse(JSON.stringify({ ...(await buildExportData()), savedAt: 'x' })))
  if (!prepared.ok) throw new Error(prepared.error)
  return prepared.data
}

describe('browserMatchesFile', () => {
  it('is true when the file holds exactly the browser data (Dates vs ISO strings ignored)', async () => {
    await seed()
    expect(await browserMatchesFile(await currentFileData())).toBe(true)
  })

  it('is false after a browser-side change', async () => {
    await seed()
    const file = await currentFileData()
    await db.todos.update(1, { title: 'Renamed' })
    expect(await browserMatchesFile(file)).toBe(false)
  })

  it('is false when a row was added on one side', async () => {
    await seed()
    const file = await currentFileData()
    await db.todos.add(makeTodo({ id: 2 }))
    expect(await browserMatchesFile(file)).toBe(false)
  })
})

describe('importDataEqual', () => {
  it('ignores key order and row order', async () => {
    await seed()
    const a = await currentFileData()
    const b = { ...a, todos: [...a.todos].reverse().map((t) => Object.fromEntries(Object.entries(t).reverse())) } as typeof a
    expect(importDataEqual(a, b)).toBe(true)
  })
})

describe('browserTaskCount', () => {
  it('counts todos', async () => {
    await seed()
    expect(await browserTaskCount()).toBe(1)
  })
})

describe('file-sync-state', () => {
  it('round-trips through localStorage and defaults to empty', () => {
    expect(readFileSyncState()).toEqual({ fileSavedAt: null, dirtySince: null })
    writeFileSyncState({ fileSavedAt: 'a', dirtySince: 'b' })
    expect(readFileSyncState()).toEqual({ fileSavedAt: 'a', dirtySince: 'b' })
    clearFileSyncState()
    expect(localStorage.getItem(FILE_SYNC_STATE_KEY)).toBeNull()
  })

  it('survives garbage in storage', () => {
    localStorage.setItem(FILE_SYNC_STATE_KEY, '{nope')
    expect(readFileSyncState()).toEqual({ fileSavedAt: null, dirtySince: null })
  })

  it('identifies file content by savedAt, then exportedAt, then lastModified', () => {
    expect(fileContentId({ savedAt: 's', exportedAt: 'e' }, 5)).toBe('s')
    expect(fileContentId({ exportedAt: 'e' }, 5)).toBe('exported:e')
    expect(fileContentId({}, 5)).toBe('modified:5')
  })
})
