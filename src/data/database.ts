import Dexie, { type Table } from 'dexie'
import type { TodoItem, Project, Canvas, Person, Tag, TodoTag, TodoPerson, TodoOrg, PersonOrg, ListInset, Org, Backup, SavedView, StickyNote, TaskboardEntry } from '../models'

export interface SettingRow {
  key: string
  value: string
}

export class Todo2Database extends Dexie {
  todos!: Table<TodoItem, number>
  projects!: Table<Project, number>
  canvases!: Table<Canvas, number>
  people!: Table<Person, number>
  settings!: Table<SettingRow, string>
  tags!: Table<Tag, number>
  todoTags!: Table<TodoTag, number>
  todoPeople!: Table<TodoPerson, number>
  listInsets!: Table<ListInset, number>
  orgs!: Table<Org, number>
  todoOrgs!: Table<TodoOrg, number>
  personOrgs!: Table<PersonOrg, number>
  backups!: Table<Backup, number>
  savedViews!: Table<SavedView, number>
  stickyNotes!: Table<StickyNote, number>
  taskboardEntries!: Table<TaskboardEntry, number>

  constructor() {
    super('todo2')

    this.version(1).stores({
      todos: '++id, groupId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder, assignedPerson',
      groups: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
    })

    this.version(2).stores({
      todos: '++id, groupId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder, assignedPerson',
      groups: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
    })

    this.version(3).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      groups: null, // delete old table
    }).upgrade(async (tx) => {
      // 1. Migrate groups → projects
      const oldGroups = await tx.table('groups').toArray()
      if (oldGroups.length > 0) {
        await tx.table('projects').bulkAdd(oldGroups)
      }

      // 2. Collect todos with assignedPerson for migration
      const todosWithPerson = await tx.table('todos')
        .filter((t: Record<string, unknown>) => !!t.assignedPerson)
        .toArray()

      // Build person lookup from existing people table
      const existingPeople = await tx.table('people').toArray()
      const personMap = new Map<string, number>()
      for (const p of existingPeople) {
        personMap.set(p.name.toLowerCase(), p.id)
      }

      // Create missing people entries
      const uniqueNames = [...new Set(todosWithPerson.map((t: Record<string, unknown>) => t.assignedPerson as string))]
      for (const name of uniqueNames) {
        if (!personMap.has(name.toLowerCase())) {
          const initials = name.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
          const id = await tx.table('people').add({ name, initials, color: '#537FE7' })
          personMap.set(name.toLowerCase(), id as number)
        }
      }

      // Create todoPeople entries
      for (const todo of todosWithPerson) {
        const personId = personMap.get((todo.assignedPerson as string).toLowerCase())
        if (personId) {
          await tx.table('todoPeople').add({ todoId: todo.id, personId })
        }
      }

      // 3. Rename groupId → projectId on all todos, remove assignedPerson
      await tx.table('todos').toCollection().modify((todo: Record<string, unknown>) => {
        if ('groupId' in todo) {
          todo.projectId = todo.groupId
          delete todo.groupId
        }
        delete todo.assignedPerson
      })
    })

    this.version(4).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      canvasBoxes: '++id, canvasId',
    })

    // v5: add progress field to todos (no index needed, no migration)
    this.version(5).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      canvasBoxes: '++id, canvasId',
    })

    // v6: add color field to projects/canvasBoxes, add listInsets table
    this.version(6).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
    })

    // v7: add orgs table, add orgId index to people
    this.version(7).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
    })

    // v8: add recurrenceRule field to todos (no index needed, no migration)
    this.version(8).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
    })

    // v9: add isAssigned field to todos (no index needed, no migration)
    this.version(9).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
    })

    // v10: add todoOrgs join table for direct task-to-org assignment
    this.version(10).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
    })

    // v11: consolidate duplicate canvases (previously done at startup)
    this.version(11).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
    }).upgrade(async (tx) => {
      const canvases = await tx.table('canvases').orderBy('id').toArray()
      if (canvases.length > 1) {
        const keepId = canvases[0].id
        for (let i = 1; i < canvases.length; i++) {
          const oldId = canvases[i].id
          await tx.table('todos').where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await tx.table('projects').where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await tx.table('canvasBoxes').where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await tx.table('canvases').delete(oldId)
        }
      }
    })

    // v12: add backups table for auto-snapshots
    this.version(12).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
      backups: '++id, createdAt, trigger',
    })

    // v13: add savedViews table for saved list views
    this.version(13).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, boxId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      canvasBoxes: '++id, canvasId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
      backups: '++id, createdAt, trigger',
      savedViews: '++id, sortOrder',
    })

    // v14: remove canvas boxes (groups) feature
    this.version(14).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name, orgId',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
      backups: '++id, createdAt, trigger',
      savedViews: '++id, sortOrder',
      canvasBoxes: null, // drop table
    }).upgrade(async (tx) => {
      // Clear boxId from all projects
      await tx.table('projects').toCollection().modify((p: Record<string, unknown>) => {
        delete p.boxId
      })
    })

    // v15: multi-org for people — add personOrgs join table, migrate person.orgId, remove orgId index
    this.version(15).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      personOrgs: '++id, personId, orgId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
      backups: '++id, createdAt, trigger',
      savedViews: '++id, sortOrder',
    }).upgrade(async (tx) => {
      // Migrate existing person.orgId to personOrgs join table
      const people = await tx.table('people').toArray()
      for (const person of people) {
        if (person.orgId != null) {
          await tx.table('personOrgs').add({ personId: person.id, orgId: person.orgId })
        }
      }
      // Remove orgId from all people records
      await tx.table('people').toCollection().modify((p: Record<string, unknown>) => {
        delete p.orgId
      })
    })

    // v16: add stickyNotes table for canvas sticky notes
    this.version(16).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      personOrgs: '++id, personId, orgId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
      backups: '++id, createdAt, trigger',
      savedViews: '++id, sortOrder',
      stickyNotes: '++id, canvasId',
    })

    // v17: add initials field to orgs (no index change, field stored inline)
    this.version(17).stores({})

    // v18: add taskboardEntries table for ordered task queue
    this.version(18).stores({
      taskboardEntries: '++id, todoId, sortOrder',
    })
  }
}

export const db = new Todo2Database()

/** All data tables (excludes backups). Used for export, import, and file-storage sync. */
export const ALL_DATA_TABLES = [db.todos, db.projects, db.canvases, db.listInsets, db.people, db.settings, db.tags, db.todoTags, db.todoPeople, db.todoOrgs, db.personOrgs, db.orgs, db.savedViews, db.stickyNotes, db.taskboardEntries] as const
