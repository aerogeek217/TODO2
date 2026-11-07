import { describe, expect, it } from 'vitest'
import { createTab, WIDGET_KINDS, type WidgetKind } from '../../models/workspace-layout'
import {
  GLANCE_ROW_MIN_PX,
  isFitHeightKind,
  isFitRow,
  isGlanceKind,
  isGlanceRow,
  isHeadlessCell,
  rowMinHeightPx,
  stripShownByWidget,
  stripShownChoice,
  type KindFlag,
} from '../../utils/workspace-rows'
import { CELL_MIN_PX } from '../../utils/workspace-resize'
import { cell, row } from '../helpers/layout-builders'

/** A stand-in flag: no kind is a glance (or fit-height) one before P3, so the tests name one. */
const calendarOnly: KindFlag = (kind) => kind === 'calendar'

const notes = (id: string) => createTab('notes', id)
const calendar = (id: string) => createTab('calendar', id)

describe('the kind flags', () => {
  it('the glance kinds are the Number, the sections and the brief’s parts; only the Number fits its height', () => {
    expect(WIDGET_KINDS.filter(isGlanceKind)).toEqual([
      'number', 'followup', 'next7', 'trend', 'status', 'people', 'tags', 'stale', 'recent', 'eisenhowerSummary',
      'changes', 'today', 'pulse',
    ])
    expect(WIDGET_KINDS.filter(isFitHeightKind)).toEqual(['number'])
  })

  it('an unknown kind is neither', () => {
    expect(isGlanceKind('nope' as WidgetKind)).toBe(false)
    expect(isFitHeightKind('nope' as WidgetKind)).toBe(false)
  })
})

describe('isHeadlessCell', () => {
  it('one tab with `stripShown: false` is headless, whatever its kind', () => {
    expect(isHeadlessCell(cell('a', [notes('t')], { stripShown: false }))).toBe(true)
  })

  it('one glance tab with no `stripShown` is headless; a non-glance one is not', () => {
    expect(isHeadlessCell(cell('a', [calendar('t')]), calendarOnly)).toBe(true)
    expect(isHeadlessCell(cell('a', [notes('t')]), calendarOnly)).toBe(false)
    expect(isHeadlessCell(cell('a', [calendar('t')]))).toBe(false)
  })

  it('`stripShown: true` is never headless', () => {
    expect(isHeadlessCell(cell('a', [calendar('t')], { stripShown: true }), calendarOnly)).toBe(false)
  })

  it('several tabs, or none, are never headless', () => {
    expect(isHeadlessCell(cell('a', [notes('t1'), notes('t2')], { stripShown: false }))).toBe(false)
    expect(isHeadlessCell(cell('a', [calendar('t1'), calendar('t2')]), calendarOnly)).toBe(false)
    expect(isHeadlessCell(cell('a', [], { stripShown: false }))).toBe(false)
  })
})

describe('the strip toggle', () => {
  it('by widget: a glance tab hides it, any other shows it', () => {
    expect(stripShownByWidget(cell('a', [calendar('t')]), calendarOnly)).toBe(false)
    expect(stripShownByWidget(cell('a', [notes('t')]), calendarOnly)).toBe(true)
  })

  it('writes the explicit choice, or `null` (by widget) when the widget would do that itself', () => {
    // A list-like cell: hiding is a choice; showing again is its widget's way.
    expect(stripShownChoice(cell('a', [notes('t')]), false)).toBe(false)
    expect(stripShownChoice(cell('a', [notes('t')], { stripShown: false }), true)).toBeNull()
    // A glance cell: showing is a choice; hiding again is its widget's way.
    expect(stripShownChoice(cell('a', [calendar('t')]), true, calendarOnly)).toBe(true)
    expect(stripShownChoice(cell('a', [calendar('t')], { stripShown: true }), false, calendarOnly)).toBeNull()
  })
})

describe('isFitRow', () => {
  it('every cell holds one tab of a fit-height kind', () => {
    expect(isFitRow(row('r', [cell('a', [calendar('t1')]), cell('b', [calendar('t2')])]), calendarOnly)).toBe(true)
  })

  it('a cell of another kind, several tabs or no tab makes it a weighted row', () => {
    expect(isFitRow(row('r', [cell('a', [calendar('t1')]), cell('b', [notes('t2')])]), calendarOnly)).toBe(false)
    expect(isFitRow(row('r', [cell('a', [calendar('t1'), calendar('t2')])]), calendarOnly)).toBe(false)
    expect(isFitRow(row('r', [cell('a', [])]), calendarOnly)).toBe(false)
  })

  it('no kind fits its content yet: every row of this build is weighted', () => {
    expect(isFitRow(row('r', [cell('a', [calendar('t1')])]))).toBe(false)
  })
})

describe('glance rows', () => {
  it('a row of only glance tabs may shrink to 64px; any other keeps the cell minimum', () => {
    const glance = row('r', [cell('a', [calendar('t1'), calendar('t2')]), cell('b', [calendar('t3')])])
    expect(isGlanceRow(glance, calendarOnly)).toBe(true)
    expect(rowMinHeightPx(glance, calendarOnly)).toBe(GLANCE_ROW_MIN_PX)
    const mixed = row('r', [cell('a', [calendar('t1'), notes('t2')])])
    expect(isGlanceRow(mixed, calendarOnly)).toBe(false)
    expect(rowMinHeightPx(mixed, calendarOnly)).toBe(CELL_MIN_PX)
    expect(isGlanceRow(row('r', [cell('a', [])]), calendarOnly)).toBe(false)
  })
})
