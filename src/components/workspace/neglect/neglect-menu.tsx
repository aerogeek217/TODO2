import {
  NEGLECT_UNTOUCHED_CHOICES,
  type NeglectColourBy,
  type NeglectTab,
} from '../../../models/workspace-layout'
import type { Tag } from '../../../models'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { projectTagIds } from '../../../utils/neglect-map'
import type { MenuEntry } from '../../shared/MenuPopover'
import { knownTagCount, settingEntry, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries } from '../glance/menu-entries'

const UNTOUCHED_WIDTH_PX = 200

/** `Tags (2)` / `People` / `None`: the Colour by item's value (the picked tags that still exist). */
export function colourByLabel(colourBy: NeglectColourBy, tags: readonly Tag[]): string {
  if (colourBy.kind === 'people') return 'People'
  if (colourBy.kind === 'none') return 'None'
  return `Tags (${knownTagCount(colourBy.tagIds, tags)})`
}

/** `14 days` (`1 day`). */
export function untouchedLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * A Neglect map tab's menu items, listed first: **Colour by ›** (Tags,
 * People or None, then a checkbox per tag — ticking one colours by tags;
 * the submenu stays open while tags are ticked) and **Untouched after ›**
 * (the threshold). Both are layout config: a change is saved at once as
 * one undo step, as any tab setting.
 */
export function useNeglectMenuEntries(tab: NeglectTab | undefined): MenuEntry[] {
  const tags = useTagStore((s) => s.tags)
  if (!tab) return []
  const { colourBy, untouchedDays } = tab.config
  const patch = (p: Partial<NeglectTab['config']>) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'neglect', p)
  const pickedTags = colourBy.kind === 'tags' ? colourBy.tagIds : []
  const kinds: Array<{ kind: NeglectColourBy['kind']; label: string; next: () => NeglectColourBy }> = [
    // Back to tags: the ones picked before, else the `Project: …` tags.
    { kind: 'tags', label: 'Tags', next: () => ({ kind: 'tags', tagIds: colourBy.kind === 'tags' ? colourBy.tagIds : projectTagIds(tags) }) },
    { kind: 'people', label: 'People', next: () => ({ kind: 'people' }) },
    { kind: 'none', label: 'None', next: () => ({ kind: 'none' }) },
  ]
  const colourEntries: MenuEntry[] = [
    { kind: 'label', text: 'Colour dots by' },
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
    { kind: 'note', text: 'A task with several picked tags takes the first one’s colour.' },
  ]
  // A threshold set outside the offered choices (e.g. by an import) still shows.
  const choices = NEGLECT_UNTOUCHED_CHOICES.includes(untouchedDays)
    ? NEGLECT_UNTOUCHED_CHOICES
    : [...NEGLECT_UNTOUCHED_CHOICES, untouchedDays].sort((a, b) => a - b)
  return [
    {
      kind: 'item',
      label: 'Colour by',
      note: colourByLabel(colourBy, tags),
      children: colourEntries,
      childrenWidth: TAG_PICKS_WIDTH_PX,
      childrenMaxHeight: TAG_PICKS_MAX_HEIGHT_PX,
    },
    settingEntry(
      'Untouched after',
      choices.map((d) => ({ value: d, label: untouchedLabel(d) })),
      untouchedDays,
      (d) => patch({ untouchedDays: d }),
      'Days since a task last changed. Due soon or late and untouched this long is Slipping.',
      UNTOUCHED_WIDTH_PX,
    ),
  ]
}
