import type { ReactElement } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import { EisenhowerSummaryWidget } from './EisenhowerSummaryWidget'
import { FollowupWidget } from './FollowupWidget'
import type { GlanceWidgetProps } from './glance-hooks'
import { NextDaysWidget } from './NextDaysWidget'
import { NumberWidget } from './NumberWidget'
import { PeopleWidget } from './PeopleWidget'
import { RecentWidget } from './RecentWidget'
import { StaleWidget } from './StaleWidget'
import { StatusWidget } from './StatusWidget'
import { TagsWidget } from './TagsWidget'
import { TrendWidget } from './TrendWidget'

/** A glance tab's widget, by kind (a case per kind: a new glance kind doesn't compile without one). */
export function GlanceWidget({ tab, ...props }: GlanceWidgetProps<GlanceTab>): ReactElement {
  switch (tab.kind) {
    case 'number': return <NumberWidget tab={tab} {...props} />
    case 'followup': return <FollowupWidget tab={tab} {...props} />
    case 'next7': return <NextDaysWidget tab={tab} {...props} />
    case 'trend': return <TrendWidget tab={tab} {...props} />
    case 'status': return <StatusWidget tab={tab} {...props} />
    case 'people': return <PeopleWidget tab={tab} {...props} />
    case 'tags': return <TagsWidget tab={tab} {...props} />
    case 'stale': return <StaleWidget tab={tab} {...props} />
    case 'recent': return <RecentWidget tab={tab} {...props} />
    case 'eisenhowerSummary': return <EisenhowerSummaryWidget tab={tab} {...props} />
  }
}
