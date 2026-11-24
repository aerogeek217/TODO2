import {
  DEFAULT_NUMBER_BREAKDOWN,
  NUMBER_BREAKDOWN_LABELS,
  NUMBER_BREAKDOWNS,
  TREND_RANGES,
} from '../../../models/glance-widgets'
import type { GlanceTab } from '../../../models/workspace-layout'
import { numberTabOf } from '../../../utils/number-views'
import { wrapClipboardHtml, writeRichClipboard } from '../../../services/rich-clipboard'
import { COPY_REFUSED_NOTICE } from '../../../services/task-copy'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import type { MenuEntry } from '../../shared/MenuPopover'
import type { WidgetMenuAction } from '../../shared/WidgetKindMenu'
import { openBeside, openNumberEditor } from '../widget-hooks'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { trendRangeLabel } from './glance-copy'
import type { GlanceSummary } from './glance-summary'
import { settingEntry } from './menu-entries'
import { breakdownSettingEntries } from './chart-menu'

/** Opens Created vs completed's editor beside it (its tab shown first, as a chart's). */
function openTrendEditor(tabId: string): void {
  if (useChartWidgetsStore.getState().trendEditorTabId === tabId) return
  openBeside(tabId, () => useChartWidgetsStore.getState().openTrendEditor(tabId))
}

/** A glance tab's settings, as its tab menu lists them first (each its section's options, as Customize had them). */
function settingEntries(tab: GlanceTab): MenuEntry[] {
  const ws = useWorkspaceStore.getState
  switch (tab.kind) {
    // One Number's view (`utils/number-views`): that Number's entries, under its own id.
    case 'numbers': {
      const number = numberTabOf(tab)
      if (!number) return []
      return [
        { kind: 'item', label: 'Edit number…', onSelect: () => openNumberEditor(number.id) },
        // A count's breakdown (D26 P6: the other shapes have none).
        ...(number.config.show === 'count' ? [settingEntry('Breakdown', NUMBER_BREAKDOWNS.map((b) => ({ value: b, label: NUMBER_BREAKDOWN_LABELS[b] })),
          number.config.breakdown ?? DEFAULT_NUMBER_BREAKDOWN,
          (breakdown) => ws().patchNumberItem(number.id, { breakdown }),
          'Shown under the count when the cell has room for the whole widget.')] : []),
      ]
    }
    case 'trend':
      return [
        // Its editor (`TrendEditorHost`): name, filter, Show as, range; its tab shown first as a chart's.
        { kind: 'item', label: 'Edit chart…', onSelect: () => openTrendEditor(tab.id) },
        settingEntry('Range', TREND_RANGES.map((r) => ({ value: r, label: trendRangeLabel(r).replace(/^Last /, '') })), tab.config.range,
          (range) => ws().patchTabConfig(tab.id, 'trend', { range })),
      ]
    // D26 P8: the chart widget.
    case 'breakdown':
      return breakdownSettingEntries(tab)
  }
}

/** What a glance tab's menu adds: its settings (first) and its actions (Copy). */
interface GlanceMenu {
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
