import { parseInput } from './natural-language-parser'
import { resolveInput, resolveTags, resolveUnmatchedPeople, type ResolvedInput } from './nlp-resolver'
import { makeRecurrenceRule } from './recurrence'
import { runNlpMetadataTransaction } from '../data'
import type { Person, Status, PersistedTodoItem, TodoChanges } from '../models'

export interface NlpCreateResult {
  title: string
  resolved: ResolvedInput
}

/**
 * Parse raw input text and resolve against known people / statuses. Returns the cleaned title and resolved metadata.
 */
export function parseTaskInput(
  rawTitle: string,
  people: Person[],
  statuses: Status[] = [],
): NlpCreateResult {
  const parsed = parseInput(rawTitle)
  const resolved = resolveInput(parsed, people, statuses)
  return { title: resolved.title, resolved }
}

/**
 * Apply resolved NLP metadata to a newly created task.
 * Writes the due date / status / markers / next follow-up (`/followup`
 * replaces the default; `none` clears it) and assigns people. Recurrence anchors
 * to the due date; without one the recurrence is dropped. `@name` tokens
 * that matched nobody create the person first (lookup-or-create via
 * `person-store`), then are assigned like matched people. Tags go through the
 * registry (resolve-or-create via `tag-store`) after the transaction — they
 * live in the normalized `tags`+`todoTags` tables and don't need to be atomic
 * with person assignment.
 */
export async function applyNlpMetadata(
  todoId: number,
  resolved: ResolvedInput,
  getTodo: (id: number) => PersistedTodoItem | undefined,
  updateTodo: (id: number, changes: TodoChanges) => Promise<void>,
  assignPerson: (todoId: number, personId: number) => Promise<void>,
): Promise<void> {
  const hasUpdates =
    resolved.dueDate !== undefined ||
    resolved.recurrence !== undefined ||
    resolved.statusId !== undefined ||
    resolved.urgent === true || resolved.important === true || resolved.focus === true ||
    resolved.nextFollowupAt !== undefined || resolved.followupNone === true
  const hasTags = resolved.tags.length > 0
  const personIds = [...resolved.personIds]
  if (resolved.unmatchedPersons.length > 0) {
    const { usePersonStore } = await import('../stores/person-store')
    const created = await resolveUnmatchedPeople(resolved.unmatchedPersons, {
      personStore: usePersonStore.getState(),
    })
    for (const id of created) if (!personIds.includes(id)) personIds.push(id)
  }
  const hasAssignments = personIds.length > 0
  if (!hasUpdates && !hasAssignments && !hasTags) return

  if (hasUpdates || hasAssignments) {
    await runNlpMetadataTransaction(async () => {
      // Update task properties if any were parsed
      if (hasUpdates) {
        const todo = getTodo(todoId)
        if (todo) {
          const changes: TodoChanges = {}
          if (resolved.dueDate !== undefined) changes.dueDate = resolved.dueDate
          if (resolved.recurrence) {
            const due = resolved.dueDate ?? todo.dueDate
            changes.recurrenceRule = due ? makeRecurrenceRule(resolved.recurrence, due) : undefined
          }
          if (resolved.statusId !== undefined) changes.statusId = resolved.statusId
          if (resolved.urgent) changes.urgent = true
          if (resolved.important) changes.important = true
          if (resolved.focus) changes.focus = true
          // `/followup` replaces the default next follow-up; `none` drops it.
          if (resolved.followupNone) changes.nextFollowupAt = undefined
          else if (resolved.nextFollowupAt !== undefined) changes.nextFollowupAt = resolved.nextFollowupAt
          await updateTodo(todoId, changes)
        }
      }

      // Assign people
      for (const personId of personIds) {
        await assignPerson(todoId, personId)
      }
    })
  }

  if (hasTags) {
    const { useTagStore } = await import('../stores/tag-store')
    const ids = await resolveTags(resolved.tags, { tagStore: useTagStore.getState() })
    for (const tagId of ids) {
      await useTagStore.getState().assignTag(todoId, tagId)
    }
  }
}
