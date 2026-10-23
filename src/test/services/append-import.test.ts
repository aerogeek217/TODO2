import { describe, it, expect, beforeEach } from 'vitest'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { prepareImport, prepareImportText, TASK_ARCHIVE_KIND } from '../../data/import-pipeline'
import type { ImportData } from '../../data/import-validation'
import { appendImportTasks } from '../../data/append-import'
import { buildTaskArchive } from '../../services/task-archive'
import { defaultAppendChoices, findAppendDuplicates, runAppendImport } from '../../services/append-import'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { buildExportData, selfCheckExportJson } from '../../data/export-data'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { makeTodo, resetDb, resetEntityStores } from '../helpers'

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

/** "Machine A": a completed task with every kind of reference, archived to JSON. */
async function archiveFromSourceDb(): Promise<{ json: string; sourceTodoId: number; sourceUid: string }> {
  const personId = await db.people.add({ name: 'Alice', initials: 'AL' }) as number
  const tagId = await db.tags.add({ name: 'urgent', color: '#ff0000' }) as number
  const statusId = await db.statuses.add({ name: 'Waiting', color: '#ffaa00', sortOrder: 9, icon: 'clock' }) as number
  const id = await todoRepository.insert({
    title: 'Ship release', notes: 'notes', isCompleted: true, completedAt: daysAgo(60),
    createdAt: daysAgo(90), modifiedAt: daysAgo(60), sortOrder: 1, statusId, dueDate: daysAgo(70),
    focus: true,
  })
  await db.todoPeople.add({ todoId: id, personId })
  await db.todoTags.add({ todoId: id, tagId })
  await db.todoEvents.bulkAdd([
    { todoId: id, type: 'status', fromValue: null, toValue: statusId, timestamp: daysAgo(65).toISOString() },
    { todoId: id, type: 'completed', fromValue: null, toValue: null, timestamp: daysAgo(60).toISOString() },
  ])
  const archive = await buildTaskArchive([id])
  const uid = archive.todos[0]?.uid ?? ''
  return { json: JSON.stringify(archive), sourceTodoId: id, sourceUid: uid }
}

function prepareAppend(json: string): ImportData {
  const prepared = prepareImportText(json, { purpose: 'append' })
  if (!prepared.ok) throw new Error(prepared.error)
  return prepared.data
}

beforeEach(async () => {
  await resetDb()
  useTodoStore.setState({ todos: [], todosVersion: 0 })
  resetEntityStores({ todos: false })
})

describe('findAppendDuplicates', () => {
  const existing = [
    makeTodo({ id: 1, uid: 'u-done', title: 'Old thing', isCompleted: true }),
    makeTodo({ id: 2, uid: 'u-open', title: 'Write report', isCompleted: false }),
  ]

  it('matches by uid against any task, completed or not', () => {
    const [c] = findAppendDuplicates([makeTodo({ uid: 'u-done', title: 'Renamed' })], existing)
    expect(c?.duplicate).toMatchObject({ reason: 'uid', existing: { id: 1 } })
  })

  it('matches by trimmed, case-insensitive title against active tasks only', () => {
    const cands = findAppendDuplicates([
      makeTodo({ uid: 'n1', title: '  write REPORT ' }),
      makeTodo({ uid: 'n2', title: 'old thing' }), // only a completed task has this title
      makeTodo({ uid: 'n3', title: 'Brand new' }),
    ], existing)
    expect(cands.map((c) => c.duplicate?.reason ?? null)).toEqual(['title', null, null])
    expect(cands[0]?.duplicate?.existing.id).toBe(2)
  })

  it('prefers the uid match over a title match', () => {
    const [c] = findAppendDuplicates([makeTodo({ uid: 'u-done', title: 'Write report' })], existing)
    expect(c?.duplicate?.reason).toBe('uid')
  })

  it('defaults duplicates to skip and the rest to import', () => {
    const cands = findAppendDuplicates([makeTodo({ uid: 'u-open' }), makeTodo({ uid: 'fresh', title: 'Fresh' })], existing)
    expect([...defaultAppendChoices(cands)]).toEqual([['u-open', 'skip'], ['fresh', 'import']])
  })
})

