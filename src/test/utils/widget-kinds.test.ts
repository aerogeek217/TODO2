import { describe, it, expect } from 'vitest'
import {
  createTab,
  isWidgetKind,
  tabListId,
  toggleCalendarDateType,
  WIDGET_KIND_SPECS,
  WIDGET_KINDS,
  widgetKindLabel,
} from '../../models/workspace-layout'
import { checkLayoutBody, pickLayoutBody } from '../../data/layout-shape'
import { tabTitle } from '../../components/workspace/widget-hooks'
import { numberTab, single } from '../helpers/layout-builders'
import { emptyPredicate } from '../../models/filter-predicate'

/** The widget-kind table and what derives from it. */
describe('widget kinds', () => {
  it('lists the kinds in menu order, with their names', () => {
    // Tasks (List, Notes), then Numbers & charts — the Calendar, the Eisenhower and the Neglect map last (D26).
    expect(WIDGET_KINDS).toEqual([
      'lens', 'notes',
      'number', 'trend', 'status', 'people', 'tags', 'pulse', 'calendar', 'eisenhower', 'neglect',
    ])
    expect(WIDGET_KINDS.map(widgetKindLabel)).toEqual([
      'List', 'Notes',
      'Number', 'Created vs completed', 'Status', 'People', 'Tags', 'Project pulse', 'Calendar', 'Eisenhower', 'Neglect map',
    ])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'tasks')).toEqual(['lens', 'notes'])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].showsList)).toEqual(['lens'])
  })

  it('accepts exactly the stored kind ids (the layout import check uses it)', () => {
    for (const kind of WIDGET_KINDS) expect(isWidgetKind(kind)).toBe(true)
    for (const v of ['taskboard', 'list', 'List', 'toString', '__proto__', 'constructor', '', 3, null, undefined]) {
      expect(isWidgetKind(v)).toBe(false)
    }
    const layout = (kind: unknown) => single({ id: 'k', tabs: [{ id: 't', kind, config: {} } as never] })
    expect(checkLayoutBody(layout('taskboard'))).toBe('cells[0].tabs[0].kind')
    expect(checkLayoutBody(layout('toString'))).toBe('cells[0].tabs[0].kind')
    expect(pickLayoutBody(layout('taskboard')).fixes).toEqual(['tab dropped'])
  })

  it('makes each kind’s new tab with its defaults', () => {
    expect(createTab('lens', 'a')).toEqual({ id: 'a', kind: 'lens', config: {} })
    expect(createTab('lens', 'a', { listDefinitionId: 4 })).toEqual({ id: 'a', kind: 'lens', config: { listDefinitionId: 4 } })
    expect(createTab('calendar', 'b')).toEqual({ id: 'b', kind: 'calendar', config: { dateTypes: { due: true, followup: true } } })
    expect(createTab('notes', 'c')).toEqual({ id: 'c', kind: 'notes', config: {} })
    expect(createTab('eisenhower', 'd')).toEqual({ id: 'd', kind: 'eisenhower', config: {} })
    // An Eisenhower tab has no config: its panes and source are app-wide settings.
    expect(createTab('eisenhower', 'd', { listDefinitionId: 4 })).toEqual({ id: 'd', kind: 'eisenhower', config: {} })
    // A Number: an empty filter (every open task), named Open, never lit, against yesterday.
    expect(createTab('number', 'e')).toEqual({ id: 'e', kind: 'number', config: { name: 'Open', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'yesterday' } })
    // A Neglect map colours by the tags it is given (the store passes the `Project: …` ones), 14 days.
    expect(createTab('neglect', 'f')).toEqual({ id: 'f', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [] }, untouchedDays: 14 } })
    expect(createTab('neglect', 'f', { neglectTagIds: [3, 8] }).config).toEqual({ colourBy: { kind: 'tags', tagIds: [3, 8] }, untouchedDays: 14 })
    // A fresh config each time.
    const one = createTab('calendar', 'x')
    one.config.dateTypes.due = false
    expect(createTab('calendar', 'y').config.dateTypes.due).toBe(true)
  })

  it('every new tab passes the layout check', () => {
    const body = single({ id: 'k', tabs: WIDGET_KINDS.map((k) => createTab(k, `t-${k}`)) })
    expect(checkLayoutBody(body)).toBe(true)
    expect(pickLayoutBody(body)).toEqual({ ...body, fixes: [] })
  })

  it('titles a list tab by its list, “(Deleted list)” when the list is gone, every other tab by kind', () => {
    expect(tabTitle(createTab('lens', 'a', { listDefinitionId: 4 }), 'Team')).toBe('Team')
    expect(tabTitle(createTab('lens', 'a', { listDefinitionId: 4 }), undefined)).toBe('(Deleted list)')
    expect(tabTitle(createTab('lens', 'a'), undefined)).toBe('List')
    expect(tabTitle(createTab('eisenhower', 'b'), undefined)).toBe('Eisenhower')
    // The Eisenhower reads Eisenhower whatever its list.
    expect(tabTitle(createTab('eisenhower', 'b'), 'Team')).toBe('Eisenhower')
    // A Number reads its name (a blank one: Number).
    expect(tabTitle(createTab('number', 'n'), undefined)).toBe('Open')
    expect(tabTitle(numberTab('n', 'closedThisWeek'), undefined)).toBe('Closed this week')
    expect(tabTitle(numberTab('n', 'open', { name: '  ' }), undefined)).toBe('Number')
    expect(tabTitle(createTab('trend', 't'), undefined)).toBe('Created vs completed')
  })

  it('the list a tab shows: a list tab’s own, an Eisenhower tab’s the Eisenhower’s list; none for the rest', () => {
    expect(tabListId(createTab('lens', 'a', { listDefinitionId: 4 }), 5)).toBe(4)
    expect(tabListId(createTab('eisenhower', 'b'), 5)).toBe(5)
    expect(tabListId(createTab('eisenhower', 'b'), null)).toBeUndefined()
    expect(tabListId(createTab('calendar', 'c'), 5)).toBeUndefined()
    expect(tabListId(createTab('number', 'd'), 5)).toBeUndefined()
  })
})

describe('toggleCalendarDateType', () => {
  it('switches a date type on or off — the last one too', () => {
    const both = { due: true, followup: true }
    expect(toggleCalendarDateType(both, 'due')).toEqual({ due: false, followup: true })
    const dueOnly = { due: true, followup: false }
    expect(toggleCalendarDateType(dueOnly, 'followup')).toEqual({ due: true, followup: true })
    expect(toggleCalendarDateType(dueOnly, 'due')).toEqual({ due: false, followup: false })
    expect(toggleCalendarDateType({ due: false, followup: false }, 'followup')).toEqual({ due: false, followup: true })
  })
})
