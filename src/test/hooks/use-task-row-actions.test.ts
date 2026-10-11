import { describe, it, expect, vi } from 'vitest'
import { buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import { makeTodo } from '../helpers'

/**
 * Phase 6 of `code-review-2026-04-25` extracted the canonical task-row context-
 * menu shape into a pure helper consumed by `TaskRow`, `MobileTaskRow`, and
 * the search context menu. These tests pin the shape + the per-item dispatch.
 * The bulk-aware hook half is exercised through the row tests it powers.
 */
describe('buildTaskRowMenuItems — task-row + mobile parity', () => {
  it('returns the full menu shape: Open, Mark complete, Focus, Move to project, separator, Delete', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo' }),
      onToggleFocus: vi.fn(),
      onOpenDetail: vi.fn(),
      onMoveToProject: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Add to Focus',
      'Move to project…',
      '--',
      'Delete',
    ])
    expect(items[items.length - 1]!.danger).toBe(true)
  })

  it('omits the Open item when onOpenDetail is missing', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      onToggleFocus: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items[0]!.label).toBe('Mark complete')
  })

  it('omits the Move to project item when onMoveToProject is missing', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      onToggleFocus: vi.fn(),
      onOpenDetail: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Add to Focus',
      '--',
      'Delete',
    ])
  })

  it('shows "Mark incomplete" when the todo is completed', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, isCompleted: true }),
      onToggleFocus: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items[0]!.label).toBe('Mark incomplete')
  })

  it('offers Remove from Focus when the task is in focus', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, focus: true }),
      onToggleFocus: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items.find((i) => i.label === 'Remove from Focus')).toBeTruthy()
    expect(items.find((i) => i.label === 'Add to Focus')).toBeFalsy()
  })

  it('the Focus item invokes the supplied onToggleFocus callback', () => {
    const onToggleFocus = vi.fn()
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 9 }),
      onToggleFocus,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    items.find((i) => i.label === 'Add to Focus')!.action()
    expect(onToggleFocus).toHaveBeenCalledOnce()
  })

  it('Mark complete action invokes the supplied onComplete callback', () => {
    const onComplete = vi.fn()
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 5 }),
      onToggleFocus: vi.fn(),
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
      onToggleFocus: vi.fn(),
      onComplete: vi.fn(),
      onDelete,
    })
    items[items.length - 1]!.action()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
