import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { TASK_ARCHIVE_KIND, prepareImportText } from '../../data/import-pipeline'
import { appendImportTasks } from '../../data/append-import'
import { buildTaskArchive, selfCheckTaskArchiveJson, taskArchiveFileName } from '../../services/task-archive'
import { exportAndPurgeCompleted, listExpiredCompleted } from '../../services/purge-completed'
import { saveTextFile } from '../../services/save-file'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { resetDb } from '../helpers'

vi.mock('../../services/save-file', () => ({ saveTextFile: vi.fn() }))

const saveMock = vi.mocked(saveTextFile)

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

/**
 * Two completed-long-ago tasks (one fully attached) and one open task, with
 * people / tags / statuses only some of which they use.
 */
async function seed() {
  const now = new Date()
  const alice = await db.people.add({ name: 'Alice', initials: 'AL' }) as number
  const bob = await db.people.add({ name: 'Bob', initials: 'BO' }) as number
  const urgent = await db.tags.add({ name: 'urgent', color: '#ff0000' }) as number
  const misc = await db.tags.add({ name: 'misc', color: '#00ff00' }) as number
  const waiting = await db.statuses.add({ name: 'Waiting', color: '#ffaa00', sortOrder: 50, icon: 'clock' }) as number
  const other = await db.statuses.add({ name: 'Other', color: '#aaaaaa', sortOrder: 51 }) as number

  const oldDone = await todoRepository.insert({
    title: 'Old done', notes: 'n', isCompleted: true, completedAt: daysAgo(90),
    createdAt: daysAgo(120), modifiedAt: daysAgo(1), sortOrder: 1, statusId: waiting,
    dueDate: daysAgo(100),
  })
  const oldBare = await todoRepository.insert({
    title: 'Old bare', isCompleted: true, completedAt: daysAgo(80), createdAt: daysAgo(90), modifiedAt: daysAgo(80), sortOrder: 2,
  })
  const open = await todoRepository.insert({
    title: 'Open task', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 3, statusId: other,
  })
  await db.todoPeople.bulkAdd([{ todoId: oldDone, personId: alice }, { todoId: open, personId: bob }])
  await db.todoTags.bulkAdd([{ todoId: oldDone, tagId: urgent }, { todoId: open, tagId: misc }])
  await db.todoEvents.add({ todoId: oldDone, type: 'completed', fromValue: null, toValue: null, timestamp: daysAgo(90).toISOString() })
  await useTodoStore.getState().loadAll()
  return { alice, bob, urgent, misc, waiting, other, oldDone, oldBare, open }
}

beforeEach(async () => {
  await resetDb()
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
  useUIStore.setState(useUIStore.getInitialState(), true)
  saveMock.mockReset()
})

