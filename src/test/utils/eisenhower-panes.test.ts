import { describe, it, expect } from 'vitest'
import { emptyFilterClauses, emptyPredicate, type TodoPredicate } from '../../models'
import {
  defaultPaneFilter,
  normalizePaneConfig,
  paneSubtitle,
  paneWrites,
  resolvePanes,
  withPaneConfig,
  withPaneSeed,
} from '../../utils/eisenhower-panes'

const p = (extra: Partial<TodoPredicate>): TodoPredicate => ({ ...emptyPredicate(), ...extra })
const NAMES = {
  people: [{ id: 1, name: 'Ann', initials: 'AN' }, { id: 2, name: 'Bob', initials: 'BO' }],
  tags: [{ id: 5, name: 'home', color: '#000' }],
  statuses: [{ id: 3, name: 'Delegated', color: '#000', icon: 'circle' as const, sortOrder: 1 }, { id: 4, name: 'Waiting', color: '#000', icon: 'circle' as const, sortOrder: 2 }],
}
const NOT_DELEGATED = p({ markers: { urgent: true, important: false }, statusIds: [3], negate: { statusIds: true } })

describe('the default panes', () => {
  it('are the quadrants of Urgent × Important as Yes / No', () => {
    expect(resolvePanes(undefined).map((pane) => [pane.id, pane.name, pane.filter.markers, pane.customName, pane.customFilter])).toEqual([
      ['do', 'Do', { urgent: true, important: true }, false, false],
      ['schedule', 'Schedule', { urgent: false, important: true }, false, false],
      ['delegate', 'Delegate', { urgent: true, important: false }, false, false],
      ['drop', 'Drop', { urgent: false, important: false }, false, false],
    ])
  })

  it('keep their plain-words subtitles', () => {
    expect(resolvePanes(undefined).map((pane) => paneSubtitle(pane, NAMES))).toEqual([
      'Urgent and important', 'Important, not urgent', 'Urgent, not important', 'Neither',
    ])
  })
})

describe('a pane’s stored settings', () => {
  it('keep only what differs from the default: a trimmed name, a filter (Show completed off)', () => {
    expect(normalizePaneConfig('do', { name: '  Now ', filter: p({ showCompleted: true, markers: { urgent: true } }) }))
      .toEqual({ name: 'Now', filter: p({ markers: { urgent: true } }) })
    expect(normalizePaneConfig('do', { name: 'Do', filter: p({ showCompleted: true, markers: { important: true, urgent: true } }) })).toBeUndefined()
    expect(normalizePaneConfig('drop', { name: '   ' })).toBeUndefined()
  })

  it('a name is one plain line: line breaks and control characters become spaces, bidi controls go; no length cap', () => {
    expect(normalizePaneConfig('do', { name: 'Now\nCan’t move to Do' })).toEqual({ name: 'Now Can’t move to Do' })
    expect(normalizePaneConfig('do', { name: '\u202Eolleh\u202C \u2066x\u2069\u200F\u0007' })).toEqual({ name: 'olleh x' })
    expect(normalizePaneConfig('do', { name: 'Line\u2028two\ttabs' })).toEqual({ name: 'Line two tabs' })
    // Emoji sequences keep their joiners; a long name stays whole.
    expect(normalizePaneConfig('do', { name: '👩‍💻 Dev' })).toEqual({ name: '👩‍💻 Dev' })
    expect(normalizePaneConfig('do', { name: 'x'.repeat(10_000) })?.name).toHaveLength(10_000)
    // Only control characters: the default name.
    expect(normalizePaneConfig('do', { name: '\u202E\u0000' })).toBeUndefined()
    expect(resolvePanes({ schedule: { name: 'Later\r\nnow' } })[1]?.name).toBe('Later  now')
  })

  it('an "is not" with nothing ticked is no filter', () => {
    expect(normalizePaneConfig('drop', { filter: { ...defaultPaneFilter('drop'), statusIds: [], negate: { statusIds: true } } })).toBeUndefined()
  })

  it('resolve over the defaults, marking what is custom', () => {
    const [, , delegate, drop] = resolvePanes({ delegate: { filter: NOT_DELEGATED }, drop: { name: 'Someday' } })
    expect(delegate).toMatchObject({ name: 'Delegate', customName: false, customFilter: true, filter: NOT_DELEGATED })
    expect(drop).toMatchObject({ name: 'Someday', customName: true, customFilter: false, filter: defaultPaneFilter('drop') })
  })

  it('withPaneConfig patches one pane, resets it with null, and is undefined once every pane is its default', () => {
    const one = withPaneConfig(undefined, 'delegate', { filter: NOT_DELEGATED })
    expect(one).toEqual({ delegate: { filter: NOT_DELEGATED } })
    const two = withPaneConfig(one, 'delegate', { name: 'Hand off' })
    expect(two).toEqual({ delegate: { name: 'Hand off', filter: NOT_DELEGATED } })
    expect(withPaneConfig(two, 'drop', { name: 'Drop' })).toEqual(two)
    expect(withPaneConfig(two, 'delegate', null)).toBeUndefined()
    expect(withPaneConfig(two, 'delegate', { filter: defaultPaneFilter('delegate') })).toEqual({ delegate: { name: 'Hand off' } })
  })
})

