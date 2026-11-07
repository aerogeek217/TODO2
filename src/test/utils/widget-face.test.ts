import { describe, expect, it } from 'vitest'
import {
  MEDIUM_FACE_MAX_HEIGHT_PX,
  SMALL_FACE_MAX_HEIGHT_PX,
  SMALL_FACE_MAX_WIDTH_PX,
  widgetFaceFor,
} from '../../utils/widget-face'

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
