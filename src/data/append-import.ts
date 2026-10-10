import { db } from './database'
import type { ImportData } from './import-validation'
import type {
  TodoItem, TodoEvent, Person, Tag, Org, Status, Project,
} from '../models'
import { newTodoUid } from '../utils/todo-uid'

/** Per incoming task: `import` (default) or `skip`. Keyed by the incoming `uid`. */
export type AppendChoice = 'skip' | 'import'

export interface AppendImportOptions {
  /** Canvas the imported tasks land on. Without one, tasks get no canvas / project. */
  canvasId?: number
  /**
   * Project for imported tasks whose own project isn't in the file (or that
   * had none). Callers resolve it up front (`ensureDefaultProject`) because
   * it may create a project through the store.
   */
  fallbackProjectId?: number
  /** Canvas coordinate limit for projects created on the fly. */
  maxExtent?: number
}

export interface AppendImportResult {
  imported: number
  skipped: number
  /** New database ids of the imported tasks, in file order. */
  todoIds: number[]
  /** Names of entities created because no existing one matched. */
  created: { people: string[]; tags: string[]; orgs: string[]; statuses: string[]; projects: string[] }
}

/** Name key for by-name matching: trimmed, case-insensitive. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Width assumed for a project node without an explicit `width` (ProjectNode's default). */
const DEFAULT_PROJECT_WIDTH = 260
const NEW_PROJECT_GAP = 40

function byNameIndex<T extends { id?: number; name: string }>(rows: readonly T[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.id == null) continue
    const k = nameKey(r.name)
    if (!out.has(k)) out.set(k, r.id)
  }
  return out
}

/**
 * Appends tasks from a validated import (task archive or full export —
 * `prepareImport(…, { purpose: 'append' })`) to the current database
 * (cr1 P5). One read-write transaction:
 *
 * - **New ids** for every task (ids are never reused); the incoming `uid` is
 *   kept unless a task in the database already has it, then a fresh one is
 *   minted.
 * - People / tags / orgs / statuses / projects are matched to existing rows
 *   **by name** (trimmed, case-insensitive); missing ones are created from
 *   the file's row. Projects are matched on `opts.canvasId` only; a created
 *   project is placed right of the canvas's existing ones.
 * - Join rows (`todoPeople` / `todoTags` / `todoOrgs`) and the tasks'
 *   `todoEvents` history are re-pointed at the new ids (status-change event
 *   values at the resolved status ids).
 * - Tasks whose `choices` entry is `skip` are left out with their rows.
 *
 * No backup snapshot and no store refresh — the caller does both.
 */
