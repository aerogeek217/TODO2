import {
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type UniqueIdentifier,
} from '@dnd-kit/core'

/**
 * dnd-kit collision algorithms exposed by {@link buildTaskCollision}. The
 * choice between `pointerWithin` vs. `closestCenter` matters in rails-style
 * layouts — `pointerWithin` requires the pointer to be inside the droppable,
 * which is what the canvas + dashboard-taskboard handlers rely on for the
 * "dropped outside → remove" branch. `closestCenter` always returns a hit for
 * row/card sortables as long as any eligible droppable exists.
 */
export type TaskCollisionAlgorithm = 'pointerWithin' | 'closestCenter' | 'rectIntersection'

const ALGORITHMS: Record<TaskCollisionAlgorithm, CollisionDetection> = {
  pointerWithin,
  closestCenter,
  rectIntersection,
}

/**
 * A single rule in the per-context task-collision table. Each rule pairs a
 * "does this drag match?" predicate with an "accept these droppables?" filter.
 * The first matching rule wins; rules are evaluated top-to-bottom.
 *
 * Each rule names its own dnd-kit algorithm so one collision function can
 * host both pointer-based drops (taskboard remove-on-drop-off) and
 * center-based drops (card reorder) without the caller threading context.
 */
export interface TaskCollisionRule {
  /**
   * Returns true when this rule applies to the current active drag. Consult
   * `active.id` for sortable-style active ids and `active.data.current?.type`
   * for the `TASK_DRAG_KIND` / `RAILS_DRAG_TYPE` family.
   */
  when: (active: CollisionActive) => boolean

  /** Returns true for droppable ids this rule accepts. */
  accept: (droppableId: UniqueIdentifier) => boolean

  /** Which dnd-kit algorithm to run against the filtered droppables. */
  algorithm: TaskCollisionAlgorithm
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
 * Build a `CollisionDetection` from a declarative rules table. Replaces the
 * hand-rolled per-context functions in `CanvasPage` and any other route
 * that wants to scope which droppables a given drag can hit.
 *
 * Rules are checked in order; the first `when` that matches wins and the
 * others are skipped. When no rule matches, the returned detection falls back
 * to `fallback` (default `closestCenter`) with every droppable in scope.
 *
 * F12 (audit): rails drags must continue to be routed to rail-only zones.
 * Callers that live in a `DndContext` that hosts both rails and tasks (today:
 * only the canvas) must supply a rails rule that accepts `isRailsDropId` zones
 * and a task rule that rejects them.
 */
export function buildTaskCollision(
  rules: readonly TaskCollisionRule[],
  fallback: TaskCollisionAlgorithm = 'closestCenter',
): CollisionDetection {
  return (args) => {
    const active = args.active as unknown as CollisionActive | null
    if (!active) return ALGORITHMS[fallback](args)

    for (const rule of rules) {
      if (!rule.when(active)) continue
      return ALGORITHMS[rule.algorithm]({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => rule.accept(c.id)),
      })
    }
    return ALGORITHMS[fallback](args)
  }
}
