import { describe, expect, it } from 'vitest'
import { createTab, type NumberTab } from '../../models/workspace-layout'
import {
  MEDIUM_FACE_MAX_HEIGHT_PX,
  SMALL_FACE_MAX_HEIGHT_PX,
  SMALL_FACE_MAX_WIDTH_PX,
  tabOpensLarger,
  widgetFaceFor,
} from '../../utils/widget-face'

describe('tabOpensLarger', () => {
  const number = (config: Partial<NumberTab['config']>): NumberTab => {
    const tab = createTab('number', 'n')
    return { ...tab, config: { ...tab.config, ...config } }
  }

  it('every kind but a Number, at any face (its large one too)', () => {
    for (const face of ['small', 'medium', 'large'] as const) {
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
