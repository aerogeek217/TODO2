import { describe, it, expect } from 'vitest'
import {
  parseRailsState,
  serializeRailsState,
  EMPTY_RAILS,
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
})
