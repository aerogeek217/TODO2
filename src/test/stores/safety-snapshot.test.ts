import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { backupScheduler } from '../../data/backup-scheduler'
import { takeSafetySnapshot } from '../../stores/safety-snapshot'
import { runAppendImport } from '../../services/append-import'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { useUIStore } from '../../stores/ui-store'
import { useFileOpsStore } from '../../stores/file-ops-store'
import { cleanupCurrentAudit } from '../../services/replace-data'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.getState().clear()
  useUndoStore.setState(useUndoStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  usePersonStore.setState(usePersonStore.getInitialState(), true)
  useTagStore.setState(useTagStore.getInitialState(), true)
  useStatusStore.setState(useStatusStore.getInitialState(), true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Makes the next pre-destructive snapshots fail, as when storage is full. */
function failSnapshots() {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
}

/** Waits for the "Continue without a backup?" prompt, then answers it. */
async function answerBackupPrompt(proceed: boolean) {
  await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
  expect(useUIStore.getState().confirmPrompts[0]?.title).toBe('Continue without a backup?')
  useUIStore.getState().answerConfirmation(proceed)
}

async function addTasks(n: number): Promise<number[]> {
  const ids: number[] = []
  for (let i = 0; i < n; i++) ids.push(await useTodoStore.getState().add(`Task ${i + 1}`))
  return ids
}

describe('takeSafetySnapshot', () => {
  it('stores a pre-destructive snapshot and asks nothing', async () => {
    expect(await takeSafetySnapshot('deleting 3 tasks')).toBe('taken')
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect((await db.backups.toArray()).map((b) => b.trigger)).toEqual(['pre-destructive'])
  })

  it('a failed snapshot asks "Continue without a backup?" with Cancel as the default', async () => {
    failSnapshots()
    const pending = takeSafetySnapshot('deleting 3 tasks')
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    const prompt = useUIStore.getState().confirmPrompts[0]!
    expect(prompt).toMatchObject({
      title: 'Continue without a backup?',
      confirmLabel: 'Continue',
      danger: true,
      cancelIsDefault: true,
    })
    expect(prompt.message).toContain('before deleting 3 tasks')
    // True on every platform: names no Settings section (a phone has no Backups section).
    expect(prompt.message).toContain('Browser storage may be full.')
    expect(prompt.message).not.toContain('Settings')
    useUIStore.getState().answerConfirmation(false)
    expect(await pending).toBe('cancelled')
    expect(useFileOpsStore.getState().snapshotWarning).toBeNull()
  })

  it('Continue goes ahead and leaves a warning until dismissed', async () => {
    failSnapshots()
    const pending = takeSafetySnapshot('deleting 3 tasks')
    await answerBackupPrompt(true)
    expect(await pending).toBe('without-backup')
    expect(useFileOpsStore.getState().snapshotWarning).toMatch(/^No backup was taken before deleting 3 tasks/)
  })

  it('two failures queue two questions, answered in order', async () => {
    failSnapshots()
    const first = takeSafetySnapshot('one')
    const second = takeSafetySnapshot('two')
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(2))
    useUIStore.getState().answerConfirmation(false)
    useUIStore.getState().answerConfirmation(true)
    expect(await first).toBe('cancelled')
    expect(await second).toBe('without-backup')
  })
})

describe('bulk delete', () => {
  it('backs up before deleting more than five tasks', async () => {
    const ids = await addTasks(6)
    await useTodoStore.getState().bulkRemove(ids)
    expect(await db.todos.count()).toBe(0)
    const [backup] = await db.backups.toArray()
    expect(backup?.trigger).toBe('pre-destructive')
    expect(backup?.data).toContain('Task 6')
  })

  it('failed backup + Cancel deletes nothing and never calls beforeDelete (the selection stays)', async () => {
    const ids = await addTasks(6)
    failSnapshots()
    const beforeDelete = vi.fn()
    const pending = useTodoStore.getState().bulkRemove(ids, { beforeDelete })
    await answerBackupPrompt(false)
    await pending
    expect(beforeDelete).not.toHaveBeenCalled()
    expect(await db.todos.count()).toBe(6)
    expect(useTodoStore.getState().todos).toHaveLength(6)
    expect(useUndoStore.getState().undoStack).toHaveLength(6) // the adds only
  })

  it('failed backup + Continue deletes, and the undo snackbar says no backup was taken', async () => {
    const ids = await addTasks(6)
    failSnapshots()
    let countAtBeforeDelete = -1
    const beforeDelete = vi.fn(() => { countAtBeforeDelete = useTodoStore.getState().todos.length })
    const pending = useTodoStore.getState().bulkRemove(ids, { beforeDelete })
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    expect(beforeDelete).not.toHaveBeenCalled()
    useUIStore.getState().answerConfirmation(true)
    await pending
    expect(beforeDelete).toHaveBeenCalledTimes(1)
    expect(countAtBeforeDelete).toBe(6)
    // Undo restores; redo deletes again without asking or calling beforeDelete.
    await useUndoStore.getState().undo()
    expect(await db.todos.count()).toBe(6)
    await useUndoStore.getState().redo()
    expect(await db.todos.count()).toBe(0)
    expect(beforeDelete).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(await db.todos.count()).toBe(0)
    expect(useUndoStore.getState().snackbar?.description).toBe('Delete 6 tasks — no backup was taken')
  })

  it('redo after undo does not ask again', async () => {
    const ids = await addTasks(6)
    await useTodoStore.getState().bulkRemove(ids)
    await useUndoStore.getState().undo()
    expect(await db.todos.count()).toBe(6)
    const spy = failSnapshots()
    await useUndoStore.getState().redo()
    expect(spy).not.toHaveBeenCalled()
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(await db.todos.count()).toBe(0)
  })

  it('five tasks or fewer take no backup; beforeDelete runs straight away', async () => {
    const ids = await addTasks(5)
    const spy = vi.spyOn(backupScheduler, 'snapshotBeforeDestructive')
    const beforeDelete = vi.fn()
    const pending = useTodoStore.getState().bulkRemove(ids, { beforeDelete })
    expect(beforeDelete).toHaveBeenCalledTimes(1)
    await pending
    expect(spy).not.toHaveBeenCalled()
    expect(await db.todos.count()).toBe(0)
  })
})

describe('purgeCompleted', () => {
  async function completedTasks(n: number): Promise<number[]> {
    const ids = await addTasks(n)
    await useTodoStore.getState().bulkSetCompleted(ids, true)
    return ids
  }

  it('failed backup + Cancel deletes nothing', async () => {
    const ids = await completedTasks(2)
    failSnapshots()
    const pending = useTodoStore.getState().purgeCompleted(ids)
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await db.todos.count()).toBe(2)
  })

  it('failed backup + Continue deletes and reports it', async () => {
    const ids = await completedTasks(2)
    failSnapshots()
    const pending = useTodoStore.getState().purgeCompleted(ids)
    await answerBackupPrompt(true)
    expect(await pending).toEqual({ status: 'done', deleted: 2, noBackup: true })
    expect(await db.todos.count()).toBe(0)
  })

  it('a task reopened while the question is open survives', async () => {
    const ids = await completedTasks(2)
    failSnapshots()
    const pending = useTodoStore.getState().purgeCompleted(ids)
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    await useTodoStore.getState().toggleComplete(ids[0]!)
    useUIStore.getState().answerConfirmation(true)
    expect(await pending).toEqual({ status: 'done', deleted: 1, noBackup: true })
    expect((await db.todos.toArray()).map((t) => t.id)).toEqual([ids[0]])
  })

  it('nothing to delete → no backup, no question', async () => {
    const ids = await addTasks(1)
    const spy = vi.spyOn(backupScheduler, 'snapshotBeforeDestructive')
    expect(await useTodoStore.getState().purgeCompleted(ids)).toEqual({ status: 'done', deleted: 0, noBackup: false })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('append import', () => {
  function archive() {
    const now = new Date().toISOString()
    const prepared = prepareImport({
      [SCHEMA_VERSION_KEY]: 51,
      kind: 'task-archive',
      todos: [{ id: 1, uid: 'a-1', title: 'Archived', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
    }, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    return prepared.data
  }

  it('failed backup + Cancel imports nothing', async () => {
    failSnapshots()
    const pending = runAppendImport(archive(), new Map())
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await db.todos.count()).toBe(0)
  })

  it('failed backup + Continue imports and reports it', async () => {
    failSnapshots()
    const pending = runAppendImport(archive(), new Map())
    await answerBackupPrompt(true)
    expect(await pending).toMatchObject({ status: 'done', imported: 1, noBackup: true })
    expect(await db.todos.count()).toBe(1)
  })
})

describe('audit cleanup', () => {
  /** An orphaned person join (its task is gone), scanned into the report. */
  async function scanOrphan() {
    const personId = await db.people.add({ name: 'Ann', initials: 'A' }) as number
    await db.todoPeople.add({ todoId: 999, personId })
    await useFileOpsStore.getState().runAudit()
    expect(useFileOpsStore.getState().auditReport?.totalOrphans).toBe(1)
  }

  it('backs up the database before it deletes anything', async () => {
    await scanOrphan()
    expect(await cleanupCurrentAudit()).toEqual({ status: 'done', cleaned: 1, noBackup: false })
    const backups = await db.backups.toArray()
    expect(backups.map((b) => b.trigger)).toEqual(['pre-destructive'])
    // The backup holds the row the cleanup deleted.
    expect(JSON.parse(backups[0]!.data).todoPeople).toHaveLength(1)
    expect(await db.todoPeople.count()).toBe(0)
  })

  it('failed backup + Cancel cleans nothing and keeps the report', async () => {
    await scanOrphan()
    failSnapshots()
    const pending = cleanupCurrentAudit()
    await answerBackupPrompt(false)
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(await db.todoPeople.count()).toBe(1)
    expect(useFileOpsStore.getState().auditReport?.totalOrphans).toBe(1)
  })

  it('failed backup + Continue cleans and reports it', async () => {
    await scanOrphan()
    failSnapshots()
    const pending = cleanupCurrentAudit()
    await answerBackupPrompt(true)
    expect(await pending).toEqual({ status: 'done', cleaned: 1, noBackup: true })
    expect(await db.todoPeople.count()).toBe(0)
  })
})
