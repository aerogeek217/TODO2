import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHECKIN_OPEN_METHOD,
  DEFAULT_CHECKIN_TASK_SCOPE,
  checkinScopeLabel,
  checkinTaskScopeEqual,
  formatCheckinTaskScope,
  isCheckinOpenMethod,
  parseCheckinTaskScope,
  resolveCheckinTaskScope,
  type CheckinTaskScope,
} from '../../utils/checkin-settings'

describe('check-in settings', () => {
  it('defaults: open in the mail app, all open tasks', () => {
    expect(DEFAULT_CHECKIN_OPEN_METHOD).toBe('mailto')
    expect(DEFAULT_CHECKIN_TASK_SCOPE).toEqual({ kind: 'all' })
  })

  it('isCheckinOpenMethod accepts mailto and eml only', () => {
    expect(isCheckinOpenMethod('mailto')).toBe(true)
    expect(isCheckinOpenMethod('eml')).toBe(true)
    for (const bad of ['', 'MAILTO', 'outlook', null, undefined, 1]) expect(isCheckinOpenMethod(bad)).toBe(false)
  })

  it('task scope round-trips through its stored form', () => {
    const scopes: CheckinTaskScope[] = [
      { kind: 'all' }, { kind: 'due-soon' }, { kind: 'hot' }, { kind: 'list', listDefinitionId: 42 },
    ]
    expect(scopes.map(formatCheckinTaskScope)).toEqual(['all', 'due-soon', 'hot', 'list:42'])
    for (const scope of scopes) expect(parseCheckinTaskScope(formatCheckinTaskScope(scope))).toEqual(scope)
  })

  it('parseCheckinTaskScope rejects anything else', () => {
    for (const bad of ['', 'ALL', 'overdue', 'list', 'list:', 'list:0', 'list:-3', 'list:1.5', 'list:abc', 'list:007', ' all', '{"kind":"all"}']) {
      expect(parseCheckinTaskScope(bad), bad).toBeUndefined()
    }
  })

  it('a list scope whose list is gone resolves to all open tasks', () => {
    const scope: CheckinTaskScope = { kind: 'list', listDefinitionId: 7 }
    expect(resolveCheckinTaskScope(scope, [3, 7])).toEqual(scope)
    expect(resolveCheckinTaskScope(scope, [3])).toEqual({ kind: 'all' })
    expect(resolveCheckinTaskScope(scope, [])).toEqual({ kind: 'all' })
    expect(resolveCheckinTaskScope({ kind: 'hot' }, [])).toEqual({ kind: 'hot' })
  })

  it('checkinTaskScopeEqual compares kind and list id', () => {
    expect(checkinTaskScopeEqual({ kind: 'list', listDefinitionId: 1 }, { kind: 'list', listDefinitionId: 1 })).toBe(true)
    expect(checkinTaskScopeEqual({ kind: 'list', listDefinitionId: 1 }, { kind: 'list', listDefinitionId: 2 })).toBe(false)
    expect(checkinTaskScopeEqual({ kind: 'all' }, { kind: 'hot' })).toBe(false)
  })
})

describe('checkinScopeLabel', () => {
  const lists = [{ id: 7, name: 'Reviews' }]
  it('names a quick pick by its label and a saved list by its name; a missing list reads as all', () => {
    expect(checkinScopeLabel({ kind: 'all' }, lists)).toBe('All open tasks')
    expect(checkinScopeLabel({ kind: 'due-soon' }, lists)).toBe('Overdue + next 2 weeks')
    expect(checkinScopeLabel({ kind: 'hot' }, lists)).toBe('Hot')
    expect(checkinScopeLabel({ kind: 'list', listDefinitionId: 7 }, lists)).toBe('Reviews')
    expect(checkinScopeLabel({ kind: 'list', listDefinitionId: 8 }, lists)).toBe('All open tasks')
  })
})
