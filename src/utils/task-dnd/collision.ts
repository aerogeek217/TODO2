import {
  pointerWithin,
  type CollisionDetection,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { dndLog } from '../debug-flags'

/**
 * A single rule in the per-context task-collision table. Each rule pairs a
 * "does this drag match?" predicate with an "accept these droppables?" filter.
 * The first matching rule wins; rules are evaluated top-to-bottom. Every
 * task drop target (calendar days, Eisenhower quadrants) must be under the
 * pointer, so the accepted droppables go through dnd-kit's `pointerWithin`.
 */
export interface TaskCollisionRule {
  /**
   * Returns true when this rule applies to the current active drag. Consult
   * `active.id` for sortable-style active ids and `active.data.current?.type`
   * for the drag's kind (`TASK_DRAG_KIND`, the workspace tab drag).
   */
  when: (active: CollisionActive) => boolean

  /** Returns true for droppable ids this rule accepts. */
  accept: (droppableId: UniqueIdentifier) => boolean
}

/**
 * Subset of dnd-kit's `Active` used by rule predicates. `data` mirrors dnd-kit's
 * `DataRef<Data>` shape — the live payload lives at `data.current`, not on
 * `data` itself, so callers must always read `active.data.current?.type`.
 */
export interface CollisionActive {
  id: UniqueIdentifier
  data: { current: (({ type?: unknown } & Record<string, unknown>) | null) }
}

/**
 * Build a `CollisionDetection` from a declarative rules table, scoping which
 * droppables a given drag can hit.
 *
 * Rules are checked in order; the first `when` that matches wins and the
 * others are skipped. When no rule matches (or no drag is active), every
 * droppable is in scope.
 */
export function buildTaskCollision(rules: readonly TaskCollisionRule[]): CollisionDetection {
  return (args) => {
    const active = args.active as unknown as CollisionActive | null
    if (!active) {
      dndLog('collision.no-active.fallback', {})
      return pointerWithin(args)
    }

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]
      if (!rule || !rule.when(active)) continue
      const filtered = args.droppableContainers.filter((c) => rule.accept(c.id))
      dndLog('collision.rule-matched', {
        ruleIndex: i,
        activeId: active.id,
        activeType: active.data.current?.type ?? null,
        droppablesIn: args.droppableContainers.length,
        droppablesAccepted: filtered.length,
      })
      return pointerWithin({
        ...args,
        droppableContainers: filtered,
      })
    }
    dndLog('collision.no-rule-matched.fallback', {
      activeId: active.id,
      activeType: active.data.current?.type ?? null,
      droppablesIn: args.droppableContainers.length,
    })
    return pointerWithin(args)
  }
}
