import { useMemo, type ReactElement } from 'react'
import type { NumberConfig } from '../../../models/glance-widgets'
import type { GlanceTab } from '../../../models/workspace-layout'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { numberTabOf } from '../../../utils/number-views'
import type { GlanceWidgetProps } from './glance-hooks'
import { BreakdownWidget } from './BreakdownWidget'
import { PivotWidget } from './PivotWidget'
import { NumberWidget } from './NumberWidget'
import { TrendWidget } from './TrendWidget'

/**
 * A glance tab's widget, by kind (a case per kind: a new glance kind doesn't
 * compile without one) — drawn from its open editor's unsaved config while
 * there is one (`widget-preview-store`), else from the tab's. A Numbers tab
 * is one Number's view (`utils/number-views`, until the Numbers widget draws
 * itself): that Number, its preview under its id.
 */
export function GlanceWidget({ tab: stored, ...props }: GlanceWidgetProps<GlanceTab>): ReactElement | null {
  // A Number's preview is under its own id.
  const previewId = stored.kind === 'numbers' ? stored.config.items[0]?.id ?? stored.id : stored.id
  const preview = useWidgetPreviewStore((s) => s.configs[previewId])
  // One object per tab and preview: the Number's hooks' shared memos key on its config.
  const number = useMemo(() => (stored.kind === 'numbers' ? numberTabOf(stored, preview as NumberConfig | undefined) : undefined), [stored, preview])
  if (stored.kind === 'numbers') return number ? <NumberWidget tab={number} {...props} /> : null
  const tab = preview ? ({ ...stored, config: preview } as GlanceTab) : stored
  switch (tab.kind) {
    case 'numbers': return null
    case 'trend': return <TrendWidget tab={tab} {...props} />
    // D26 P8: the chart widgets.
    case 'breakdown': return <BreakdownWidget tab={tab} {...props} />
    case 'pivot': return <PivotWidget tab={tab} {...props} />
  }
}
