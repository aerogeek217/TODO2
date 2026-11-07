import { wrapClipboardHtml, writeRichClipboard } from '../../../services/rich-clipboard'
import { COPY_REFUSED_NOTICE } from '../../../services/task-copy'
import { useUndoStore } from '../../../stores/undo-store'
import type { WidgetMenuAction } from '../../shared/WidgetKindMenu'
import type { DashboardSummary } from '../glance/glance-summary'
import { DashGlyph } from '../../shared/DashGlyph'

/**
 * The Dashboard tab menu's own items: `Customize dashboard…` and
 * `Copy summary` (only while the widget has reported its counts — i.e. the
 * tab is the cell's active one).
 */
export function useDashboardMenuActions({ onCustomize, summary }: {
  onCustomize: () => void
  summary: DashboardSummary | undefined
}): WidgetMenuAction[] {
  const actions: WidgetMenuAction[] = [
    { label: 'Customize dashboard…', icon: <DashGlyph name="sliders" />, onSelect: onCustomize },
  ]
  if (summary) {
    actions.push({
      label: 'Copy summary',
      icon: <DashGlyph name="copy" />,
      onSelect: () => {
        void writeRichClipboard(wrapClipboardHtml(summary.html), summary.plain).then((ok) => {
          if (!ok) useUndoStore.getState().notify(COPY_REFUSED_NOTICE)
        })
      },
    })
  }
  return actions
}
