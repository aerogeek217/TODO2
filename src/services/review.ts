import type { FilterExpr, Person, Tag, TodoPredicate } from '../models'
import type { BreakdownColumn, BreakdownConfig } from '../models/chart-widgets'
import { useFilterStore } from '../stores/filter-store'
import { listAsShownNow } from '../stores/list-draft-store'
import { useListWidgetStore, type ReviewFilter, type ShownListSection } from '../stores/list-widget-store'
import { useTodoStore } from '../stores/todo-store'
import { admitsCompleted, criteriaToPredicate, predicateToCriteria } from '../utils/filter-criteria'
import { normalizeExpression, wholeExpression } from '../utils/filter-expression'
import { applyRuntimeFilter } from './build-list'
import { zoomTargetTab } from './list-zoom'
import type { AgeBucket, BreakdownRow, DueBucket, PriorityGroupKey } from './stats/breakdown'

/**
 * What each Review button sends to a Review widget (widget feedback 2B): a
 * filter (`ReviewFilter`, the expression its field shows) built from where
 * the button is — a list tab as it shows its tasks, a person, a tag, several
 * people, a Breakdown row or one of its count columns, the top bar's filter.
 * The jump itself is `services/review-jump`. Every filter is built as a tree
 * of ids (`FilterExpr`), never as text: a name with spaces, quotes or
 * parentheses prints as the field quotes it.
 */

/** The filter that keeps every open task (an `and` of nothing; it prints as an empty field). */
const EVERY_TASK: FilterExpr = { kind: 'and', items: [] }

/** `terms` ANDed (the absent ones left out) in normal form; null when none is left. */
function allOf(terms: readonly (FilterExpr | null | undefined)[]): FilterExpr | null {
  const items = terms.filter((t): t is FilterExpr => t != null)
  if (items.length === 0) return null
  return normalizeExpression(items.length === 1 && items[0] ? items[0] : { kind: 'and', items })
}

/**
 * What a Review button sends (`services/review-jump.jumpToReview`): the
 * filter, and — from a source that counts its tasks under a lens switch of
 * its own (a list, a Breakdown, the top bar) — whether that source ignores
 * the top bar's lens. The jump sets the Review widget's lens switch to it,
 * so "Review these 8 tasks" opens those 8. Absent (a person's or a tag's
 * menu, which counts nothing): the widget's switch stays as it is.
 */
export interface ReviewJump extends ReviewFilter {
  ignoreLens?: boolean
}

/** A Review widget's filter of `expression` (null: every open task). The widget reviews open tasks, so never `done`. */
function reviewFilterOf(expression: FilterExpr | null, ignoreLens?: boolean): ReviewJump {
  return { expression: expression ?? EVERY_TASK, showCompleted: false, ...(ignoreLens != null ? { ignoreLens } : {}) }
}

/** A review entry point's label for `n` tasks: `Review these 8 tasks` (`Review this task` for one). */
export function reviewTasksLabel(n: number): string {
  return n === 1 ? 'Review this task' : `Review these ${n} tasks`
}

// ── People and tags ─────────────────────────────────────────────────────────

/** A person's open tasks: `@Name`. */
export function personReviewFilter(person: Pick<Person, 'id'> & { id: number }): ReviewFilter {
  return reviewFilterOf({ kind: 'person', id: person.id })
}

/** A tag's open tasks: `#name`. */
export function tagReviewFilter(tag: Pick<Tag, 'id'> & { id: number }): ReviewFilter {
  return reviewFilterOf({ kind: 'tag', id: tag.id })
}

/** Several people's open tasks together: `@A or @B` (one person: `@A`). Null with none. */
export function peopleReviewFilter(people: readonly Pick<Person, 'id'>[]): ReviewFilter | null {
  const atoms = people.flatMap((p): FilterExpr[] => (p.id != null ? [{ kind: 'person', id: p.id }] : []))
  if (atoms.length === 0) return null
  return reviewFilterOf(normalizeExpression(atoms.length === 1 && atoms[0] ? atoms[0] : { kind: 'or', items: atoms }))
}

// ── A list tab ──────────────────────────────────────────────────────────────

/** A list's sections as their tasks, each once, at its first place (a task in several People groups). */
export function sectionTaskIds(sections: readonly ShownListSection[]): number[] {
  const seen = new Set<number>()
  for (const section of sections) for (const t of section.todos) seen.add(t.id)
  return [...seen]
}

/** How many open tasks list tab `tabId` shows now (each once); 0 while it isn't on screen. */
export function listReviewCount(tabId: string): number {
  const shown = useListWidgetStore.getState().shown[tabId]
  if (!shown) return 0
  return openCount(sectionTaskIds(shown.sections))
}

/** How many of `ids` are open tasks. */
export function openCount(ids: readonly number[]): number {
  const open = new Set(useTodoStore.getState().todos.filter((t) => !t.isCompleted).map((t) => t.id))
  return ids.filter((id) => open.has(id)).length
}

/**
 * List tab `tabId`'s filter as it shows its tasks (J5): the list's whole
 * filter as edited (its chips or its expression as one expression,
 * `wholeExpression`), its prompt pick taking the place of that field's own
 * term as the list applies it (`applyRuntimeFilter`). Its manual order and
 * group dividers don't carry over; its lens switch does (`ReviewJump`). Null
 * while the tab isn't on screen or its prompt waits for a pick.
 */
export function listReviewFilter(tabId: string): ReviewJump | null {
  const shown = useListWidgetStore.getState().shown[tabId]
  if (!shown) return null
  const definition = listAsShownNow(shown.listId)
  if (!definition) return null
  let predicate: TodoPredicate = definition.membership.predicate
  if (definition.runtimeFilter) {
    const pick = useListWidgetStore.getState().picks[tabId]
    if (!pick || pick.length === 0) return null
    predicate = applyRuntimeFilter(predicate, definition.runtimeFilter, pick)
  }
  return reviewFilterOf(wholeExpression(predicate), definition.ignoreLens === true)
}

