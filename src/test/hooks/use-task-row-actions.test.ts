import { describe, it, expect, vi } from 'vitest'
import { buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { makeTodo } from '../helpers'

/**
 * Phase 6 of `code-review-2026-04-25` extracted the canonical task-row context-
 * menu shape into a pure helper consumed by `TaskRow`, `MobileTaskRow`, and
 * the search context menu. These tests pin the shape + the per-item dispatch.
 * The bulk-aware hook half is exercised through the row tests it powers.
 */
describe('buildTaskRowMenuItems — Phase 6 task-row + mobile parity', () => {
  it('returns the full menu shape: Open, Mark complete, taskboard, Move to project, separator, Delete', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo' }),
      onBoard: false,
      onOpenDetail: vi.fn(),
      onMoveToProject: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Add to Taskboard',
      'Move to project…',
      '--',
      'Delete',
    ])
    expect(items[items.length - 1]!.danger).toBe(true)
  })

  it('omits the Open item when onOpenDetail is missing', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      onBoard: false,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items[0]!.label).toBe('Mark complete')
  })

  it('omits the Move to project item when onMoveToProject is missing', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      onBoard: false,
      onOpenDetail: vi.fn(),
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Add to Taskboard',
      '--',
      'Delete',
    ])
  })

  it('shows "Mark incomplete" when the todo is completed', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1, isCompleted: true }),
      onBoard: false,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items[0]!.label).toBe('Mark incomplete')
  })

  it('flips the taskboard item to Remove when onBoard is true', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      onBoard: true,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(items.find((i) => i.label === 'Remove from Taskboard')).toBeTruthy()
    expect(items.find((i) => i.label === 'Add to Taskboard')).toBeFalsy()
  })

  it('renames terminal Delete to Remove from Taskboard when onTaskboard surface', () => {
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 1 }),
      onBoard: true,
      onTaskboard: true,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    const last = items[items.length - 1]!
    expect(last.label).toBe('Remove from Taskboard')
    expect(last.danger).toBe(true)
  })

  it('Add to Taskboard action calls taskboardStore.add with the todo id', () => {
    const add = vi.fn()
    vi.spyOn(useTaskboardStore, 'getState').mockReturnValue({ add } as never)
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 9 }),
      onBoard: false,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    items.find((i) => i.label === 'Add to Taskboard')!.action()
    expect(add).toHaveBeenCalledWith(9)
  })

  it('Remove from Taskboard action calls taskboardStore.removeEntry when onBoard', () => {
    const removeEntry = vi.fn()
    vi.spyOn(useTaskboardStore, 'getState').mockReturnValue({ removeEntry } as never)
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 11 }),
      onBoard: true,
      onComplete: vi.fn(),
      onDelete: vi.fn(),
    })
    items.find((i) => i.label === 'Remove from Taskboard')!.action()
    expect(removeEntry).toHaveBeenCalledWith(11)
  })

  it('Mark complete action invokes the supplied onComplete callback', () => {
    const onComplete = vi.fn()
    const items = buildTaskRowMenuItems({
      todo: makeTodo({ id: 5 }),
      onBoard: false,
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
      onBoard: false,
      onComplete: vi.fn(),
      onDelete,
    })
    items[items.length - 1]!.action()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
