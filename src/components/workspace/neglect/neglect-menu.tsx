import type { NeglectColourBy, NeglectTab } from '../../../models/workspace-layout'
import type { Status, Tag } from '../../../models'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { projectTagIds } from '../../../utils/neglect-map'
import type { MenuEntry } from '../../shared/MenuPopover'
import { StatusMark } from '../../shared/StatusMark'
import { knownTagCount, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries, toggledId } from '../glance/menu-entries'
import styles from './NeglectMapWidget.module.css'

/** The Hide statuses submenu's width (the board's 232px). */
const HIDE_STATUSES_WIDTH_PX = 232

/** `Parked` / `Parked, Waiting` / `None`: the Hide statuses item's value (the hidden statuses that still exist, in their order). */
function hiddenLabel(hidden: readonly number[], statuses: readonly Status[]): string {
  const names = statuses.flatMap((s) => (s.id != null && hidden.includes(s.id) ? [s.name] : []))
  return names.length > 0 ? names.join(', ') : 'None'
}

/** A checkbox per status, in the statuses' order, its mark in its color beside it; ticked = hidden. */
function hideStatusEntries(statuses: readonly Status[], hidden: readonly number[], onPick: (ids: number[]) => void): MenuEntry[] {
  if (statuses.length === 0) return [{ kind: 'note', text: 'No statuses yet.' }]
  return statuses.flatMap((s): MenuEntry[] => {
    const id = s.id
    if (id == null) return []
    return [{
      kind: 'item',
      label: s.name,
      icon: <span className={styles.statusMark} style={{ color: s.color }} aria-hidden="true"><StatusMark status={s} /></span>,
      checkbox: true,
      checked: hidden.includes(id),
      keepOpen: true,
      onSelect: () => onPick(toggledId(hidden, id)),
    }]
  })
}

/** `Tags (2)` / `People` / `None`: the Color by item's value (the picked tags that still exist). */
function colourByLabel(colourBy: NeglectColourBy, tags: readonly Tag[]): string {
  if (colourBy.kind === 'people') return 'People'
  if (colourBy.kind === 'none') return 'None'
  return `Tags (${knownTagCount(colourBy.tagIds, tags)})`
}

/**
 * A Neglect map tab's menu items, listed first: **Color by ›** (Tags,
 * People or None, then a checkbox per tag — ticking one colours by tags;
 * the submenu stays open while tags are ticked) and **Hide statuses ›** (a
 * checkbox per status: a task with a ticked one leaves the map, its counts
 * and its Review). Layout config: a change is
 * saved at once as one undo step, as any tab setting. What counts as
 * untouched is Settings' Stale after, so the map has no threshold of its own.
 */
export function useNeglectMenuEntries(tab: NeglectTab | undefined): MenuEntry[] {
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  if (!tab) return []
  const { colourBy } = tab.config
  const hidden = tab.config.hiddenStatusIds ?? []
  const patch = (p: Partial<NeglectTab['config']>) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'neglect', p)
  const pickedTags = colourBy.kind === 'tags' ? colourBy.tagIds : []
  const kinds: Array<{ kind: NeglectColourBy['kind']; label: string; next: () => NeglectColourBy }> = [
    // Back to tags: the ones picked before, else the `Project: …` tags.
    { kind: 'tags', label: 'Tags', next: () => ({ kind: 'tags', tagIds: colourBy.kind === 'tags' ? colourBy.tagIds : projectTagIds(tags) }) },
    { kind: 'people', label: 'People', next: () => ({ kind: 'people' }) },
    { kind: 'none', label: 'None', next: () => ({ kind: 'none' }) },
  ]
  const colourEntries: MenuEntry[] = [
    { kind: 'label', text: 'Color dots by' },
    ...kinds.map((k): MenuEntry => ({
      kind: 'item',
      label: k.label,
      radio: true,
      indicator: 'radio',
      checked: colourBy.kind === k.kind,
      keepOpen: true,
      onSelect: () => { if (colourBy.kind !== k.kind) patch({ colourBy: k.next() }) },
    })),
    { kind: 'separator' },
    { kind: 'label', text: 'Tags' },
    ...tagPickEntries(tags, pickedTags, (tagIds) => patch({ colourBy: { kind: 'tags', tagIds } }), colourBy.kind === 'tags'),
    { kind: 'separator' },
    { kind: 'note', text: 'A task with several picked tags takes the first one’s color.' },
  ]
  return [
    {
      kind: 'item',
      label: 'Color by',
      note: colourByLabel(colourBy, tags),
      children: colourEntries,
      childrenWidth: TAG_PICKS_WIDTH_PX,
      childrenMaxHeight: TAG_PICKS_MAX_HEIGHT_PX,
    },
    {
      kind: 'item',
      label: 'Hide statuses',
      note: hiddenLabel(hidden, statuses),
      children: [
        { kind: 'label', text: 'Hide statuses' },
        ...hideStatusEntries(statuses, hidden, (hiddenStatusIds) => patch({ hiddenStatusIds })),
        { kind: 'separator' },
        { kind: 'note', text: 'Tasks with a hidden status leave the map, its counts and its Review.' },
      ],
      childrenWidth: HIDE_STATUSES_WIDTH_PX,
      childrenMaxHeight: TAG_PICKS_MAX_HEIGHT_PX,
    },
  ]
}
