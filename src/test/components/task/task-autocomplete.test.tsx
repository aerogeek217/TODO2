import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditPopup } from '../../../components/task/TaskEditPopup'
import { useSettingsStore } from '../../../stores/settings-store'
import { makePerson } from '../../helpers'
import type { Person, Tag } from '../../../models'

beforeEach(() => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  useSettingsStore.setState({ themeMode: 'dark' })
})

afterEach(() => cleanup())

const TITLE_PLACEHOLDER = 'New task… (@person #tag /command)'

const alice: Person & { id: number } = makePerson({ id: 1, name: 'Alice' })
// Tags kept unsorted on purpose — the component sorts alphabetically; tests assert order.
const urgent: Tag & { id: number } = { id: 1, name: 'urgent', color: '#f00' }
const followup: Tag & { id: number } = { id: 2, name: 'followup', color: '#0a0' }
const backend: Tag & { id: number } = { id: 3, name: 'Backend', color: '#00f' }

function renderPopup(allTags: Tag[] = [urgent, followup, backend]) {
  const onCreate = vi.fn().mockResolvedValue(42)
  const props = {
    mode: 'create' as const,
    assignedPeople: [],
    allPeople: [alice],
    assignedTags: [],
    allTags,
    onClose: vi.fn(),
    onCreate,
    onAssignPerson: vi.fn(),
    onUnassignPerson: vi.fn(),
    onAssignTag: vi.fn(),
    onUnassignTag: vi.fn(),
    onCreatePerson: vi.fn().mockResolvedValue(99),
    onCreateTag: vi.fn().mockResolvedValue(77),
  }
  const result = render(<TaskEditPopup {...props} />)
  return { ...result, onCreate }
}

function getTitleInput() {
  return screen.getByPlaceholderText(TITLE_PLACEHOLDER) as HTMLInputElement
}

/** fireEvent.change collapses selection to the end of value, which matches
 * typical "user typed to end" flow — good enough for token-detection tests. */
function typeTitle(value: string) {
  const input = getTitleInput()
  fireEvent.change(input, { target: { value } })
  return input
}

/** The popover rows are options whose text starts with `#` — use that to
 * find them; the chip-selector's "Tags" section label collides with the
 * popover's "Tags" header, so we don't key tests off the header text. */
function getPopoverItemTexts() {
  return screen.queryAllByRole('option')
    .map((b) => b.textContent ?? '')
    .filter((t) => t.startsWith('#') && t !== '#')
}

describe('task title autocomplete — tags', () => {
  describe('open + filter', () => {
    it('typing `#` opens the tag popover with all tags sorted alphabetically', () => {
      renderPopup()
      typeTitle('#')

      // Alphabetical case-insensitive sort (localeCompare) yields: Backend, followup, urgent.
      expect(getPopoverItemTexts()).toEqual(['#Backend', '#followup', '#urgent'])
    })

    it('typing `#ur` filters tags by case-insensitive prefix', () => {
      renderPopup()
      typeTitle('#ur')

      expect(getPopoverItemTexts()).toEqual(['#urgent'])
    })

    it('prefix match is case-insensitive (`#BA` matches `Backend`)', () => {
      renderPopup()
      typeTitle('#BA')

      expect(getPopoverItemTexts()).toEqual(['#Backend'])
    })

    it('typing `#` with no tags defined keeps the popover hidden (no query yet)', () => {
      renderPopup([])
      typeTitle('#')

      expect(getPopoverItemTexts()).toEqual([])
      expect(screen.queryByText(/^Create #/)).not.toBeInTheDocument()
    })
  })

  describe('accept', () => {
    it('clicking a tag row completes the token to `#<name> ` and closes popover', () => {
      renderPopup()
      typeTitle('#ur')

      const row = screen.getByRole('option', { name: '#urgent' })
      fireEvent.mouseDown(row)

      const input = getTitleInput()
      expect(input.value).toBe('#urgent ')
      expect(getPopoverItemTexts()).toEqual([])
    })

    it('Enter key accepts the selected (first) tag when matches exist', () => {
      renderPopup()
      const input = typeTitle('#f')

      fireEvent.keyDown(input, { key: 'Enter' })
      expect(input.value).toBe('#followup ')
      expect(getPopoverItemTexts()).toEqual([])
    })

    it('Tab key also accepts the selected tag', () => {
      renderPopup()
      const input = typeTitle('#u')

      fireEvent.keyDown(input, { key: 'Tab' })
      expect(input.value).toBe('#urgent ')
    })

    it('ArrowDown moves selection, Enter accepts the new pick', () => {
      renderPopup()
      // `#` alone shows all three sorted: Backend, followup, urgent
      const input = typeTitle('#')

      fireEvent.keyDown(input, { key: 'ArrowDown' }) // moves to followup
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(input.value).toBe('#followup ')
    })

    it('accepted tag preserves surrounding title text', () => {
      renderPopup()
      const input = typeTitle('fix #ur')

      fireEvent.keyDown(input, { key: 'Enter' })
      expect(input.value).toBe('fix #urgent ')
    })
  })

  describe('create-new', () => {
    it('typing `#newtag` with no matches shows the create-new hint', () => {
      renderPopup()
      typeTitle('#newtag')

      expect(screen.getByText(/Create #newtag/)).toBeInTheDocument()
    })

    it('Enter on no-matches completes the token with user-typed casing', () => {
      renderPopup()
      const input = typeTitle('#NewTag')

      fireEvent.keyDown(input, { key: 'Enter' })
      expect(input.value).toBe('#NewTag ')
      expect(screen.queryByText(/^Create #/)).not.toBeInTheDocument()
    })

    it('clicking the create-new hint row completes the token', () => {
      renderPopup()
      typeTitle('#xyz')

      const hint = screen.getByText(/Create #xyz/)
      fireEvent.mouseDown(hint)

      const input = getTitleInput()
      expect(input.value).toBe('#xyz ')
    })

    it('Escape dismisses the popover without completing the token', () => {
      renderPopup()
      const input = typeTitle('#xyz')

      fireEvent.keyDown(input, { key: 'Escape' })
      expect(input.value).toBe('#xyz')
      expect(screen.queryByText(/^Create #/)).not.toBeInTheDocument()
    })
  })
})
