import { describe, it, expect } from 'vitest'
import { emptyPredicate } from '../../models/filter-predicate'
import { LENSES_SETTING_MAX_LEN, formatLensesSetting, pickLenses, readLensesSetting } from '../../data/lens-shape'
import { LENSES_MAX } from '../../utils/lens'

describe('the stored lenses', () => {
  it('round-trips a lens list', () => {
    const lenses = [
      { id: 'lens-a', name: 'Has a person', predicate: { ...emptyPredicate(), personIds: [0], negate: { personIds: true as const } } },
      { id: 'lens-b', name: 'Fresh', predicate: { ...emptyPredicate(), dates: { modified: { match: 'range' as const, start: { kind: 'offset' as const, days: -30 }, end: null } } } },
    ]
    expect(readLensesSetting(formatLensesSetting(lenses))).toEqual({ lenses, fixes: [] })
  })

  it('drops a lens without an id or a name, with an id taken, or a predicate that isn’t one', () => {
    const { lenses, fixes } = pickLenses([
      { id: 'a', name: 'A', predicate: emptyPredicate() },
      { id: 'a', name: 'Again', predicate: emptyPredicate() },
      { name: 'No id', predicate: emptyPredicate() },
      { id: 'b', name: '  ', predicate: emptyPredicate() },
      { id: 'c', name: 'C', predicate: { dates: 'soon' } },
      'nope',
    ])
    expect(lenses.map((l) => l.id)).toEqual(['a'])
    expect(fixes).toEqual(['5 lenses dropped'])
  })

  it('fixes a lens: a malformed clause, completed tasks shown, a stray key, a padded name', () => {
    const { lenses, fixes } = pickLenses([
      { id: 'a', name: ' A ', extra: 1, predicate: { ...emptyPredicate(), showCompleted: true, statusIds: 'x', tags: [2] } },
    ])
    expect(lenses).toEqual([{ id: 'a', name: 'A', predicate: { ...emptyPredicate(), tags: [2] } }])
    expect(fixes).toEqual(['lens fixed'])
  })

  it('reads text that isn’t a list, isn’t JSON or is too long as no lenses', () => {
    expect(readLensesSetting('{}')).toEqual({ lenses: [], fixes: ['lenses reset'] })
    expect(readLensesSetting('nope')).toEqual({ lenses: [], fixes: ['lenses reset'] })
    expect(readLensesSetting('x'.repeat(LENSES_SETTING_MAX_LEN + 1))).toEqual({ lenses: [], fixes: ['lenses too long — reset'] })
  })

  it('keeps the first LENSES_MAX lenses', () => {
    const many = Array.from({ length: LENSES_MAX + 2 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, predicate: emptyPredicate() }))
    const { lenses, fixes } = pickLenses(many)
    expect(lenses).toHaveLength(LENSES_MAX)
    expect(fixes).toEqual(['2 lenses dropped'])
  })
})
