import type { Tag } from '../../../models'
import type { MenuEntry } from '../../shared/MenuPopover'
import styles from './MenuEntries.module.css'

/**
 * The tab-menu submenus the glance widgets and the Neglect map share: a
 * setting's radio choices, and the tag picks.
 */

/** The tag picks submenu's size. */
export const TAG_PICKS_WIDTH_PX = 248
export const TAG_PICKS_MAX_HEIGHT_PX = 360

const SETTING_WIDTH_PX = 220

/** One choice of a setting submenu. */
export interface Choice<V> {
  value: V
  label: string
}

/**
 * A setting as a submenu item: its name, its current value as the note, a
 * radio choice per value; picking another value calls `pick` (a tab's
 * config — the layout becomes unsaved, as any tab setting).
 */
export function settingEntry<V>(
  label: string,
  choices: readonly Choice<V>[],
  current: V,
  pick: (v: V) => void,
  note?: string,
  width = SETTING_WIDTH_PX,
): MenuEntry {
  return {
    kind: 'item',
    label,
    note: choices.find((c) => c.value === current)?.label,
    childrenWidth: width,
    children: [
      { kind: 'label', text: label },
      ...choices.map((c): MenuEntry => ({
        kind: 'item',
        label: c.label,
        radio: true,
        indicator: 'radio',
        checked: c.value === current,
        onSelect: () => { if (c.value !== current) pick(c.value) },
      })),
      ...(note ? [{ kind: 'separator' } as const, { kind: 'note', text: note } as const] : []),
    ],
  }
}

/** `ids` with `id` added (at the end) or taken out. */
export function toggledId(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/**
 * How many of `picked` are tags that still exist: a deleted tag's id stays
 * in a tab's config (tag deletes don't touch layouts), so it isn't counted.
 */
export function knownTagCount(picked: readonly number[], tags: readonly Tag[]): number {
  const known = new Set(tags.flatMap((t) => (t.id != null ? [t.id] : [])))
  return picked.filter((id) => known.has(id)).length
}

/**
 * The tag picks: a checkbox per tag, in the tags' order, its colour beside
 * its name — ticked while `picked` holds it (and `ticked`) — and a note
 * with none yet. A tick calls `onPick` with the picks it makes (the tag
 * added at the end, or taken out); the submenu stays open while ticking.
 */
export function tagPickEntries(
  tags: readonly Tag[],
  picked: readonly number[],
  onPick: (tagIds: number[]) => void,
  ticked = true,
): MenuEntry[] {
  if (tags.length === 0) return [{ kind: 'note', text: 'No tags yet.' }]
  return tags.flatMap(({ id, name, color }): MenuEntry[] => (id == null ? [] : [{
    kind: 'item',
    label: name,
    icon: <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />,
    checkbox: true,
    checked: ticked && picked.includes(id),
    keepOpen: true,
    onSelect: () => onPick(toggledId(picked, id)),
  }]))
}
