// Esc in the fields block's People / Tags search closes just that picker and
// goes no further, so the review deck (or a dialog) around it stays open.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditMetadata } from '../../components/task/TaskEditMetadata'
import { PERSON_PICKER_PLACEHOLDER } from '../../utils/person'

afterEach(cleanup)

function renderBlock() {
  const onDropdownChange = vi.fn()
  render(
    <TaskEditMetadata
      deadline={null}
      recurrenceType=""
      onDeadlineChange={vi.fn()}
      onRecurrenceChange={vi.fn()}
      assignedPeople={[]}
      assignedTags={[]}
      allPeople={[{ id: 1, name: 'Aisha' }]}
      allTags={[{ id: 1, name: 'ops' }]}
      onTogglePerson={vi.fn()}
      onToggleTag={vi.fn()}
      onDropdownChange={onDropdownChange}
    />,
  )
  return { onDropdownChange }
}

const addButtons = () => screen.getAllByRole('button', { name: '+ Add' })

describe('TaskEditMetadata pickers and Esc', () => {
  it.each([
    ['People', 0, PERSON_PICKER_PLACEHOLDER],
    ['Tags', 1, 'Search tags...'],
  ])('Esc in the %s search closes the picker and is consumed', (_label, index, placeholder) => {
    const { onDropdownChange } = renderBlock()
    const add = addButtons().at(index)
    if (!add) throw new Error('no + Add button')
    fireEvent.click(add)
    const search = screen.getByPlaceholderText(placeholder)

    // `fireEvent` returns false when a handler called preventDefault (the dialog behind ignores it).
    const notPrevented = fireEvent.keyDown(search, { key: 'Escape' })

    expect(notPrevented).toBe(false)
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull()
    expect(onDropdownChange).toHaveBeenLastCalledWith(false)
  })
})
