import {
  findEisenhowerList,
  ownerLayoutId,
  type ListDefinition,
  type PersistedListDefinition,
} from '../models/list-definition'
import { bySortOrder } from './sort-order'

/** What Copy from's grouping reads of a list. */
export type CopySourceRef = Pick<PersistedListDefinition, 'id' | 'owner' | 'sortOrder'>

/** One heading of Copy from's chooser and the lists under it. */
export interface CopySourceGroup<T extends CopySourceRef = PersistedListDefinition> {
  /** `layout:<id>` or `eisenhower`. */
  key: string
  heading: string
  lists: T[]
}

/** Copy from's heading for the Eisenhower's own list. */
export const EISENHOWER_COPY_HEADING = 'Eisenhower'

/**
 * The lists Copy from offers, by layout: the open layout's first
 * (`openLayoutId`, headed `<name> · this layout`), then every other layout
 * in `layouts`' order (the top bar's tabs), then the Eisenhower's own list
 * under `Eisenhower`. A layout with no list to offer is left out; so is
 * `excludeId` (the list being edited) and a list whose layout isn't among
 * `layouts`. Lists within a layout in their order (`sortOrder`).
 */
export function copySourceGroups<T extends CopySourceRef>({
  lists,
  layouts,
  openLayoutId,
  eisenhowerListId,
  excludeId,
}: {
  lists: readonly T[]
  layouts: readonly { id: number; name: string }[]
  openLayoutId: number | undefined
  eisenhowerListId: number | null | undefined
  excludeId?: number
}): CopySourceGroup<T>[] {
  const offered = [...lists].filter((d) => d.id !== excludeId).sort(bySortOrder)
  const byLayout = new Map<number, T[]>()
  for (const d of offered) {
    const layoutId = ownerLayoutId(d)
    if (layoutId == null) continue
    const group = byLayout.get(layoutId)
    if (group) group.push(d)
    else byLayout.set(layoutId, [d])
  }
  const open = layouts.find((l) => l.id === openLayoutId)
  const ordered = open ? [open, ...layouts.filter((l) => l !== open)] : layouts
  const groups: CopySourceGroup<T>[] = []
  for (const layout of ordered) {
    const defs = byLayout.get(layout.id)
    if (!defs?.length) continue
    groups.push({
      key: `layout:${layout.id}`,
      heading: layout === open ? `${layout.name} · this layout` : layout.name,
      lists: defs,
    })
  }
  const eisenhower = findEisenhowerList(lists, eisenhowerListId)
  if (eisenhower && eisenhower.id !== excludeId) {
    groups.push({ key: 'eisenhower', heading: EISENHOWER_COPY_HEADING, lists: [eisenhower] })
  }
  return groups
}

/**
 * The parts of a list Copy from takes from its source: the filters (Show
 * completed with them), group, sort and its direction, the prompt and Show
 * filter line. Never the name, the owner or the manual order.
 */
export type CopiedListParts = Pick<ListDefinition, 'membership' | 'sort' | 'sortDirection' | 'grouping' | 'runtimeFilter' | 'showFilterLine'>

/** `source`'s copied parts (`CopiedListParts`), its filter cloned; parts it doesn't set are absent. */
export function copiedListParts(source: ListDefinition): CopiedListParts {
  return {
    membership: structuredClone(source.membership),
    sort: source.sort,
    ...(source.sortDirection != null ? { sortDirection: source.sortDirection } : {}),
    grouping: source.grouping,
    ...(source.runtimeFilter != null ? { runtimeFilter: { field: source.runtimeFilter.field } } : {}),
    ...(source.showFilterLine === false ? { showFilterLine: false as const } : {}),
  }
}

/**
 * `target` with `source`'s copied parts (`copiedListParts`) in place of
 * its own — its name, id, order and owner kept. A part `source` doesn't
 * set (a direction, a prompt, a hidden filter line) is dropped from
 * `target` too.
 */
export function withCopiedParts<T extends ListDefinition>(target: T, source: ListDefinition): T {
  const next: T = { ...target }
  delete next.sortDirection
  delete next.runtimeFilter
  delete next.showFilterLine
  return { ...next, ...copiedListParts(source) }
}

/**
 * `base`, or `base 2`, `base 3`, … — the first not among `taken`
 * (compared ignoring case): a new list's name, unique within its layout.
 */
export function uniqueListName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()))
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`
  return name
}
