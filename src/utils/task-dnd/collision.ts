import {
  pointerWithin,
  type Collision,
  type CollisionDetection,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { dndLog } from '../debug-flags'
import { topModalBackdrop, underModal } from '../dom-contract'

/**
 * A single rule in the per-context task-collision table. Each rule pairs a
 * "does this drag match?" predicate with an "accept these droppables?" filter.
 * The first matching rule wins; rules are evaluated top-to-bottom. Every
 * task drop target (calendar days) must be under the
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
  return withinVisible(buildRuleCollision(rules))
}

type DetectArgs = Parameters<CollisionDetection>[0]

/**
 * Keeps only the hits whose droppable shows at the pointer. dnd-kit measures
 * droppables by their rects alone, so two kinds of hidden target still
 * collide:
 * - a calendar day scrolled out of its scroller still has a rect — over
 *   whatever lies beyond the scroller (the list a row is dragged in). A hit
 *   counts only where no ancestor that clips its overflow cuts the point off
 *   (cr31 W1);
 * - a calendar day in a cell behind a modal (the widget popup, Open larger)
 *   lies under the rows dragged in that modal. A hit under a modal never
 *   counts (`underModal`, cr34 N1): the modal's own droppables, and those of
 *   a popover opened from it, come after its backdrop in the page and do.
 */
function withinVisible(detect: CollisionDetection): CollisionDetection {
  return (args) => {
    const hits = detect(args)
    const point = args.pointerCoordinates
    if (hits.length === 0) return hits
    const backdrop = topModalBackdrop()
    return hits.filter((hit) => {
      const node = args.droppableContainers.find((c) => c.id === hit.id)?.node.current
      if (!node) return true
      if (underModal(node, backdrop)) return false
      return !point || !clippedAt(node, point.x, point.y)
    })
  }
}

/** Whether an ancestor of `node` that clips its overflow (a scroller) leaves the point outside. */
export function clippedAt(node: Element, x: number, y: number): boolean {
  for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(el)
    const clipsX = overflowX !== 'visible'
    const clipsY = overflowY !== 'visible'
    if (!clipsX && !clipsY) continue
    const r = el.getBoundingClientRect()
    if ((clipsX && (x < r.left || x > r.right)) || (clipsY && (y < r.top || y > r.bottom))) return true
  }
  return false
}

function buildRuleCollision(rules: readonly TaskCollisionRule[]): CollisionDetection {
  return (args: DetectArgs): Collision[] => {
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
