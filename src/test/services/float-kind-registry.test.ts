import { describe, it, expect } from 'vitest'
import {
  FLOAT_KIND_REGISTRY,
  floatKindBySlotKind,
  floatKindByDragKind,
  floatKindForNodeId,
  isFloatNodeId,
} from '../../services/float-kind-registry'
import type { SlotKind } from '../../models/canvas-rails'
import type { FloatDragKind } from '../../stores/ui-store'

describe('float-kind-registry', () => {
  it('keys an entry for every SlotKind', () => {
    const allSlotKinds: SlotKind[] = ['lens', 'notes', 'calendar', 'status']
    for (const kind of allSlotKinds) {
      expect(() => floatKindBySlotKind(kind)).not.toThrow()
      expect(floatKindBySlotKind(kind).slotKind).toBe(kind)
    }
  })

  it('keys an entry for every FloatDragKind', () => {
    const allDragKinds: FloatDragKind[] = ['note', 'calendar', 'lens', 'status']
    for (const kind of allDragKinds) {
      expect(() => floatKindByDragKind(kind)).not.toThrow()
      expect(floatKindByDragKind(kind).floatDragKind).toBe(kind)
    }
  })

  it('domPrefix values are unique', () => {
    const prefixes = FLOAT_KIND_REGISTRY.map((e) => e.domPrefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('floatKindForNodeId decodes ids prefixed with the entry domPrefix', () => {
    expect(floatKindForNodeId('note-42')).toEqual({
      kind: 'note',
      floatId: 42,
      entry: expect.objectContaining({ slotKind: 'notes' }),
    })
    expect(floatKindForNodeId('inset-7')).toEqual({
      kind: 'lens',
      floatId: 7,
      entry: expect.objectContaining({ slotKind: 'lens' }),
    })
    expect(floatKindForNodeId('calendar-3')).toEqual(
      expect.objectContaining({ kind: 'calendar', floatId: 3 }),
    )
    expect(floatKindForNodeId('status-1')).toEqual(
      expect.objectContaining({ kind: 'status', floatId: 1 }),
    )
  })

  it('floatKindForNodeId returns null for non-float ids', () => {
    expect(floatKindForNodeId('5')).toBeNull()
    expect(floatKindForNodeId('project-1')).toBeNull()
    // Prefixes of removed widget kinds are no longer floats.
    expect(floatKindForNodeId('horizons-1')).toBeNull()
    expect(floatKindForNodeId('scoreboard-1')).toBeNull()
    expect(floatKindForNodeId('snooze-graveyard-1')).toBeNull()
    expect(floatKindForNodeId('taskboard-1')).toBeNull()
    expect(floatKindForNodeId('')).toBeNull()
  })

  it('isFloatNodeId mirrors floatKindForNodeId presence', () => {
    expect(isFloatNodeId('note-1')).toBe(true)
    expect(isFloatNodeId('inset-2')).toBe(true)
    expect(isFloatNodeId('calendar-3')).toBe(true)
    expect(isFloatNodeId('status-5')).toBe(true)
    expect(isFloatNodeId('1')).toBe(false)
    expect(isFloatNodeId('foo-1')).toBe(false)
  })

  it('throws on unknown SlotKind / FloatDragKind', () => {
    expect(() => floatKindBySlotKind('unknown' as SlotKind)).toThrow(/unknown SlotKind/)
    expect(() => floatKindByDragKind('unknown' as FloatDragKind)).toThrow(/unknown FloatDragKind/)
  })
})
