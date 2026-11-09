import {
  BREAKDOWN_FIXED_SORT_KEYS,
  BREAKDOWN_SPLITS,
  BREAKDOWN_STYLES,
  breakdownColumns,
  liveBreakdownSort,
  type BreakdownSort,
} from '../../../models/chart-widgets'
import type { ChartTab } from '../../../models/workspace-layout'
import { NONE_ROW_LABELS } from '../../../services/stats/breakdown'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { MenuEntry } from '../../shared/MenuPopover'
import { showTab } from '../widget-hooks'
import { sortHeading, sortWords, SPLIT_CHOICE_LABELS, STYLE_LABELS } from './breakdown-copy'
import { knownTagCount, settingEntry, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries, type Choice } from './menu-entries'
import { useTagStore } from '../../../stores/tag-store'

/**
 * A chart widget's tab-menu settings (D26 P8), listed first in its ⋯ menu:
 * Edit … (its editor), then a Breakdown's Split by, Style, Sort (view
 * state, saved at once, per split) and its none row — its count columns
 * are its editor's (board BC). Every other choice is layout config.
 */

/** Opens a chart's editor beside it (its tab shown first, as Edit list's). */
function openChartEditor(tabId: string): void {
  showTab(tabId)
  useChartWidgetsStore.getState().openEditor(tabId)
}

const SHOWN_HIDDEN: readonly Choice<boolean>[] = [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }]

/** The sorts the headings give, as radio choices (the split's own order first, then the fixed headings', then each count column's). */
function sortEntry(tab: Extract<ChartTab, { kind: 'breakdown' }>): MenuEntry {
  const { splitBy, show } = tab.config
  const columns = breakdownColumns(tab.config, useSettingsStore.getState().tabBadges)
  const stored = tab.viewState?.sorts?.[splitBy]
  // A sort by a column it no longer has reads as the default; the old Due / Follow-up's as the late column.
  const current = liveBreakdownSort(stored, columns.map((c) => c.id))
  const key = (s: BreakdownSort | undefined) => (s ? `${s.by}${s.reversed ? '-r' : ''}` : 'default')
  const keys = [...BREAKDOWN_FIXED_SORT_KEYS.filter((by) => !(by === 'priority' && splitBy === 'priority')), ...columns.map((c) => c.id)]
  const sorts: Array<BreakdownSort | undefined> = [undefined, ...keys.flatMap((by): BreakdownSort[] => [{ by }, { by, reversed: true }])]
  const choices: Choice<string>[] = sorts.map((s) => ({
    value: key(s),
    label: s ? `${sortHeading(s.by, splitBy, show, columns)}: ${sortWords(s, splitBy, show, columns)}` : `Default: ${sortWords(undefined, splitBy, show, columns)}`,
  }))
  const entry = settingEntry('Sort', choices, key(current), (value) => {
    const next = sorts.find((s) => key(s) === value)
    const all = { ...tab.viewState?.sorts }
    if (next) all[splitBy] = next
    else delete all[splitBy]
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'breakdown', { sorts: all })
  }, undefined, 260)
  return entry.kind === 'item' ? { ...entry, note: sortWords(current, splitBy, show, columns) } : entry
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

/** A Breakdown's settings: Edit breakdown…, Split by, Style, Sort, its none row. */
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
    case 'tagMap':
      return [
        { kind: 'item', label: 'Edit tag map…', onSelect: () => openChartEditor(tab.id) },
        tagMapTagsEntry(tab),
      ]
  }
}
