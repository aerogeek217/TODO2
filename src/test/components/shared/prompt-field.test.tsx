import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { PromptAvatar, PromptField, type PromptOption } from '../../../components/shared/PromptField'
import { ESCAPE_OWN_ATTR } from '../../../hooks/use-popover-anchor'

/**
 * The shared prompt row (`PromptField`) — a list's Prompt for
 * (`runtime-filter-picker.test` covers its selection and keyboard through
 * `RuntimeFilterPicker`) and the Review widget's field: what the general
 * field adds for the second — any options (a list's too), each with a mark
 * and a count, marks on the chips, a control in place of the label, content
 * at the row's end — and what both get (its own Escape inside a popover).
 */

const OPTIONS: PromptOption[] = [
  { id: 1, name: 'Marcus Chen', mark: <PromptAvatar initials="MC" color="#8fbf6a" />, count: 6 },
  { id: 2, name: 'Marco Ruiz', mark: <PromptAvatar initials="MR" />, count: 2 },
  { id: 3, name: 'Aisha', mark: <span data-testid="glyph">◆</span>, count: 0 },
  { id: 4, name: 'Plain' },
]

function Field({ initial = [], onChange = () => {}, ...props }: {
  initial?: number[]
  onChange?: (ids: number[]) => void
  labelControl?: ReactNode
  trailing?: ReactNode
  chipMarks?: boolean
  options?: PromptOption[]
}) {
  const [value, setValue] = useState<number[]>(initial)
  return (
    <PromptField
      label="Person"
      options={props.options ?? OPTIONS}
      value={value}
      onChange={(ids) => { setValue(ids); onChange(ids) }}
      inputLabel="People to review"
      placeholder="Pick a person…"
      emptyText="No people yet"
      labelControl={props.labelControl}
      trailing={props.trailing}
      chipMarks={props.chipMarks}
    />
  )
}

const input = () => screen.getByRole('combobox', { name: 'People to review' })

afterEach(() => {
  cleanup()
})

describe('PromptField', () => {
  it('the options in the order given, each with its mark and its count at the end', () => {
    render(<Field />)
    expect(screen.getByText('Person')).toBeInTheDocument()
    expect(input()).toHaveAttribute('placeholder', 'Pick a person…')
    fireEvent.focus(input())
    expect(screen.getByRole('listbox', { name: 'Person' })).toBeInTheDocument()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['MCMarcus Chen6', 'MRMarco Ruiz2', '◆Aisha0', 'Plain'])
  })

  it('type to match; ⏎ picks the first; the pick is a chip — with its mark only with `chipMarks`', () => {
    const onChange = vi.fn()
    const { unmount } = render(<Field onChange={onChange} chipMarks />)
    fireEvent.change(input(), { target: { value: 'mar' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith([1])
    const remove = screen.getByRole('button', { name: 'Remove Marcus Chen' })
    expect(remove.parentElement).toHaveTextContent('MCMarcus Chen')
    // The placeholder goes once something is picked.
    expect(input()).toHaveAttribute('placeholder', '')
    unmount()
    render(<Field initial={[1]} />)
    expect(screen.getByRole('button', { name: 'Remove Marcus Chen' }).parentElement).toHaveTextContent(/^Marcus Chen/)
  })

  it('no options at all: the caller’s words; none matching: No matches', () => {
    render(<Field options={[]} />)
    fireEvent.focus(input())
    expect(screen.getByText('No people yet')).toBeInTheDocument()
    cleanup()
    render(<Field />)
    fireEvent.change(input(), { target: { value: 'zz' } })
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('a plain label is part of the field: a press on it leaves the option list open', () => {
    render(<Field />)
    fireEvent.focus(input())
    fireEvent.mouseDown(screen.getByText('Person'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('a control in place of the label, and content at the row’s end, are outside the field: a press there closes the option list', () => {
    render(<Field labelControl={<button type="button">Person ▾</button>} trailing={<span data-testid="trailing">3 of 12</span>} />)
    const row = document.querySelector<HTMLElement>('[data-prompt-row]')!
    expect(row.firstElementChild).toBe(screen.getByRole('button', { name: 'Person ▾' }))
    expect(row.lastElementChild).toBe(screen.getByTestId('trailing'))
    fireEvent.focus(input())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Person ▾' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.focus(input())
    fireEvent.mouseDown(screen.getByTestId('trailing'))
    expect(screen.queryByRole('listbox')).toBeNull()
    // The field itself (a chip's ×, the text) stays inside.
    fireEvent.focus(input())
    fireEvent.mouseDown(input())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('a new `resetKey` is another field: the typed text goes and the option list closes; the row (its label control) stays mounted', () => {
    const props = { label: 'Person', options: OPTIONS, value: [], onChange: () => {}, inputLabel: 'People to review', placeholder: 'Pick…', emptyText: 'None' }
    const control = <button type="button">Kind ▾</button>
    const { rerender } = render(<PromptField {...props} labelControl={control} resetKey="person" />)
    const button = screen.getByRole('button', { name: 'Kind ▾' })
    fireEvent.change(input(), { target: { value: 'mar' } })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    // The same key: nothing changes.
    rerender(<PromptField {...props} labelControl={control} resetKey="person" />)
    expect(input()).toHaveValue('mar')
    rerender(<PromptField {...props} labelControl={control} resetKey="tag" />)
    expect(input()).toHaveValue('')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Kind ▾' })).toBe(button)
  })

  it('Esc is the field’s own — it closes the option list — so a popover the row sits in stays open', () => {
    render(<Field />)
    expect(input()).toHaveAttribute(ESCAPE_OWN_ATTR)
    fireEvent.focus(input())
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
