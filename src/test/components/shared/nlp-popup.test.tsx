import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { NlpPopup } from '../../../components/shared/NlpPopup'
import { computeAutocomplete, personItems, tagItems, type AutocompleteItem } from '../../../services/nlp-autocomplete'
import { useNlpAutocomplete } from '../../../hooks/use-nlp-autocomplete'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useUIStore } from '../../../stores/ui-store'

afterEach(cleanup)

const PEOPLE = [{ id: 1, name: 'Anna', initials: 'AN' }, { id: 2, name: 'Andy Ross', initials: 'AR' }]
const TAGS = [{ id: 7, name: 'q4', color: '#f00' }]

function viewFor(text: string) {
  const view = computeAutocomplete(text, text.length, {
    people: personItems(PEOPLE), tags: tagItems(TAGS), statuses: [], commands: true,
    followupDefault: { count: 1, unit: 'm' }, today: new Date(2026, 9, 10),
  })
  if (!view) throw new Error('no popup for ' + text)
  return view
}

function renderPopup(text: string, selectedIndex = 0) {
  usePersonStore.setState({ people: PEOPLE })
  useTagStore.setState({ tags: TAGS })
  const input = document.createElement('input')
  document.body.appendChild(input)
  input.focus()
  const onPick = vi.fn()
  const onOpenChange = vi.fn()
  const onShowTasks = vi.fn()
  const utils = render(
    <NlpPopup
      view={viewFor(text)}
      selectedIndex={selectedIndex}
      onPick={onPick}
      entityMenu={{ keyTarget: () => input, onOpenChange, onShowTasks }}
    />,
  )
  return { input, onPick, onOpenChange, onShowTasks, ...utils }
}

const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)

describe('NlpPopup — a person’s / tag’s menu on its rows', () => {
  afterEach(() => { document.querySelectorAll('body > input').forEach((el) => el.remove()) })

  it('a right-click on a person row opens its menu without picking it; Esc closes only the menu, back in the field', () => {
    const { input, onPick, onOpenChange } = renderPopup('@an')
    const andy = screen.getByRole('option', { name: '@Andy Ross' })
    // The right button's press doesn't pick (a left press does).
    expect(fireEvent.mouseDown(andy, { button: 2 })).toBe(false)
    fireEvent.contextMenu(andy, { button: 2, clientX: 20, clientY: 30 })
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { name: '@Andy Ross' })).toBeInTheDocument()
    expect(menuItems()).toEqual(['Show tasks', 'Edit…', 'Delete…'])
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(input).toHaveFocus()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(andy, { button: 0 })
    expect(onPick).toHaveBeenCalledOnce()
  })

  it('Shift+F10 / the context-menu key in the field opens the active row’s menu; a right-click on the field doesn’t', () => {
    const { input } = renderPopup('@an', 1)
    fireEvent.contextMenu(input, { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(input, { button: 0 })
    expect(screen.getByRole('menu', { name: '@Andy Ross' })).toBeInTheDocument()
  })

  it('a tag row’s menu is the tag’s; Show tasks runs onShowTasks first', () => {
    const { onShowTasks } = renderPopup('#q')
    fireEvent.contextMenu(screen.getByRole('option', { name: '#q4' }), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show tasks' }))
    expect(onShowTasks).toHaveBeenCalledOnce()
    expect(useUIStore.getState().taskDialog?.title).toBe('#q4')
  })

  it('no menu on create or command rows, nor without entityMenu', () => {
    const { input, unmount } = renderPopup('@zed')
    fireEvent.contextMenu(screen.getByRole('option', { name: /create @zed/ }), { button: 2 })
    fireEvent.contextMenu(input, { button: 0 })
    expect(screen.queryByRole('menu')).toBeNull()
    unmount()
    renderPopup('/')
    fireEvent.contextMenu(screen.getAllByRole('option')[0]!, { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    cleanup()
    const onPick = vi.fn()
    render(<NlpPopup view={viewFor('@an')} selectedIndex={0} onPick={onPick} />)
    fireEvent.contextMenu(screen.getByRole('option', { name: '@Anna' }), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('useNlpAutocomplete — the open popup follows its candidates', () => {
  it('a rename or delete elsewhere shows in the open popup at once', () => {
    const input = document.createElement('input')
    input.value = '@an'
    const { result, rerender } = renderHook(
      ({ people }: { people: AutocompleteItem[] }) => useNlpAutocomplete({ people, onApply: vi.fn() }),
      { initialProps: { people: personItems(PEOPLE) } },
    )
    act(() => { result.current.handleInputChange('@an', 3, input) })
    const names = () => result.current.state.view?.rows.flatMap((r) => (r.kind === 'entity' ? [r.item.name] : []))
    expect(names()).toEqual(['Anna', 'Andy Ross'])
    rerender({ people: personItems([{ id: 1, name: 'Annabel', initials: 'AN' }]) })
    expect(names()).toEqual(['Annabel'])
  })

  it('makes its text-measuring context once, not per caret measurement', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const input = document.createElement('input')
    const people = personItems(PEOPLE)
    const onApply = vi.fn()
    const { result } = renderHook(() => useNlpAutocomplete({ people, onApply }))
    for (const text of ['@a', '@an', '@and']) act(() => { result.current.handleInputChange(text, text.length, input) })
    expect(result.current.state.view).not.toBeNull()
    expect(getContext).toHaveBeenCalledTimes(1)
  })
})
