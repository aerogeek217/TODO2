import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FollowupPopoverHost } from '../../../components/overlays/FollowupPopoverHost'
import { POPOVER_LEVEL_ATTR } from '../../../components/shared/popover-level'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore, type FollowupPopoverRequest } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo } from '../../helpers'

const request = (fields: Partial<FollowupPopoverRequest> = {}): FollowupPopoverRequest => ({
  todoId: 1,
  anchor: { left: 10, top: 10, right: 30, bottom: 30 },
  triggerRef: { current: null },
  initialFocus: 'followedUp',
  level: 1,
  ...fields,
})

const popover = () => screen.queryByRole('dialog', { name: 'Follow-up' })

function open(fields: Partial<FollowupPopoverRequest> = {}) {
  useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Quote' })] })
  render(<FollowupPopoverHost />)
  act(() => useUIStore.getState().openFollowupPopover(request(fields)))
}

describe('<FollowupPopoverHost>', () => {
  afterEach(cleanup)

  it('shows nothing until asked; Esc closes', () => {
    render(<FollowupPopoverHost />)
    expect(popover()).toBeNull()
    cleanup()
    open()
    expect(popover()).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useUIStore.getState().followupPopover).toBeNull()
    expect(popover()).toBeNull()
  })

  it('takes the level of the row’s place: 2 in a dialog', () => {
    open({ level: 2 })
    expect(popover()).toHaveAttribute(POPOVER_LEVEL_ATTR, '2')
  })

  it('a press on the row’s trigger isn’t outside (it toggles); anywhere else is', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    open({ triggerRef: { current: trigger } })
    fireEvent.mouseDown(trigger)
    expect(popover()).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(popover()).toBeNull()
    trigger.remove()
  })

  it('closes when its task is deleted, and on a layout switch', () => {
    open()
    act(() => useTodoStore.setState({ todos: [] }))
    expect(useUIStore.getState().followupPopover).toBeNull()
    cleanup()

    useWorkspaceStore.setState({ activeLayoutId: 1 })
    open()
    expect(popover()).toBeInTheDocument()
    act(() => useWorkspaceStore.setState({ activeLayoutId: 2 }))
    expect(useUIStore.getState().followupPopover).toBeNull()
  })
})
