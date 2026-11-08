import {
  DEFAULT_NUMBER_BREAKDOWN,
  LOOK_AHEAD_CHOICES,
  NUMBER_BREAKDOWN_LABELS,
  NUMBER_BREAKDOWNS,
  NUMBER_METRIC_LABELS,
  NUMBER_METRICS,
  RECENT_DAYS_CHOICES,
  STALE_DAYS_CHOICES,
  TREND_RANGES,
} from '../../../models/glance-widgets'
import type { GlanceTab } from '../../../models/workspace-layout'
import { wrapClipboardHtml, writeRichClipboard } from '../../../services/rich-clipboard'
import { clearFocus } from '../../../services/today-focus'
import { COPY_REFUSED_NOTICE } from '../../../services/task-copy'
import { useTagStore } from '../../../stores/tag-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { DashGlyph } from '../../shared/DashGlyph'
import type { MenuEntry } from '../../shared/MenuPopover'
import type { WidgetMenuAction } from '../../shared/WidgetKindMenu'
import { CUSTOMIZE_PANES_LABEL, openEisenhowerSettings } from '../eisenhower/eisenhower-settings-link'
import { trendRangeLabel } from './glance-copy'
import type { GlanceSummary } from './glance-summary'
import {
  knownTagCount, settingEntry, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries, type Choice,
} from './menu-entries'

/**
 * What changed's and Project pulse's **Tags ›**: a checkbox per tag, in the
 * tags' order (a tick adds it at the end of the picks; the submenu stays
 * open while ticking). Layout config, as any tab setting.
 */
function tagPicksEntry(tab: Extract<GlanceTab, { kind: 'changes' | 'pulse' }>, note: string): MenuEntry {
  const tags = useTagStore.getState().tags
  const picked = tab.config.tagIds
  const count = knownTagCount(picked, tags)
  return {
    kind: 'item',
    label: 'Tags',
    note: count === 0 ? 'None' : String(count),
    childrenWidth: TAG_PICKS_WIDTH_PX,
    childrenMaxHeight: TAG_PICKS_MAX_HEIGHT_PX,
    children: [
      { kind: 'label', text: 'Tags' },
      ...tagPickEntries(tags, picked, (tagIds) => useWorkspaceStore.getState().patchTabConfig(tab.id, tab.kind, { tagIds })),
      { kind: 'separator' },
      { kind: 'note', text: note },
    ],
  }
}

const days = <N extends number>(n: N): Choice<N> => ({ value: n, label: `${n} days` })
const SHOWN_HIDDEN: readonly Choice<boolean>[] = [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }]

/** A glance tab's settings, as its tab menu lists them first (each its section's options, as Customize had them). */
function settingEntries(tab: GlanceTab): MenuEntry[] {
  const ws = useWorkspaceStore.getState
  switch (tab.kind) {
    case 'number':
      return [
        settingEntry('Metric', NUMBER_METRICS.map((m) => ({ value: m, label: NUMBER_METRIC_LABELS[m] })), tab.config.metric,
          (metric) => ws().patchTabConfig(tab.id, 'number', { metric }),
          'Open, Overdue, Due today and Closed this week show their last 14 days.'),
        settingEntry('Breakdown', NUMBER_BREAKDOWNS.map((b) => ({ value: b, label: NUMBER_BREAKDOWN_LABELS[b] })),
          tab.config.breakdown ?? DEFAULT_NUMBER_BREAKDOWN,
          (breakdown) => ws().patchTabConfig(tab.id, 'number', { breakdown }),
          'Shown under the count when the cell has room for the whole widget.'),
      ]
    case 'followup':
      return [settingEntry('Look ahead', LOOK_AHEAD_CHOICES.map(days), tab.config.lookAhead,
        (lookAhead) => ws().patchTabConfig(tab.id, 'followup', { lookAhead }))]
    case 'trend':
      return [settingEntry('Range', TREND_RANGES.map((r) => ({ value: r, label: trendRangeLabel(r).replace(/^Last /, '') })), tab.config.range,
        (range) => ws().patchTabConfig(tab.id, 'trend', { range }))]
    case 'people':
      return [settingEntry('Unassigned', SHOWN_HIDDEN, tab.config.showUnassigned,
        (showUnassigned) => ws().patchTabConfig(tab.id, 'people', { showUnassigned }))]
    case 'tags':
      return [settingEntry('No tag', SHOWN_HIDDEN, tab.config.showUntagged,
        (showUntagged) => ws().patchTabConfig(tab.id, 'tags', { showUntagged }))]
    case 'stale':
      return [settingEntry('Older than', STALE_DAYS_CHOICES.map(days), tab.config.staleDays,
        (staleDays) => ws().patchTabConfig(tab.id, 'stale', { staleDays }))]
    case 'recent':
      return [settingEntry('Last', RECENT_DAYS_CHOICES.map(days), tab.config.recentDays,
        (recentDays) => ws().patchTabConfig(tab.id, 'recent', { recentDays }))]
    case 'eisenhowerSummary':
      return [{ kind: 'item', label: CUSTOMIZE_PANES_LABEL, icon: <DashGlyph name="sliders" />, onSelect: () => openEisenhowerSettings() }]
    case 'changes':
      return [tagPicksEntry(tab, 'The tag with the most late tasks among these gets a sentence.')]
    case 'pulse':
      return [tagPicksEntry(tab, 'A card per tag, in the order picked.')]
    case 'next7':
    case 'status':
    case 'today':
      return []
  }
}

/** A glance tab's own actions, before Copy: Today's Clear Focus…. */
function kindActions(tab: GlanceTab): WidgetMenuAction[] {
  if (tab.kind !== 'today') return []
  return [{ label: 'Clear Focus…', icon: <DashGlyph name="focus" />, onSelect: () => void clearFocus() }]
}

/** What a glance tab's menu adds: its settings (first) and its actions (Today's Clear Focus…, Copy). */
export interface GlanceMenu {
  settingEntries: MenuEntry[]
  actions: WidgetMenuAction[]
}

/**
 * A glance tab's menu items: its settings, then **Copy** — the widget's
 * lines (its title and counts) through the rich clipboard — while the widget has reported them (it is
 * its cell's active tab). `undefined` for any other tab.
 */
export function glanceMenu(tab: GlanceTab | undefined, summary: GlanceSummary | undefined): GlanceMenu | undefined {
  if (!tab) return undefined
  const actions: WidgetMenuAction[] = [...kindActions(tab), ...(summary ? [{
    label: 'Copy',
    icon: <DashGlyph name="copy" />,
    onSelect: () => {
      void writeRichClipboard(wrapClipboardHtml(summary.html), summary.plain).then((ok) => {
        if (!ok) useUndoStore.getState().notify(COPY_REFUSED_NOTICE)
      })
    },
  }] : [])]
  return { settingEntries: settingEntries(tab), actions }
}
