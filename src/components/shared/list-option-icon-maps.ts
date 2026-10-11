import { createElement, type ReactNode } from 'react'
import type { ListGroupBy, ListItemSortBy } from '../../models'
import {
  DeadlineIcon,
  FlatIcon,
  ManualIcon,
  NameIcon,
  PeopleIcon,
  ProjectIcon,
  StatusIconGlyph,
  TagIcon,
} from './list-option-icons'
import { FollowupFlagIcon } from './FollowupIcons'

// Post ui-consistency-2026-04-25 P4 the keys widen to the full unified union.
// Surfaces consume only the icons they need (via their per-surface subset
// constants) — the maps stay `Partial<…>` so the dictionary lookup gracefully
// returns `undefined` for sort/group dimensions a surface doesn't expose.
export const groupByIcons: Partial<Record<ListGroupBy, ReactNode>> = {
  none: createElement(FlatIcon),
  deadline: createElement(DeadlineIcon),
  followup: createElement(FollowupFlagIcon),
  people: createElement(PeopleIcon),
  project: createElement(ProjectIcon),
  status: createElement(StatusIconGlyph),
  tag: createElement(TagIcon),
}

export const itemSortByIcons: Partial<Record<ListItemSortBy, ReactNode>> = {
  manual: createElement(ManualIcon),
  name: createElement(NameIcon),
  deadline: createElement(DeadlineIcon),
  followup: createElement(FollowupFlagIcon),
}
