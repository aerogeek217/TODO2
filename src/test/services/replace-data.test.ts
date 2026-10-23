import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { backupScheduler } from '../../data/backup-scheduler'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { runAppendImport } from '../../services/append-import'
import { useUndoStore } from '../../stores/undo-store'
import { buildExportData } from '../../data/export-data'
import { useFileOpsStore } from '../../stores/file-ops-store'
import { onDataReplaced, restoreBackup, restoreFromImport } from '../../services/replace-data'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { makeTodo, resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
  useTodoStore.setState(useTodoStore.getInitialState(), true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function titles(): Promise<string[]> {
  return (await db.todos.toArray()).map((t) => t.title).sort()
}

/** A backup holding one task, `title`; the database then moves on to `Current`. */
async function backupOf(title: string): Promise<number> {
  await db.todos.clear()
  await db.todos.add(makeTodo({ id: 1, title }))
  await db.settings.put({ key: 'themeMode', value: 'dark' })
  const id = await backupRepository.createSnapshot('manual')
  await db.todos.clear()
  await db.todos.add(makeTodo({ id: 2, title: 'Current' }))
  return id
}

function failSnapshots() {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
}

async function answerBackupPrompt(proceed: boolean) {
  await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
  expect(useUIStore.getState().confirmPrompts[0]?.title).toBe('Continue without a backup?')
  useUIStore.getState().answerConfirmation(proceed)
}

describe('restoreBackup', () => {
  it('backs up the current data first, then restores', async () => {
    const id = await backupOf('From backup')
    expect(await restoreBackup(id)).toEqual({ status: 'done', noBackup: false })
    expect(await titles()).toEqual(['From backup'])
    expect(await db.settings.get('themeMode')).toEqual({ key: 'themeMode', value: 'dark' })
    const preOp = (await db.backups.toArray()).filter((b) => b.trigger === 'pre-destructive')
    expect(preOp).toHaveLength(1)
    expect(preOp[0]?.data).toContain('Current')
    // The backup list now shows the new snapshot.
    expect(useFileOpsStore.getState().backups.map((b) => b.trigger).sort()).toEqual(['manual', 'pre-destructive'])
  })

  it('the snapshot of the current data restores what the restore replaced', async () => {
    const id = await backupOf('From backup')
    await restoreBackup(id)
    const preOp = (await db.backups.toArray()).find((b) => b.trigger === 'pre-destructive')!
    expect(await restoreBackup(preOp.id!)).toMatchObject({ status: 'done' })
    expect(await titles()).toEqual(['Current'])
  })

  it('restores the oldest backup even when the new snapshot prunes it', async () => {
    const oldest = await backupOf('Oldest')
    for (let i = 0; i < 9; i++) await backupRepository.createSnapshot('auto')
    expect(await db.backups.count()).toBe(10)
    expect(await restoreBackup(oldest)).toMatchObject({ status: 'done' })
    expect(await titles()).toEqual(['Oldest'])
  })

  it('failed snapshot + Cancel leaves the current data untouched', async () => {
    const id = await backupOf('From backup')
    failSnapshots()
    const pending = restoreBackup(id)
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await titles()).toEqual(['Current'])
  })

  it('failed snapshot + Continue restores without a backup and says so', async () => {
    const id = await backupOf('From backup')
    failSnapshots()
    const pending = restoreBackup(id)
    await answerBackupPrompt(true)
    expect(await pending).toEqual({ status: 'done', noBackup: true })
    expect(await titles()).toEqual(['From backup'])
    expect(useFileOpsStore.getState().snapshotWarning).toMatch(/^No backup was taken before restoring the backup/)
  })

  it('a missing or unreadable backup is an error, with no snapshot taken', async () => {
    const spy = vi.spyOn(backupScheduler, 'snapshotBeforeDestructive')
    expect(await restoreBackup(9999)).toEqual({ status: 'error', error: 'Backup not found' })
    const id = await db.backups.add({ createdAt: new Date().toISOString(), trigger: 'auto', sizeBytes: 5, data: 'NOT_JSON{{{' }) as number
    const result = await restoreBackup(id)
    expect(result.status).toBe('error')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('restoreFromImport', () => {
  async function importData() {
    const id = await backupOf('Imported')
    const prepared = prepareImportText((await db.backups.get(id))!.data)
    if (!prepared.ok) throw new Error(prepared.error)
    await db.backups.clear()
    return prepared.data
  }

  it('backs up the current data first, then replaces it', async () => {
    const data = await importData()
    expect(await restoreFromImport(data)).toEqual({ status: 'done', noBackup: false })
    expect(await titles()).toEqual(['Imported'])
    const [backup] = await db.backups.toArray()
    expect(backup?.trigger).toBe('pre-destructive')
    expect(backup?.data).toContain('Current')
  })

  it('failed snapshot + Cancel leaves the current data untouched', async () => {
    const data = await importData()
    failSnapshots()
    const pending = restoreFromImport(data)
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await titles()).toEqual(['Current'])
  })

  it('failed snapshot + Continue imports without a backup', async () => {
    const data = await importData()
    failSnapshots()
    const pending = restoreFromImport(data)
    await answerBackupPrompt(true)
    expect(await pending).toEqual({ status: 'done', noBackup: true })
    expect(await titles()).toEqual(['Imported'])
  })
})

describe('onDataReplaced', () => {
  async function importedBack(): Promise<void> {
    const prepared = prepareImportText(JSON.stringify(await buildExportData()))
    if (!prepared.ok) throw new Error(prepared.error)
    await restoreFromImport(prepared.data)
  }

  it('every listener hears each replace, in turn, with its source, once the stores have reloaded', async () => {
    await db.todos.add(makeTodo({ id: 5, title: 'In the file' }))
    const heard: string[] = []
    const offs = [
      onDataReplaced((source) => { heard.push(`first ${source} ${useTodoStore.getState().todos.map((t) => t.title).join()}`) }),
      onDataReplaced(async (source) => { heard.push(`second ${source}`) }),
    ]
    await importedBack()
    for (const off of offs) off()
    expect(heard).toEqual(['first import In the file', 'second import'])
  })

  it('a listener that fails does not stop the next one; the replace rejects with its error', async () => {
    const second = vi.fn()
    const offs = [onDataReplaced(() => { throw new Error('listener failed') }), onDataReplaced(second)]
    await expect(importedBack()).rejects.toThrow('listener failed')
    for (const off of offs) off()
    expect(second).toHaveBeenCalledWith('import')
  })

  it('an unsubscribed listener no longer hears', async () => {
    const listener = vi.fn()
    onDataReplaced(listener)()
    await importedBack()
    expect(listener).not.toHaveBeenCalled()
  })

  it('a cancelled replace tells no listener', async () => {
    failSnapshots()
    const listener = vi.fn()
    const off = onDataReplaced(listener)
    const pending = restoreFromImport({} as never)
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    off()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('append import through the replace', () => {
  function archive() {
    const now = new Date().toISOString()
    const prepared = prepareImport({
      [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
      kind: 'task-archive',
      todos: [{ id: 1, uid: 'a-1', title: 'Archived', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
    }, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    return prepared.data
  }

  it('adds nothing it replaces: the undo history and the selection stay, the tasks reload, listeners hear it', async () => {
    await db.todos.add(makeTodo({ id: 2, title: 'Current' }))
    await useTodoStore.getState().loadAll()
    useUndoStore.getState().push({ description: 'Earlier edit', undo: () => {}, redo: () => {} })
    useUIStore.getState().selectOneTodo(2)
    const heard = vi.fn()
    const off = onDataReplaced(heard)

    expect(await runAppendImport(archive(), new Map())).toMatchObject({ status: 'done', imported: 1, noBackup: false })
    off()

    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Earlier edit'])
    expect([...useUIStore.getState().selectedTodoIds]).toEqual([2])
    expect(useTodoStore.getState().todos.map((t) => t.title).sort()).toEqual(['Archived', 'Current'])
    expect(heard).toHaveBeenCalledWith('append-import')
  })
})
