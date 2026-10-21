import type { PersistedTodoItem, TodoItem } from '../models'
import type { ImportData } from '../data/import-validation'
import { todoRepository } from '../data/todo-repository'
import { appendImportTasks, nameKey, type AppendChoice, type AppendImportResult } from '../data/append-import'
import { replaceData } from './replace-data'

export type { AppendChoice, AppendImportResult }

export interface AppendDuplicate {
  /** `uid`: the same task (by identity) is already in the database. `title`: an active task has the same title. */
  reason: 'uid' | 'title'
  existing: PersistedTodoItem
}

export interface AppendCandidate {
  incoming: TodoItem
  duplicate: AppendDuplicate | null
}

/**
 * Duplicate detection for an append import: an
 * incoming task is a duplicate when a task in the database has the same
 * `uid` (any task, completed or not), or else when an **active**
 * (not completed) task has the same title — trimmed, case-insensitive.
 * Returns one candidate per incoming task, in file order.
 */
export function findAppendDuplicates(
  incoming: readonly TodoItem[],
  existing: readonly PersistedTodoItem[],
): AppendCandidate[] {
  const byUid = new Map(existing.map((t) => [t.uid, t]))
  const activeByTitle = new Map<string, PersistedTodoItem>()
  for (const t of existing) {
    if (t.isCompleted) continue
    const k = nameKey(t.title)
    if (!activeByTitle.has(k)) activeByTitle.set(k, t)
  }
  return incoming.map((t) => {
    const sameUid = byUid.get(t.uid)
    if (sameUid) return { incoming: t, duplicate: { reason: 'uid', existing: sameUid } }
    const sameTitle = activeByTitle.get(nameKey(t.title))
    if (sameTitle) return { incoming: t, duplicate: { reason: 'title', existing: sameTitle } }
    return { incoming: t, duplicate: null }
  })
}

/** `findAppendDuplicates` against every task in the database. */
export async function findAppendDuplicatesInDb(incoming: readonly TodoItem[]): Promise<AppendCandidate[]> {
  return findAppendDuplicates(incoming, await todoRepository.getAll())
}

/** Starting choices for the picker: duplicates are skipped, everything else imported. */
export function defaultAppendChoices(candidates: readonly AppendCandidate[]): Map<string, AppendChoice> {
  return new Map(candidates.map((c) => [c.incoming.uid, c.duplicate ? 'skip' : 'import']))
}

/**
 * An append import's outcome. `cancelled`: the backup snapshot failed and the
 * user didn't continue without one — nothing was imported.
 */
export type RunAppendImportOutcome =
  | (AppendImportResult & { status: 'done'; noBackup: boolean })
  | { status: 'cancelled' }

/**
 * Runs a confirmed append import through `replaceData`: note saves held,
 * backup snapshot (`takeSafetySnapshot`) → `appendImportTasks` → the task
 * stores reload.
 */
export async function runAppendImport(
  data: ImportData,
  choices: ReadonlyMap<string, AppendChoice>,
): Promise<RunAppendImportOutcome> {
  const outcome = await replaceData('append-import', {
    backup: { operation: 'importing the tasks' },
    write: () => appendImportTasks(data, choices),
  })
  if (outcome.status === 'cancelled') return outcome
  return { ...outcome.result, status: 'done', noBackup: outcome.noBackup }
}
