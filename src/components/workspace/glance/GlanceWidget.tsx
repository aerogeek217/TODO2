import type { ReactElement } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import type { GlanceWidgetProps } from './glance-hooks'
import { BreakdownWidget } from './BreakdownWidget'
import { PivotWidget } from './PivotWidget'
import { TagMapWidget } from './TagMapWidget'
import { NumberWidget } from './NumberWidget'
import { PulseWidget } from './PulseWidget'
import { TrendWidget } from './TrendWidget'

/** A glance tab's widget, by kind (a case per kind: a new glance kind doesn't compile without one). */
export function GlanceWidget({ tab, ...props }: GlanceWidgetProps<GlanceTab>): ReactElement {
  switch (tab.kind) {
    case 'number': return <NumberWidget tab={tab} {...props} />
    case 'trend': return <TrendWidget tab={tab} {...props} />
    case 'pulse': return <PulseWidget tab={tab} {...props} />
    // D26 P8: the chart widgets.
    case 'breakdown': return <BreakdownWidget tab={tab} {...props} />
    case 'pivot': return <PivotWidget tab={tab} {...props} />
    case 'tagMap': return <TagMapWidget tab={tab} {...props} />
  }
}
