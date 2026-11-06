import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { FollowupPopoverHost } from '../../../components/overlays/FollowupPopoverHost'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { addDays, startOfToday } from '../../../utils/date'
import { makeTodo } from '../../helpers'

afterEach(cleanup)

describe('FollowupPopoverHost on a row in a multi-selection (cr31 T11)', () => {
  it('starts from the selection (mixed): a date equal to the clicked task’s is set on every selected task', () => {
    const d5 = addDays(startOfToday(), 5)
    const d9 = addDays(startOfToday(), 9)
    useTodoStore.setState({ todos: [makeTodo({ id: 1, nextFollowupAt: d5 }), makeTodo({ id: 2, nextFollowupAt: d9 })] })
    useUIStore.getState().selectAll([1, 2])
    const bulk = vi.spyOn(useTodoStore.getState(), 'bulkSetFollowup').mockResolvedValue(undefined as never)
    const trigger = createRef<HTMLButtonElement>()
    render(<><button ref={trigger}>flag</button><FollowupPopoverHost /></>)
    act(() => {
      useUIStore.getState().openFollowupPopover({ todoId: 1, anchor: { left: 0, top: 0, right: 10, bottom: 10 }, triggerRef: trigger, initialFocus: 'next', level: 1 })
    })
    const field = screen.getByRole('dialog', { name: 'Follow-up' }).querySelector<HTMLInputElement>('input')!
    // Mixed: the field starts empty (each task's own), not on task 1's date.
    expect(field.value).toBe('')
    fireEvent.change(field, { target: { value: 'in 5 days' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(bulk).toHaveBeenCalledTimes(1)
    expect(bulk.mock.calls[0]?.[0]).toEqual([1, 2])
    expect(bulk.mock.calls[0]?.[1]).toEqual(d5)
  })
})
