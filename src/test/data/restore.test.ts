import { describe, it, expect, beforeEach } from 'vitest'
import { db, ALL_DATA_TABLES } from '../../data/database'
import { restoreFromImportData } from '../../data/restore'
import type { ImportData } from '../../data/import-validation'

const now = new Date()

/** Minimal valid ImportData with one of each common entity type. */
function makeImportData(overrides: Partial<ImportData> = {}): ImportData {
  return {
    todos: [],
    people: [],
    todoPeople: [],
    settings: [],
    statuses: [],
    listDefinitions: [],
    notes: [],
    todoEvents: [],
    layouts: [],
    listOrders: [],
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

    it('replaces existing layouts with imported rows', async () => {
      await db.layouts.add({ name: 'Old Layout', columns: [], createdAt: now, modifiedAt: now })
      const newData = makeImportData({
        layouts: [{ id: 5, name: 'New Layout', columns: [], createdAt: now, modifiedAt: now }],
      })

      await restoreFromImportData(newData)

      const layouts = await db.layouts.toArray()
      expect(layouts).toHaveLength(1)
      expect(layouts[0]!.name).toBe('New Layout')
      expect(layouts[0]!.id).toBe(5)
    })

    it('clears every data table, even when the import has no rows for it', async () => {
      await db.todos.add({ id: 1, uid: 'u1', title: 'Old', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now })
      await db.people.add({ id: 1, name: 'Alice', initials: 'AL' })
      await db.settings.put({ key: 'themeMode', value: 'light' })
      await db.todoPeople.add({ todoId: 1, personId: 1 })
      await db.statuses.add({ id: 1, name: 'Old Status', color: '#aabbcc', sortOrder: 0 })
      await db.listDefinitions.add({
        id: 1, name: 'Old List', sortOrder: 0, pinnedToDashboard: true, sort: 'manual', grouping: 'none',
        membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dateRangeIncludeNoDate: false } as never },
      })
      await db.notes.add({ content: 'old', createdAt: now, modifiedAt: now })
      await db.tags.add({ id: 1, name: 'old', color: '#abcdef' })
      await db.todoTags.add({ todoId: 1, tagId: 1 })
      await db.todoEvents.add({ todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: now.toISOString() })
      await db.layouts.add({ name: 'Old Layout', columns: [], createdAt: now, modifiedAt: now })
      await db.listOrders.add({ listDefinitionId: 1, todoId: 1, rank: 1 })
      for (const table of ALL_DATA_TABLES) expect(await table.count(), `${table.name} seeded`).toBeGreaterThan(0)

      await restoreFromImportData(makeImportData())

      for (const table of ALL_DATA_TABLES) {
        // Restore re-seeds the Assigned status and its settings pointer.
        if (table.name === 'statuses' || table.name === 'settings') continue
        expect(await table.count(), table.name).toBe(0)
      }
      expect((await db.statuses.toArray()).map((s) => s.name)).toEqual(['Assigned'])
      expect((await db.settings.toArray()).map((s) => s.key)).toEqual(['seededAssignedStatusId'])
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

    it('round-trips manual list ranks', async () => {
      const data = makeImportData({
        listOrders: [
          { id: 3, listDefinitionId: 1, todoId: 1, rank: 2 },
          { id: 4, listDefinitionId: 1, todoId: 2, rank: 1 },
        ],
      })

      await restoreFromImportData(data)

      expect(await db.listOrders.orderBy('id').toArray()).toEqual([
        { id: 3, listDefinitionId: 1, todoId: 1, rank: 2 },
        { id: 4, listDefinitionId: 1, todoId: 2, rank: 1 },
      ])
    })

    it('clears existing list ranks before restore', async () => {
      await db.listOrders.add({ listDefinitionId: 1, todoId: 1, rank: 1 })

      await restoreFromImportData(makeImportData({
        listOrders: [{ id: 7, listDefinitionId: 1, todoId: 1, rank: 5 }],
      }))

      expect(await db.listOrders.toArray()).toEqual([{ id: 7, listDefinitionId: 1, todoId: 1, rank: 5 }])
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
      // ensureSeededStatuses also adds Assigned (and nothing else).
      expect(names).toContain('Assigned')
      expect(names).not.toContain('Follow-up')
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
      expect(await db.layouts.count()).toBe(0)
      expect(await db.listOrders.count()).toBe(0)
      expect(await db.notes.count()).toBe(0)
      expect(await db.people.count()).toBe(0)
    })

  })

  describe('atomicity', () => {
    it('writes layouts and todos in a single transaction', async () => {
      await db.layouts.add({ name: 'Old', columns: [], createdAt: now, modifiedAt: now })

      const data = makeImportData({
        layouts: [{ id: 1, name: 'Restored', columns: [], createdAt: now, modifiedAt: now }],
        todos: [
          { id: 1, title: 'Restored Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
      })

      await restoreFromImportData(data)

      const layouts = await db.layouts.toArray()
      expect(layouts).toHaveLength(1)
      expect(layouts[0]!.name).toBe('Restored')

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

    it('does not seed list definitions when the import has none', async () => {
      await restoreFromImportData(makeImportData({ listDefinitions: [] }))

      expect(await db.listDefinitions.count()).toBe(0)
      expect(await db.settings.get('horizonSlots')).toBeUndefined()
    })

    it('auto-seeds only Assigned when import has no statuses', async () => {
      await restoreFromImportData(makeImportData({ statuses: [] }))

      const statuses = await db.statuses.toArray()
      expect(statuses.map(s => s.name)).toEqual(['Assigned'])
      expect(await db.settings.get('seededFollowupStatusId')).toBeUndefined()
    })

    it('preserves seeded status ids round-tripped through import', async () => {
      const data = makeImportData({
        statuses: [
          { id: 10, name: 'Delegated', color: '#537FE7', sortOrder: 0, icon: 'person' },
          { id: 11, name: 'Follow-up', color: '#F5A623', sortOrder: 1, icon: 'message-bubble' },
        ],
        settings: [
          { key: 'seededAssignedStatusId', value: '10' },
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const assignedId = Number(settings.find(s => s.key === 'seededAssignedStatusId')!.value)
      expect(assignedId).toBe(10)

      const statuses = await db.statuses.toArray()
      expect(statuses.find(s => s.id === 10)!.name).toBe('Delegated')
      // An imported "Follow-up" status is ordinary user data: kept, not re-seeded.
      expect(statuses.map(s => s.name).sort()).toEqual(['Delegated', 'Follow-up'])
    })

    it('keeps an imported Assigned status without seeding another', async () => {
      const data = makeImportData({
        statuses: [
          { id: 10, name: 'Assigned', color: '#537FE7', sortOrder: 0, icon: 'person' },
        ],
        settings: [
          { key: 'seededAssignedStatusId', value: '10' },
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const assignedId = Number(settings.find(s => s.key === 'seededAssignedStatusId')!.value)
      expect(assignedId).toBe(10)
      expect((await db.statuses.toArray()).map(s => s.name)).toEqual(['Assigned'])
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
