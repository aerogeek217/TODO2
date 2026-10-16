import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { backupScheduler } from '../../data/backup-scheduler'
import { prepareImportText } from '../../data/import-pipeline'
import { useFileOpsStore } from '../../stores/file-ops-store'
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
    expect(await useFileOpsStore.getState().restoreBackup(id)).toEqual({ status: 'done', noBackup: false })
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
    await useFileOpsStore.getState().restoreBackup(id)
    const preOp = (await db.backups.toArray()).find((b) => b.trigger === 'pre-destructive')!
    expect(await useFileOpsStore.getState().restoreBackup(preOp.id!)).toMatchObject({ status: 'done' })
    expect(await titles()).toEqual(['Current'])
  })

  it('restores the oldest backup even when the new snapshot prunes it', async () => {
    const oldest = await backupOf('Oldest')
    for (let i = 0; i < 9; i++) await backupRepository.createSnapshot('auto')
    expect(await db.backups.count()).toBe(10)
    expect(await useFileOpsStore.getState().restoreBackup(oldest)).toMatchObject({ status: 'done' })
    expect(await titles()).toEqual(['Oldest'])
  })

  it('failed snapshot + Cancel leaves the current data untouched', async () => {
    const id = await backupOf('From backup')
    failSnapshots()
    const pending = useFileOpsStore.getState().restoreBackup(id)
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await titles()).toEqual(['Current'])
  })

  it('failed snapshot + Continue restores without a backup and says so', async () => {
    const id = await backupOf('From backup')
    failSnapshots()
    const pending = useFileOpsStore.getState().restoreBackup(id)
    await answerBackupPrompt(true)
    expect(await pending).toEqual({ status: 'done', noBackup: true })
    expect(await titles()).toEqual(['From backup'])
    expect(useFileOpsStore.getState().snapshotWarning).toMatch(/^No backup was taken before restoring the backup/)
  })

  it('a missing or unreadable backup is an error, with no snapshot taken', async () => {
    const spy = vi.spyOn(backupScheduler, 'snapshotBeforeDestructive')
    expect(await useFileOpsStore.getState().restoreBackup(9999)).toEqual({ status: 'error', error: 'Backup not found' })
    const id = await db.backups.add({ createdAt: new Date().toISOString(), trigger: 'auto', sizeBytes: 5, data: 'NOT_JSON{{{' }) as number
    const result = await useFileOpsStore.getState().restoreBackup(id)
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
    expect(await useFileOpsStore.getState().restoreFromImport(data)).toEqual({ status: 'done', noBackup: false })
    expect(await titles()).toEqual(['Imported'])
    const [backup] = await db.backups.toArray()
    expect(backup?.trigger).toBe('pre-destructive')
    expect(backup?.data).toContain('Current')
  })

  it('failed snapshot + Cancel leaves the current data untouched', async () => {
    const data = await importData()
    failSnapshots()
    const pending = useFileOpsStore.getState().restoreFromImport(data)
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await titles()).toEqual(['Current'])
  })

  it('failed snapshot + Continue imports without a backup', async () => {
    const data = await importData()
    failSnapshots()
    const pending = useFileOpsStore.getState().restoreFromImport(data)
    await answerBackupPrompt(true)
    expect(await pending).toEqual({ status: 'done', noBackup: true })
    expect(await titles()).toEqual(['Imported'])
  })
})

describe('loadBackups', () => {
  it('a read that resolves after a later one does not put back the older list', async () => {
    const older: Array<(rows: never[]) => void> = []
    const list = vi.spyOn(backupRepository, 'listSnapshots')
    list.mockImplementationOnce(() => new Promise((resolve) => { older.push(resolve) }))
    const first = useFileOpsStore.getState().loadBackups()
    await backupRepository.createSnapshot('manual')
    await useFileOpsStore.getState().loadBackups()
    expect(useFileOpsStore.getState().backups).toHaveLength(1)
    older[0]!([])
    await first
    expect(useFileOpsStore.getState().backups).toHaveLength(1)
  })
})
