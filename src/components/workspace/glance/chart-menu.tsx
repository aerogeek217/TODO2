import {
  BREAKDOWN_SORT_KEYS,
  BREAKDOWN_SPLITS,
  BREAKDOWN_STYLES,
  STATUS_FLOW_WEEK_CHOICES,
  type BreakdownSort,
} from '../../../models/chart-widgets'
import type { TabBadgeRange, TabBadgeRanges } from '../../../models/list-definition'
import type { ChartTab } from '../../../models/workspace-layout'
import { NONE_ROW_LABELS } from '../../../services/stats/breakdown'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { TAB_BADGE_CHOICES, tabBadgeRangeLabel } from '../../../utils/tab-badges'
import type { MenuEntry } from '../../shared/MenuPopover'
import { showTab } from '../widget-hooks'
import { sortHeading, sortWords, SPLIT_CHOICE_LABELS, STYLE_LABELS } from './breakdown-copy'
import { knownTagCount, settingEntry, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries, type Choice } from './menu-entries'
import { useTagStore } from '../../../stores/tag-store'

/**
 * A chart widget's tab-menu settings (D26 P8), listed first in its ⋯ menu:
 * Edit … (its editor), then a Breakdown's Split by, Style, Sort (view
 * state, saved at once, per split), its none row, and the Due /
 * Follow-up ranges (Settings' unless overridden, as Edit list's tab
 * badges). Every other choice is layout config.
 */

/** Opens a chart's editor beside it (its tab shown first, as Edit list's). */
function openChartEditor(tabId: string): void {
  showTab(tabId)
  useChartWidgetsStore.getState().openEditor(tabId)
}

const SHOWN_HIDDEN: readonly Choice<boolean>[] = [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }]

/** A range's choices: Settings' (its value as the note), then each range. */
function rangeEntry(label: string, own: TabBadgeRange | undefined, app: TabBadgeRange, pick: (r: TabBadgeRange | undefined) => void): MenuEntry {
  const choices: Choice<TabBadgeRange | 'app'>[] = [
    { value: 'app', label: `As in Settings (${tabBadgeRangeLabel(app)})` },
    ...TAB_BADGE_CHOICES.map((r) => ({ value: r, label: tabBadgeRangeLabel(r) })),
  ]
  const entry = settingEntry(label, choices, own ?? 'app', (v) => pick(v === 'app' ? undefined : v), undefined, 260)
  // The note short: Settings' or the range's own.
  return entry.kind === 'item' ? { ...entry, note: own === undefined ? 'Settings' : tabBadgeRangeLabel(own) } : entry
}

/** A Breakdown's Due and Follow-up ranges: each Settings' or its own. */
function badgeEntries(tab: Extract<ChartTab, { kind: 'breakdown' }>): MenuEntry[] {
  const app = useSettingsStore.getState().tabBadges
  const own = tab.config.badges
  const ownRanges: Partial<TabBadgeRanges> = own === 'off' ? { due: 'off', followup: 'off' } : own ?? {}
  // Each range on its own: one back on Settings' follows Settings again; both, no override.
  const write = (part: keyof TabBadgeRanges) => (r: TabBadgeRange | undefined) => {
    const next: Partial<TabBadgeRanges> = { ...ownRanges, [part]: r }
    if (r === undefined) delete next[part]
    const badges = next.due === undefined && next.followup === undefined ? undefined : next
    useWorkspaceStore.getState().patchTabConfig(tab.id, 'breakdown', { badges })
  }
  return [
    rangeEntry('Due', ownRanges.due, app.due, write('due')),
    rangeEntry('Follow-up', ownRanges.followup, app.followup, write('followup')),
  ]
}

/** The sorts the headings give, as radio choices (the split's own order first). */
function sortEntry(tab: Extract<ChartTab, { kind: 'breakdown' }>): MenuEntry {
  const { splitBy, show } = tab.config
  const current = tab.viewState?.sorts?.[splitBy]
  const key = (s: BreakdownSort | undefined) => (s ? `${s.by}${s.reversed ? '-r' : ''}` : 'default')
  const sorts: Array<BreakdownSort | undefined> = [
    undefined,
    ...BREAKDOWN_SORT_KEYS.filter((by) => !(by === 'priority' && splitBy === 'priority')).flatMap((by): BreakdownSort[] => [{ by }, { by, reversed: true }]),
  ]
  const choices: Choice<string>[] = sorts.map((s) => ({
    value: key(s),
    label: s ? `${sortHeading(s.by, splitBy, show)}: ${sortWords(s, splitBy, show)}` : `Default: ${sortWords(undefined, splitBy, show)}`,
  }))
  const entry = settingEntry('Sort', choices, key(current), (value) => {
    const next = sorts.find((s) => key(s) === value)
    const all = { ...tab.viewState?.sorts }
    if (next) all[splitBy] = next
    else delete all[splitBy]
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'breakdown', { sorts: all })
  }, undefined, 260)
  return entry.kind === 'item' ? { ...entry, note: sortWords(current, splitBy, show) } : entry
}

