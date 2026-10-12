import type { ComponentType } from 'react'
import type { DashboardSectionId } from '../../../models/dashboard-config'
import {
  FollowupSection,
  HotSection,
  NextDaysSection,
  PeopleSection,
  StatusSection,
  TrendSection,
  type DashboardSectionProps,
} from './DashboardSections'
import { SECTION_META, type DashboardSectionMeta } from './section-meta'

/**
 * One dashboard section: a self-contained part (title, glyph, default width,
 * its own options) rendered from the shared dashboard data — so a section
 * could later become a widget kind of its own.
 */
export interface DashboardSectionDef extends DashboardSectionMeta {
  Component: ComponentType<DashboardSectionProps>
}

/** Every section, by id. */
export const DASHBOARD_SECTIONS: Record<DashboardSectionId, DashboardSectionDef> = {
  hot: { ...SECTION_META.hot, Component: HotSection },
  followup: { ...SECTION_META.followup, Component: FollowupSection },
  next7: { ...SECTION_META.next7, Component: NextDaysSection },
  trend: { ...SECTION_META.trend, Component: TrendSection },
  status: { ...SECTION_META.status, Component: StatusSection },
  people: { ...SECTION_META.people, Component: PeopleSection },
}
