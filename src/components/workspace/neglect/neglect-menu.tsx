import type { NeglectColourBy, NeglectTab } from '../../../models/workspace-layout'
import type { Tag } from '../../../models'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { projectTagIds } from '../../../utils/neglect-map'
import type { MenuEntry } from '../../shared/MenuPopover'
import { knownTagCount, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries } from '../glance/menu-entries'

/** `Tags (2)` / `People` / `None`: the Color by item's value (the picked tags that still exist). */
function colourByLabel(colourBy: NeglectColourBy, tags: readonly Tag[]): string {
  if (colourBy.kind === 'people') return 'People'
  if (colourBy.kind === 'none') return 'None'
  return `Tags (${knownTagCount(colourBy.tagIds, tags)})`
}

/**
 * A Neglect map tab's menu items, listed first: **Color by ›** (Tags,
 * People or None, then a checkbox per tag — ticking one colours by tags;
 * the submenu stays open while tags are ticked). Layout config: a change is
 * saved at once as one undo step, as any tab setting. What counts as
 * untouched is Settings' Stale after, so the map has no threshold of its own.
 */
export function useNeglectMenuEntries(tab: NeglectTab | undefined): MenuEntry[] {
  const tags = useTagStore((s) => s.tags)
  if (!tab) return []
  const { colourBy } = tab.config
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
  ]
}
