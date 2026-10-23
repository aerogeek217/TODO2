import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts'
import { copiedNotice, copyTasks, inDisplayOrder, tasksToCopy } from '../../services/task-copy'
import { createCommands, type CommandContext } from '../../services/command-registry'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { makeTodo, stubClipboard } from '../helpers'

/** A rendered widget scope `w` whose rows show tasks 3, 1, 2 in that order (task 3 twice). */
function renderScope(): HTMLElement {
  const scope = document.createElement('div')
  scope.setAttribute('data-selection-scope', 'w')
  for (const [key, id] of [['a|3', 3], ['a|1', 1], ['b|3', 3], ['b|2', 2]] as const) {
    const row = document.createElement('div')
    row.setAttribute('data-row-key', key)
    row.setAttribute('data-row-todo', String(id))
    const cell = document.createElement('button')
    cell.textContent = `cell ${id}`
    row.appendChild(cell)
    scope.appendChild(row)
  }
  document.body.appendChild(scope)
  return scope
}

function pressCopy(target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

const noop = () => {}
const callbacks = { openPalette: noop, closePalette: noop, openSettings: noop }

beforeEach(() => {
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'One' }),
      makeTodo({ id: 2, title: 'Two' }),
      makeTodo({ id: 3, title: 'Three' }),
    ],
  })
  usePersonStore.setState({ assignedPeopleMap: new Map([[2, [{ id: 9, name: 'Ann', initials: 'AN' }]]]) })
  useStatusStore.setState({ statuses: [] })
  useUIStore.getState().clearSelection()
  // No clipboard unless a test stubs one.
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(globalThis, 'ClipboardItem')
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('copy helpers', () => {
  it('copiedNotice counts tasks', () => {
    expect(copiedNotice(1)).toBe('Copied 1 task')
    expect(copiedNotice(3)).toBe('Copied 3 tasks')
  })

  it('copyTasks copies with the stores’ people and says how many tasks (each once)', async () => {
    const { written } = stubClipboard()
    const [one, two] = useTodoStore.getState().todos
    expect(await copyTasks([{ label: 'A', todos: [one!, two!] }, { label: 'B', todos: [two!] }])).toBe(true)
    expect(written).toEqual(['== A ==\n[ ] One\n[ ] Two @Ann\n\n== B ==\n[ ] Two @Ann'])
    expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Copied 2 tasks' })
  })

  it('copyTasks with no tasks writes nothing and says nothing', async () => {
    const { written } = stubClipboard()
    expect(await copyTasks([{ label: 'Empty', todos: [] }])).toBe(false)
    expect(await copyTasks([])).toBe(false)
    expect(written).toEqual([])
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('a refused copy says so instead', async () => {
    const [one] = useTodoStore.getState().todos
    expect(await copyTasks([{ todos: [one!] }])).toBe(false)
    expect(useUndoStore.getState().snackbar?.description).toMatch(/Couldn’t copy/)
  })

  it('inDisplayOrder follows the scope’s rendered rows; with no such scope, the order given', () => {
    renderScope()
    const todos = useTodoStore.getState().todos
    expect(inDisplayOrder(todos, 'w').map((t) => t.id)).toEqual([3, 1, 2])
    expect(inDisplayOrder(todos, 'gone').map((t) => t.id)).toEqual([1, 2, 3])
    expect(inDisplayOrder(todos, null).map((t) => t.id)).toEqual([1, 2, 3])
  })

  it('tasksToCopy: the selection in display order, else the focused row’s task, else none', () => {
    const scope = renderScope()
    expect(tasksToCopy()).toEqual([])
    scope.querySelector<HTMLElement>('[data-row-key="b|2"] button')!.focus()
    expect(tasksToCopy().map((t) => t.id)).toEqual([2])
    useUIStore.getState().setScopedSelection('w', { ids: new Set([1, 2, 3]), anchorKey: 'a|3', cursorKey: 'b|2', cursorTodoId: 2 })
    expect(tasksToCopy().map((t) => t.id)).toEqual([3, 1, 2])
  })
})

describe('the copy shortcut (Ctrl+C / ⌘C)', () => {
  beforeEach(() => {
    renderScope()
    useUIStore.getState().setScopedSelection('w', { ids: new Set([1, 3]), anchorKey: 'a|3', cursorKey: 'a|1', cursorTodoId: 1 })
  })

  it('copies the selected tasks in their widget’s order, as one list with no heading', async () => {
    const { written } = stubClipboard()
    renderHook(() => useKeyboardShortcuts(callbacks))
    const e = pressCopy()
    expect(e.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(written).toEqual(['[ ] Three\n[ ] One']))
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Copied 2 tasks' }))
  })

  it('⌘C counts too', async () => {
    const { written } = stubClipboard()
    renderHook(() => useKeyboardShortcuts(callbacks))
    const e = new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(written).toHaveLength(1))
  })

  it('in a text field the browser’s own copy runs untouched', () => {
    const { written } = stubClipboard()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useKeyboardShortcuts(callbacks))
    expect(pressCopy(input).defaultPrevented).toBe(false)
    expect(written).toEqual([])
  })

  it('with text selected on the page the browser’s own copy runs untouched', () => {
    const { written } = stubClipboard()
    const p = document.createElement('p')
    p.textContent = 'Some text'
    document.body.appendChild(p)
    const range = document.createRange()
    range.selectNodeContents(p)
    window.getSelection()!.addRange(range)
    renderHook(() => useKeyboardShortcuts(callbacks))
    expect(pressCopy().defaultPrevented).toBe(false)
    expect(written).toEqual([])
  })

  it('with no selected or focused task nothing is taken', () => {
    const { written } = stubClipboard()
    useUIStore.getState().clearSelection()
    renderHook(() => useKeyboardShortcuts(callbacks))
    expect(pressCopy().defaultPrevented).toBe(false)
    expect(written).toEqual([])
  })

  it('inside a modal no copy is taken', () => {
    const { written } = stubClipboard()
    const modal = document.createElement('div')
    modal.setAttribute('data-shortcut-scope', 'modal')
    const button = document.createElement('button')
    modal.appendChild(button)
    document.body.appendChild(modal)
    button.focus()
    renderHook(() => useKeyboardShortcuts(callbacks))
    expect(pressCopy(button).defaultPrevented).toBe(false)
    expect(written).toEqual([])
  })

  it('rebound to other keys, Ctrl+C is the browser’s again', async () => {
    const { written } = stubClipboard()
    useSettingsStore.setState({ shortcutOverrides: { 'copy-selected': [{ key: 'x' }] } })
    renderHook(() => useKeyboardShortcuts(callbacks))
    expect(pressCopy().defaultPrevented).toBe(false)
    expect(written).toEqual([])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(written).toEqual(['[ ] Three\n[ ] One']))
  })

  it('the palette’s Copy N Tasks copies the selection, with the shortcut as its hint', async () => {
    const { written } = stubClipboard()
    const ctx = { shortcuts: callbacks, selectionCount: 2, getStatuses: () => [] } as unknown as CommandContext
    const cmd = createCommands(ctx, {}).find((c) => c.id === 'bulk-copy')!
    expect(cmd).toMatchObject({ name: 'Copy 2 Tasks', category: 'bulk' })
    expect(cmd.shortcut).toMatch(/C$/)
    cmd.action()
    await vi.waitFor(() => expect(written).toEqual(['[ ] Three\n[ ] One']))
    expect(createCommands({ ...ctx, selectionCount: 0 }, {}).some((c) => c.id === 'bulk-copy')).toBe(false)
  })
})
