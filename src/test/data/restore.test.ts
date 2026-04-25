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
    savedViews: [],
    stickyNotes: [],
    taskboardEntries: [],
    taskboards: [],
    floatingTaskboards: [],
    statuses: [],
    listDefinitions: [],
    notes: [],
    floatingCalendars: [],
    floatingNotes: [],
    floatingHorizons: [],
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

    it('restoreFromImportData_withExistingPeople_clearsAll', async () => {
      // Arrange
      await db.people.bulkAdd([{ name: 'Alice', initials: 'AL' }])

      // Act — import with empty people
      await restoreFromImportData(makeImportData())

      // Assert table cleared
      expect(await db.people.count()).toBe(0)
    })
  })

  describe('imports new data', () => {
    it('restoreFromImportData_withPeople_persistsTable', async () => {
      // Arrange
      const data = makeImportData({
        people: [{ id: 1, name: 'Bob', initials: 'BO' }],
      })

      // Act
      await restoreFromImportData(data)

      // Assert
      const people = await db.people.toArray()
      expect(people).toHaveLength(1)
      expect(people[0].name).toBe('Bob')
    })

    it('restoreFromImportData_withLegacyStickyNotes_translatesIntoFloatingNotePlacements', async () => {
      // Pre-v26 backups carry a `stickyNotes` array. Post-v28, each row
      // becomes a placement-only `floatingNotes` row — content + color are
      // dropped (floating notes now view the single global note).
      const data = makeImportData({
        stickyNotes: [
          { id: 1, canvasId: 1, title: 'Reminder', text: 'Remember this', x: 100, y: 200, width: 240, height: 200, color: '#FFF3B0', createdAt: now, modifiedAt: now },
        ],
      })

      await restoreFromImportData(data)

      // No per-sticky content rows in `notes`.
      const canvasNotes = await db.notes.filter((n) => (n as unknown as Record<string, unknown>).canvasId != null).toArray()
      expect(canvasNotes).toHaveLength(0)

      // A placement row in `floatingNotes`.
      const placements = await db.floatingNotes.where('canvasId').equals(1).toArray()
      expect(placements).toHaveLength(1)
      expect(placements[0].x).toBe(100)
      expect(placements[0].y).toBe(200)
      expect(placements[0].width).toBe(240)
      expect(placements[0].height).toBe(200)
    })

    it('restoreFromImportData_withJoinTables_persistsTodoPeople', async () => {
      // Arrange
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Task', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
        people: [{ id: 1, name: 'Alice', initials: 'AL' }],
        todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
      })

      // Act
      await restoreFromImportData(data)

      // Assert join table written
      expect(await db.todoPeople.count()).toBe(1)
    })

    it('restoreFromImportData_withLegacyTagsAndTodoTags_appendsHashtagsToTitles', async () => {
      // Pre-v29 backups carry tag rows; restore bakes `#tagname` suffixes
      // into matching todo titles and drops the rows.
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Fix bug', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now },
        ],
        tags: [{ id: 1, name: 'urgent', color: '#ff0000' }],
        todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      })

      await restoreFromImportData(data)

      const todo = await db.todos.get(1)
      expect(todo!.title).toContain('#urgent')
      // Pre-v29 backups do NOT populate inline tags — the data survives only
      // as `#tagname` text in the title (searchable, not grouped).
      expect((todo as { tags?: unknown }).tags).toBeUndefined()
    })

    it('restoreFromImportData_withInlineTagsOnly_seedsRegistryAndStripsInline', async () => {
      // Post-v35, pre-v37 backups carry tags inline on todos but no top-level
      // `tags` / `todoTags`. Restore seeds the re-introduced registry from
      // inline (same logic as the in-place v36 upgrade) and strips the inline
      // field so the post-restore state matches the post-v37 shape.
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Fix bug', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, tags: ['urgent', 'today'] },
          { id: 2, title: 'Ship it', isCompleted: false, sortOrder: 1, createdAt: now, modifiedAt: now, tags: ['urgent'] },
        ] as unknown as ImportData['todos'],
      })

      await restoreFromImportData(data)

      const todo = await db.todos.get(1)
      expect(todo!.title).toBe('Fix bug')
      expect((todo as { tags?: unknown }).tags).toBeUndefined()

      const tags = await db.tags.toArray()
      expect(tags.map((t) => t.name).sort()).toEqual(['today', 'urgent'])
      for (const t of tags) expect(t.color).toBe('#537FE7')

      const joins = await db.todoTags.toArray()
      expect(joins).toHaveLength(3)
    })

    it('restoreFromImportData_withPostV36Shape_bulkAddsTagTables', async () => {
      // Post-v36 backups carry top-level `tags` + `todoTags` (and may still
      // carry inline `todo.tags` from pre-v37). Restore trusts the top-level
      // arrays, bulk-adds them, and strips any inline residue.
      const data = makeImportData({
        todos: [
          { id: 1, title: 'Fix bug', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now, tags: ['urgent'] },
        ] as unknown as ImportData['todos'],
        tags: [{ id: 7, name: 'urgent', color: '#123456' }],
        todoTags: [{ id: 1, todoId: 1, tagId: 7 }],
      })

      await restoreFromImportData(data)

      const todo = await db.todos.get(1)
      expect(todo!.title).toBe('Fix bug')
      expect((todo as { tags?: unknown }).tags).toBeUndefined()

      const tags = await db.tags.toArray()
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('urgent')
      expect(tags[0].color).toBe('#123456') // user-chosen color preserved

      const joins = await db.todoTags.toArray()
      expect(joins).toHaveLength(1)
      expect(joins[0].todoId).toBe(1)
      expect(joins[0].tagId).toBe(7)
    })

    it('restoreFromImportData_withPostV36Shape_clearsExistingTagTables', async () => {
      // Existing tags must be cleared before the new ones land — same rule
      // as every other table restore.
      await db.tags.add({ name: 'stale', color: '#abcdef' })
      const data = makeImportData({
        todos: [{ id: 1, title: 't', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now }],
        tags: [{ id: 1, name: 'fresh', color: '#112233' }],
      })

      await restoreFromImportData(data)

      const tags = await db.tags.toArray()
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('fresh')
    })

    it('restoreFromImportData_withFloatingHorizons_roundTripsFaithfully', async () => {
      // Round-trip a single floatingHorizons placement (P1 of code-review-2026-04-25):
      // pre-fix the table was missing from TABLE_KEY_PAIRS, silently dropping
      // every row on restore.
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

    it('restoreFromImportData_withExistingFloatingHorizons_clearsBeforeRestore', async () => {
      // Existing rows must be wiped before the new ones land — same rule as
      // every other table restore.
      await db.floatingHorizons.add({ canvasId: 1, x: 0, y: 0, width: 520, height: 360 })

      await restoreFromImportData(makeImportData({
        floatingHorizons: [
          { id: 7, canvasId: 1, x: 50, y: 60, width: 520, height: 360 },
        ],
      }))

      const placements = await db.floatingHorizons.toArray()
      expect(placements).toHaveLength(1)
      expect(placements[0].id).toBe(7)
      expect(placements[0].x).toBe(50)
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

    it('strips dormant Dashboard-era settings keys at restore', async () => {
      const data = makeImportData({
        settings: [
          { key: 'dashboardUserLists', value: JSON.stringify([1, 2, 3]) },
          { key: 'notesPinnedToDashboard', value: 'true' },
          { key: 'themeMode', value: 'dark' },
        ],
      })

      await restoreFromImportData(data)

      const settings = await db.settings.toArray()
      // Dormant keys must be stripped post-restore (P8).
      expect(settings.find(s => s.key === 'dashboardUserLists')).toBeUndefined()
      expect(settings.find(s => s.key === 'notesPinnedToDashboard')).toBeUndefined()
      // Live keys still survive.
      expect(settings.find(s => s.key === 'themeMode')!.value).toBe('dark')
    })
  })
})
