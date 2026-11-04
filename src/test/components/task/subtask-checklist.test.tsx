// The shared checklist (cr28): the add row (⏎ adds a trimmed title and keeps
// the focus; Esc with text clears), renaming in place (⏎ saves, Esc cancels
// and stops there, a blank cancels), the checkbox, and the ⋯ menu (Rename ·
// the host's extra items | Delete).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SubtaskChecklist, type ChecklistItem } from '../../../components/task/subtasks/SubtaskChecklist'

afterEach(cleanup)

const ITEMS: ChecklistItem[] = [
  { id: 1, title: 'Send the template', isCompleted: true },
  { id: 2, title: 'Headcount from Aisha', isCompleted: false },
]

function setup(items: ChecklistItem[] = ITEMS, extra?: Parameters<typeof SubtaskChecklist>[0]['extraMenuEntries']) {
  const handlers = { onAdd: vi.fn(), onRename: vi.fn(), onSetDone: vi.fn(), onRemove: vi.fn() }
  const onParentKey = vi.fn()
  render(
    <div onKeyDown={onParentKey}>
      <SubtaskChecklist items={items} density="editor" label="Subtasks" {...handlers} extraMenuEntries={extra} />
    </div>,
  )
  return { ...handlers, onParentKey }
}

const addField = () => screen.getByRole('textbox', { name: 'New subtask' }) as HTMLInputElement

describe('SubtaskChecklist — add', () => {
  it('⏎ adds the trimmed title, clears the field and keeps the focus; a blank adds nothing', () => {
    const { onAdd } = setup()
    const field = addField()
    field.focus()
    fireEvent.change(field, { target: { value: '  Review with\n Ben  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('Review with Ben')
    expect(field.value).toBe('')
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('Esc with text clears it and stops there; an empty field leaves Esc to the host', () => {
    const { onParentKey } = setup()
    const field = addField()
    fireEvent.change(field, { target: { value: 'half typed' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field.value).toBe('')
    expect(onParentKey).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onParentKey).toHaveBeenCalledTimes(1)
  })

  it('autoFocusAdd focuses the add field on mount', () => {
    render(<SubtaskChecklist items={[]} density="tight" label="Subtasks" autoFocusAdd onAdd={vi.fn()} onRename={vi.fn()} onSetDone={vi.fn()} onRemove={vi.fn()} />)
    expect(document.activeElement).toBe(addField())
  })
})

describe('SubtaskChecklist — rows', () => {
  it('lists the items in order, done ones marked; the checkbox checks and unchecks', () => {
    const { onSetDone } = setup()
    const rows = within(screen.getByRole('list', { name: 'Subtasks' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['Send the template', 'Headcount from Aisha'])
    expect(rows[0]).toHaveAttribute('data-done')
    expect(rows[1]).not.toHaveAttribute('data-done')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Check Headcount from Aisha' }))
    expect(onSetDone).toHaveBeenCalledWith(2, true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Uncheck Send the template' }))
    expect(onSetDone).toHaveBeenCalledWith(1, false)
  })

  it('a click on the title renames in place: ⏎ saves the trimmed title, a blank or the same title saves nothing', () => {
    const { onRename } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename Headcount from Aisha' }))
    const field = screen.getByRole('textbox', { name: 'Subtask title' }) as HTMLInputElement
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('Headcount from Aisha')
    fireEvent.change(field, { target: { value: ' Headcount from Aisha and Ben ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith(2, 'Headcount from Aisha and Ben')
    expect(screen.queryByRole('textbox', { name: 'Subtask title' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rename Headcount from Aisha' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Subtask title' }), { target: { value: '  ' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Subtask title' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Rename Headcount from Aisha' }))
    fireEvent.blur(screen.getByRole('textbox', { name: 'Subtask title' }))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('Esc cancels the rename and stops there (the host’s dialog stays open)', () => {
    const { onRename, onParentKey } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename Send the template' }))
    const field = screen.getByRole('textbox', { name: 'Subtask title' })
    fireEvent.change(field, { target: { value: 'changed' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Subtask title' })).toBeNull()
    expect(onRename).not.toHaveBeenCalled()
    expect(onParentKey).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Rename Send the template' })).toBeInTheDocument()
  })

  it('⋯ opens the menu: Rename · the host’s items | Delete', () => {
    const extra = vi.fn()
    const { onRemove } = setup(ITEMS, (item) => [{ kind: 'item', label: 'Make a task', onSelect: () => extra(item.id) }])
    fireEvent.click(screen.getByRole('button', { name: 'Subtask menu: Headcount from Aisha' }))
    const menu = screen.getByRole('menu', { name: 'Subtask: Headcount from Aisha' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Make a task', 'Delete'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Make a task' }))
    expect(extra).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByRole('button', { name: 'Subtask menu: Headcount from Aisha' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    expect(onRemove).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByRole('button', { name: 'Subtask menu: Send the template' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'Subtask title' })).toHaveValue('Send the template')
  })

  it('without items there is only the add row', () => {
    setup([])
    expect(screen.queryByRole('list')).toBeNull()
    expect(addField()).toBeInTheDocument()
  })
})
