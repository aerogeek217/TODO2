import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { AnchoredPicker } from '../../../components/shared/AnchoredPicker'
import { SubtasksSheet } from '../../../components/task/subtasks/SubtasksSheet'
import type { PersistedTodoItem } from '../../../models'

/**
 * A portaled row layer keeps its pointer events from bubbling (through the
 * React tree) to the row that opened it — its select, drag, editor and task
 * menu handlers (cr31 T2, T5).
 */
afterEach(cleanup)

function rowSpies() {
  return {
    onClick: vi.fn(), onDoubleClick: vi.fn(), onMouseDown: vi.fn(),
    onPointerDown: vi.fn(), onContextMenu: vi.fn(),
  }
}

function fireAll(el: Element) {
  fireEvent.pointerDown(el)
  fireEvent.mouseDown(el)
  fireEvent.click(el)
  fireEvent.doubleClick(el)
  fireEvent.contextMenu(el)
}

function expectNoneCalled(spies: ReturnType<typeof rowSpies>) {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
}

describe('portaled row layers keep their events inside', () => {
  it('AnchoredPicker: a press, click, double-click or right-click in it never reaches the row (T2)', () => {
    const spies = rowSpies()
    function Row() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <div {...spies}>
          <button ref={ref}>trigger</button>
          <AnchoredPicker anchorRef={ref} onClose={() => {}}>
            <input aria-label="Search people" />
          </AnchoredPicker>
        </div>
      )
    }
    render(<Row />)
    fireAll(screen.getByLabelText('Search people'))
    fireAll(document.querySelector('[data-anchored-picker]')!)
    expectNoneCalled(spies)
  })

  it('SubtasksSheet: a long-press / right-click or press in it, or on its scrim, never reaches the row (T5)', () => {
    const spies = rowSpies()
    const onClose = vi.fn()
    const todo = { id: 1, title: 'Parent', isCompleted: false } as PersistedTodoItem
    render(<div {...spies}><SubtasksSheet todo={todo} onClose={onClose} /></div>)
    fireAll(document.querySelector('[data-subtasks-sheet]')!)
    expectNoneCalled(spies)
    expect(onClose).not.toHaveBeenCalled()
    const scrim = document.querySelector('[data-subtasks-sheet]')!.previousElementSibling!
    fireAll(scrim)
    expectNoneCalled(spies)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SubtasksSheet: Esc and the scrim (cr31 T9, T10)', () => {
  const todo = { id: 1, title: 'Parent', isCompleted: false } as PersistedTodoItem

  it('Esc in the sheet closes only the sheet, not a dialog it was opened from', () => {
    const dialogKeyDown = vi.fn()
    const onClose = vi.fn()
    render(<div onKeyDown={dialogKeyDown}><SubtasksSheet todo={todo} onClose={onClose} /></div>)
    fireEvent.keyDown(screen.getByLabelText('New subtask'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogKeyDown).not.toHaveBeenCalled()
  })

  it('a touch drag on the scrim doesn’t scroll the page behind (a non-passive listener)', () => {
    render(<SubtasksSheet todo={todo} onClose={() => {}} />)
    const scrim = document.querySelector('[data-subtasks-sheet]')!.previousElementSibling!
    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    scrim.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(true)
  })
})
