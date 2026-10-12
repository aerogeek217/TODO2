import { describe, it, expect, vi } from 'vitest'
import { buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import { makeTodo } from '../helpers'

/** The marker callbacks every call needs (overridden per test). */
const markers = () => ({
  urgentOn: false,
  onToggleUrgent: vi.fn(),
  onToggleImportant: vi.fn(),
  onToggleFocus: vi.fn(),
})

/**
 * The canonical task-row context-menu shape is a pure helper consumed by
 * `TaskRow`, `MobileTaskRow`, and the search context menu. These tests pin
 * the shape + the per-item dispatch.
 * The bulk-aware hook half is exercised through the row tests it powers.
 */
describe('buildTaskRowMenuItems — task-row + mobile parity', () => {
  it('returns the full menu shape: Open, Mark complete, markers, separator, Delete', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo' }),
      ...markers(),
      onOpenDetail: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Mark urgent',
      'Mark important',
      'Add to Focus',
      '--',
      'Delete',
    ])
    expect(items[items.length - 1]!.danger).toBe(true)
  })

  it('omits the Open item when onOpenDetail is missing', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      ...markers(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items[0]!.label).toBe('Mark complete')
  })

  it('shows "Mark incomplete" when the todo is completed', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, isCompleted: true }),
      ...markers(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items[0]!.label).toBe('Mark incomplete')
  })

  it('offers Remove for each marker the task has (Urgent follows urgentOn, not just the flag)', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, focus: true, important: true }),
      ...markers(),
      urgentOn: true,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const labels = items.map((i) => i.label)
    expect(labels).toEqual(expect.arrayContaining(['Remove urgent', 'Remove important', 'Remove from Focus']))
    expect(labels).not.toContain('Add to Focus')
    expect(labels).not.toContain('Mark urgent')
  })

  it('each marker item invokes its own callback', () => {
    const m = markers()
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 9 }),
      ...m,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    items.find((i) => i.label === 'Add to Focus')!.action()
    items.find((i) => i.label === 'Mark urgent')!.action()
    items.find((i) => i.label === 'Mark important')!.action()
    expect(m.onToggleFocus).toHaveBeenCalledOnce()
    expect(m.onToggleUrgent).toHaveBeenCalledOnce()
    expect(m.onToggleImportant).toHaveBeenCalledOnce()
  })

  it('Mark complete action invokes the supplied onComplete callback', () => {
    const onComplete = vi.fn()
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 5 }),
      ...markers(),
      onComplete,
      onDelete: vi.fn(),
    })
    items.find((i) => i.label === 'Mark complete')!.action()
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('Delete action invokes the supplied onDelete callback', () => {
    const onDelete = vi.fn()
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 5 }),
      ...markers(),
      onComplete: vi.fn(),
      onDelete,
    })
    items[items.length - 1]!.action()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
