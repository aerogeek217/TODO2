import { parseInput } from './natural-language-parser'
import { resolveInput, type ResolvedInput } from './nlp-resolver'
import { makeRecurrenceRule } from './recurrence'
import type { Person, Tag, Project, PersistedTodoItem } from '../models'

export interface NlpCreateResult {
  title: string
  resolved: ResolvedInput
}

/**
 * Parse raw input text and resolve against known people/tags.
 * Returns the cleaned title and resolved metadata.
 */
export function parseTaskInput(rawTitle: string, people: Person[], tags: Tag[], projects: Project[] = []): NlpCreateResult {
  const parsed = parseInput(rawTitle)
  const resolved = resolveInput(parsed, people, tags, projects)
  return { title: resolved.title, resolved }
}

/**
 * Apply resolved NLP metadata to a newly created task.
 * Updates priority/dueDate and assigns people/tags.
 */
export async function applyNlpMetadata(
  todoId: number,
  resolved: ResolvedInput,
  getTodo: (id: number) => PersistedTodoItem | undefined,
  updateTodo: (todo: PersistedTodoItem) => Promise<void>,
  assignPerson: (todoId: number, personId: number) => Promise<void>,
  assignTag: (todoId: number, tagId: number) => Promise<void>,
): Promise<void> {
  // Update task properties if any were parsed
  if (resolved.priority !== undefined || resolved.dueDate || resolved.recurrence) {
    const todo = getTodo(todoId)
    if (todo) {
      const dueDate = resolved.dueDate ?? todo.dueDate
      await updateTodo({
        ...todo,
        priority: resolved.priority ?? todo.priority,
        dueDate,
        recurrenceRule: dueDate && resolved.recurrence ? makeRecurrenceRule(resolved.recurrence, dueDate) : todo.recurrenceRule,
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
}
