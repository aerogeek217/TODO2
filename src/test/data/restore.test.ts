import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { restoreFromImportData } from '../../data/restore'
import type { ImportData } from '../../data/import-validation'
import { Priority } from '../../models/priority'

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
        { title: 'Old Task', priority: Priority.Normal, isCompleted: false, isStarred: false, sortOrder: 0, createdAt: now, modifiedAt: now },
      ])
      const newData = makeImportData({
        todos: [
          { id: 10, title: 'New Task', priority: Priority.High, isCompleted: false, isStarred: false, sortOrder: 1, createdAt: now, modifiedAt: now },
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

    it('restoreFromImportData_withStickyNotes_persistsStickyNotes', async () => {
      // Arrange
      const data = makeImportData({
        stickyNotes: [
          { id: 1, canvasId: 1, text: 'Remember this', x: 100, y: 200, width: 240, height: 200, createdAt: now, modifiedAt: now },
        ],
      })

      // Act
      await restoreFromImportData(data)

      // Assert
      const notes = await db.stickyNotes.toArray()
      expect(notes).toHaveLength(1)
      expect(notes[0].text).toBe('Remember this')
    })

    it('restoreFromImportData_withJoinTables_persistsTodoPeopleAndTodoTags', async () => {
      // Arrange
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Task', priority: Priority.Normal, isCompleted: false, isStarred: false, sortOrder: 0, createdAt: now, modifiedAt: now },
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
      expect(statuses).toHaveLength(2)
      expect(statuses.map(s => s.name)).toContain('Open')
      expect(statuses.map(s => s.name)).toContain('Closed')
    })

    it('restoreFromImportData_withExistingStatuses_replacesWithImported', async () => {
      await db.statuses.add({ name: 'Old Status', color: '#aabbcc', sortOrder: 0 })

      await restoreFromImportData(makeImportData({
        statuses: [{ id: 5, name: 'New Status', color: '#112233', sortOrder: 0 }],
      }))

      const statuses = await db.statuses.toArray()
      expect(statuses).toHaveLength(1)
      expect(statuses[0].name).toBe('New Status')
      expect(statuses[0].id).toBe(5)
    })

    it('restoreFromImportData_withEmptyOptionalTables_leavesThemEmpty', async () => {
      // Act
      await restoreFromImportData(makeImportData())

      // Assert all optional tables are empty (no error thrown)
      expect(await db.todos.count()).toBe(0)
      expect(await db.projects.count()).toBe(0)
      expect(await db.stickyNotes.count()).toBe(0)
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
          { id: 1, title: 'Restored Task', priority: Priority.Normal, isCompleted: false, isStarred: false, sortOrder: 0, createdAt: now, modifiedAt: now },
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
})
