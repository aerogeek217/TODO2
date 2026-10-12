import { useSettingsStore } from '../../../stores/settings-store'
import { wrapClipboardHtml, writeRichClipboard } from '../../../services/task-copy'
import { HotRuleEditor } from '../../settings/HotRuleEditor'
import type { WidgetMenuAction } from '../../shared/WidgetKindMenu'
import { hotRuleShort } from './dashboard-copy'
import type { DashboardSummary } from './dashboard-summary'
import { DashGlyph } from './glyphs'

/** The Hot flyout's width (D0 popover surface). */
export const HOT_FLYOUT_WIDTH_PX = 316

/**
 * The Dashboard tab menu's own items: `Customize dashboard…`, `Hot is ›`
 * (the app-wide Hot rule editor in a flyout; never a layout change) and
 * `Copy summary` (only while the widget has reported its counts — i.e. the
 * tab is the cell's active one).
 */
export function useDashboardMenuActions({ onCustomize, summary }: {
  onCustomize: () => void
  summary: DashboardSummary | undefined
}): WidgetMenuAction[] {
  const hotRule = useSettingsStore((s) => s.hotRule)
  const actions: WidgetMenuAction[] = [
    { label: 'Customize dashboard…', icon: <DashGlyph name="sliders" />, onSelect: onCustomize },
    {
      label: 'Hot is',
      icon: <DashGlyph name="hot" />,
      note: hotRuleShort(hotRule),
      panel: { label: 'Hot rule', width: HOT_FLYOUT_WIDTH_PX, render: () => <HotRuleEditor variant="flyout" /> },
    },
  ]
  if (summary) {
    actions.push({
      label: 'Copy summary',
      icon: <DashGlyph name="copy" />,
      onSelect: () => { void writeRichClipboard(wrapClipboardHtml(summary.html), summary.plain) },
    })
  }
  return actions
}
