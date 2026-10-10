import { CURRENT_DB_VERSION, db } from '../data/database'
import { prepareImportText, TASK_ARCHIVE_KIND } from '../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from './migration-check'
import type {
  TodoItem, TodoPerson, TodoTag, TodoOrg, TodoEvent, Person, Tag, Org, Status, Project,
} from '../models'

/**
 * A task archive: the file "Export & delete" writes before purging
 * old completed tasks. Same envelope as a full export (`__schemaVersion`,
 * `exportedAt`) plus `kind: 'task-archive'`, carrying only the archived
 * tasks and what is needed to re-attach them on an append import:
 *
 * - `todos` and their `todoPeople` / `todoTags` / `todoOrgs` join rows and
 *   `todoEvents` history;
 * - the referenced `people` / `tags` / `orgs` / `statuses` / `projects` rows,
 *   so the append import can match them **by name** in another database.
 *
 * It imports through the same pipeline as everything else
 * (`prepareImport(…, { purpose: 'append' })` — the schema transforms tolerate
 * the missing tables), so an archive written today still loads after later
 * schema changes.
 */
export interface TaskArchive {
  [SCHEMA_VERSION_KEY]: number
  kind: typeof TASK_ARCHIVE_KIND
  exportedAt: string
  todos: TodoItem[]
  todoPeople: TodoPerson[]
  todoTags: TodoTag[]
  todoOrgs: TodoOrg[]
  todoEvents: TodoEvent[]
  people: Person[]
  tags: Tag[]
  orgs: Org[]
  statuses: Status[]
  projects: Project[]
}

function definedIds(ids: Iterable<number | undefined>): number[] {
  const out = new Set<number>()
  for (const id of ids) if (id != null) out.add(id)
  return [...out]
}

/**
 * Reads the given tasks and everything they reference in one read-only
 * transaction (a consistent snapshot, like `buildExportData`). Ids that no
 * longer exist are skipped.
 */
export async function buildTaskArchive(todoIds: readonly number[], now: Date = new Date()): Promise<TaskArchive> {
  const ids = [...new Set(todoIds)]
  return db.transaction(
    'r',
    [db.todos, db.todoPeople, db.todoTags, db.todoOrgs, db.todoEvents, db.people, db.tags, db.orgs, db.statuses, db.projects],
    async () => {
      const todos = (await db.todos.bulkGet(ids)).filter((t): t is TodoItem => t != null)
      const presentIds = todos.map((t) => t.id).filter((id): id is number => id != null)
      const [todoPeople, todoTags, todoOrgs, todoEvents] = await Promise.all([
        db.todoPeople.where('todoId').anyOf(presentIds).toArray(),
        db.todoTags.where('todoId').anyOf(presentIds).toArray(),
        db.todoOrgs.where('todoId').anyOf(presentIds).toArray(),
        db.todoEvents.where('todoId').anyOf(presentIds).toArray(),
      ])
      const [people, tags, orgs, statuses, projects] = await Promise.all([
        db.people.bulkGet(definedIds(todoPeople.map((r) => r.personId))),
        db.tags.bulkGet(definedIds(todoTags.map((r) => r.tagId))),
        db.orgs.bulkGet(definedIds(todoOrgs.map((r) => r.orgId))),
        db.statuses.bulkGet(definedIds(todos.map((t) => t.statusId))),
        db.projects.bulkGet(definedIds(todos.map((t) => t.projectId))),
      ])
      return {
        [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
        kind: TASK_ARCHIVE_KIND,
        exportedAt: now.toISOString(),
        todos,
        todoPeople,
        todoTags,
        todoOrgs,
        todoEvents,
        people: people.filter((r): r is Person => r != null),
        tags: tags.filter((r): r is Tag => r != null),
        orgs: orgs.filter((r): r is Org => r != null),
        statuses: statuses.filter((r): r is Status => r != null),
        projects: projects.filter((r): r is Project => r != null),
      }
    },
  )
}

/** `todo2-archive-<timestamp>.json`, same timestamp style as full exports. */
export function taskArchiveFileName(now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `todo2-archive-${timestamp}.json`
}

/**
 * Self-check: would this archive load through "Import tasks (append)…"?
 * `null` when yes, else the validator's message. Run before anything is
 * deleted — an archive that can't be re-imported is no safety net.
 */
export function selfCheckTaskArchiveJson(json: string): string | null {
  const result = prepareImportText(json, { purpose: 'append' })
  return result.ok ? null : result.error
}
