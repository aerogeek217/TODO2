import { useMemo, type ReactNode } from 'react'
import { DEFAULT_STATUS_ICON } from '../../../models'
import { listedLists } from '../../../models/list-definition'
import type { ReviewBy } from '../../../models/review'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { bySortOrder } from '../../../utils/sort-order'
import { HashIcon, WidgetKindIcon } from '../../shared/icons'
import { PromptAvatar, type PromptOption } from '../../shared/PromptField'
import { StatusIcon } from '../../shared/StatusIcon'
import { useListOwnerLayoutId } from '../widget-hooks'
import styles from './ReviewWidget.module.css'

// As the list's prompt (`RuntimeFilterPicker`), every choice here is read from cached Zustand stores
// (people, tags, statuses, list definitions, the shared stats base) — no Dexie read on render or keystroke.

/** Each kind's words: `a person` (the empty state, the field's placeholder), the field's name, and what its list says with no options. */
export const REVIEW_KIND_WORDS: Record<ReviewBy, { a: string; input: string; none: string }> = {
  person: { a: 'a person', input: 'People to review', none: 'No people yet' },
  tag: { a: 'a tag', input: 'Tags to review', none: 'No tags yet' },
  status: { a: 'a status', input: 'Statuses to review', none: 'No statuses yet' },
  list: { a: 'a list', input: 'Lists to review', none: 'This layout has no lists' },
}

/** One thing of the widget's kind that can be picked: its option (without a count) and its name in words (`#tag`). */
interface ReviewChoice {
  option: PromptOption
  words: string
}

/** What a Review widget can pick by its kind: the field's options (with counts) and each one's name in words, by id. */
export interface ReviewChoices {
  options: PromptOption[]
  /** Each choice's name in words (a tag as `#name`), by id — the ids that can be picked. */
  words: ReadonlyMap<number, string>
}

/**
 * The choices of `by`'s kind (board BM): people and tags by name, statuses
 * and this layout's lists in their own order — people with their avatar,
 * tags a # in their colour, statuses their glyph, lists the list glyph —,
 * each person, tag and status with its open tasks under the screen filter
 * as the widget applies it (a list has no count: each would be a build of
 * its own). `words` changes only with the people, tags, statuses or lists
 * themselves, never with a count.
 */
export function useReviewChoices(by: ReviewBy): ReviewChoices {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const lists = useListDefinitionStore((s) => s.listDefinitions)
  const layoutId = useListOwnerLayoutId()
  const choices = useMemo<ReviewChoice[]>(() => {
    const mark = (node: ReactNode, color?: string) => <span className={styles.optionMark} style={color ? { color } : undefined}>{node}</span>
    switch (by) {
      case 'person':
        return [...people].sort((a, b) => a.name.localeCompare(b.name)).flatMap((p) => (p.id == null ? [] : [{
          option: { id: p.id, name: p.name, mark: <PromptAvatar initials={p.initials || p.name.slice(0, 2).toUpperCase()} color={p.color} /> },
          words: p.name,
        }]))
      case 'tag':
        return [...tags].sort((a, b) => a.name.localeCompare(b.name)).flatMap((g) => (g.id == null ? [] : [{
          option: { id: g.id, name: g.name, mark: mark(<HashIcon size={12} />, g.color) },
          words: `#${g.name}`,
        }]))
      case 'status':
        return [...statuses].sort(bySortOrder).flatMap((st) => (st.id == null ? [] : [{
          option: { id: st.id, name: st.name, mark: mark(<StatusIcon icon={st.icon ?? DEFAULT_STATUS_ICON} filled />, st.color) },
          words: st.name,
        }]))
      case 'list':
        return listedLists([...lists].sort(bySortOrder), layoutId).map((d) => ({
          option: { id: d.id, name: d.name, mark: mark(<WidgetKindIcon kind="lens" size={13} />) },
          words: d.name,
        }))
    }
  }, [by, people, tags, statuses, lists, layoutId])
  const words = useMemo(() => new Map(choices.map((c) => [c.option.id, c.words])), [choices])

  const base = useStatsBase()
  const counts = useMemo(() => {
    const byId = new Map<number, number>()
    if (by === 'list') return byId
    const bump = (id: number | undefined) => { if (id != null) byId.set(id, (byId.get(id) ?? 0) + 1) }
    for (const t of base.shown) {
      if (t.isCompleted) continue
      if (by === 'person') for (const p of base.ctx.assignedPeopleMap.get(t.id) ?? []) bump(p.id)
      else if (by === 'tag') for (const g of base.ctx.assignedTagsMap.get(t.id) ?? []) bump(g.id)
      else bump(t.statusId)
    }
    return byId
  }, [by, base])
  const options = useMemo(
    () => (by === 'list' ? choices.map((c) => c.option) : choices.map((c) => ({ ...c.option, count: counts.get(c.option.id) ?? 0 }))),
    [by, choices, counts],
  )
  return { options, words }
}
