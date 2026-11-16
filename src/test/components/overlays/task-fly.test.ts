import { describe, it, expect } from 'vitest'
import { pickFlightTarget } from '../../../components/overlays/task-fly'

const viewport = { width: 1000, height: 700 }
const at = (top: number, height = 30, left = 100, visibleAtCenter = true, id = 'r') => ({
  id, visibleAtCenter, rect: { top, bottom: top + height, left, right: left + 400, height },
})

describe('pickFlightTarget', () => {
  it('the first drawn candidate in view with nothing over its centre', () => {
    expect(pickFlightTarget([at(100, 30, 100, true, 'a'), at(200, 30, 100, true, 'b')], viewport)?.id).toBe('a')
  })

  it('skips a row with no box (skipped or folded), one covered at its centre, and one scrolled out of view', () => {
    const picked = pickFlightTarget([
      at(100, 0, 100, true, 'folded'),
      at(150, 30, 100, false, 'covered'),
      at(800, 30, 100, true, 'below'),
      at(-50, 30, 100, true, 'above'),
      at(300, 30, 100, true, 'ok'),
    ], viewport)
    expect(picked?.id).toBe('ok')
  })

  it('none: null (the pill shows)', () => {
    expect(pickFlightTarget([], viewport)).toBeNull()
    expect(pickFlightTarget([at(150, 30, 100, false)], viewport)).toBeNull()
  })
})
