// Esc in the facts rail's People / Tags search closes just that picker and
// goes no further, so the review deck (or a dialog) around it stays open.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditMetadata } from '../../components/task/TaskEditMetadata'
import { PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { makePerson } from '../helpers'

afterEach(cleanup)

function renderBlock() {
  render(
    <TaskEditMetadata
      deadline={null}
      recurrenceType=""
      onDeadlineChange={vi.fn()}
      onRecurrenceChange={vi.fn()}
      assignedPeople={[]}
      assignedTags={[]}
      allPeople={[makePerson({ id: 1, name: 'Aisha' })]}
      allTags={[{ id: 1, name: 'ops', color: '#7ec4bc' }]}
      onTogglePerson={vi.fn()}
      onToggleTag={vi.fn()}
    />,
  )
}

const addButtons = () => [screen.getByRole('button', { name: 'Add person' }), screen.getByRole('button', { name: 'Add tag' })]

describe('TaskEditMetadata pickers and Esc', () => {
  it.each([
    ['People', 0, PERSON_PICKER_PLACEHOLDER],
    ['Tags', 1, 'Search tags...'],
  ])('Esc in the %s search closes the picker and is consumed', (_label, index, placeholder) => {
    renderBlock()
    const add = addButtons().at(index)
    if (!add) throw new Error('no + Add button')
    fireEvent.click(add)
    const search = screen.getByPlaceholderText(placeholder)

    // `fireEvent` returns false when a handler called preventDefault (the dialog behind ignores it).
    const notPrevented = fireEvent.keyDown(search, { key: 'Escape' })

    expect(notPrevented).toBe(false)
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull()
    expect(addButtons().at(index)).toHaveAttribute('aria-expanded', 'false')
  })
})