describe('paneSubtitle of a custom filter', () => {
  it('is the filter in words', () => {
    const [, , delegate] = resolvePanes({ delegate: { filter: NOT_DELEGATED } })
    expect(paneSubtitle(delegate!, NAMES)).toBe('Urgent · not Important · not Delegated')
  })

  it('names dates and text with their field; an empty filter is every task', () => {
    const [pane] = resolvePanes({ do: { filter: p({ dates: { deadline: { match: 'unset' } }, searchText: 'call', tags: [5] }) } })
    expect(paneSubtitle(pane!, NAMES)).toBe('#home · Due no date · Text “call”')
    const [empty] = resolvePanes({ do: { filter: p({}) } })
    expect(paneSubtitle(empty!, NAMES)).toBe('Every task')
  })

  it('spells an or group as its chips joined with "or", each chip whole; a group-only filter is no longer every task', () => {
    const group = { ...emptyFilterClauses(), statusIds: [4], markers: { urgent: true, important: false } }
    const [pane] = resolvePanes({ do: { filter: p({ tags: [5], orGroups: [group] }) } })
    expect(paneSubtitle(pane!, NAMES)).toBe('#home · Urgent, not Important or Waiting')
    const [only] = resolvePanes({ do: { filter: p({ orGroups: [{ ...emptyFilterClauses(), personIds: [1, 2] }] }) } })
    expect(paneSubtitle(only!, NAMES)).toBe('Ann or Bob')
  })
})

describe('paneWrites — what a drop / "+" on the pane writes', () => {
  it('each marker it tests, Yes or No', () => {
    expect(paneWrites(defaultPaneFilter('schedule'), NAMES)).toEqual({ markers: { urgent: false, important: true } })
    expect(paneWrites(p({ markers: 'hot' }), NAMES)).toEqual({ markers: {} })
  })

  it('one status, person or tag picked with "is"', () => {
    expect(paneWrites(p({ statusIds: [4], personIds: [1], tags: [5] }), NAMES)).toEqual({ markers: {}, statusId: 4, personId: 1, tagId: 5 })
  })

  it('nothing from "is not", several values or the "none" sentinels', () => {
    expect(paneWrites(NOT_DELEGATED, NAMES)).toEqual({ markers: { urgent: true, important: false } })
    expect(paneWrites(p({ statusIds: [3, 4], personIds: [1, 2], tags: [5, 6] }), NAMES)).toEqual({ markers: {} })
    expect(paneWrites(p({ statusIds: [0], personIds: [0], tags: [0] }), NAMES)).toEqual({ markers: {} })
  })

  it('never a status, person or tag that no longer exists: that clause is named instead', () => {
    expect(paneWrites(p({ markers: { urgent: true }, statusIds: [99], personIds: [98], tags: [97] }), NAMES))
      .toEqual({ markers: { urgent: true }, deleted: ['status', 'people', 'tags'] })
    expect(paneWrites(p({ statusIds: [4], personIds: [98] }), NAMES)).toEqual({ markers: {}, statusId: 4, deleted: ['people'] })
  })
})

describe('withPaneSeed — a pane "+"’s new-task defaults', () => {
  const base = { personIds: [1], tagIds: [], statusId: 3, markers: { focus: true, urgent: true } }

  it('the pane decides each marker it tests (a No leaves the flag off), its status wins, its person / tag join', () => {
    expect(withPaneSeed(base, { markers: { urgent: false, important: true }, statusId: 4, personId: 2, tagId: 5 }))
      .toEqual({ personIds: [1, 2], tagIds: [5], statusId: 4, markers: { focus: true, important: true } })
  })

  it('without writes the source’s seeds stay', () => {
    expect(withPaneSeed(base, { markers: {} })).toEqual(base)
    expect(withPaneSeed({ personIds: [], tagIds: [], statusId: undefined }, { markers: { urgent: false } }))
      .toEqual({ personIds: [], tagIds: [], statusId: undefined })
  })
})

describe('paneWrites and or groups', () => {
  it('writes the clauses outside the or groups only (which of a group’s clauses to meet is ambiguous)', () => {
    const filter = p({ markers: { urgent: true }, orGroups: [{ ...emptyFilterClauses(), statusIds: [4], personIds: [1] }] })
    expect(paneWrites(filter, NAMES)).toEqual({ markers: { urgent: true } })
  })
})
