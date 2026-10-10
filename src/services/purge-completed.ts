import type { PersistedTodoItem } from '../models'
import { todoRepository } from '../data/todo-repository'
import { useTodoStore } from '../stores/todo-store'
import { selectExpiredCompleted } from '../utils/completed-at'
import { buildTaskArchive, selfCheckTaskArchiveJson, taskArchiveFileName } from './task-archive'
import { saveTextFile } from './save-file'

/**
 * Completed tasks past `retentionDays`, read from the database (the todo
 * store may hold only one canvas's tasks). With `uids`, only those tasks —
 * the launch prompt keeps the set it found at launch.
 */
export async function listExpiredCompleted(
  retentionDays: number,
  uids?: ReadonlySet<string>,
): Promise<PersistedTodoItem[]> {
  const rows = uids ? await todoRepository.getByUids([...uids]) : await todoRepository.getAll()
  return selectExpiredCompleted(rows, retentionDays)
}

export type ExportAndPurgeResult =
  | { status: 'done'; deleted: number; saved: 'saved' | 'downloaded'; fileName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

/**
 * "Export & delete": writes the given completed tasks to a task
 * archive file, then deletes exactly the archived tasks.
 *
 * Nothing is deleted unless the archive passes the append-import self-check
 * and the file was handed over (picker save or download). Cancelling the
 * picker deletes nothing. The deletion itself goes through
 * `purgeCompleted` (backup snapshot first; reopened tasks skipped).
 */
export async function exportAndPurgeCompleted(ids: readonly number[]): Promise<ExportAndPurgeResult> {
  const now = new Date()
  const archive = await buildTaskArchive(ids, now)
  if (archive.todos.length === 0) return { status: 'error', message: 'Those tasks no longer exist.' }

  const json = JSON.stringify(archive, null, 2)
  const problem = selfCheckTaskArchiveJson(json)
  if (problem) {
    console.warn(`[archive] task archive would not re-import: ${problem}`)
    return { status: 'error', message: `Nothing was deleted — the archive would not import back: ${problem}` }
  }

  const fileName = taskArchiveFileName(now)
  const saved = await saveTextFile({
    text: json,
    suggestedName: fileName,
    description: 'TODO2 task archive',
    mimeType: 'application/json',
    extension: '.json',
  })
  if (saved === 'cancelled') return { status: 'cancelled' }

  const archivedIds = archive.todos.map((t) => t.id).filter((id): id is number => id != null)
  const deleted = await useTodoStore.getState().purgeCompleted(archivedIds)
  return { status: 'done', deleted, saved, fileName }
}
