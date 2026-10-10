import type { PersistedTodoItem, TodoItem } from '../models'
import type { ImportData } from '../data/import-validation'
import { todoRepository } from '../data/todo-repository'
import { appendImportTasks, nameKey, type AppendChoice, type AppendImportResult } from '../data/append-import'
import { backupScheduler } from './backup-scheduler'
import { ensureDefaultProject } from './ensure-default-project'
import { getCanvasMaxExtent } from '../utils/canvas-bounds'
import { useCanvasStore } from '../stores/canvas-store'
import { useTodoStore } from '../stores/todo-store'
import { useProjectStore } from '../stores/project-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import { useStatusStore } from '../stores/status-store'

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
 * Runs a confirmed append import: backup snapshot → `appendImportTasks` on
 * the selected canvas → reload the affected stores.
 *
 * Tasks whose project isn't in the file land in the canvas's default project
 * (`ensureDefaultProject`), resolved only when such a task is imported.
 */
export async function runAppendImport(
  data: ImportData,
  choices: ReadonlyMap<string, AppendChoice>,
): Promise<AppendImportResult> {
  await backupScheduler.snapshotBeforeDestructive().catch((e) => console.warn('backup snapshot failed', e))

  const canvasId = useCanvasStore.getState().selectedCanvasId ?? undefined
  const projectIds = new Set(data.projects.map((p) => p.id))
  const needsFallback = data.todos.some((t) =>
    (choices.get(t.uid) ?? 'import') === 'import' && (t.projectId == null || !projectIds.has(t.projectId)),
  )
  let fallbackProjectId: number | undefined
  if (canvasId != null && needsFallback) {
    // `ensureDefaultProject` reads the project store — make sure it's loaded,
    // or it would create an Inbox next to existing projects.
    await useProjectStore.getState().ensureAllLoaded()
    fallbackProjectId = await ensureDefaultProject(canvasId)
  }

  const result = await appendImportTasks(data, choices, {
    canvasId,
    fallbackProjectId,
    maxExtent: getCanvasMaxExtent(),
  })

  await Promise.all([
    useTodoStore.getState().loadAll(),
    useProjectStore.getState().loadAll(),
    usePersonStore.getState().load(),
    useTagStore.getState().load(),
    useOrgStore.getState().load(),
    useStatusStore.getState().load(),
  ])
  const todoIds = useTodoStore.getState().todos.map((t) => t.id)
  await Promise.all([
    usePersonStore.getState().loadAssignments(todoIds),
    useOrgStore.getState().loadAssignments(todoIds),
    useTagStore.getState().loadAssignments(todoIds),
  ])
  return result
}
