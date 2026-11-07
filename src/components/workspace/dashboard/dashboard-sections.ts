import type { ComponentType } from 'react'
import type { DashboardSectionId } from '../../../models/dashboard-config'
import type { DashboardData } from '../../../hooks/use-dashboard-data'
import { EisenhowerSection } from '../glance/EisenhowerSummaryWidget'
import { FollowupSection } from '../glance/FollowupWidget'
import { NextDaysSection } from '../glance/NextDaysWidget'
import { PeopleSection } from '../glance/PeopleWidget'
import { RecentSection } from '../glance/RecentWidget'
import type { RowSectionProps } from '../glance/section-parts'
import { StaleSection } from '../glance/StaleWidget'
import { StatusSection } from '../glance/StatusWidget'
import { TagsSection } from '../glance/TagsWidget'
import { TrendSection } from '../glance/TrendWidget'
import { SECTION_META, type DashboardSectionMeta } from '../glance/section-meta'

/** What every section is rendered with on the Dashboard: the whole dashboard data, and the rows' kit. */
export type DashboardSectionProps = RowSectionProps<DashboardData>

/**
 * One dashboard section: a self-contained part (title, glyph, default width,
 * its own options) rendered from the shared dashboard data — each is also a
 * glance widget of its own (`components/workspace/glance`).
 */
export interface DashboardSectionDef extends DashboardSectionMeta {
  Component: ComponentType<DashboardSectionProps>
}

/** Every section, by id. */
export const DASHBOARD_SECTIONS: Record<DashboardSectionId, DashboardSectionDef> = {
  followup: { ...SECTION_META.followup, Component: FollowupSection },
  next7: { ...SECTION_META.next7, Component: NextDaysSection },
  trend: { ...SECTION_META.trend, Component: TrendSection },
  status: { ...SECTION_META.status, Component: StatusSection },
  people: { ...SECTION_META.people, Component: PeopleSection },
  tags: { ...SECTION_META.tags, Component: TagsSection },
  stale: { ...SECTION_META.stale, Component: StaleSection },
  recent: { ...SECTION_META.recent, Component: RecentSection },
  eisenhower: { ...SECTION_META.eisenhower, Component: EisenhowerSection },
}