/**
 * The list tab Review List acts on (the shortcut, the palette): the one on
 * screen the user was last in, as the zoom commands pick it
 * (`zoomTargetTab`), while it shows an open task; else null.
 */
export function reviewTargetTabId(): string | null {
  const tab = zoomTargetTab()
  return tab && listReviewCount(tab.id) > 0 ? tab.id : null
}

// ── The top bar's filter ────────────────────────────────────────────────────

/**
 * The filtered-tasks panel's review: the top bar's chips and its text search
 * as one expression. The lens is not part of it — the widget has its own
 * lens switch, which the jump sets to follow the lens, as the panel's tasks
 * do.
 */
export function screenReviewFilter(): ReviewJump {
  return reviewFilterOf(wholeExpression(criteriaToPredicate(useFilterStore.getState().filters)), false)
}

// ── A Breakdown row ─────────────────────────────────────────────────────────

/** A date range of `field`, each end a day offset from today (null: open). */
function daysRange(field: 'deadline' | 'created', start: number | null, end: number | null): FilterExpr {
  return {
    kind: 'date',
    field,
    match: {
      match: 'range',
      start: start == null ? null : { kind: 'offset', days: start },
      end: end == null ? null : { kind: 'offset', days: end },
    },
  }
}

const URGENT: FilterExpr = { kind: 'priority', value: 'urgent' }
const IMPORTANT: FilterExpr = { kind: 'priority', value: 'important' }
const FOCUS: FilterExpr = { kind: 'priority', value: 'focus' }
const not = (item: FilterExpr): FilterExpr => ({ kind: 'not', item })

/** Each priority row: the Priority sort's exclusive groups (`utils/markers.priorityRank`). */
const PRIORITY_TERMS: Record<PriorityGroupKey, FilterExpr> = {
  focus: FOCUS,
  urgentImportant: { kind: 'and', items: [URGENT, IMPORTANT, not(FOCUS)] },
  urgent: { kind: 'and', items: [URGENT, not(IMPORTANT), not(FOCUS)] },
  important: { kind: 'and', items: [IMPORTANT, not(URGENT), not(FOCUS)] },
}

/** Each due row (`services/stats/breakdown` `dueBucketOf`: days until due). */
const DUE_TERMS: Record<DueBucket, FilterExpr> = {
  overdue: daysRange('deadline', null, -1),
  today: daysRange('deadline', 0, 0),
  week: daysRange('deadline', 1, 7),
  later: daysRange('deadline', 8, null),
}

/** Each age row (`ageBucketOf`: whole days since created). */
const AGE_TERMS: Record<AgeBucket, FilterExpr> = {
  week: daysRange('created', -6, null),
  month: daysRange('created', -27, -7),
  quarter: daysRange('created', -90, -28),
  older: daysRange('created', null, -91),
}

/**
 * A Breakdown row as a filter term — the tasks the row holds among the
 * chart's (`services/stats/breakdown`): a person, a tag, a status, a
 * priority group, a due or an age bucket, or the split's none row
 * (Unassigned, No tags, No status, No priority, No due date). Every split's
 * rows are expressible; null only for a row this build doesn't know.
 */
export function breakdownRowTerm(row: Pick<BreakdownRow, 'entity'>, splitBy: BreakdownConfig['splitBy']): FilterExpr | null {
  const e = row.entity
  switch (e.kind) {
    case 'person': return { kind: 'person', id: e.person.id }
    case 'tag': return { kind: 'tag', id: e.tag.id }
    case 'status': return { kind: 'status', id: e.status.id }
    case 'priority': return PRIORITY_TERMS[e.group]
    case 'due': return DUE_TERMS[e.bucket]
    case 'age': return AGE_TERMS[e.bucket]
    case 'none':
      switch (splitBy) {
        case 'people': return { kind: 'person', id: 0 }
        case 'tags': return { kind: 'tag', id: 0 }
        case 'status': return { kind: 'status', id: 0 }
        case 'priority': return { kind: 'priority', value: 'none' }
        case 'due': return { kind: 'date', field: 'deadline', match: { match: 'unset' } }
        default: return null
      }
  }
}

/**
 * Whether a Breakdown's rows can be reviewed: not while its filter lets
 * completed tasks through (Show completed, a Completed range — "completed
 * this week by person"). Its rows then count tasks a review, which takes
 * open tasks only, would not show; its Review buttons open those tasks in
 * the task dialog instead.
 */
export function breakdownReviews(config: Pick<BreakdownConfig, 'filter'>): boolean {
  return !admitsCompleted(predicateToCriteria(config.filter))
}

/**
 * A Breakdown row's review (its Review button): the Breakdown's own filter
 * AND the row; with `column` (a count column's count), AND that column's
 * filter too; `ignoreLens` the Breakdown's lens switch (`ReviewJump`). Null
 * when the row can't be said as a filter, or the Breakdown counts completed
 * tasks (`breakdownReviews`) — the caller then opens the task dialog
 * instead.
 */
export function breakdownReviewFilter(
  config: Pick<BreakdownConfig, 'filter' | 'splitBy'>,
  row: Pick<BreakdownRow, 'entity'>,
  column?: Pick<BreakdownColumn, 'filter'>,
  ignoreLens?: boolean,
): ReviewJump | null {
  if (!breakdownReviews(config)) return null
  const term = breakdownRowTerm(row, config.splitBy)
  if (!term) return null
  return reviewFilterOf(allOf([wholeExpression(config.filter), term, column ? wholeExpression(column.filter) : null]), ignoreLens)
}
