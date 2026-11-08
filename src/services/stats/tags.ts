import type { PersistedTodoItem, Tag } from '../../models'
import { byName } from '../../utils/sort-order'
import { keepsNoneRow, openRowStats, restrictedRows, type PeopleRowStats, type RowRestrictions } from './people'
import { idsByDate, openTasks, type StatsContext } from './stats-context'

/** One Tags row: open tasks, the count by priority and the follow-up-due ones (as a People row). */
export type TagRowStats = PeopleRowStats

export interface TagStats {
  /**
   * Every tag on at least one open task, by open count descending, ties by
   * name. A task with several tags counts for each of them.
   */
  rows: Array<TagRowStats & { tag: Tag & { id: number } }>
  /** Open tasks with no tag (the row that comes last). */
  untagged: TagRowStats
  /** Open tasks with at least one tag (each once), by due date then `sortOrder`. */
  taggedIds: number[]
}

/**
 * The tag rows over `tasks`' open ones. `restrictions` (the top bar's `#`
 * picks, `RowRestrictions`) narrow them as they narrow a list grouped by
 * Tag: a task counts under the picked tags only.
 */
export function computeTagStats(tasks: readonly PersistedTodoItem[], ctx: StatsContext, restrictions: RowRestrictions = []): TagStats {
  const byTag = new Map<number, { tag: Tag & { id: number }; tasks: PersistedTodoItem[] }>()
  const tagged: PersistedTodoItem[] = []
  const untagged: PersistedTodoItem[] = []
  const keepNone = keepsNoneRow(restrictions)

  for (const t of openTasks(tasks)) {
    const tags = new Map<number, Tag>()
    for (const tag of ctx.assignedTagsMap.get(t.id) ?? []) if (tag.id != null && !tags.has(tag.id)) tags.set(tag.id, tag)
    if (tags.size === 0) {
      if (keepNone) untagged.push(t)
      continue
    }
    const under = restrictedRows([...tags.keys()], restrictions)
    for (const id of under) {
      const tag = tags.get(id)
      if (!tag) continue
      let entry = byTag.get(id)
      if (!entry) {
        entry = { tag: { ...tag, id }, tasks: [] }
        byTag.set(id, entry)
      }
      entry.tasks.push(t)
    }
    if (under.length > 0) tagged.push(t)
  }

  const rows = [...byTag.values()]
    .sort((a, b) => b.tasks.length - a.tasks.length || byName(a.tag, b.tag) || a.tag.id - b.tag.id)
    .map(({ tag, tasks: tagTasks }) => ({ tag, ...openRowStats(tagTasks, ctx) }))

  return { rows, untagged: openRowStats(untagged, ctx), taggedIds: idsByDate(tagged, 'deadline') }
}
