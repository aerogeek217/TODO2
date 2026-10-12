import type { ListRowSelectMods } from '../list/ListWidgetRow'
import type { DashGlyphName } from './glyph-paths'

/**
 * A set of tasks a dashboard number stands for — what clicking it opens.
 * Built-in counts name their tasks (ids in display order); a list tile
 * names its list (the list's own sort and grouping apply).
 */
export type DashboardDrill =
  | { kind: 'tasks'; title: string; glyph: DashGlyphName; todoIds: readonly number[] }
  | { kind: 'list'; listDefinitionId: number }

/** Opens the tasks behind a number; absent = numbers aren't clickable. */
export type OnDashboardDrill = (drill: DashboardDrill) => void

/** What the task-row sections (Hot, Needs follow-up) share. */
export interface DashboardRowKit {
  tabId: string
  isMobile: boolean
  inScope: boolean
  selectedIds: ReadonlySet<number>
  cursorKey: string | null
  onSelect: (key: string, todoId: number, mods: ListRowSelectMods) => void
  onOpen: (todoId: number) => void
}