describe('appendImportTasks — archive from another database', () => {
  it('assigns new ids, keeps the uid, resolves names case-insensitively and creates missing entities', async () => {
    const { json, sourceTodoId, sourceUid } = await archiveFromSourceDb()

    // "Machine B": a different DB whose ids overlap the source's.
    await resetDb()
    const now = new Date()
    const existingId = await todoRepository.insert({ title: 'Already here', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 5 })
    expect(existingId).toBe(sourceTodoId) // same id on both machines — must not collide
    const alice = await db.people.add({ name: 'ALICE ', initials: 'A' }) as number
    const waiting = await db.statuses.add({ name: 'waiting', color: '#000000', sortOrder: 1 }) as number
    const peopleBefore = await db.people.count()

    const data = prepareAppend(json)
    const cands = findAppendDuplicates(data.todos, await todoRepository.getAll())
    expect(cands.every((c) => c.duplicate === null)).toBe(true)
    const result = await appendImportTasks(data, defaultAppendChoices(cands))

    expect(result).toMatchObject({ imported: 1, skipped: 0 })
    expect(result.created).toEqual({ people: [], tags: ['urgent'], statuses: [] })
    const [newId] = result.todoIds
    expect(newId).toBeDefined()
    expect(newId).not.toBe(existingId)
    expect((await db.todos.get(existingId))?.title).toBe('Already here')

    const row = await db.todos.get(newId!)
    expect(row).toMatchObject({
      title: 'Ship release', notes: 'notes', uid: sourceUid, isCompleted: true,
      statusId: waiting, focus: true,
    })
    expect('projectId' in row! || 'canvasId' in row!).toBe(false)
    expect(row?.completedAt).toBeInstanceOf(Date)
    expect(row?.dueDate).toBeInstanceOf(Date)
    expect(row!.sortOrder).toBeGreaterThan(5)

    expect(await db.people.count()).toBe(peopleBefore)
    expect((await db.todoPeople.where('todoId').equals(newId!).toArray()).map((r) => r.personId)).toEqual([alice])
    const tag = await db.tags.where('name').equals('urgent').first()
    expect((await db.todoTags.where('todoId').equals(newId!).toArray()).map((r) => r.tagId)).toEqual([tag?.id])

    // History re-pointed at the new id; status values at the resolved status.
    const events = await db.todoEvents.where('todoId').equals(newId!).toArray()
    expect(events.map((e) => e.type).sort()).toEqual(['completed', 'created', 'status'])
    expect(events.find((e) => e.type === 'status')?.toValue).toBe(waiting)
  })
})

describe('appendImportTasks — person emails', () => {
  it('matches people by name only: a match keeps its own email, a created person brings the archived one', async () => {
    const alice = await db.people.add({ name: 'Alice', initials: 'AL', email: 'alice@source.example' }) as number
    const bob = await db.people.add({ name: 'Bob', initials: 'BO', email: 'bob@source.example' }) as number
    const now = new Date()
    const id = await todoRepository.insert({ title: 'Shared task', isCompleted: true, completedAt: now, createdAt: now, modifiedAt: now, sortOrder: 1 })
    await db.todoPeople.bulkAdd([{ todoId: id, personId: alice }, { todoId: id, personId: bob }])
    const json = JSON.stringify(await buildTaskArchive([id]))

    await resetDb()
    const target = await db.people.add({ name: 'alice', initials: 'A' }) as number
    const data = prepareAppend(json)
    const result = await appendImportTasks(data, defaultAppendChoices(findAppendDuplicates(data.todos, [])))

    expect(result.created.people).toEqual(['Bob'])
    expect(await db.people.get(target)).toEqual({ id: target, name: 'alice', initials: 'A' })
    expect(await db.people.where('name').equals('Bob').first()).toMatchObject({ initials: 'BO', email: 'bob@source.example' })
  })
})

describe('appendImportTasks — blank names', () => {
  it('a person / tag / status named only spaces is created as named, so every export still imports', async () => {
    const now = new Date().toISOString()
    const data = prepareAppend(JSON.stringify({
      [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
      kind: TASK_ARCHIVE_KIND,
      todos: [{ id: 1, uid: 'blank-1', title: 'Task', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1, statusId: 1 }],
      people: [{ id: 1, name: '   ', initials: 'X' }],
      todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
      tags: [{ id: 1, name: '  ', color: '#112233' }],
      todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      statuses: [{ id: 1, name: ' ', color: '#445566', sortOrder: 1 }],
    }))
    const result = await appendImportTasks(data, defaultAppendChoices(findAppendDuplicates(data.todos, [])))
    expect(result.todoIds).toHaveLength(1)
    expect((await db.people.toArray()).map((p) => p.name)).toEqual(['   '])
    expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['  '])
    expect((await db.statuses.toArray()).map((s) => s.name)).toEqual([' '])
    expect(selfCheckExportJson(JSON.stringify(await buildExportData()))).toBeNull()
  })
})

