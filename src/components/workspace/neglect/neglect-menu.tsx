import {
  NEGLECT_UNTOUCHED_CHOICES,
  type NeglectColourBy,
  type NeglectTab,
} from '../../../models/workspace-layout'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { projectTagIds } from '../../../utils/neglect-map'
import type { MenuEntry } from '../../shared/MenuPopover'
import styles from './NeglectMapWidget.module.css'

const COLOUR_BY_WIDTH_PX = 248
const COLOUR_BY_MAX_HEIGHT_PX = 360
const UNTOUCHED_WIDTH_PX = 200

/** `Tags (2)` / `People` / `None`: the Colour by item's value. */
export function colourByLabel(colourBy: NeglectColourBy): string {
  if (colourBy.kind === 'people') return 'People'
  if (colourBy.kind === 'none') return 'None'
  return `Tags (${colourBy.tagIds.length})`
}

/** `14 days` (`1 day`). */
export function untouchedLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

/** `ids` with `id` added (at the end) or taken out. */
function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/**
 * A Neglect map tab's menu items, listed first: **Colour by ›** (Tags,
 * People or None, then a checkbox per tag — ticking one colours by tags;
 * the submenu stays open while tags are ticked) and **Untouched after ›**
 * (the threshold). Both are layout config: a change makes the layout
 * unsaved, as any tab setting.
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
    ...(tags.length === 0
      ? [{ kind: 'note', text: 'No tags yet.' } as const]
      : tags.flatMap(({ id, name, color }): MenuEntry[] => (id == null ? [] : [{
          kind: 'item',
          label: name,
          icon: <span className={styles.menuSwatch} style={{ background: color }} aria-hidden="true" />,
          checkbox: true,
          checked: colourBy.kind === 'tags' && pickedTags.includes(id),
          keepOpen: true,
          onSelect: () => patch({ colourBy: { kind: 'tags', tagIds: toggled(pickedTags, id) } }),
        }]))),
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
      note: colourByLabel(colourBy),
      children: colourEntries,
      childrenWidth: COLOUR_BY_WIDTH_PX,
      childrenMaxHeight: COLOUR_BY_MAX_HEIGHT_PX,
    },
    {
      kind: 'item',
      label: 'Untouched after',
      note: untouchedLabel(untouchedDays),
      childrenWidth: UNTOUCHED_WIDTH_PX,
      children: [
        { kind: 'label', text: 'Untouched after' },
        ...choices.map((d): MenuEntry => ({
          kind: 'item',
          label: untouchedLabel(d),
          radio: true,
          indicator: 'radio',
          checked: d === untouchedDays,
          onSelect: () => { if (d !== untouchedDays) patch({ untouchedDays: d }) },
        })),
        { kind: 'separator' },
        { kind: 'note', text: 'Days since a task last changed. Due soon or late and untouched this long is Slipping.' },
      ],
    },
  ]
}
