import { describe, it, expect } from 'vitest'
import { emptyPredicate } from '../../models/filter-predicate'
import {
  cleanLensName, findLens, lensPredicate, newLensId, presetLenses, uniqueLensName, waitingStatusId, type Lens,
} from '../../utils/lens'

const lens = (id: string, name: string): Lens => ({ id, name, predicate: emptyPredicate() })

describe('lens helpers', () => {
  it('a name is trimmed; a blank or too-long one is refused', () => {
    expect(cleanLensName('  Fresh ')).toBe('Fresh')
    expect(cleanLensName('   ')).toBeNull()
    expect(cleanLensName('x'.repeat(101))).toBeNull()
  })

  it('a lens never shows completed tasks, and an "is not" with nothing ticked is no filter', () => {
    expect(lensPredicate({ ...emptyPredicate(), showCompleted: true, statusIds: [], negate: { statusIds: true } }))
      .toEqual(emptyPredicate())
  })

  it('a new id is one no lens has; find reads the pick (none for a deleted lens)', () => {
    const lenses = [lens('lens-a', 'A')]
    expect(newLensId(lenses)).toMatch(/^lens-[a-z0-9]+$/)
    expect(newLensId(lenses)).not.toBe('lens-a')
    expect(findLens(lenses, 'lens-a')?.name).toBe('A')
    expect(findLens(lenses, 'lens-gone')).toBeUndefined()
    expect(findLens(lenses, null)).toBeUndefined()
  })

  it('a duplicate name gets the first free number', () => {
    const lenses = [lens('a', 'Fresh'), lens('b', 'fresh 2')]
    expect(uniqueLensName(lenses, 'Fresh')).toBe('Fresh 3')
    expect(uniqueLensName(lenses, 'New')).toBe('New')
  })

  it('the Waiting status is found by name, any case', () => {
    expect(waitingStatusId([{ id: 1, name: 'Assigned', color: '#000', sortOrder: 0 }, { id: 4, name: ' waiting ', color: '#000', sortOrder: 1 }])).toBe(4)
    expect(waitingStatusId([{ id: 1, name: 'Assigned', color: '#000', sortOrder: 0 }])).toBeNull()
  })
})

describe('presetLenses', () => {
  let n = 0
  const ids = () => `p${++n}`

  it('This month, Not waiting, Has a person and Fresh, as the D15 spec gives them', () => {
    n = 0
    const presets = presetLenses(7, ids)
    expect(presets.map((p) => [p.id, p.name])).toEqual([['p1', 'This month'], ['p2', 'Not waiting'], ['p3', 'Has a person'], ['p4', 'Fresh']])
    expect(presets[0]!.predicate.dates).toEqual({
      deadline: { match: 'range', start: null, end: { kind: 'offset', days: 30 }, includeNoDate: true },
      followup: { match: 'range', start: null, end: { kind: 'offset', days: 14 }, includeNoDate: true },
    })
    expect(presets[1]!.predicate).toMatchObject({ statusIds: [7], negate: { statusIds: true } })
    expect(presets[2]!.predicate).toMatchObject({ personIds: [0], negate: { personIds: true } })
    expect(presets[3]!.predicate.dates).toEqual({ modified: { match: 'range', start: { kind: 'offset', days: -30 }, end: null } })
    for (const p of presets) expect(p.predicate.showCompleted).toBe(false)
  })

  it('no Not waiting without a Waiting status', () => {
    expect(presetLenses(null, ids).map((p) => p.name)).toEqual(['This month', 'Has a person', 'Fresh'])
  })
})
