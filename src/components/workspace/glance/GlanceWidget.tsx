import type { ReactElement } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import type { GlanceWidgetProps } from './glance-hooks'
import { NumberWidget } from './NumberWidget'
import { PeopleWidget } from './PeopleWidget'
import { PulseWidget } from './PulseWidget'
import { StatusWidget } from './StatusWidget'
import { TagsWidget } from './TagsWidget'
import { TrendWidget } from './TrendWidget'

/** A glance tab's widget, by kind (a case per kind: a new glance kind doesn't compile without one). */
export function GlanceWidget({ tab, ...props }: GlanceWidgetProps<GlanceTab>): ReactElement {
  switch (tab.kind) {
    case 'number': return <NumberWidget tab={tab} {...props} />
    case 'trend': return <TrendWidget tab={tab} {...props} />
    case 'status': return <StatusWidget tab={tab} {...props} />
    case 'people': return <PeopleWidget tab={tab} {...props} />
    case 'tags': return <TagsWidget tab={tab} {...props} />
    case 'pulse': return <PulseWidget tab={tab} {...props} />
  }
}
