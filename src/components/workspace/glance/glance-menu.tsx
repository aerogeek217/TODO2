import {
  DEFAULT_NUMBER_BREAKDOWN,
  NUMBER_BREAKDOWN_LABELS,
  NUMBER_BREAKDOWNS,
  TREND_RANGES,
} from '../../../models/glance-widgets'
import type { GlanceTab } from '../../../models/workspace-layout'
import { wrapClipboardHtml, writeRichClipboard } from '../../../services/rich-clipboard'
import { COPY_REFUSED_NOTICE } from '../../../services/task-copy'
import { useTagStore } from '../../../stores/tag-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import type { MenuEntry } from '../../shared/MenuPopover'
import type { WidgetMenuAction } from '../../shared/WidgetKindMenu'
import { openNumberEditor } from '../widget-hooks'
import { trendRangeLabel } from './glance-copy'
import type { GlanceSummary } from './glance-summary'
import {
  knownTagCount, settingEntry, TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX, tagPickEntries,
} from './menu-entries'
import { chartSettingEntries } from './chart-menu'

/**
 * Project pulse's **Tags ›**: a checkbox per tag, in the tags' order (a
 * tick adds it at the end of the picks; the submenu stays open while
 * ticking). Layout config, as any tab setting.
 */
function tagPicksEntry(tab: Extract<GlanceTab, { kind: 'pulse' }>, note: string): MenuEntry {
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

/** A glance tab's settings, as its tab menu lists them first (each its section's options, as Customize had them). */
function settingEntries(tab: GlanceTab): MenuEntry[] {
  const ws = useWorkspaceStore.getState
  switch (tab.kind) {
    case 'number':
      return [
        { kind: 'item', label: 'Edit number…', onSelect: () => openNumberEditor(tab.id) },
        settingEntry('Breakdown', NUMBER_BREAKDOWNS.map((b) => ({ value: b, label: NUMBER_BREAKDOWN_LABELS[b] })),
          tab.config.breakdown ?? DEFAULT_NUMBER_BREAKDOWN,
          (breakdown) => ws().patchTabConfig(tab.id, 'number', { breakdown }),
          'Shown under the count when the cell has room for the whole widget.'),
      ]
    case 'trend':
      return [settingEntry('Range', TREND_RANGES.map((r) => ({ value: r, label: trendRangeLabel(r).replace(/^Last /, '') })), tab.config.range,
        (range) => ws().patchTabConfig(tab.id, 'trend', { range }))]
    case 'pulse':
      return [tagPicksEntry(tab, 'A card per tag, in the order picked.')]
    // D26 P8: the chart widgets.
    case 'breakdown':
    case 'pivot':
    case 'statusFlow':
    case 'tagMap':
      return chartSettingEntries(tab)
  }
}

/** What a glance tab's menu adds: its settings (first) and its actions (Copy). */
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
  const actions: WidgetMenuAction[] = summary ? [{
    label: 'Copy',
    icon: <GlanceGlyph name="copy" />,
    onSelect: () => {
      void writeRichClipboard(wrapClipboardHtml(summary.html), summary.plain).then((ok) => {
        if (!ok) useUndoStore.getState().notify(COPY_REFUSED_NOTICE)
      })
    },
  }] : []
  return { settingEntries: settingEntries(tab), actions }
}
