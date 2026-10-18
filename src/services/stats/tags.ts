import type { PersistedTodoItem, Tag } from '../../models'
import { byName } from '../../utils/sort-order'
import { openRowStats, type PeopleRowStats } from './people'
import { idsByDate, openTasks, type StatsContext } from './stats-context'

/** One Tags row: open tasks, and the hot / follow-up-due ones among them (as a People row). */
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

export function computeTagStats(tasks: readonly PersistedTodoItem[], ctx: StatsContext): TagStats {
  const byTag = new Map<number, { tag: Tag & { id: number }; tasks: PersistedTodoItem[] }>()
  const tagged: PersistedTodoItem[] = []
  const untagged: PersistedTodoItem[] = []

  for (const t of openTasks(tasks)) {
    const seen = new Set<number>()
    for (const tag of ctx.assignedTagsMap.get(t.id) ?? []) {
      if (tag.id == null || seen.has(tag.id)) continue
      seen.add(tag.id)
      let entry = byTag.get(tag.id)
      if (!entry) {
        entry = { tag: { ...tag, id: tag.id }, tasks: [] }
        byTag.set(tag.id, entry)
      }
      entry.tasks.push(t)
    }
    if (seen.size === 0) untagged.push(t)
    else tagged.push(t)
  }

  const rows = [...byTag.values()]
    .sort((a, b) => b.tasks.length - a.tasks.length || byName(a.tag, b.tag) || a.tag.id - b.tag.id)
    .map(({ tag, tasks: tagTasks }) => ({ tag, ...openRowStats(tagTasks, ctx) }))

  return { rows, untagged: openRowStats(untagged, ctx), taggedIds: idsByDate(tagged, 'deadline') }
}
