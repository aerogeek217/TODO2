import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { restoreFromImportData } from '../../data/restore'
import type { ImportData } from '../../data/import-validation'

const now = new Date()

/** Minimal valid ImportData with one of each common entity type. */
function makeImportData(overrides: Partial<ImportData> = {}): ImportData {
  return {
    canvases: [{ id: 1, name: 'Default', sortOrder: 0, createdAt: now }],
    projects: [],
    todos: [],
    people: [],
    listInsets: [],
    todoPeople: [],
    todoOrgs: [],
    personOrgs: [],
    settings: [],
    orgs: [],
    taskboards: [],
    floatingTaskboards: [],
    statuses: [],
    listDefinitions: [],
    notes: [],
    floatingCalendars: [],
    floatingNotes: [],
    floatingHorizons: [],
    floatingStatus: [],
    floatingScoreboard: [],
    floatingSnoozeGraveyard: [],
    todoEvents: [],
    ...overrides,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('restoreFromImportData', () => {
  describe('clears existing data', () => {
    it('replaces existing todos with imported rows', async () => {
      await db.todos.bulkAdd([
        { title: 'Old Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
      ])
      const newData = makeImportData({
        todos: [
          { id: 10, title: 'New Task', isCompleted: false, sortOrder: 1, createdAt: now, modifiedAt: now },
        ],
      })

      await restoreFromImportData(newData)

      const todos = await db.todos.toArray()
      expect(todos).toHaveLength(1)
      expect(todos[0]!.title).toBe('New Task')
      expect(todos[0]!.id).toBe(10)
    })

    it('replaces existing canvases with imported rows', async () => {
      await db.canvases.bulkAdd([
        { name: 'Old Canvas', sortOrder: 0, createdAt: now },
      ])
      const newData = makeImportData({
        canvases: [{ id: 5, name: 'New Canvas', sortOrder: 0, createdAt: now }],
      })

      await restoreFromImportData(newData)

      const canvases = await db.canvases.toArray()
      expect(canvases).toHaveLength(1)
      expect(canvases[0]!.name).toBe('New Canvas')
      expect(canvases[0]!.id).toBe(5)
    })

    it('clears existing people when import has none', async () => {
      await db.people.bulkAdd([{ name: 'Alice', initials: 'AL' }])

      await restoreFromImportData(makeImportData())

      expect(await db.people.count()).toBe(0)
    })
  })

  describe('imports new data', () => {
    it('persists people', async () => {
      const data = makeImportData({
        people: [{ id: 1, name: 'Bob', initials: 'BO' }],
      })

      await restoreFromImportData(data)

      const people = await db.people.toArray()
      expect(people).toHaveLength(1)
      expect(people[0]!.name).toBe('Bob')
    })

    it('persists todoPeople join rows', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
        people: [{ id: 1, name: 'Alice', initials: 'AL' }],
        todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
      })

      await restoreFromImportData(data)

      expect(await db.todoPeople.count()).toBe(1)
    })

    it('persists tag tables', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Fix bug', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
        tags: [{ id: 7, name: 'urgent', color: '#123456' }],
        todoTags: [{ id: 1, todoId: 1, tagId: 7 }],
      })

      await restoreFromImportData(data)

      const tags = await db.tags.toArray()
      expect(tags).toHaveLength(1)
      expect(tags[0]!.name).toBe('urgent')
      expect(tags[0]!.color).toBe('#123456')

      const joins = await db.todoTags.toArray()
      expect(joins).toHaveLength(1)
      expect(joins[0]!.todoId).toBe(1)
      expect(joins[0]!.tagId).toBe(7)
    })

    it('clears existing tag tables before restore', async () => {
      await db.tags.add({ name: 'stale', color: '#abcdef' })
      const data = makeImportData({
        todos: [{ id: 1, title: 't', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now }],
        tags: [{ id: 1, name: 'fresh', color: '#112233' }],
      })

      await restoreFromImportData(data)

      const tags = await db.tags.toArray()
      expect(tags).toHaveLength(1)
      expect(tags[0]!.name).toBe('fresh')
    })

    it('round-trips floatingHorizons placements', async () => {
      const data = makeImportData({
        floatingHorizons: [
          { id: 1, canvasId: 1, x: 100, y: 200, width: 520, height: 360, collapsed: true },
        ],
      })

      await restoreFromImportData(data)

      const placements = await db.floatingHorizons.toArray()
      expect(placements).toHaveLength(1)
      expect(placements[0]).toMatchObject({
        canvasId: 1,
        x: 100,
        y: 200,
        width: 520,
        height: 360,
        collapsed: true,
      })
    })

    it('clears existing floatingHorizons before restore', async () => {
      await db.floatingHorizons.add({ canvasId: 1, x: 0, y: 0, width: 520, height: 360 })

      await restoreFromImportData(makeImportData({
        floatingHorizons: [
          { id: 7, canvasId: 1, x: 50, y: 60, width: 520, height: 360 },
        ],
      }))

      const placements = await db.floatingHorizons.toArray()
      expect(placements).toHaveLength(1)
      expect(placements[0]!.id).toBe(7)
      expect(placements[0]!.x).toBe(50)
    })

    it('persists imported statuses alongside auto-seeded defaults', async () => {
      const data = makeImportData({
        statuses: [
          { id: 1, name: 'Open', color: '#00ff00', sortOrder: 0 },
          { id: 2, name: 'Closed', color: '#ff0000', sortOrder: 1 },
        ],
      })

      await restoreFromImportData(data)

      const statuses = await db.statuses.toArray()
      const names = statuses.map(s => s.name)
      expect(names).toContain('Open')
      expect(names).toContain('Closed')
      // ensureSeededStatuses also adds Assigned + Follow-up.
      expect(names).toContain('Assigned')
      expect(names).toContain('Follow-up')
    })

    it('replaces existing statuses with imported rows', async () => {
      await db.statuses.add({ name: 'Old Status', color: '#aabbcc', sortOrder: 0 })

      await restoreFromImportData(makeImportData({
        statuses: [{ id: 5, name: 'New Status', color: '#112233', sortOrder: 0 }],
      }))

      const statuses = await db.statuses.toArray()
      const names = statuses.map(s => s.name)
      expect(names).toContain('New Status')
      expect(names).not.toContain('Old Status')
      expect(statuses.find(s => s.id === 5)!.name).toBe('New Status')
    })

    it('leaves optional tables empty when not present in import', async () => {
      await restoreFromImportData(makeImportData())

      expect(await db.todos.count()).toBe(0)
      expect(await db.projects.count()).toBe(0)
      expect(await db.notes.count()).toBe(0)
      expect(await db.orgs.count()).toBe(0)
    })

    it('seeds an empty taskboard singleton when none imported', async () => {
      await restoreFromImportData(makeImportData())

      const boards = await db.taskboards.toArray()
      expect(boards).toHaveLength(1)
      expect(boards[0]!.entries).toEqual([])
    })
  })

  describe('atomicity', () => {
    it('writes canvases and todos in a single transaction', async () => {
      await db.canvases.add({ name: 'Old', sortOrder: 0, createdAt: now })

      const data = makeImportData({
        canvases: [{ id: 1, name: 'Restored', sortOrder: 0, createdAt: now }],
        todos: [
          { id: 1, title: 'Restored Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
      })

      await restoreFromImportData(data)

      const canvases = await db.canvases.toArray()
      expect(canvases).toHaveLength(1)
      expect(canvases[0]!.name).toBe('Restored')

      const todos = await db.todos.toArray()
      expect(todos).toHaveLength(1)
      expect(todos[0]!.title).toBe('Restored Task')
    })
  })

  describe('seeding', () => {
    it('preserves existing statusId on imported todos', async () => {
      const data = makeImportData({
        statuses: [{ id: 50, name: 'Custom', color: '#abc123', sortOrder: 0 }],
        todos: [
          { id: 1, title: 'Has status', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, statusId: 50 },
        ],
      })

      await restoreFromImportData(data)

      const todo = await db.todos.get(1)
      expect(todo!.statusId).toBe(50)
    })

    it('auto-seeds Assigned + Follow-up when import has no statuses', async () => {
      await restoreFromImportData(makeImportData({ statuses: [] }))

      const statuses = await db.statuses.toArray()
      const names = statuses.map(s => s.name)
      expect(names).toContain('Assigned')
      expect(names).toContain('Follow-up')

      const settings = await db.settings.toArray()
      expect(settings.find(s => s.key === 'seededAssignedStatusId')).toBeDefined()
      expect(settings.find(s => s.key === 'seededFollowupStatusId')).toBeDefined()
    })

    it('preserves seeded status ids round-tripped through import', async () => {
      const data = makeImportData({
        statuses: [
          { id: 10, name: 'Delegated', color: '#537FE7', sortOrder: 0, icon: 'person', hideByDefault: true },
          { id: 11, name: 'Follow-up', color: '#F5A623', sortOrder: 1, icon: 'message-bubble', hideByDefault: false },
        ],
        settings: [
          { key: 'seededAssignedStatusId', value: '10' },
          { key: 'seededFollowupStatusId', value: '11' },
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const assignedId = Number(settings.find(s => s.key === 'seededAssignedStatusId')!.value)
      const followupId = Number(settings.find(s => s.key === 'seededFollowupStatusId')!.value)
      expect(assignedId).toBe(10)
      expect(followupId).toBe(11)

      const statuses = await db.statuses.toArray()
      expect(statuses.find(s => s.id === 10)!.name).toBe('Delegated')
    })

    it('auto-seeds the missing seeded status when only one is imported', async () => {
      const data = makeImportData({
        statuses: [
          { id: 10, name: 'Assigned', color: '#537FE7', sortOrder: 0, icon: 'person', hideByDefault: true },
        ],
        settings: [
          { key: 'seededAssignedStatusId', value: '10' },
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const assignedId = Number(settings.find(s => s.key === 'seededAssignedStatusId')!.value)
      expect(assignedId).toBe(10)
      const followupId = Number(settings.find(s => s.key === 'seededFollowupStatusId')!.value)
      expect(followupId).toBeGreaterThan(0)
      const followupStatus = await db.statuses.get(followupId)
      expect(followupStatus!.name).toBe('Follow-up')
    })
  })

  describe('idempotency', () => {
    it('a second restore over the same data produces the same database', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Task A', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
          { id: 2, title: 'Task B', isCompleted: true, sortOrder: 1, createdAt: now, modifiedAt: now },
        ],
        people: [{ id: 1, name: 'Alice', initials: 'AL' }],
        todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
        statuses: [{ id: 5, name: 'Open', color: '#00ff00', sortOrder: 0 }],
      })

      await restoreFromImportData(data)
      const firstTodos = await db.todos.toArray()
      const firstPeople = await db.people.toArray()
      const firstJoins = await db.todoPeople.toArray()
      const firstStatusNames = (await db.statuses.toArray()).map(s => s.name).sort()

      await restoreFromImportData(data)
      const secondTodos = await db.todos.toArray()
      const secondPeople = await db.people.toArray()
      const secondJoins = await db.todoPeople.toArray()
      const secondStatusNames = (await db.statuses.toArray()).map(s => s.name).sort()

      expect(secondTodos).toEqual(firstTodos)
      expect(secondPeople).toEqual(firstPeople)
      expect(secondJoins).toEqual(firstJoins)
      expect(secondStatusNames).toEqual(firstStatusNames)
    })
  })
})
