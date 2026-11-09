import { describe, expect, it } from 'vitest'
import {
  goalStateLabel,
  oldestAge,
  oldestFoot,
  paceLabel,
  percentLabel,
  shareDeltaLabel,
} from '../../../components/workspace/glance/number-shape-copy'
import { switchShape } from '../../../components/workspace/glance/number-shape-switch'
import { emptyPredicate } from '../../../models/filter-predicate'
import { numberTab } from '../../helpers/layout-builders'

/** Thu 15 Oct 2026. */
const THU = new Date(2026, 9, 15)

describe('a Number’s shapes’ words (D26 P6)', () => {
  it('a share: its percent and its change in points', () => {
    expect(percentLabel(18)).toBe('18%')
    expect(percentLabel(null)).toBe('—')
    expect(shareDeltaLabel(4, 'yesterday')).toBe('+4 pts vs yesterday')
    expect(shareDeltaLabel(-1, 'lastWeek', THU)).toBe('−1 pt vs last Thu')
    expect(shareDeltaLabel(0, 'yesterday')).toBe('No change vs yesterday')
  })

  it('an oldest task’s age by its date, and the foot', () => {
    expect(oldestAge(19, 'lastFollowup')).toEqual({ figure: '19', caption: 'days since last follow-up' })
    expect(oldestAge(1, 'created')).toEqual({ figure: '1', caption: 'day old' })
    expect(oldestAge(30, 'modified')).toEqual({ figure: '30', caption: 'days untouched' })
    expect(oldestAge(3, 'deadline')).toEqual({ figure: '3', caption: 'days overdue' })
    expect(oldestAge(0, 'deadline')).toEqual({ figure: '0', caption: 'due today' })
    expect(oldestAge(-2, 'deadline')).toEqual({ figure: '2', caption: 'days until due' })
    expect(oldestFoot(12, 6)).toBe('12 · median 6 days')
    expect(oldestFoot(1, 1)).toBe('1 · median 1 day')
    expect(oldestFoot(0, null)).toBe('0')
  })

  it('where a goal stands', () => {
    expect(goalStateLabel({ state: 'met', target: 12, pace: 6 }, 12, THU)).toBe('Goal met')
    expect(goalStateLabel({ state: 'onPace', target: 12, pace: 6 }, 9, THU)).toBe('On pace (Thu)')
    expect(goalStateLabel({ state: 'behind', target: 12, pace: 6 }, 3, THU)).toBe('Behind pace (Thu)')
    expect(goalStateLabel({ state: 'behind', target: 12, pace: null }, 9, THU)).toBe('3 to go')
    expect(goalStateLabel({ state: 'within', target: 3, pace: null }, 1, THU)).toBe('Within the limit')
    expect(goalStateLabel({ state: 'over', target: 3, pace: null }, 5, THU)).toBe('2 over the limit')
    expect(paceLabel(60 / 7, THU)).toBe('Pace: 8.6 by the end of Thu')
  })
})

describe('the editor’s shape switch (D26 P6)', () => {
  const count = numberTab('n', 'overdue', { name: 'Late' }).config

  it('takes the old shape’s field out, puts the new one’s default in', () => {
    const toGoal = switchShape(count, 'goal', {}, undefined)
    expect(toGoal.patch).toEqual({ show: 'goal', goal: { atLeast: 10, period: 'week' } })
    const goal = { ...count, ...toGoal.patch }
    const toOldest = switchShape(goal, 'oldest', toGoal.stash, undefined)
    expect(toOldest.patch).toEqual({ show: 'oldest', goal: undefined, oldestBy: 'lastFollowup' })
    expect(toOldest.stash).toEqual({ goal: { atLeast: 10, period: 'week' } })
  })

  it('brings a stashed field back; the same shape changes nothing', () => {
    const stash = { goal: { atMost: 2 }, list: { listDefinitionId: 4 } }
    expect(switchShape(count, 'goal', stash, 9).patch).toEqual({ show: 'goal', goal: { atMost: 2 } })
    expect(switchShape(count, 'list', stash, 9).patch).toEqual({ show: 'list', list: { listDefinitionId: 4 } })
    expect(switchShape(count, 'count', stash, 9)).toEqual({ patch: {}, stash })
  })

  it('a group starts as one count of the Number’s own; a list on the layout’s first one, or none; a share of every open task', () => {
    expect(switchShape(count, 'group', {}, undefined).patch.items).toEqual([{ name: 'Late', filter: count.filter, ...(count.color ? { color: count.color } : {}) }])
    expect(switchShape(count, 'list', {}, 7).patch).toEqual({ show: 'list', list: { listDefinitionId: 7 } })
    expect(switchShape(count, 'list', {}, undefined).patch).toEqual({ show: 'list' })
    expect(switchShape({ ...count, items: [{ name: 'A', filter: emptyPredicate() }], show: 'group' }, 'share', {}, undefined).patch)
      .toEqual({ show: 'share', items: undefined })
  })
})
