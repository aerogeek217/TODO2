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
    tags: [],
    listInsets: [],
    todoTags: [],
    todoPeople: [],
    todoOrgs: [],
    personOrgs: [],
    settings: [],
    orgs: [],
    savedViews: [],
    stickyNotes: [],
    taskboardEntries: [],
    statuses: [],
    listDefinitions: [],
    notes: [],
    floatingCalendars: [],
    ...overrides,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('restoreFromImportData', () => {
  describe('clears existing data', () => {
    it('restoreFromImportData_withExistingTodos_removesOldTodosAndAddsNew', async () => {
      // Arrange — seed old data
      await db.todos.bulkAdd([
        { title: 'Old Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
      ])
      const newData = makeImportData({
        todos: [
          { id: 10, title: 'New Task', isCompleted: false, sortOrder: 1, createdAt: now, modifiedAt: now },
        ],
      })

      // Act
      await restoreFromImportData(newData)

      // Assert old data gone, new data present
      const todos = await db.todos.toArray()
      expect(todos).toHaveLength(1)
      expect(todos[0].title).toBe('New Task')
      expect(todos[0].id).toBe(10)
    })

    it('restoreFromImportData_withExistingCanvases_replacesWithImportedCanvases', async () => {
      // Arrange
      await db.canvases.bulkAdd([
        { name: 'Old Canvas', sortOrder: 0, createdAt: now },
      ])
      const newData = makeImportData({
        canvases: [{ id: 5, name: 'New Canvas', sortOrder: 0, createdAt: now }],
      })

      // Act
      await restoreFromImportData(newData)

      // Assert
      const canvases = await db.canvases.toArray()
      expect(canvases).toHaveLength(1)
      expect(canvases[0].name).toBe('New Canvas')
      expect(canvases[0].id).toBe(5)
    })

    it('restoreFromImportData_withExistingPeopleAndTags_clearsAll', async () => {
      // Arrange
      await db.people.bulkAdd([{ name: 'Alice', initials: 'AL', color: '#537FE7' }])
      await db.tags.bulkAdd([{ name: 'urgent', color: '#ff0000' }])

      // Act — import with empty people and tags
      await restoreFromImportData(makeImportData())

      // Assert both tables cleared
      expect(await db.people.count()).toBe(0)
      expect(await db.tags.count()).toBe(0)
    })
  })

  describe('imports new data', () => {
    it('restoreFromImportData_withPeopleAndTags_persistsBothTables', async () => {
      // Arrange
      const data = makeImportData({
        people: [{ id: 1, name: 'Bob', initials: 'BO', color: '#aabbcc' }],
        tags: [{ id: 1, name: 'feature', color: '#00ff00' }],
      })

      // Act
      await restoreFromImportData(data)

      // Assert
      const people = await db.people.toArray()
      expect(people).toHaveLength(1)
      expect(people[0].name).toBe('Bob')

      const tags = await db.tags.toArray()
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('feature')
    })

    it('restoreFromImportData_withLegacyStickyNotes_translatesIntoNotes', async () => {
      // Pre-v26 backups carry a `stickyNotes` array. Restore should translate
      // each row into a matching `notes` row (title prepended as H1), since
      // the `stickyNotes` table has been retired.
      const data = makeImportData({
        stickyNotes: [
          { id: 1, canvasId: 1, title: 'Reminder', text: 'Remember this', x: 100, y: 200, width: 240, height: 200, color: '#FFF3B0', createdAt: now, modifiedAt: now },
        ],
      })

      await restoreFromImportData(data)

      const notes = await db.notes.where('canvasId').equals(1).toArray()
      expect(notes).toHaveLength(1)
      expect(notes[0].content).toBe('# Reminder\n\nRemember this')
      expect(notes[0].x).toBe(100)
      expect(notes[0].y).toBe(200)
      expect(notes[0].color).toBe('#FFF3B0')
    })

    it('restoreFromImportData_withJoinTables_persistsTodoPeopleAndTodoTags', async () => {
      // Arrange
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
        people: [{ id: 1, name: 'Alice', initials: 'AL', color: '#537FE7' }],
        tags: [{ id: 1, name: 'bug', color: '#ff0000' }],
        todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
        todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      })

      // Act
      await restoreFromImportData(data)

      // Assert join tables written
      expect(await db.todoPeople.count()).toBe(1)
      expect(await db.todoTags.count()).toBe(1)
    })

    it('restoreFromImportData_withStatuses_persistsStatusTable', async () => {
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
      // ensureSeededStatuses also adds Assigned + Follow-up
      expect(names).toContain('Assigned')
      expect(names).toContain('Follow-up')
    })

    it('restoreFromImportData_withExistingStatuses_replacesWithImported', async () => {
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

    it('restoreFromImportData_withEmptyOptionalTables_leavesThemEmpty', async () => {
      // Act
      await restoreFromImportData(makeImportData())

      // Assert all optional tables are empty (no error thrown)
      expect(await db.todos.count()).toBe(0)
      expect(await db.projects.count()).toBe(0)
      expect(await db.notes.count()).toBe(0)
      expect(await db.orgs.count()).toBe(0)
      expect(await db.savedViews.count()).toBe(0)
    })
  })

  describe('atomicity', () => {
    it('restoreFromImportData_withMultipleEntities_writesAllOrNone', async () => {
      // Arrange — seed old canvas
      await db.canvases.add({ name: 'Old', sortOrder: 0, createdAt: now })

      const data = makeImportData({
        canvases: [{ id: 1, name: 'Restored', sortOrder: 0, createdAt: now }],
        todos: [
          { id: 1, title: 'Restored Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
      })

      // Act
      await restoreFromImportData(data)

      // Assert both were written in a single transaction
      const canvases = await db.canvases.toArray()
      expect(canvases).toHaveLength(1)
      expect(canvases[0].name).toBe('Restored')

      const todos = await db.todos.toArray()
      expect(todos).toHaveLength(1)
      expect(todos[0].title).toBe('Restored Task')
    })
  })

  describe('legacy translation', () => {
    it('translates isStarred=true to seeded follow-up statusId', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Starred', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, isStarred: true } as any,
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const followupId = Number(settings.find(s => s.key === 'seededFollowupStatusId')!.value)
      const todo = await db.todos.get(1)
      expect(todo!.statusId).toBe(followupId)
      expect((todo as any).isStarred).toBeUndefined()
    })

    it('translates isAssigned=true to seeded assigned statusId', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Assigned', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, isAssigned: true } as any,
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const assignedId = Number(settings.find(s => s.key === 'seededAssignedStatusId')!.value)
      const todo = await db.todos.get(1)
      expect(todo!.statusId).toBe(assignedId)
      expect((todo as any).isAssigned).toBeUndefined()
    })

    it('star wins over assigned per Q4 precedence', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Both', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, isStarred: true, isAssigned: true } as any,
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      const followupId = Number(settings.find(s => s.key === 'seededFollowupStatusId')!.value)
      const todo = await db.todos.get(1)
      expect(todo!.statusId).toBe(followupId)
    })

    it('preserves existing statusId when no legacy flags', async () => {
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

    it('strips legacy fields even when both are false', async () => {
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Clean', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, isStarred: false, isAssigned: false } as any,
        ],
      })

      await restoreFromImportData(data)

      const todo = await db.todos.get(1)
      expect((todo as any).isStarred).toBeUndefined()
      expect((todo as any).isAssigned).toBeUndefined()
      expect(todo!.statusId).toBeUndefined()
    })

    it('auto-seeds statuses when import has none', async () => {
      const data = makeImportData({ statuses: [] })

      await restoreFromImportData(data)

      const statuses = await db.statuses.toArray()
      const names = statuses.map(s => s.name)
      expect(names).toContain('Assigned')
      expect(names).toContain('Follow-up')

      const settings = await db.settings.toArray()
      expect(settings.find(s => s.key === 'seededAssignedStatusId')).toBeDefined()
      expect(settings.find(s => s.key === 'seededFollowupStatusId')).toBeDefined()
    })

    it('v20 round-trip: preserves seeded statuses from import', async () => {
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

    it('handles import with only one seeded status present', async () => {
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
      // Follow-up was auto-seeded
      const followupId = Number(settings.find(s => s.key === 'seededFollowupStatusId')!.value)
      expect(followupId).toBeGreaterThan(0)
      const followupStatus = await db.statuses.get(followupId)
      expect(followupStatus!.name).toBe('Follow-up')
    })
  })
})
