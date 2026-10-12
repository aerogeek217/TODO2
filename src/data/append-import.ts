import { db } from './database'
import type { ImportData } from './import-validation'
import type {
  TodoItem, TodoEvent, Person, Tag, Status,
} from '../models'
import { newTodoUid } from '../utils/todo-uid'

/** Per incoming task: `import` (default) or `skip`. Keyed by the incoming `uid`. */
export type AppendChoice = 'skip' | 'import'

export interface AppendImportResult {
  imported: number
  skipped: number
  /** New database ids of the imported tasks, in file order. */
  todoIds: number[]
  /** Names of entities created because no existing one matched. */
  created: { people: string[]; tags: string[]; statuses: string[] }
}

/** Name key for by-name matching: trimmed, case-insensitive. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

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
 * `prepareImport(…, { purpose: 'append' })`) to the current database.
 * One read-write transaction:
 *
 * - **New ids** for every task (ids are never reused); the incoming `uid` is
 *   kept unless a task in the database already has it, then a fresh one is
 *   minted.
 * - People / tags / statuses are matched to existing rows **by name**
 *   (trimmed, case-insensitive); missing ones are created from the file's
 *   row. (Files from before projects became tags arrive with their projects
 *   already turned into `Project: <name>` tags by the upgrade pipeline.)
 * - Join rows (`todoPeople` / `todoTags`) and the tasks'
 *   `todoEvents` history are re-pointed at the new ids (status-change event
 *   values at the resolved status ids).
 * - Tasks whose `choices` entry is `skip` are left out with their rows.
 *
 * No backup snapshot and no store refresh — the caller does both.
 */
export async function appendImportTasks(
  data: ImportData,
  choices: ReadonlyMap<string, AppendChoice>,
): Promise<AppendImportResult> {
  const selected = data.todos.filter((t) => (choices.get(t.uid) ?? 'import') === 'import')
  const skipped = data.todos.length - selected.length
  const created: AppendImportResult['created'] = { people: [], tags: [], statuses: [] }

  const tables = [
    db.todos, db.todoPeople, db.todoTags, db.todoEvents,
    db.people, db.tags, db.statuses,
  ]
  const todoIds = await db.transaction('rw', tables, async () => {
    // --- Entity resolution (by name; create missing) ---
    const peopleByName = byNameIndex(await db.people.toArray())
    const tagsByName = byNameIndex(await db.tags.toArray())
    const existingStatuses = await db.statuses.toArray()
    const statusesByName = byNameIndex(existingStatuses)
    let nextStatusSort = existingStatuses.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1

    const incomingPeople = new Map(data.people.map((p) => [p.id, p]))
    const incomingTags = new Map((data.tags ?? []).map((t) => [t.id, t]))
    const incomingStatuses = new Map(data.statuses.map((s) => [s.id, s]))

    // incoming id → resolved id (memoized so each entity resolves once)
    const personMap = new Map<number, number>()
    const tagMap = new Map<number, number>()
    const statusMap = new Map<number, number>()

    const resolvePerson = async (incomingId: number): Promise<number | undefined> => {
      const hit = personMap.get(incomingId)
      if (hit != null) return hit
      const row = incomingPeople.get(incomingId)
      if (!row) return undefined
      let id = peopleByName.get(nameKey(row.name))
      if (id == null) {
        const person: Person = { name: row.name.trim(), initials: row.initials }
        if (row.color != null) person.color = row.color
        if (row.email != null) person.email = row.email
        id = await db.people.add(person) as number
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
        id = await db.statuses.add(status) as number
        statusesByName.set(nameKey(row.name), id)
        created.statuses.push(status.name)
      }
      statusMap.set(incomingId, id)
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
      if (t.dueDate != null) row.dueDate = t.dueDate
      if (t.lastFollowupAt != null) row.lastFollowupAt = t.lastFollowupAt
      if (t.nextFollowupAt != null) row.nextFollowupAt = t.nextFollowupAt
      if (t.recurrenceRule != null) row.recurrenceRule = t.recurrenceRule
      if (t.focus === true) row.focus = true
      if (t.urgent === true) row.urgent = true
      if (t.important === true) row.important = true
      const statusId = await resolveStatus(t.statusId)
      if (statusId != null) row.statusId = statusId
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
