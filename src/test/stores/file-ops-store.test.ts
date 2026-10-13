import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { backupScheduler } from '../../services/backup-scheduler'
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
