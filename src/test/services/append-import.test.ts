import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { prepareImport, prepareImportText, TASK_ARCHIVE_KIND } from '../../data/import-pipeline'
import type { ImportData } from '../../data/import-validation'
import { appendImportTasks } from '../../data/append-import'
import { buildTaskArchive } from '../../services/task-archive'
import { defaultAppendChoices, findAppendDuplicates, runAppendImport } from '../../services/append-import'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
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
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
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

  it('accepts an older archive with orgs: they arrive as Org: people', async () => {
    const { json } = await archiveFromSourceDb()
    // The same archive as a pre-merge build wrote it: one org assigned to the task.
    const archive = JSON.parse(json) as Record<string, unknown> & { todos: Array<{ id: number }> }
    const taskId = archive.todos[0]?.id
    const older = {
      ...archive,
      __schemaVersion: 54,
      orgs: [{ id: 1, name: 'Acme', initials: 'AC' }, { id: 2, name: 'Globex' }],
      todoOrgs: [{ id: 1, todoId: taskId, orgId: 1 }, { id: 2, todoId: taskId, orgId: 2 }],
    }

    await resetDb()
    const existingAcme = await db.people.add({ name: 'org: acme', initials: 'OA' }) as number

    const data = prepareAppend(JSON.stringify(older))
    expect('orgs' in data).toBe(false)
    const result = await appendImportTasks(data, defaultAppendChoices(findAppendDuplicates(data.todos, [])))

    expect(result.created.people).toEqual(['Alice', 'Org: Globex'])
    const globex = await db.people.where('name').equals('Org: Globex').first()
    expect(globex).toMatchObject({ initials: 'G', color: '#f28c4e' })
    const assigned = (await db.todoPeople.where('todoId').equals(result.todoIds[0]!).toArray()).map((r) => r.personId)
    expect(assigned).toEqual(expect.arrayContaining([existingAcme, globex!.id]))
    // The existing person matched by name is reused, untouched.
    expect(await db.people.get(existingAcme)).toEqual({ id: existingAcme, name: 'org: acme', initials: 'OA' })
  })

  it('accepts an older archive with projects: they arrive as Project: tags, matched by name', async () => {
    const { json } = await archiveFromSourceDb()
    // The same archive as a pre-v60 build wrote it: its task in project
    // "Work", a second task in "Errands", and a project no task uses.
    const archive = JSON.parse(json) as Record<string, unknown> & { todos: Array<Record<string, unknown>> }
    const task = archive.todos[0]!
    const older = {
      ...archive,
      __schemaVersion: 59,
      todos: [
        { ...task, projectId: 5, canvasId: 1 },
        {
          id: 99, uid: 'archived-errand', title: 'Buy stamps', isCompleted: true, completedAt: task.completedAt,
          createdAt: task.createdAt, modifiedAt: task.modifiedAt, sortOrder: 2, projectId: 6, canvasId: 1,
        },
      ],
      projects: [
        { id: 5, name: 'Work', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: task.createdAt, color: '#4f8cff' },
        { id: 6, name: 'Errands', canvasId: 1, positionX: 400, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: task.createdAt, color: '#00aa00' },
        { id: 7, name: 'Unused', canvasId: 1, positionX: 800, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: task.createdAt },
      ],
    }

    await resetDb()
    // The target already has the Work project's tag (another case): reused.
    const existingWork = await db.tags.add({ name: 'project: work', color: '#123456' }) as number

    const data = prepareAppend(JSON.stringify(older))
    expect('projects' in data).toBe(false)
    for (const t of data.todos) expect('projectId' in t || 'canvasId' in t, t.title).toBe(false)
    const result = await appendImportTasks(data, defaultAppendChoices(findAppendDuplicates(data.todos, [])))

    expect(result.imported).toBe(2)
    // Only the tags the imported tasks carry: no tag for the unused project.
    expect(result.created.tags).toEqual(['urgent', 'Project: Errands'])
    const errands = await db.tags.where('name').equals('Project: Errands').first()
    expect(errands?.color).toBe('#00aa00')
    expect(await db.tags.where('name').equals('Project: Unused').count()).toBe(0)
    expect(await db.tags.get(existingWork)).toEqual({ id: existingWork, name: 'project: work', color: '#123456' })

    const [shipId, stampsId] = result.todoIds
    const tagsOf = async (todoId: number) => (await db.todoTags.where('todoId').equals(todoId).toArray()).map((r) => r.tagId)
    const urgent = await db.tags.where('name').equals('urgent').first()
    expect((await tagsOf(shipId!)).sort()).toEqual([urgent!.id, existingWork].sort())
    expect(await tagsOf(stampsId!)).toEqual([errands!.id])
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
      // An older full export: its canvas goes in the upgrade.
      [SCHEMA_VERSION_KEY]: 51,
      canvases: [{ id: 1, name: 'X', sortOrder: 0, createdAt: now.toISOString() }],
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

describe('append import of an older-version archive', () => {
  it('a v49 archive (no uid / completedAt, string dates) upgrades through the pipeline and appends', async () => {
    const done = '2026-07-01T10:00:00.000Z'
    const raw = {
      [SCHEMA_VERSION_KEY]: 49,
      kind: TASK_ARCHIVE_KIND,
      exportedAt: '2026-09-01T00:00:00.000Z',
      todos: [{
        id: 3, title: 'Legacy done', isCompleted: true, sortOrder: 1,
        createdAt: '2026-06-01T09:00:00.000Z', modifiedAt: '2026-09-15T09:00:00.000Z',
        scheduledDate: { kind: 'fuzzy', token: 'this-week', setAt: '2026-06-02T00:00:00.000Z' },
      }],
      people: [{ id: 4, name: 'Dana', initials: 'DA' }],
      todoPeople: [{ id: 1, todoId: 3, personId: 4 }],
      todoEvents: [{ id: 1, todoId: 3, type: 'completed', fromValue: null, toValue: null, timestamp: done }],
    }
    const prepared = prepareImport(raw, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared).toMatchObject({ upgraded: true, sourceVersion: 49, kind: 'task-archive', legacy: null })
    const todo = prepared.data.todos[0]!
    expect(todo.uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(todo.completedAt).toEqual(new Date(done))
    expect(todo.createdAt).toBeInstanceOf(Date)

    const result = await appendImportTasks(prepared.data, new Map())
    const row = await db.todos.get(result.todoIds[0]!)
    expect(row).toMatchObject({ title: 'Legacy done', uid: todo.uid, completedAt: new Date(done) })
    expect(result.created.people).toEqual(['Dana'])
  })
})

describe('runAppendImport', () => {
  it('snapshots, appends the tasks and refreshes the stores', async () => {
    const now = new Date()
    const raw = {
      [SCHEMA_VERSION_KEY]: 51,
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
