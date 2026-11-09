import { CURRENT_DB_VERSION, db } from '../data/database'
import { prepareImportText, TASK_ARCHIVE_KIND } from '../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../data/file-version'
import type {
  TodoItem, TodoPerson, TodoTag, TodoEvent, StatusUpdate, Subtask, Person, Tag, Status,
} from '../models'

/**
 * A task archive: the file "Export & delete" writes before purging
 * old completed tasks. Same envelope as a full export (`__schemaVersion`,
 * `exportedAt`) plus `kind: 'task-archive'`, carrying only the archived
 * tasks and what is needed to re-attach them on an append import:
 *
 * - `todos` and their `todoPeople` / `todoTags` join rows,
 *   `todoEvents` history, `statusUpdates` and `subtasks`;
 * - the referenced `people` / `tags` / `statuses` rows (people and tags
 *   their `person` / `tag` events name too), so the append import can
 *   match them **by name** in another database.
 *
 * It imports through the same pipeline as everything else
 * (`prepareImport(…, { purpose: 'append' })` — the schema transforms tolerate
 * the missing tables), so an archive written today still loads after later
 * schema changes, as long as its version is at or above the floor
 * (`OLDEST_SUPPORTED_DB_VERSION`); one from below it is refused.
 */
export interface TaskArchive {
  [SCHEMA_VERSION_KEY]: number
  kind: typeof TASK_ARCHIVE_KIND
  exportedAt: string
  todos: TodoItem[]
  todoPeople: TodoPerson[]
  todoTags: TodoTag[]
  todoEvents: TodoEvent[]
  statusUpdates: StatusUpdate[]
  subtasks: Subtask[]
  people: Person[]
  tags: Tag[]
  statuses: Status[]
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
    [db.todos, db.todoPeople, db.todoTags, db.todoEvents, db.statusUpdates, db.subtasks, db.people, db.tags, db.statuses],
    async () => {
      const todos = (await db.todos.bulkGet(ids)).filter((t): t is TodoItem => t != null)
      const presentIds = todos.map((t) => t.id).filter((id): id is number => id != null)
      const [todoPeople, todoTags, todoEvents, statusUpdates, subtasks] = await Promise.all([
        db.todoPeople.where('todoId').anyOf(presentIds).toArray(),
        db.todoTags.where('todoId').anyOf(presentIds).toArray(),
        db.todoEvents.where('todoId').anyOf(presentIds).toArray(),
        db.statusUpdates.where('todoId').anyOf(presentIds).toArray(),
        db.subtasks.where('todoId').anyOf(presentIds).toArray(),
      ])
      // The people and tags their history names too (a person removed
      // since), so the append import can match those events by name.
      const historyIds = (type: 'person' | 'tag') => todoEvents.flatMap((e) => {
        const id = e.type === type ? e.toValue ?? e.fromValue : null
        return typeof id === 'number' ? [id] : []
      })
      const [people, tags, statuses] = await Promise.all([
        db.people.bulkGet(definedIds([...todoPeople.map((r) => r.personId), ...historyIds('person')])),
        db.tags.bulkGet(definedIds([...todoTags.map((r) => r.tagId), ...historyIds('tag')])),
        db.statuses.bulkGet(definedIds(todos.map((t) => t.statusId))),
      ])
      return {
        [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
        kind: TASK_ARCHIVE_KIND,
        exportedAt: now.toISOString(),
        todos,
        todoPeople,
        todoTags,
        todoEvents,
        statusUpdates,
        subtasks,
        people: people.filter((r): r is Person => r != null),
        tags: tags.filter((r): r is Tag => r != null),
        statuses: statuses.filter((r): r is Status => r != null),
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