describe('appendImportTasks — duplicates in the same database', () => {
  it('honors Skip / Import as new and mints a fresh uid on a uid collision', async () => {
    const now = new Date()
    const a = await todoRepository.insert({ title: 'Alpha', isCompleted: true, completedAt: daysAgo(40), createdAt: now, modifiedAt: now, sortOrder: 1 })
    const b = await todoRepository.insert({ title: 'Beta', isCompleted: true, completedAt: daysAgo(40), createdAt: now, modifiedAt: now, sortOrder: 2 })
    await todoRepository.insert({ title: 'beta', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 3 })
    const archive = await buildTaskArchive([a, b])
    const uidA = archive.todos[0]!.uid
    const uidB = archive.todos[1]!.uid
    // Re-import the archive into the same DB: Alpha matches by uid, Beta by uid too.
    const data = prepareAppend(JSON.stringify(archive))
    const cands = findAppendDuplicates(data.todos, await todoRepository.getAll())
    expect(cands.map((c) => c.duplicate?.reason)).toEqual(['uid', 'uid'])

    const choices = defaultAppendChoices(cands)
    choices.set(uidA, 'import') // "Import as new"
    const result = await appendImportTasks(data, choices)
    expect(result).toMatchObject({ imported: 1, skipped: 1 })

    const copy = await db.todos.get(result.todoIds[0]!)
    expect(copy?.title).toBe('Alpha')
    expect(copy?.uid).not.toBe(uidA)
    expect(copy?.uid).toMatch(/^[0-9a-f-]{36}$/)
    expect((await db.todos.where('uid').equals(uidA).count())).toBe(1)
    expect(await db.todos.where('uid').equals(uidB).count()).toBe(1)
    expect(await db.todos.count()).toBe(4)
  })

  it('a full export is accepted too and appends its todos', async () => {
    const now = new Date()
    const raw = {
      [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
      settings: [{ key: 'themeMode', value: 'dark' }],
      todos: [{ id: 7, uid: 'full-1', title: 'From full export', isCompleted: false, createdAt: now.toISOString(), modifiedAt: now.toISOString(), sortOrder: 0 }],
    }
    const prepared = prepareImport(raw, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.kind).toBe('full')
    const result = await appendImportTasks(prepared.data, new Map())
    expect((await db.todos.get(result.todoIds[0]!))).toMatchObject({ uid: 'full-1', title: 'From full export' })
    // Only tasks are appended: the export's settings stay out.
    expect(await db.settings.get('themeMode')).toBeUndefined()
  })
})

describe('append import of an archive below the floor', () => {
  it('is refused before anything is read from it: nothing appended', async () => {
    const now = new Date().toISOString()
    const raw = {
      [SCHEMA_VERSION_KEY]: OLDEST_SUPPORTED_DB_VERSION - 1,
      kind: TASK_ARCHIVE_KIND,
      todos: [{ id: 3, uid: 'old-1', title: 'Old done', isCompleted: true, completedAt: now, createdAt: now, modifiedAt: now, sortOrder: 1 }],
    }
    const prepared = prepareImport(raw, { purpose: 'append' })
    expect(prepared).toMatchObject({ ok: false, reason: 'too-old' })
    if (prepared.ok) return
    expect(prepared.error).toContain(`(schema v${OLDEST_SUPPORTED_DB_VERSION - 1})`)
    expect(await db.todos.count()).toBe(0)
  })
})

describe('runAppendImport', () => {
  it('snapshots, appends the tasks and refreshes the stores', async () => {
    const now = new Date()
    const raw = {
      [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
      kind: TASK_ARCHIVE_KIND,
      todos: [{ id: 1, uid: 'r-1', title: 'No project', isCompleted: false, createdAt: now.toISOString(), modifiedAt: now.toISOString(), sortOrder: 0 }],
      people: [{ id: 2, name: 'Eve', initials: 'EV' }],
      todoPeople: [{ todoId: 1, personId: 2 }],
      tags: [{ id: 3, name: 'Project: Home', color: '#537FE7' }],
      todoTags: [{ todoId: 1, tagId: 3 }],
    }
    const prepared = prepareImport(raw, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)

    const result = await runAppendImport(prepared.data, new Map())
    if (result.status !== 'done') throw new Error('append import cancelled')
    const id = result.todoIds[0]!
    expect((await db.todos.get(id))).toMatchObject({ uid: 'r-1', title: 'No project' })
    expect(useTodoStore.getState().todos.some((t) => t.id === id)).toBe(true)
    expect(usePersonStore.getState().people.map((p) => p.name)).toContain('Eve')
    expect((usePersonStore.getState().assignedPeopleMap.get(id) ?? []).map((p) => p.name)).toEqual(['Eve'])
    expect(useTagStore.getState().tags.map((t) => t.name)).toEqual(['Project: Home'])
    expect((useTagStore.getState().assignedTagsMap.get(id) ?? []).map((t) => t.name)).toEqual(['Project: Home'])
    expect((await db.backups.toArray()).some((b) => b.trigger === 'pre-destructive')).toBe(true)
  })
})
