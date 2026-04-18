import { parseInput } from './natural-language-parser'
import { resolveInput, type ResolvedInput } from './nlp-resolver'
import { makeRecurrenceRule } from './recurrence'
import { db } from '../data/database'
import type { Person, Tag, Project, Org, PersistedTodoItem } from '../models'

export interface NlpCreateResult {
  title: string
  resolved: ResolvedInput
}

/**
 * Parse raw input text and resolve against known people/tags.
 * Returns the cleaned title and resolved metadata.
 */
export function parseTaskInput(rawTitle: string, people: Person[], tags: Tag[], projects: Project[] = [], orgs: Org[] = []): NlpCreateResult {
  const parsed = parseInput(rawTitle)
  const resolved = resolveInput(parsed, people, tags, projects, orgs)
  return { title: resolved.title, resolved }
}

/**
 * Apply resolved NLP metadata to a newly created task.
 * Writes scheduledDate and assigns people/tags. Recurrence anchors to dueDate
 * when present, otherwise to a precise scheduledDate; without either anchor
 * the recurrence is dropped.
 */
export async function applyNlpMetadata(
  todoId: number,
  resolved: ResolvedInput,
  getTodo: (id: number) => PersistedTodoItem | undefined,
  updateTodo: (todo: PersistedTodoItem) => Promise<void>,
  assignPerson: (todoId: number, personId: number) => Promise<void>,
  assignTag: (todoId: number, tagId: number) => Promise<void>,
  assignOrg?: (todoId: number, orgId: number) => Promise<void>,
): Promise<void> {
  const hasUpdates = resolved.scheduledDate !== undefined || resolved.dueDate !== undefined || resolved.recurrence !== undefined
  const hasAssignments = resolved.personIds.length > 0 || resolved.tagIds.length > 0 || resolved.orgIds.length > 0
  if (!hasUpdates && !hasAssignments) return

  await db.transaction('rw', [db.todos, db.todoPeople, db.todoTags, db.todoOrgs], async () => {
    // Update task properties if any were parsed
    if (hasUpdates) {
      const todo = getTodo(todoId)
      if (todo) {
        const nextScheduled = resolved.scheduledDate ?? todo.scheduledDate
        const nextDue = resolved.dueDate ?? todo.dueDate
        let nextRule = todo.recurrenceRule
        if (resolved.recurrence) {
          if (nextDue) {
            nextRule = makeRecurrenceRule(resolved.recurrence, nextDue)
          } else if (nextScheduled && nextScheduled.kind === 'date') {
            nextRule = makeRecurrenceRule(resolved.recurrence, nextScheduled.value)
          } else {
            nextRule = undefined
          }
        }
        await updateTodo({
          ...todo,
          scheduledDate: nextScheduled,
          dueDate: nextDue,
          recurrenceRule: nextRule,
        })
      }
    }

    // Assign people
    for (const personId of resolved.personIds) {
      await assignPerson(todoId, personId)
    }

    // Assign tags
    for (const tagId of resolved.tagIds) {
      await assignTag(todoId, tagId)
    }

    // Assign orgs
    if (assignOrg) {
      for (const orgId of resolved.orgIds) {
        await assignOrg(todoId, orgId)
      }
    }
  })
}
