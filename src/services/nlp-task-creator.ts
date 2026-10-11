import { parseInput } from './natural-language-parser'
import { resolveInput, resolveTags, type ResolvedInput } from './nlp-resolver'
import { makeRecurrenceRule } from './recurrence'
import { runNlpMetadataTransaction } from '../data'
import type { Person, Project, Status, PersistedTodoItem } from '../models'

export interface NlpCreateResult {
  title: string
  resolved: ResolvedInput
}

/**
 * Parse raw input text and resolve against known people / projects /
 * statuses. Returns the cleaned title and resolved metadata.
 */
export function parseTaskInput(
  rawTitle: string,
  people: Person[],
  projects: Project[] = [],
  statuses: Status[] = [],
): NlpCreateResult {
  const parsed = parseInput(rawTitle)
  const resolved = resolveInput(parsed, people, projects, statuses)
  return { title: resolved.title, resolved }
}

/**
 * Apply resolved NLP metadata to a newly created task.
 * Writes the due date / status and assigns people. Recurrence anchors
 * to the due date; without one the recurrence is dropped. Tags go through the registry (resolve-or-create
 * via `tag-store`) after the transaction — they live in the normalized
 * `tags`+`todoTags` tables and don't need to be atomic with person
 * assignment.
 */
export async function applyNlpMetadata(
  todoId: number,
  resolved: ResolvedInput,
  getTodo: (id: number) => PersistedTodoItem | undefined,
  updateTodo: (todo: PersistedTodoItem) => Promise<void>,
  assignPerson: (todoId: number, personId: number) => Promise<void>,
): Promise<void> {
  const hasUpdates =
    resolved.dueDate !== undefined ||
    resolved.recurrence !== undefined ||
    resolved.statusId !== undefined
  const hasAssignments = resolved.personIds.length > 0
  const hasTags = resolved.tags.length > 0
  if (!hasUpdates && !hasAssignments && !hasTags) return

  if (hasUpdates || hasAssignments) {
    await runNlpMetadataTransaction(async () => {
      // Update task properties if any were parsed
      if (hasUpdates) {
        const todo = getTodo(todoId)
        if (todo) {
          const nextDue = resolved.dueDate ?? todo.dueDate
          const nextStatusId = resolved.statusId ?? todo.statusId
          let nextRule = todo.recurrenceRule
          if (resolved.recurrence) {
            nextRule = nextDue ? makeRecurrenceRule(resolved.recurrence, nextDue) : undefined
          }
          await updateTodo({
            ...todo,
            dueDate: nextDue,
            recurrenceRule: nextRule,
            statusId: nextStatusId,
          })
        }
      }

      // Assign people
      for (const personId of resolved.personIds) {
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
