import { describe, it, expect } from 'vitest'
import {
  parseRailsState,
  serializeRailsState,
  clampRailSize,
  defaultRailSize,
  railSize,
  EMPTY_RAILS,
  RAIL_SIZE_MAX,
  RAIL_SIZE_MIN,
  type RailsState,
} from '../../models/canvas-rails'

describe('canvas-rails model', () => {
  describe('serialize + parse round-trip', () => {
    it('round-trips an empty state', () => {
      const parsed = parseRailsState(serializeRailsState(EMPTY_RAILS))
      expect(parsed).toEqual(EMPTY_RAILS)
    })

    it('round-trips a populated state', () => {
      const state: RailsState = {
        left: null,
        right: {
          orientation: 'vertical',
          slots: [
            { id: 'slot-a', kind: 'lens', listDefinitionId: 42 },
            { id: 'slot-b', kind: 'notes' },
          ],
        },
        top: null,
        bottom: {
          orientation: 'horizontal',
          slots: [{ id: 'slot-c', kind: 'calendar' }],
        },
      }
      const parsed = parseRailsState(serializeRailsState(state))
      expect(parsed).toEqual(state)
    })
  })

  describe('parseRailsState', () => {
    it('returns null on null/empty', () => {
      expect(parseRailsState(null)).toBeNull()
      expect(parseRailsState(undefined)).toBeNull()
      expect(parseRailsState('')).toBeNull()
    })

    it('returns null on malformed JSON', () => {
      expect(parseRailsState('{not json')).toBeNull()
    })

    it('coerces a non-object payload to null', () => {
      expect(parseRailsState('42')).toBeNull()
      expect(parseRailsState('"hello"')).toBeNull()
    })

    it('drops a rail whose orientation does not match its side', () => {
      // `top` must be horizontal; vertical is ignored.
      const raw = JSON.stringify({
        left: null,
        right: null,
        top: { orientation: 'vertical', slots: [{ id: 'x', kind: 'lens' }] },
        bottom: null,
      })
      const parsed = parseRailsState(raw)
      expect(parsed).not.toBeNull()
      expect(parsed!.top).toBeNull()
    })

    it('drops slots with unknown kinds but keeps valid siblings', () => {
      const raw = JSON.stringify({
        left: null,
        right: {
          orientation: 'vertical',
          slots: [
            { id: 'a', kind: 'lens' },
            { id: 'b', kind: 'bogus' },
            { id: 'c', kind: 'notes' },
          ],
        },
        top: null,
        bottom: null,
      })
      const parsed = parseRailsState(raw)
      expect(parsed!.right!.slots.map((s) => s.id)).toEqual(['a', 'c'])
    })

    it('collapses a rail with no valid slots to null', () => {
      const raw = JSON.stringify({
        left: null,
        right: {
          orientation: 'vertical',
          slots: [{ id: 'a', kind: 'bogus' }],
        },
        top: null,
        bottom: null,
      })
      const parsed = parseRailsState(raw)
      expect(parsed!.right).toBeNull()
    })

    it('round-trips widths/heights and clamps out-of-range values on parse', () => {
      const state: RailsState = {
        left: null,
        right: null,
        top: null,
        bottom: null,
        widths: { left: 420 },
        heights: { top: 200 },
      }
      const parsed = parseRailsState(serializeRailsState(state))
      expect(parsed!.widths?.left).toBe(420)
      expect(parsed!.heights?.top).toBe(200)

      const raw = JSON.stringify({
        left: null, right: null, top: null, bottom: null,
        widths: { left: 9999, right: -50 },
        heights: { top: 10, bottom: 'nope' },
      })
      const clamped = parseRailsState(raw)
      expect(clamped!.widths).toEqual({ left: RAIL_SIZE_MAX, right: RAIL_SIZE_MIN })
      expect(clamped!.heights).toEqual({ top: RAIL_SIZE_MIN })
    })

    it('omits widths/heights when the persisted bag is empty or bad', () => {
      const raw = JSON.stringify({
        left: null, right: null, top: null, bottom: null,
        widths: { left: 'not-a-number' },
        heights: 'not-an-object',
      })
      const parsed = parseRailsState(raw)
      expect(parsed!.widths).toBeUndefined()
      expect(parsed!.heights).toBeUndefined()
    })

    it('drops a slot with non-numeric listDefinitionId but keeps the slot', () => {
      const raw = JSON.stringify({
        left: null,
        right: {
          orientation: 'vertical',
          slots: [{ id: 'a', kind: 'lens', listDefinitionId: 'not-a-number' }],
        },
        top: null,
        bottom: null,
      })
      const parsed = parseRailsState(raw)
      expect(parsed!.right!.slots[0]).toEqual({ id: 'a', kind: 'lens' })
    })
  })

  describe('rail size helpers', () => {
    it('clamps to [RAIL_SIZE_MIN, RAIL_SIZE_MAX]', () => {
      expect(clampRailSize(10)).toBe(RAIL_SIZE_MIN)
      expect(clampRailSize(9999)).toBe(RAIL_SIZE_MAX)
      expect(clampRailSize(400)).toBe(400)
      expect(clampRailSize(Number.NaN)).toBe(340)
    })

    it('defaultRailSize is 340 for vertical, 260 for horizontal', () => {
      expect(defaultRailSize('left')).toBe(340)
      expect(defaultRailSize('right')).toBe(340)
      expect(defaultRailSize('top')).toBe(260)
      expect(defaultRailSize('bottom')).toBe(260)
    })

    it('railSize falls through to defaults when not persisted', () => {
      expect(railSize(EMPTY_RAILS, 'left')).toBe(340)
      expect(railSize(EMPTY_RAILS, 'top')).toBe(260)
      const withSizes: RailsState = { ...EMPTY_RAILS, widths: { left: 420 }, heights: { top: 300 } }
      expect(railSize(withSizes, 'left')).toBe(420)
      expect(railSize(withSizes, 'right')).toBe(340)
      expect(railSize(withSizes, 'top')).toBe(300)
      expect(railSize(withSizes, 'bottom')).toBe(260)
    })
  })
})