describe('buildTaskArchive', () => {
  it('carries the tasks, their joins + history, and only the referenced entities', async () => {
    const s = await seed()
    const archive = await buildTaskArchive([s.oldDone, s.oldBare])

    expect(archive[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(archive.kind).toBe(TASK_ARCHIVE_KIND)
    expect(typeof archive.exportedAt).toBe('string')
    expect(archive.todos.map((t) => t.title)).toEqual(['Old done', 'Old bare'])
    expect(archive.todoPeople).toEqual([expect.objectContaining({ todoId: s.oldDone, personId: s.alice })])
    expect(archive.todoTags).toEqual([expect.objectContaining({ todoId: s.oldDone, tagId: s.urgent })])
    expect(archive.people.map((p) => p.name)).toEqual(['Alice'])
    expect(archive.tags.map((t) => t.name)).toEqual(['urgent'])
    expect(archive).not.toHaveProperty('orgs')
    expect(archive.statuses.map((x) => x.name)).toEqual(['Waiting'])
    // Projects are tags now: an archive carries no projects table.
    expect(archive).not.toHaveProperty('projects')
    // insert() logs 'created' for both; plus the explicit 'completed' event.
    expect(archive.todoEvents.every((e) => e.todoId === s.oldDone || e.todoId === s.oldBare)).toBe(true)
    expect(archive.todoEvents.filter((e) => e.type === 'completed')).toHaveLength(1)
    expect(archive.todoEvents.filter((e) => e.type === 'created')).toHaveLength(2)
    // No full-database tables.
    expect(archive).not.toHaveProperty('settings')
    expect(archive).not.toHaveProperty('listDefinitions')
  })

  it('skips ids that no longer exist', async () => {
    const s = await seed()
    const archive = await buildTaskArchive([s.oldBare, 9999])
    expect(archive.todos.map((t) => t.title)).toEqual(['Old bare'])
  })

  it('serializes to a file that passes the append-import pipeline (and only that)', async () => {
    const s = await seed()
    const json = JSON.stringify(await buildTaskArchive([s.oldDone]))
    expect(selfCheckTaskArchiveJson(json)).toBeNull()
    const prepared = prepareImportText(json, { purpose: 'append' })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.kind).toBe('task-archive')
    expect(prepared.data.todos[0]?.completedAt).toBeInstanceOf(Date)
    expect(prepareImportText(json)).toMatchObject({ ok: false, reason: 'task-archive' })
  })

  it('a 1,000-character title (and person name) passes the archive self-check and the append import', async () => {
    const title = `title ${'t'.repeat(994)}`
    const name = `person ${'p'.repeat(993)}`
    const person = await db.people.add({ name, initials: 'PP' }) as number
    const id = await todoRepository.insert({
      title, isCompleted: true, completedAt: daysAgo(90), createdAt: daysAgo(100), modifiedAt: daysAgo(90), sortOrder: 1,
    })
    await db.todoPeople.add({ todoId: id, personId: person })
    const json = JSON.stringify(await buildTaskArchive([id]))
    expect(selfCheckTaskArchiveJson(json)).toBeNull()

    await resetDb()
    const prepared = prepareImportText(json, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    await appendImportTasks(prepared.data, new Map())
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual([title])
    expect((await db.people.toArray()).map((p) => p.name)).toEqual([name])
  })

  it('names the file todo2-archive-<timestamp>.json', () => {
    expect(taskArchiveFileName(new Date('2026-10-10T12:34:56.789Z'))).toBe('todo2-archive-2026-10-10_12-34-56-789.json')
  })
})

describe('purgeCompleted', () => {
  it('deletes only the given ids that are still completed, with their join rows', async () => {
    const s = await seed()
    const outcome = await useTodoStore.getState().purgeCompleted([s.oldDone, s.open])
    expect(outcome).toEqual({ status: 'done', deleted: 1, noBackup: false })
    expect(await db.todos.get(s.oldDone)).toBeUndefined()
    expect(await db.todos.get(s.open)).toBeDefined()
    expect(await db.todoPeople.where('todoId').equals(s.oldDone).count()).toBe(0)
    expect(useTodoStore.getState().todos.map((t) => t.id).sort()).toEqual([s.oldBare, s.open].sort())
  })

  it('takes a pre-destructive backup snapshot first', async () => {
    const s = await seed()
    await useTodoStore.getState().purgeCompleted([s.oldBare])
    const backups = await db.backups.toArray()
    expect(backups.some((b) => b.trigger === 'pre-destructive' && b.data.includes('Old bare'))).toBe(true)
  })
})

describe('exportAndPurgeCompleted', () => {
  it('cancelling the save picker deletes nothing', async () => {
    const s = await seed()
    saveMock.mockResolvedValue('cancelled')
    const result = await exportAndPurgeCompleted([s.oldDone, s.oldBare])
    expect(result).toEqual({ status: 'cancelled' })
    expect(await db.todos.count()).toBe(3)
  })

  it('saves the archive, then deletes exactly the archived tasks', async () => {
    const s = await seed()
    saveMock.mockResolvedValue('saved')
    const result = await exportAndPurgeCompleted([s.oldDone, s.oldBare])
    expect(result).toMatchObject({ status: 'done', deleted: 2, saved: 'saved' })
    expect(saveMock).toHaveBeenCalledTimes(1)
    const [opts] = saveMock.mock.calls[0] ?? []
    expect(opts?.suggestedName).toMatch(/^todo2-archive-.*\.json$/)
    const written = JSON.parse(opts?.text ?? '{}') as { kind: string; todos: Array<{ title: string }> }
    expect(written.kind).toBe(TASK_ARCHIVE_KIND)
    expect(written.todos.map((t) => t.title).sort()).toEqual(['Old bare', 'Old done'])
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual(['Open task'])
  })

  it('a download fallback asks "Did the file save?" first; Cancel (the default) deletes nothing', async () => {
    const s = await seed()
    saveMock.mockResolvedValue('downloaded')
    const pending = exportAndPurgeCompleted([s.oldBare])
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    const prompt = useUIStore.getState().confirmPrompts[0]!
    expect(prompt).toMatchObject({ title: 'Did the file save?', confirmLabel: 'Delete 1 task', cancelIsDefault: true })
    useUIStore.getState().answerConfirmation(false)
    const result = await pending
    expect(result).toMatchObject({ status: 'kept', reason: 'unconfirmed' })
    expect(await db.todos.get(s.oldBare)).toBeDefined()
    expect(await db.backups.count()).toBe(0)
  })

  it('a download fallback deletes once the user confirms the file saved', async () => {
    const s = await seed()
    saveMock.mockResolvedValue('downloaded')
    const pending = exportAndPurgeCompleted([s.oldBare])
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    useUIStore.getState().answerConfirmation(true)
    expect(await pending).toMatchObject({ status: 'done', deleted: 1, saved: 'downloaded', noBackup: false })
    expect(await db.todos.get(s.oldBare)).toBeUndefined()
  })

  it('a picker save needs no confirmation', async () => {
    const s = await seed()
    saveMock.mockResolvedValue('saved')
    await exportAndPurgeCompleted([s.oldBare])
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
  })

  it('an archive that would not re-import is neither saved nor followed by a delete', async () => {
    const s = await seed()
    // Corrupt the row behind validation's back (an empty title fails checkTodo).
    await db.todos.update(s.oldDone, { title: '' })
    const result = await exportAndPurgeCompleted([s.oldDone])
    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toContain('Nothing was deleted')
    expect(saveMock).not.toHaveBeenCalled()
    expect(await db.todos.get(s.oldDone)).toBeDefined()
  })
})

describe('reads the database, not the todo store (which may not hold every task)', () => {
  it('purgeCompleted deletes a listed completed task the store does not hold', async () => {
    const s = await seed()
    useTodoStore.setState({ todos: useTodoStore.getState().todos.filter((t) => t.id !== s.oldBare) })
    expect(await useTodoStore.getState().purgeCompleted([s.oldBare])).toMatchObject({ status: 'done', deleted: 1 })
    expect(await db.todos.get(s.oldBare)).toBeUndefined()
  })

  it('listExpiredCompleted finds every expired task, optionally only the given uids', async () => {
    const s = await seed()
    useTodoStore.setState({ todos: [] })
    expect((await listExpiredCompleted(30)).map((t) => t.title).sort()).toEqual(['Old bare', 'Old done'])
    const bareUid = (await db.todos.get(s.oldBare))!.uid
    expect((await listExpiredCompleted(30, new Set([bareUid]))).map((t) => t.title)).toEqual(['Old bare'])
    expect(await listExpiredCompleted(100)).toEqual([])
  })
})
