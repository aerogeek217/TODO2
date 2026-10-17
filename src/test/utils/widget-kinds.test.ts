import { describe, it, expect } from 'vitest'
import {
  createTab,
  isWidgetKind,
  toggleCalendarDateType,
  WIDGET_KIND_SPECS,
  WIDGET_KINDS,
  widgetKindLabel,
} from '../../models/workspace-layout'
import { defaultDashboardConfig } from '../../models/dashboard-config'
import { checkLayoutColumns, pickLayoutColumns } from '../../data/layout-shape'
import { tabTitle } from '../../components/workspace/widget-hooks'

/** The widget-kind table and what derives from it. */
describe('widget kinds', () => {
  it('lists the kinds in menu order, with their names', () => {
    expect(WIDGET_KINDS).toEqual(['lens', 'calendar', 'notes', 'eisenhower', 'dashboard'])
    expect(WIDGET_KINDS.map(widgetKindLabel)).toEqual(['List', 'Calendar', 'Notes', 'Eisenhower', 'Dashboard'])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].showsList)).toEqual(['lens'])
  })

  it('accepts exactly the stored kind ids (the layout import check uses it)', () => {
    for (const kind of WIDGET_KINDS) expect(isWidgetKind(kind)).toBe(true)
    for (const v of ['status', 'taskboard', 'list', 'List', 'toString', '__proto__', 'constructor', '', 3, null, undefined]) {
      expect(isWidgetKind(v)).toBe(false)
    }
    const layout = (kind: unknown) => [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 't', kind, config: {} }] }] }]
    expect(checkLayoutColumns(layout('status'))).toBe('columns[0].cells[0].tabs[0].kind')
    expect(checkLayoutColumns(layout('toString'))).toBe('columns[0].cells[0].tabs[0].kind')
    expect(pickLayoutColumns(layout('status')).fixes).toEqual(['tab dropped'])
  })

  it('makes each kind’s new tab with its defaults', () => {
    expect(createTab('lens', 'a')).toEqual({ id: 'a', kind: 'lens', config: {} })
    expect(createTab('lens', 'a', { listDefinitionId: 4 })).toEqual({ id: 'a', kind: 'lens', config: { listDefinitionId: 4 } })
    expect(createTab('calendar', 'b')).toEqual({ id: 'b', kind: 'calendar', config: { dateTypes: { due: true, followup: true } } })
    expect(createTab('notes', 'c')).toEqual({ id: 'c', kind: 'notes', config: {} })
    expect(createTab('eisenhower', 'd')).toEqual({ id: 'd', kind: 'eisenhower', config: {} })
    expect(createTab('dashboard', 'e')).toEqual({ id: 'e', kind: 'dashboard', config: defaultDashboardConfig() })
    // A fresh config each time.
    const one = createTab('calendar', 'x')
    one.config.dateTypes.due = false
    expect(createTab('calendar', 'y').config.dateTypes.due).toBe(true)
  })

  it('every new tab passes the layout check', () => {
    const columns = [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: WIDGET_KINDS.map((k) => createTab(k, `t-${k}`)) }] }]
    expect(checkLayoutColumns(columns)).toBe(true)
    expect(pickLayoutColumns(columns)).toEqual({ columns, fixes: [] })
  })

  it('titles a tab by its list, “(Deleted list)” when the list is gone, else by kind', () => {
    expect(tabTitle(createTab('lens', 'a', { listDefinitionId: 4 }), 'Team')).toBe('Team')
    expect(tabTitle(createTab('lens', 'a', { listDefinitionId: 4 }), undefined)).toBe('(Deleted list)')
    expect(tabTitle(createTab('lens', 'a'), undefined)).toBe('List')
    expect(tabTitle(createTab('eisenhower', 'b'), undefined)).toBe('Eisenhower')
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
