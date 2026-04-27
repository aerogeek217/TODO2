import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SortGroupToolbar, type SortGroupOption } from '../../../components/shared/SortGroupToolbar'

afterEach(() => cleanup())

const SORT_OPTS: readonly SortGroupOption<'manual' | 'name' | 'date'>[] = [
  { value: 'manual', label: 'None' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Effective Date' },
]

const GROUP_OPTS: readonly SortGroupOption<'none' | 'project' | 'status'>[] = [
  { value: 'none', label: 'None' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
]

describe('SortGroupToolbar — comfortable density', () => {
  it('renders Group + Sort field labels by default', () => {
    render(
      <SortGroupToolbar
        density="comfortable"
        sortBy="manual"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    expect(screen.getByText('Group')).toBeInTheDocument()
    expect(screen.getByText('Sort')).toBeInTheDocument()
  })

  it('shows the currently selected sort + group label on the triggers', () => {
    render(
      <SortGroupToolbar
        density="comfortable"
        sortBy="name"
        groupBy="project"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /sort tasks by/i })).toHaveTextContent('Name')
    expect(screen.getByRole('button', { name: /group tasks by/i })).toHaveTextContent('Project')
  })

  it('fires onGroupChange when an option is picked', () => {
    const onGroupChange = vi.fn()
    render(
      <SortGroupToolbar
        density="comfortable"
        sortBy="manual"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={onGroupChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /group tasks by/i }))
    fireEvent.click(screen.getByRole('option', { name: /project/i }))
    expect(onGroupChange).toHaveBeenCalledWith('project')
  })

  it('fires onSortChange when an option is picked', () => {
    const onSortChange = vi.fn()
    render(
      <SortGroupToolbar
        density="comfortable"
        sortBy="manual"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={onSortChange}
        onGroupChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /sort tasks by/i }))
    fireEvent.click(screen.getByRole('option', { name: /^name$/i }))
    expect(onSortChange).toHaveBeenCalledWith('name')
  })

  it('renders a separate asc toggle when onToggleAsc is supplied', () => {
    const onToggleAsc = vi.fn()
    render(
      <SortGroupToolbar
        density="comfortable"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        sortAsc={true}
        onSortChange={() => {}}
        onGroupChange={() => {}}
        onToggleAsc={onToggleAsc}
      />,
    )
    const ascBtn = screen.getByRole('button', { name: /sort ascending/i })
    fireEvent.click(ascBtn)
    expect(onToggleAsc).toHaveBeenCalledTimes(1)
  })

  it('hides Sort or Group when showSort/showGroup is false', () => {
    render(
      <SortGroupToolbar
        density="comfortable"
        sortBy="manual"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
        showSort={false}
      />,
    )
    expect(screen.queryByText('Sort')).not.toBeInTheDocument()
    expect(screen.getByText('Group')).toBeInTheDocument()
  })
})

describe('SortGroupToolbar — compact density', () => {
  it('renders icon-only triggers (no Group/Sort labels)', () => {
    render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    expect(screen.queryByText('Group')).not.toBeInTheDocument()
    expect(screen.queryByText('Sort')).not.toBeInTheDocument()
    const sortBtn = screen.getByRole('button', { name: /sort tasks by/i })
    const groupBtn = screen.getByRole('button', { name: /group tasks by/i })
    expect(sortBtn).toBeInTheDocument()
    expect(groupBtn).toBeInTheDocument()
  })

  it('shows ↕ when sortAsc is undefined, ↑ when true, ↓ when false', () => {
    const { rerender } = render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /sort tasks by/i })).toHaveTextContent('↕')

    rerender(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        sortAsc={true}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /sort tasks by/i })).toHaveTextContent('↑')

    rerender(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        sortAsc={false}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /sort tasks by/i })).toHaveTextContent('↓')
  })

  it('opens the sort menu, fires onSortChange, and renders the asc arrow on the active option', () => {
    const onSortChange = vi.fn()
    render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        sortAsc={true}
        onSortChange={onSortChange}
        onGroupChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /sort tasks by/i }))
    const activeOpt = screen.getByRole('option', { name: /^name/i })
    expect(activeOpt).toHaveAttribute('aria-selected', 'true')
    expect(activeOpt.textContent).toContain('↑')
    fireEvent.click(screen.getByRole('option', { name: /effective date/i }))
    expect(onSortChange).toHaveBeenCalledWith('date')
  })

  it('hides sort field when showSort=false', () => {
    render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
        showSort={false}
      />,
    )
    expect(screen.queryByRole('button', { name: /sort tasks by/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /group tasks by/i })).toBeInTheDocument()
  })

  it('closes the menu on outside click', () => {
    render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /sort tasks by/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the menu on Escape', () => {
    render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /sort tasks by/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('applies the consumer-supplied className to the root', () => {
    const { container } = render(
      <SortGroupToolbar
        density="compact"
        sortBy="name"
        groupBy="none"
        sortOptions={SORT_OPTS}
        groupOptions={GROUP_OPTS}
        onSortChange={() => {}}
        onGroupChange={() => {}}
        className="hover-reveal-hook"
      />,
    )
    const root = container.firstChild as HTMLElement
    expect(root.className).toMatch(/hover-reveal-hook/)
  })
})
