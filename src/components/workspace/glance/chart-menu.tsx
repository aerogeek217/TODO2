import {
  BREAKDOWN_FIXED_SORT_KEYS,
  BREAKDOWN_SPLITS,
  BREAKDOWN_STYLES,
  breakdownColumns,
  breakdownSortKeys,
  liveBreakdownSort,
  type BreakdownSort,
} from '../../../models/chart-widgets'
import type { BreakdownTab } from '../../../models/workspace-layout'
import { NONE_ROW_LABELS } from '../../../services/stats/breakdown'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { MenuEntry } from '../../shared/MenuPopover'
import { openBeside } from '../widget-hooks'
import { countWordOf, sortHeading, sortWords, SPLIT_CHOICE_LABELS, STYLE_LABELS } from './breakdown-copy'
import { settingEntry, type Choice } from './menu-entries'

/**
 * A Breakdown's tab-menu settings (D26 P8), listed first in its ⋯ menu:
 * Edit breakdown… (its editor), then its Split by, Style, Sort (view
 * state, saved at once, per split) and its none row — its count columns
 * are its editor's (board BC). Every other choice is layout config.
 */

/** Opens a chart's editor beside it (its tab shown first, as Edit list's: an open editor with changes asks before that). */
function openChartEditor(tabId: string): void {
  if (useChartWidgetsStore.getState().editorTabId === tabId) return
  openBeside(tabId, () => useChartWidgetsStore.getState().openEditor(tabId))
}

const SHOWN_HIDDEN: readonly Choice<boolean>[] = [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }]

/** The sorts the headings give, as radio choices (the split's own order first, then the fixed headings', then each count column's — and its follow-up age's, where it has one). */
function sortEntry(tab: BreakdownTab): MenuEntry {
  const { splitBy, show } = tab.config
  const columns = breakdownColumns(tab.config, useSettingsStore.getState().tabBadges)
  const stored = tab.viewState?.sorts?.[splitBy]
  // A sort by a column it no longer has reads as the default; an older derived column's as the Due / Follow-up column.
  const columnKeys = breakdownSortKeys(columns)
  const current = liveBreakdownSort(stored, columnKeys)
  const key = (s: BreakdownSort | undefined) => (s ? `${s.by}${s.reversed ? '-r' : ''}` : 'default')
  const keys = [...BREAKDOWN_FIXED_SORT_KEYS, ...columnKeys]
  const sorts: Array<BreakdownSort | undefined> = [undefined, ...keys.flatMap((by): BreakdownSort[] => [{ by }, { by, reversed: true }])]
  // A Breakdown whose filter lets completed tasks through counts tasks, not open ones (cr34 G6).
  const word = countWordOf(tab.config.filter)
  const choices: Choice<string>[] = sorts.map((s) => ({
    value: key(s),
    label: s ? `${sortHeading(s.by, splitBy, show, columns, word)}: ${sortWords(s, splitBy, show, columns, word)}` : `Default: ${sortWords(undefined, splitBy, show, columns, word)}`,
  }))
  const entry = settingEntry('Sort', choices, key(current), (value) => {
    const next = sorts.find((s) => key(s) === value)
    const all = { ...tab.viewState?.sorts }
    if (next) all[splitBy] = next
    else delete all[splitBy]
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'breakdown', { sorts: all })
  }, undefined, 260)
  return entry.kind === 'item' ? { ...entry, note: sortWords(current, splitBy, show, columns, word) } : entry
}

const SPLIT_CHOICES = BREAKDOWN_SPLITS.map((s) => ({ value: s, label: SPLIT_CHOICE_LABELS[s] }))

/** A Breakdown's settings, as its ⋯ menu lists them first: Edit breakdown…, Split by, Style, Sort, its none row. */
export function breakdownSettingEntries(tab: BreakdownTab): MenuEntry[] {
  const ws = useWorkspaceStore.getState
  const config = tab.config
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Edit breakdown…', onSelect: () => openChartEditor(tab.id) },
    settingEntry('Split by', SPLIT_CHOICES, config.splitBy,
      (splitBy) => ws().patchTabConfig(tab.id, 'breakdown', { splitBy })),
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
