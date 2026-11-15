import { describe, expect, it } from 'vitest'
import type { Status, Tag } from '../../models'
import { expressionResolver, namedIds } from '../../services/filter-expression-field'
import { NO_PICKS, withPicked } from '../../services/nlp-resolver'
import { parseExpression, printExpression } from '../../utils/filter-expression'
import { expressionNamesOf } from '../../utils/filter-chips'
import { makePerson } from '../helpers'

/**
 * Names → ids for a filter expression when two share a name (cr33 F5, cr34
 * F10): the text of `@Alex` can't say which Alex, so the resolver is told —
 * by what was picked from the popup, then by what the filter already names.
 */

const people = [makePerson({ id: 3, name: 'Alex' }), makePerson({ id: 4, name: 'Alex' }), makePerson({ id: 5, name: 'Bea' })]
const tags: Tag[] = [{ id: 1, name: 'q4', color: '#111' }, { id: 2, name: 'q4', color: '#222' }]
const statuses: Status[] = [{ id: 7, name: 'Waiting', color: '#888', sortOrder: 1 }, { id: 8, name: 'Waiting', color: '#888', sortOrder: 2 }]
const TODAY = new Date(2026, 10, 6)

describe('expressionResolver with namesakes', () => {
  it('with nothing said, a name is the first that matches', () => {
    const r = expressionResolver(people, tags, statuses)
    expect([r.person('Alex'), r.tag('q4'), r.status('Waiting'), r.person('Bea'), r.person('Nobody')]).toEqual([3, 1, 7, 5, undefined])
  })

  it('a pick from the popup says which: the second Alex picked is the second Alex (cr34 F10)', () => {
    const picked = withPicked(withPicked(withPicked(NO_PICKS, { kind: 'person', id: 4 }), { kind: 'tag', id: 2 }), { kind: 'status', id: 8 })
    const r = expressionResolver(people, tags, statuses, undefined, picked)
    expect([r.person('Alex'), r.tag('q4'), r.status('Waiting')]).toEqual([4, 2, 8])
    // Typed short of the whole name, it is still the one picked; another name is untouched.
    expect(r.person('Al')).toBe(4)
    expect(r.person('Bea')).toBe(5)
  })

  it('the newest pick wins — over an older pick and over the one the filter names', () => {
    const named = namedIds({ kind: 'person', id: 4 })
    // The filter names the second Alex (cr33 F5: it stays that one) …
    expect(expressionResolver(people, tags, statuses, named).person('Alex')).toBe(4)
    // … until the first is picked from the popup.
    expect(expressionResolver(people, tags, statuses, named, withPicked(NO_PICKS, { kind: 'person', id: 3 })).person('Alex')).toBe(3)
    const both = withPicked(withPicked(NO_PICKS, { kind: 'person', id: 3 }), { kind: 'person', id: 4 })
    expect(both.person).toEqual([3, 4])
    expect(expressionResolver(people, tags, statuses, named, both).person('Alex')).toBe(4)
    // Picked again, it moves to the end, once.
    expect(withPicked(both, { kind: 'person', id: 3 }).person).toEqual([4, 3])
  })

  it('a pick of someone else, or of a person since deleted, changes nothing for the name', () => {
    const r = expressionResolver(people, tags, statuses, undefined, { ...NO_PICKS, person: [5, 99] })
    expect(r.person('Alex')).toBe(3)
  })

  it('a text reads and prints through it: the picked namesake, with the same text', () => {
    const names = expressionNamesOf({ people, tags, statuses })
    const read = (picked = NO_PICKS) => {
      const p = parseExpression('@Alex and #q4', { today: TODAY, names: expressionResolver(people, tags, statuses, undefined, picked) })
      if (!p.ok || !p.expression) throw new Error('unreadable')
      return p.expression
    }
    expect(read()).toEqual({ kind: 'and', items: [{ kind: 'person', id: 3 }, { kind: 'tag', id: 1 }] })
    const second = read(withPicked(NO_PICKS, { kind: 'person', id: 4 }))
    expect(second).toEqual({ kind: 'and', items: [{ kind: 'person', id: 4 }, { kind: 'tag', id: 1 }] })
    expect(printExpression(second, false, names)).toBe('@Alex and #q4')
  })
})
