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
import styles from './BriefWidgets.module.css'

const SETTING_WIDTH_PX = 220
const TAGS_WIDTH_PX = 248
const TAGS_MAX_HEIGHT_PX = 360

/** One choice of a setting submenu. */
interface Choice<V> {
  value: V
  label: string
}

/**
 * A setting as a submenu item: its name, its current value as the note, a
 * radio choice per value; picking another value patches the tab's config
 * (layout config — the layout becomes unsaved, as any tab setting).
 */
function settingEntry<V>(label: string, choices: readonly Choice<V>[], current: V, pick: (v: V) => void, note?: string): MenuEntry {
  return {
    kind: 'item',
    label,
    note: choices.find((c) => c.value === current)?.label,
    childrenWidth: SETTING_WIDTH_PX,
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
function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/**
 * What changed's and Project pulse's **Tags ›**: a checkbox per tag, in the
 * tags' order (a tick adds it at the end of the picks; the submenu stays
 * open while ticking). Layout config, as any tab setting.
 */
function tagPicksEntry(tab: Extract<GlanceTab, { kind: 'changes' | 'pulse' }>, note: string): MenuEntry {
  const tags = useTagStore.getState().tags
  const picked = tab.config.tagIds
  const known = new Set(tags.flatMap((t) => (t.id != null ? [t.id] : [])))
  const count = picked.filter((id) => known.has(id)).length
  return {
    kind: 'item',
    label: 'Tags',
    note: count === 0 ? 'None' : String(count),
    childrenWidth: TAGS_WIDTH_PX,
    childrenMaxHeight: TAGS_MAX_HEIGHT_PX,
    children: [
      { kind: 'label', text: 'Tags' },
      ...(tags.length === 0
        ? [{ kind: 'note', text: 'No tags yet.' } as const]
        : tags.flatMap(({ id, name, color }): MenuEntry[] => (id == null ? [] : [{
            kind: 'item',
            label: name,
            icon: <span className={styles.menuSwatch} style={{ background: color }} aria-hidden="true" />,
            checkbox: true,
            checked: picked.includes(id),
            keepOpen: true,
            onSelect: () => useWorkspaceStore.getState().patchTabConfig(tab.id, tab.kind, { tagIds: toggled(picked, id) }),
          }]))),
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
