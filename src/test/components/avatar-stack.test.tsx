import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AvatarStack } from '../../components/shared/AvatarStack'
import { makePerson } from '../helpers'

afterEach(cleanup)

describe('AvatarStack', () => {
  it('renders nothing when people list is empty', () => {
    const { container } = render(<AvatarStack people={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders all avatars when under the max', () => {
    const people = [1, 2].map((id) => makePerson({ id, name: `Person ${id}`, initials: `P${id}` }))
    render(<AvatarStack people={people} max={3} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('renders a +N overflow when people exceed the max', () => {
    const people = [1, 2, 3, 4, 5].map((id) => makePerson({ id, name: `Person ${id}`, initials: `P${id}` }))
    render(<AvatarStack people={people} max={3} />)
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(screen.getByText('P3')).toBeInTheDocument()
    expect(screen.queryByText('P4')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('defaults max to 3', () => {
    const people = [1, 2, 3, 4].map((id) => makePerson({ id, name: `Person ${id}`, initials: `P${id}` }))
    render(<AvatarStack people={people} />)
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('calls onClick when the stack is clicked', () => {
    const onClick = vi.fn()
    const people = [makePerson({ id: 1, name: 'Alice', initials: 'AL' })]
    render(<AvatarStack people={people} onClick={onClick} />)
    fireEvent.click(screen.getByText('AL'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses name slice as fallback when initials are empty', () => {
    const people = [makePerson({ id: 1, name: 'zoe', initials: '' })]
    render(<AvatarStack people={people} />)
    expect(screen.getByText('ZO')).toBeInTheDocument()
  })

  it('exposes an accessible label describing the assignment count', () => {
    const single = [makePerson({ id: 1, name: 'Alice', initials: 'AL' })]
    const { rerender, unmount } = render(<AvatarStack people={single} />)
    expect(screen.getByRole('button', { name: '1 person assigned' })).toBeInTheDocument()
    const many = [1, 2, 3].map((id) => makePerson({ id, name: `Person ${id}`, initials: `P${id}` }))
    rerender(<AvatarStack people={many} />)
    expect(screen.getByRole('button', { name: '3 people assigned' })).toBeInTheDocument()
    unmount()
  })

  it('invokes onPersonContextMenu with the source person on right-click', () => {
    const onPersonContextMenu = vi.fn()
    const people = [
      makePerson({ id: 1, name: 'Alice', initials: 'AL' }),
      makePerson({ id: 2, name: 'Bob', initials: 'BO' }),
    ]
    render(<AvatarStack people={people} onPersonContextMenu={onPersonContextMenu} />)
    fireEvent.contextMenu(screen.getByText('BO'))
    expect(onPersonContextMenu).toHaveBeenCalledTimes(1)
    expect(onPersonContextMenu.mock.calls[0][1].id).toBe(2)
  })
})
