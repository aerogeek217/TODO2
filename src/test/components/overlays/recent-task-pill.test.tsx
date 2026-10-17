import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RecentTaskPill } from '../../../components/overlays/RecentTaskPill'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { makeTodo } from '../../helpers'

describe('RecentTaskPill', () => {
  it('shows the new task with a dismiss button and no Focus button (/focus covers it)', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 7, title: 'Just added' })] })
    useUIStore.getState().showRecentlyCreated(7)
    render(<RecentTaskPill />)
    expect(screen.getByRole('status')).toHaveTextContent('Just added')
    expect(screen.queryByRole('button', { name: /focus/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useUIStore.getState().recentlyCreated).toBeNull()
  })
})
