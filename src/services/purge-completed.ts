import type { PersistedTodoItem } from '../models'
import { todoRepository } from '../data/todo-repository'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { selectExpiredCompleted } from '../utils/completed-at'
import { buildTaskArchive, selfCheckTaskArchiveJson, taskArchiveFileName } from './task-archive'
import { saveTextFile } from './save-file'

/**
 * Completed tasks past `retentionDays`, read from the database (the todo
 * store may not be loaded yet). With `uids`, only those tasks —
 * the launch prompt keeps the set it found at launch.
 */
export async function listExpiredCompleted(
  retentionDays: number,
  uids?: ReadonlySet<string>,
): Promise<PersistedTodoItem[]> {
  const rows = uids ? await todoRepository.getByUids([...uids]) : await todoRepository.getAll()
  return selectExpiredCompleted(rows, retentionDays)
}

/**
 * `kept`: the archive was handed over but nothing was deleted —
 * `unconfirmed`: it went out as a plain download and the user didn't confirm
 * it saved; `no-backup`: the backup snapshot failed and the user cancelled.
 */
export type ExportAndPurgeResult =
  | { status: 'done'; deleted: number; saved: 'saved' | 'downloaded'; fileName: string; noBackup: boolean }
  | { status: 'kept'; reason: 'unconfirmed' | 'no-backup'; fileName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * "Export & delete": writes the given completed tasks to a task
 * archive file, then deletes exactly the archived tasks.
 *
 * Nothing is deleted unless the archive passes the append-import self-check
 * and the file was saved. Cancelling the picker deletes nothing. A plain
 * download (no File System Access API, or the picker write failed) can't be
 * confirmed by the app, so the user is asked "Did the file save?" first
 * (Cancel is the default). The deletion itself goes through
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
  if (saved === 'downloaded') {
    const count = plural(archivedIds.length, 'task')
    const confirmed = await useUIStore.getState().askConfirmation({
      title: 'Did the file save?',
      message: `${fileName} was handed to the browser as a download, so TODO2 can't tell whether it was saved. `
        + `Check your downloads before deleting ${count}.`,
      confirmLabel: `Delete ${count}`,
      cancelLabel: 'Cancel',
      danger: true,
      cancelIsDefault: true,
    })
    if (!confirmed) return { status: 'kept', reason: 'unconfirmed', fileName }
  }

  const outcome = await useTodoStore.getState().purgeCompleted(archivedIds)
  if (outcome.status === 'cancelled') return { status: 'kept', reason: 'no-backup', fileName }
  return { status: 'done', deleted: outcome.deleted, saved, fileName, noBackup: outcome.noBackup }
}

/**
 * What Export & delete says when it's done: the archive saved through the
 * save dialog, or handed over as a plain download (the user confirmed it
 * saved before anything was deleted).
 */
export function doneMessage(result: Extract<ExportAndPurgeResult, { status: 'done' }>): string {
  const count = plural(result.deleted, 'task')
  return result.saved === 'saved'
    ? `Saved ${count} to ${result.fileName} and deleted them.`
    : `Downloaded ${result.fileName} (${count}) and deleted them — the file is in your Downloads folder.`
}

/** What the purge dialogs say when Export & delete saved a file but deleted nothing. */
export function keptMessage(result: Extract<ExportAndPurgeResult, { status: 'kept' }>): string {
  return result.reason === 'unconfirmed'
    ? `Nothing was deleted. Check that ${result.fileName} saved, then try again.`
    : `Nothing was deleted — the backup could not be saved. The archive ${result.fileName} was saved.`
}