/**
 * A Tag map's **Tags ›**: Every tag (its default, No tags too), then a
 * checkbox per tag — ticking one maps just the picked tags, in pick order;
 * untick the last and it maps none until Every tag is picked again.
 */
function tagMapTagsEntry(tab: Extract<ChartTab, { kind: 'tagMap' }>): MenuEntry {
  const tags = useTagStore.getState().tags
  const picked = tab.config.tagIds
  const write = (tagIds: number[] | undefined) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'tagMap', { tagIds })
  return {
    kind: 'item',
    label: 'Tags',
    note: picked ? String(knownTagCount(picked, tags)) : 'Every tag',
    childrenWidth: TAG_PICKS_WIDTH_PX,
    childrenMaxHeight: TAG_PICKS_MAX_HEIGHT_PX,
    children: [
      { kind: 'item', label: 'Every tag', checkbox: true, checked: picked == null, keepOpen: true, onSelect: () => write(undefined) },
      { kind: 'separator' },
      ...tagPickEntries(tags, picked ?? [], (tagIds) => write(tagIds), picked != null),
    ],
  }
}

const SPLIT_CHOICES = BREAKDOWN_SPLITS.map((s) => ({ value: s, label: SPLIT_CHOICE_LABELS[s] }))

/** A Breakdown's settings: Edit breakdown…, Split by, Style, Sort, its none row, the Due / Follow-up ranges. */
function breakdownEntries(tab: Extract<ChartTab, { kind: 'breakdown' }>): MenuEntry[] {
  const ws = useWorkspaceStore.getState
  const config = tab.config
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Edit breakdown…', onSelect: () => openChartEditor(tab.id) },
    settingEntry('Split by', SPLIT_CHOICES, config.splitBy,
      (splitBy) => ws().patchTabConfig(tab.id, 'breakdown', splitBy === 'people' ? { splitBy } : { splitBy, checkins: undefined })),
    settingEntry('Style', BREAKDOWN_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })), config.style,
      (style) => ws().patchTabConfig(tab.id, 'breakdown', { style })),
    sortEntry(tab),
  ]
  if (config.splitBy !== 'age') {
    entries.push(settingEntry(NONE_ROW_LABELS[config.splitBy], SHOWN_HIDDEN, config.showNone,
      (showNone) => ws().patchTabConfig(tab.id, 'breakdown', { showNone })))
  }
  entries.push(...badgeEntries(tab))
  return entries
}

/** A chart tab's settings, as its ⋯ menu lists them first (a case per chart kind). */
export function chartSettingEntries(tab: ChartTab): MenuEntry[] {
  const ws = useWorkspaceStore.getState
  switch (tab.kind) {
    case 'breakdown':
      return breakdownEntries(tab)
    case 'pivot':
      return [
        { kind: 'item', label: 'Edit pivot…', onSelect: () => openChartEditor(tab.id) },
        settingEntry('Rows', SPLIT_CHOICES, tab.config.rows, (rows) => ws().patchTabConfig(tab.id, 'pivot', { rows })),
        settingEntry('Columns', SPLIT_CHOICES, tab.config.cols, (cols) => ws().patchTabConfig(tab.id, 'pivot', { cols })),
      ]
    case 'statusFlow':
      return [
        { kind: 'item', label: 'Edit status flow…', onSelect: () => openChartEditor(tab.id) },
        settingEntry('Weeks', STATUS_FLOW_WEEK_CHOICES.map((w) => ({ value: w, label: `${w} weeks` })), tab.config.weeks,
          (weeks) => ws().patchTabConfig(tab.id, 'statusFlow', { weeks })),
      ]
    case 'tagMap':
      return [
        { kind: 'item', label: 'Edit tag map…', onSelect: () => openChartEditor(tab.id) },
        tagMapTagsEntry(tab),
      ]
  }
}
