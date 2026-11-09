import type { PersistedTodoItem, Tag } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { isStale } from '../../utils/stale'
import { trendWindow } from '../../utils/trend-window'
import { completionOf } from './task-history'
import { idsByDate, type StatsContext } from './stats-context'

/**
 * Project pulse (D25 L): a card per picked tag — the share of its open
 * tasks that are late, 4 weeks of tasks added and closed, its open / late /
 * stale counts and its momentum (growing, steady or shrinking by the net
 * over the 4 weeks). Tags aren't logged, so a task counts under the tags
 * it has now; added is its `createdAt`, closed its completion (a task
 * reopened since isn't closed).
 */

/** Weeks a card covers: this week (so far) and the three before it. */
export const PULSE_WEEKS = 4

/** More than this many added than closed over the weeks is growing. */
export const PULSE_GROWING_NET = 2

export type PulseMomentum = 'growing' | 'steady' | 'shrinking'

export interface PulseCard {
  tag: Tag
  /** Its open tasks, in dialog order (by due date). */
  openIds: number[]
  /** Its late open tasks, in dialog order. */
  lateIds: number[]
  /** Its open tasks untouched for Settings' `staleAfterDays` (0 = off: none). */
  staleCount: number
  /** `lateIds / openIds`, 0 – 1; 0 with no open task. */
  lateShare: number
  /** Tasks added in each week, oldest first (`PULSE_WEEKS` entries). */
  added: number[]
  /** Tasks closed in each week, oldest first. */
  closed: number[]
  /** Added minus closed over the weeks. */
  net: number
  momentum: PulseMomentum
}

export type PulseContext = Pick<StatsContext, 'today' | 'weekStartsOn' | 'assignedTagsMap'>

/** Growing above `PULSE_GROWING_NET`, shrinking below 0, else steady. */
export function pulseMomentum(net: number): PulseMomentum {
  if (net > PULSE_GROWING_NET) return 'growing'
  return net < 0 ? 'shrinking' : 'steady'
}

/** `Growing: +5 net in 4 weeks` / `Steady: +0 net in 4 weeks` / `Shrinking: −2 net in 4 weeks`. */
export function momentumText(card: Pick<PulseCard, 'net' | 'momentum'>): string {
  const word = card.momentum === 'growing' ? 'Growing' : card.momentum === 'shrinking' ? 'Shrinking' : 'Steady'
  const net = card.net < 0 ? `−${-card.net}` : `+${card.net}`
  return `${word}: ${net} net in ${PULSE_WEEKS} weeks`
}

/**
 * A card per tag of `tagIds` (in pick order; a tag not in `tags` — deleted
 * since — is skipped) over `tasks` (completed ones included: closed reads
 * them), usually the screen-filtered tasks. A tag with no tasks gets an
 * empty card. Pure.
 */
export function computePulse(
  tasks: readonly PersistedTodoItem[],
  tags: readonly Tag[],
  ctx: PulseContext,
  tagIds: readonly number[],
  staleAfterDays: number,
): PulseCard[] {
  const { today } = ctx
  const weekStarts = trendWindow('4w', today, ctx.weekStartsOn).bucketStarts
  const weekOf = (d: Date | null | undefined): number | null => {
    if (!d) return null
    if ((daysUntil(d, today) ?? 1) > 0) return null
    for (let i = weekStarts.length - 1; i >= 0; i--) {
      const start = weekStarts[i]
      if (!start) continue
      const from = daysUntil(d, start) ?? -1
      if (from >= 0 && from < 7) return i
    }
    return null
  }
  const tagById = new Map(tags.flatMap((t) => (t.id != null ? [[t.id, t] as const] : [])))
  const tasksByTag = new Map<number, PersistedTodoItem[]>()
  for (const t of tasks) {
    for (const tag of ctx.assignedTagsMap.get(t.id) ?? []) {
      if (tag.id == null) continue
      const list = tasksByTag.get(tag.id) ?? []
      list.push(t)
      tasksByTag.set(tag.id, list)
    }
  }

  const cards: PulseCard[] = []
  for (const id of new Set(tagIds)) {
    const tag = tagById.get(id)
    if (!tag) continue
    const mine = tasksByTag.get(id) ?? []
    const open = mine.filter((t) => !t.isCompleted)
    const late = open.filter((t) => (daysUntil(t.dueDate, today) ?? 0) < 0)
    const added = new Array<number>(PULSE_WEEKS).fill(0)
    const closed = new Array<number>(PULSE_WEEKS).fill(0)
    for (const t of mine) {
      const a = weekOf(t.createdAt)
      if (a != null) added[a] = (added[a] ?? 0) + 1
      if (t.isCompleted) {
        const c = weekOf(completionOf(t))
        if (c != null) closed[c] = (closed[c] ?? 0) + 1
      }
    }
    const net = added.reduce((n, x) => n + x, 0) - closed.reduce((n, x) => n + x, 0)
    cards.push({
      tag,
      openIds: idsByDate(open, 'deadline'),
      lateIds: idsByDate(late, 'deadline'),
      staleCount: open.filter((t) => isStale(t, today, staleAfterDays)).length,
      lateShare: open.length > 0 ? late.length / open.length : 0,
      added,
      closed,
      net,
      momentum: pulseMomentum(net),
    })
  }
  return cards
}

/**
 * The card with the largest late share (ties: more late tasks, then pick
 * order); `null` with no card or none late.
 */
export function worstPulseCard(cards: readonly PulseCard[]): PulseCard | null {
  let worst: PulseCard | null = null
  for (const c of cards) {
    if (c.lateIds.length === 0) continue
    if (!worst || c.lateShare > worst.lateShare || (c.lateShare === worst.lateShare && c.lateIds.length > worst.lateIds.length)) worst = c
  }
  return worst
}

/** `25%`: a late share as a whole percentage. */
export function lateShareText(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** The cumulative counts at each week's end, from 0 at the first week's start (a card's lines). */
export function cumulative(perWeek: readonly number[]): number[] {
  const out = [0]
  for (const n of perWeek) out.push((out.at(-1) ?? 0) + n)
  return out
}

