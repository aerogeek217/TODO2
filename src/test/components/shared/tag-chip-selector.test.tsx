import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TagChipSelector } from '../../../components/shared/TagChipSelector'
import type { Tag } from '../../../models'

const alpha: Tag = { id: 1, name: 'alpha', color: '#aa0000' }
const beta: Tag = { id: 2, name: 'beta', color: '#00aa00' }

afterEach(cleanup)

describe('<TagChipSelector>', () => {
  describe('empty state', () => {
    it('renders the # trigger when no tags are assigned', () => {
      render(
        <TagChipSelector
          assignedTags={[]}
          allTags={[alpha, beta]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Add tag')).toBeInTheDocument()
    })

    it('marks the wrapper with the tagChipEmpty class so the row can hover-reveal it', () => {
      const { container } = render(
        <TagChipSelector
          assignedTags={[]}
          allTags={[alpha]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      // CSS-modules hashes the class — substring-match for tagChipEmpty
      expect(container.querySelector('[class*="tagChipEmpty"]')).not.toBeNull()
    })

    it('does NOT mark the wrapper with tagChipEmpty when tags are assigned', () => {
      const { container } = render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      expect(container.querySelector('[class*="tagChipEmpty"]')).toBeNull()
    })
  })

  describe('populated state', () => {
    it('renders #name chips for each assigned tag', () => {
      render(
        <TagChipSelector
          assignedTags={[alpha, beta]}
          allTags={[alpha, beta]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      expect(screen.getByText('#alpha')).toBeInTheDocument()
      expect(screen.getByText('#beta')).toBeInTheDocument()
    })

    it('does not render the empty-state # trigger when at least one tag is assigned', () => {
      render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha, beta]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      expect(screen.queryByLabelText('Add tag')).not.toBeInTheDocument()
    })

    it('applies the tag color as both color and borderColor inline', () => {
      const { container } = render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      const chip = container.querySelector('[class*="tagChip"]') as HTMLElement
      expect(chip.style.color).toBe('rgb(170, 0, 0)')
      expect(chip.style.borderColor).toBe('rgb(170, 0, 0)')
    })
  })

  describe('dropdown interactions', () => {
    it('clicking a chip opens the lookup-or-create dropdown', () => {
      render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha, beta]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByText('#alpha'))
      expect(screen.getByPlaceholderText('Search tags...')).toBeInTheDocument()
    })

    it('clicking the empty trigger opens the dropdown', () => {
      render(
        <TagChipSelector
          assignedTags={[]}
          allTags={[alpha, beta]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByLabelText('Add tag'))
      expect(screen.getByPlaceholderText('Search tags...')).toBeInTheDocument()
    })

    it('selecting an unassigned tag from the dropdown calls onToggle with that id', () => {
      const onToggle = vi.fn()
      render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha, beta]}
          onToggle={onToggle}
          onCreate={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByText('#alpha'))
      fireEvent.click(screen.getByText('beta'))
      expect(onToggle).toHaveBeenCalledWith(2)
    })

    it('selecting an assigned tag from the dropdown calls onToggle (parent decides assign/unassign)', () => {
      const onToggle = vi.fn()
      render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha, beta]}
          onToggle={onToggle}
          onCreate={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByText('#alpha'))
      fireEvent.click(screen.getByText('alpha'))
      expect(onToggle).toHaveBeenCalledWith(1)
    })

    it('typing a novel name + Enter calls onCreate with the trimmed name', () => {
      const onCreate = vi.fn()
      render(
        <TagChipSelector
          assignedTags={[]}
          allTags={[alpha]}
          onToggle={vi.fn()}
          onCreate={onCreate}
        />,
      )
      fireEvent.click(screen.getByLabelText('Add tag'))
      const input = screen.getByPlaceholderText('Search tags...') as HTMLInputElement
      fireEvent.change(input, { target: { value: '  newtag  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onCreate).toHaveBeenCalledWith('newtag')
    })
  })

  describe('disabled (ghost) mode', () => {
    it('does not open the dropdown when disabled', () => {
      render(
        <TagChipSelector
          assignedTags={[alpha]}
          allTags={[alpha, beta]}
          onToggle={vi.fn()}
          onCreate={vi.fn()}
          disabled
        />,
      )
      fireEvent.click(screen.getByText('#alpha'))
      expect(screen.queryByPlaceholderText('Search tags...')).not.toBeInTheDocument()
    })
  })
})
