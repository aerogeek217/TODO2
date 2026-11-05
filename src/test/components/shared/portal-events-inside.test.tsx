import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import { AnchoredPicker } from '../../../components/shared/AnchoredPicker'
import { SubtasksSheet } from '../../../components/task/subtasks/SubtasksSheet'
import type { PersistedTodoItem } from '../../../models'

/**
 * A portaled row layer keeps its pointer events from bubbling (through the
 * React tree) to the row that opened it — its select, drag, editor and task
 * menu handlers (cr31 T2, T5).
 */
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