export async function appendImportTasks(
  data: ImportData,
  choices: ReadonlyMap<string, AppendChoice>,
  opts: AppendImportOptions = {},
): Promise<AppendImportResult> {
  const selected = data.todos.filter((t) => (choices.get(t.uid) ?? 'import') === 'import')
  const skipped = data.todos.length - selected.length
  const created: AppendImportResult['created'] = { people: [], tags: [], orgs: [], statuses: [], projects: [] }

  const tables = [
    db.todos, db.todoPeople, db.todoTags, db.todoOrgs, db.todoEvents,
    db.people, db.tags, db.orgs, db.statuses, db.projects,
  ]
  const todoIds = await db.transaction('rw', tables, async () => {
    // --- Entity resolution (by name; create missing) ---
    const peopleByName = byNameIndex(await db.people.toArray())
    const tagsByName = byNameIndex(await db.tags.toArray())
    const orgsByName = byNameIndex(await db.orgs.toArray())
    const existingStatuses = await db.statuses.toArray()
    const statusesByName = byNameIndex(existingStatuses)
    let nextStatusSort = existingStatuses.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1
    const canvasProjects = opts.canvasId != null
      ? await db.projects.where('canvasId').equals(opts.canvasId).toArray()
      : []
    const projectsByName = byNameIndex(canvasProjects)
    let nextProjectSort = (await db.projects.toArray()).reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1
    let nextProjectX = canvasProjects.length === 0
      ? 0
      : Math.max(...canvasProjects.map((p) => p.positionX + (p.width ?? DEFAULT_PROJECT_WIDTH))) + NEW_PROJECT_GAP
    const newProjectY = canvasProjects.length === 0 ? 0 : Math.min(...canvasProjects.map((p) => p.positionY))
    const clamp = (n: number) => (opts.maxExtent != null ? Math.max(-opts.maxExtent, Math.min(opts.maxExtent, n)) : n)

    const incomingPeople = new Map(data.people.map((p) => [p.id, p]))
    const incomingTags = new Map((data.tags ?? []).map((t) => [t.id, t]))
    const incomingOrgs = new Map(data.orgs.map((o) => [o.id, o]))
    const incomingStatuses = new Map(data.statuses.map((s) => [s.id, s]))
    const incomingProjects = new Map(data.projects.map((p) => [p.id, p]))

    // incoming id → resolved id (memoized so each entity resolves once)
    const personMap = new Map<number, number>()
    const tagMap = new Map<number, number>()
    const orgMap = new Map<number, number>()
    const statusMap = new Map<number, number>()
    const projectMap = new Map<number, number>()

    const resolvePerson = async (incomingId: number): Promise<number | undefined> => {
      const hit = personMap.get(incomingId)
      if (hit != null) return hit
      const row = incomingPeople.get(incomingId)
      if (!row) return undefined
      let id = peopleByName.get(nameKey(row.name))
      if (id == null) {
        id = await db.people.add({ name: row.name.trim(), initials: row.initials } as Person) as number
        peopleByName.set(nameKey(row.name), id)
        created.people.push(row.name.trim())
      }
      personMap.set(incomingId, id)
      return id
    }
    const resolveTag = async (incomingId: number): Promise<number | undefined> => {
      const hit = tagMap.get(incomingId)
      if (hit != null) return hit
      const row = incomingTags.get(incomingId)
      if (!row) return undefined
      let id = tagsByName.get(nameKey(row.name))
      if (id == null) {
        id = await db.tags.add({ name: row.name.trim(), color: row.color } as Tag) as number
        tagsByName.set(nameKey(row.name), id)
        created.tags.push(row.name.trim())
      }
      tagMap.set(incomingId, id)
      return id
    }
    const resolveOrg = async (incomingId: number): Promise<number | undefined> => {
      const hit = orgMap.get(incomingId)
      if (hit != null) return hit
      const row = incomingOrgs.get(incomingId)
      if (!row) return undefined
      let id = orgsByName.get(nameKey(row.name))
      if (id == null) {
        const org: Org = { name: row.name.trim() }
        if (row.initials != null) org.initials = row.initials
        if (row.color != null) org.color = row.color
        id = await db.orgs.add(org) as number
        orgsByName.set(nameKey(row.name), id)
        created.orgs.push(org.name)
      }
      orgMap.set(incomingId, id)
      return id
    }
    const resolveStatus = async (incomingId: number | undefined): Promise<number | undefined> => {
      if (incomingId == null) return undefined
      const hit = statusMap.get(incomingId)
      if (hit != null) return hit
      const row = incomingStatuses.get(incomingId)
      if (!row) return undefined
      let id = statusesByName.get(nameKey(row.name))
      if (id == null) {
        const status: Status = { name: row.name.trim(), color: row.color, sortOrder: nextStatusSort++ }
        if (row.icon != null) status.icon = row.icon
        if (row.hideByDefault != null) status.hideByDefault = row.hideByDefault
        id = await db.statuses.add(status) as number
        statusesByName.set(nameKey(row.name), id)
        created.statuses.push(status.name)
      }
      statusMap.set(incomingId, id)
      return id
    }
    const resolveProject = async (incomingId: number | undefined): Promise<number | undefined> => {
      if (opts.canvasId == null) return undefined
      const row = incomingId != null ? incomingProjects.get(incomingId) : undefined
      if (incomingId == null || !row) return opts.fallbackProjectId
      const hit = projectMap.get(incomingId)
      if (hit != null) return hit
      let id = projectsByName.get(nameKey(row.name))
      if (id == null) {
        const project: Project = {
          name: row.name.trim(),
          canvasId: opts.canvasId,
          positionX: clamp(nextProjectX),
          positionY: clamp(newProjectY),
          isCollapsed: false,
          sortOrder: nextProjectSort++,
          createdAt: new Date(),
        }
        if (row.color != null) project.color = row.color
        if (row.width != null) project.width = row.width
        if (row.groupBy !== undefined) project.groupBy = row.groupBy
        if (row.groupOrder != null) project.groupOrder = row.groupOrder
        nextProjectX += (row.width ?? DEFAULT_PROJECT_WIDTH) + NEW_PROJECT_GAP
        id = await db.projects.add(project) as number
        projectsByName.set(nameKey(row.name), id)
        created.projects.push(project.name)
      }
      projectMap.set(incomingId, id)
      return id
    }

    // --- Tasks ---
    let nextSort = (await db.todos.toArray()).reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1
    const todoIdMap = new Map<number, number>() // incoming id → new id
    const newIds: number[] = []
    for (const t of selected) {
      const uidTaken = (await db.todos.where('uid').equals(t.uid).count()) > 0
      const row: TodoItem = {
        uid: uidTaken ? newTodoUid() : t.uid,
        title: t.title,
        isCompleted: t.isCompleted,
        createdAt: t.createdAt,
        modifiedAt: t.modifiedAt,
        sortOrder: nextSort++,
      }
      if (t.notes != null) row.notes = t.notes
      if (t.progress != null) row.progress = t.progress
      if (t.isCompleted && t.completedAt != null) row.completedAt = t.completedAt
      if (t.scheduledDate != null) row.scheduledDate = t.scheduledDate
      if (t.dueDate != null) row.dueDate = t.dueDate
      if (t.recurrenceRule != null) row.recurrenceRule = t.recurrenceRule
      const statusId = await resolveStatus(t.statusId)
      if (statusId != null) row.statusId = statusId
      if (opts.canvasId != null) {
        row.canvasId = opts.canvasId
        const projectId = await resolveProject(t.projectId)
        if (projectId != null) row.projectId = projectId
      }
      const id = await db.todos.add(row) as number
      if (t.id != null) todoIdMap.set(t.id, id)
      newIds.push(id)
    }

    // --- Joins (deduplicated per resolved pair) ---
    const seen = new Set<string>()
    const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true))
    for (const r of data.todoPeople) {
      const todoId = todoIdMap.get(r.todoId)
      const personId = todoId != null ? await resolvePerson(r.personId) : undefined
      if (todoId == null || personId == null || !once(`p:${todoId}:${personId}`)) continue
      await db.todoPeople.add({ todoId, personId })
    }
    for (const r of data.todoTags ?? []) {
      const todoId = todoIdMap.get(r.todoId)
      const tagId = todoId != null ? await resolveTag(r.tagId) : undefined
      if (todoId == null || tagId == null || !once(`t:${todoId}:${tagId}`)) continue
      await db.todoTags.add({ todoId, tagId })
    }
    for (const r of data.todoOrgs) {
      const todoId = todoIdMap.get(r.todoId)
      const orgId = todoId != null ? await resolveOrg(r.orgId) : undefined
      if (todoId == null || orgId == null || !once(`o:${todoId}:${orgId}`)) continue
      await db.todoOrgs.add({ todoId, orgId })
    }

    // --- History ---
    // Lookup only — a status that only appears in history isn't worth
    // creating; an unresolvable value becomes null ("no status").
    const remapStatusValue = (v: string | number | null): string | number | null => {
      if (typeof v !== 'number') return v
      const resolved = statusMap.get(v)
      if (resolved != null) return resolved
      const row = incomingStatuses.get(v)
      return (row && statusesByName.get(nameKey(row.name))) ?? null
    }
    const events: TodoEvent[] = []
    for (const e of data.todoEvents) {
      const todoId = todoIdMap.get(e.todoId)
      if (todoId == null) continue
      const isStatus = e.type === 'status'
      events.push({
        todoId,
        type: e.type,
        fromValue: isStatus ? remapStatusValue(e.fromValue) : e.fromValue,
        toValue: isStatus ? remapStatusValue(e.toValue) : e.toValue,
        timestamp: e.timestamp,
      })
    }
    if (events.length > 0) await db.todoEvents.bulkAdd(events)

    return newIds
  })

  return { imported: todoIds.length, skipped, todoIds, created }
}
