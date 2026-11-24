import { describe, expect, it } from 'vitest'
import { createTab, type NumbersTab } from '../../models/workspace-layout'
import type { NumberItem } from '../../models/glance-widgets'
import {
  MEDIUM_FACE_MAX_HEIGHT_PX,
  plannerFaceFor,
  plannerPortrait,
  plannerStripFits,
  SMALL_FACE_MAX_HEIGHT_PX,
  SMALL_FACE_MAX_WIDTH_PX,
  tabOpensLarger,
  widgetFaceFor,
} from '../../utils/widget-face'
import { freshNumberTab } from '../helpers/layout-builders'

describe('tabOpensLarger', () => {
  /** A Numbers widget of one Number with `config` over a new one's. */
  const number = (config: Partial<NumberItem>): NumbersTab => {
    const tab = freshNumberTab('n')
    return { ...tab, config: { items: [{ ...tab.config.items[0]!, ...config }] } }
  }

  it('every kind but a Number, at any face (its large one too)', () => {
    for (const face of ['small', 'medium', 'large'] as const) {
      expect(tabOpensLarger(createTab('planner', 'p'), face)).toBe(true)
      expect(tabOpensLarger(createTab('neglect', 'm'), face)).toBe(true)
      expect(tabOpensLarger(createTab('calendar', 'c'), face)).toBe(true)
      expect(tabOpensLarger(createTab('review', 'r'), face)).toBe(true)
    }
  })

  it('a count only with a breakdown, which its large face alone draws', () => {
    expect(tabOpensLarger(number({}), 'small')).toBe(false)
    expect(tabOpensLarger(number({ breakdown: 'people' }), 'small')).toBe(true)
    expect(tabOpensLarger(number({ breakdown: 'people' }), 'medium')).toBe(true)
    expect(tabOpensLarger(number({ breakdown: 'people' }), 'large')).toBe(false)
  })

  it('the other shapes only from the small face, which leaves out their details', () => {
    for (const show of ['share', 'oldest', 'goal', 'group'] as const) {
      expect(tabOpensLarger(number({ show }), 'small')).toBe(true)
      expect(tabOpensLarger(number({ show }), 'medium')).toBe(false)
    }
  })

  it('never a Number that follows a list (its click opens the list)', () => {
    expect(tabOpensLarger(number({ show: 'list' }), 'small')).toBe(false)
  })

  it('a Numbers widget of several Numbers: not as a whole (each Number offers its own)', () => {
    const one = number({ show: 'share' })
    const two: NumbersTab = { ...one, config: { items: [...one.config.items, { ...one.config.items[0]!, id: 'm' }] } }
    expect(tabOpensLarger(two, 'small')).toBe(false)
  })
})

describe('widgetFaceFor', () => {
  it('an unmeasured body is large', () => {
    expect(widgetFaceFor({ width: 0, height: 0 })).toBe('large')
  })

  it('short or narrow is small, at the limits included', () => {
    expect(widgetFaceFor({ width: 600, height: SMALL_FACE_MAX_HEIGHT_PX })).toBe('small')
    expect(widgetFaceFor({ width: SMALL_FACE_MAX_WIDTH_PX, height: 500 })).toBe('small')
  })

  it('just past small and up to the medium height is medium', () => {
    expect(widgetFaceFor({ width: 600, height: SMALL_FACE_MAX_HEIGHT_PX + 1 })).toBe('medium')
    expect(widgetFaceFor({ width: SMALL_FACE_MAX_WIDTH_PX + 1, height: MEDIUM_FACE_MAX_HEIGHT_PX })).toBe('medium')
  })

  it('taller is large', () => {
    expect(widgetFaceFor({ width: 600, height: MEDIUM_FACE_MAX_HEIGHT_PX + 1 })).toBe('large')
  })
})

describe('plannerFaceFor', () => {
  it('is small as every widget is', () => {
    expect(plannerFaceFor({ width: 1200, height: SMALL_FACE_MAX_HEIGHT_PX })).toBe('small')
    expect(plannerFaceFor({ width: SMALL_FACE_MAX_WIDTH_PX, height: 900 })).toBe('small')
  })

  it('is large from 720 × 300: room for its two panes', () => {
    expect(plannerFaceFor({ width: 720, height: 300 })).toBe('large')
    expect(plannerFaceFor({ width: 1400, height: 860 })).toBe('large')
  })

  it('is medium, one column, while narrower or shorter', () => {
    expect(plannerFaceFor({ width: 719, height: 900 })).toBe('medium')
    expect(plannerFaceFor({ width: 1400, height: 299 })).toBe('medium')
    expect(plannerFaceFor({ width: SMALL_FACE_MAX_WIDTH_PX + 1, height: SMALL_FACE_MAX_HEIGHT_PX + 1 })).toBe('medium')
  })

  it('goes by the width alone where the height is the content’s (the phone)', () => {
    expect(plannerFaceFor({ width: 359, height: Number.POSITIVE_INFINITY })).toBe('medium')
    expect(plannerFaceFor({ width: 900, height: Number.POSITIVE_INFINITY })).toBe('large')
  })

  it('unmeasured is large', () => {
    expect(plannerFaceFor({ width: 0, height: 0 })).toBe('large')
  })
})

describe('plannerStripFits', () => {
  const tall = (width: number) => ({ width, height: 800 })
  it('shows the strip only where each of its seven tiles has room for its ticks (38px): 315px without the arrows, 371px with them', () => {
    expect(plannerStripFits(tall(315), { arrows: false, topLine: true })).toBe(true)
    expect(plannerStripFits(tall(314), { arrows: false, topLine: true })).toBe(false)
    expect(plannerStripFits(tall(371), { arrows: true, topLine: false })).toBe(true)
    expect(plannerStripFits(tall(370), { arrows: true, topLine: false })).toBe(false)
  })

  it('and only where the widget is tall enough for the strip over Today’s heading and one row: 165px with a top line, 135px without', () => {
    expect(plannerStripFits({ width: 900, height: 165 }, { arrows: true, topLine: true })).toBe(true)
    expect(plannerStripFits({ width: 900, height: 164 }, { arrows: true, topLine: true })).toBe(false)
    expect(plannerStripFits({ width: 900, height: 135 }, { arrows: true, topLine: false })).toBe(true)
    expect(plannerStripFits({ width: 900, height: 134 }, { arrows: true, topLine: false })).toBe(false)
  })

  it('unmeasured, it fits', () => {
    expect(plannerStripFits({ width: 0, height: 0 }, { arrows: true, topLine: true })).toBe(true)
  })
})

describe('plannerPortrait (board R1)', () => {
  it('a tall, narrow cell: under 720px wide, at least 560px tall and 1.4 × as tall as wide', () => {
    expect(plannerPortrait({ width: 340, height: 800 })).toBe(true)
    expect(plannerPortrait({ width: 400, height: 560 })).toBe(true)
    expect(plannerPortrait({ width: 500, height: 700 })).toBe(true)
  })

  it('not when short, squarish, wide enough for the panes or unmeasured', () => {
    expect(plannerPortrait({ width: 300, height: 559 })).toBe(false)
    expect(plannerPortrait({ width: 500, height: 699 })).toBe(false)
    expect(plannerPortrait({ width: 720, height: 1200 })).toBe(false)
    expect(plannerPortrait({ width: 0, height: 900 })).toBe(false)
  })
})
