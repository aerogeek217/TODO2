import { useSubtaskStore } from '../stores/subtask-store'
import { useUndoStore } from '../stores/undo-store'
import { subtaskTitle } from '../utils/subtasks'
import { shortTitle as short } from '../utils/text'
import { listMarker, type ConvertLine } from './note-lines'

/** One subtask a converted note line makes: a plain title (no parsing) and its done state. */
export interface NoteSubtaskDraft {
  title: string
  done: boolean
}

/**
 * Where a task's notes convert to: adds the drafts to that task's checklist,
 * last and in order, then awaits `writeNote` (the note's own change, so a
 * stored task's Undo takes both). Resolves false when nothing was added: the
 * note is left as it is.
 */
export type NoteSubtaskTarget = (drafts: readonly NoteSubtaskDraft[], writeNote: () => Promise<void>) => Promise<boolean>

/**
 * The subtasks `lines` make, in note order: each line, then the list lines
 * indented under it — the checklist has one level, so they sit side by side.
 * A done box is a done subtask. Titles are as stored (`subtaskTitle`); a
 * line left with none makes no subtask, and the rest still convert.
 */
export function noteSubtaskDrafts(lines: readonly ConvertLine[]): NoteSubtaskDraft[] {
  return lines.flatMap((line) => [
    { title: line.body, done: listMarker(line.text)?.kind === 'done' },
    ...(line.subtasks ?? []).map((s) => ({ title: s.title, done: s.done })),
  ]).map((d) => ({ ...d, title: subtaskTitle(d.title) })).filter((d) => d.title !== '')
}

/**
 * Note lines → subtasks of stored task `todoId`, with the note's change, as
 * one undo step (the snackbar's). A draft with no title (`subtaskTitle`) is
 * skipped; with none left, nothing happens. A write that fails takes back
 * what went in and leaves the note alone; the store has said what failed.
 */
export function addSubtasksFromNote(
  todoId: number,
  given: readonly NoteSubtaskDraft[],
  writeNote: () => Promise<void>,
): Promise<boolean> {
  const drafts = given.map((d) => ({ ...d, title: subtaskTitle(d.title) })).filter((d) => d.title !== '')
  if (drafts.length === 0) return Promise.resolve(false)
  const [only] = drafts
  const description = drafts.length === 1 && only ? `Added subtask “${short(only.title)}”` : `Added ${drafts.length} subtasks`
  return useUndoStore.getState().runGroup(description, async (token) => {
    for (const draft of drafts) {
      const added = await useSubtaskStore.getState().add(todoId, draft.title, { done: draft.done })
      if (!added) {
        await useUndoStore.getState().abortGroup(token, description)
        return false
      }
    }
    await writeNote()
    return true
  })
}
