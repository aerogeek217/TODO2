import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useUIStore } from '../../stores/ui-store'
import { clickKeepsSelection, useClearSelectionOnOutsideClick } from '../../hooks/use-clear-selection-on-outside-click'

let root: HTMLElement

function el(html: string, parent: Element = root): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  const node = wrap.firstElementChild as HTMLElement
  parent.append(node)
  return node
}

function pointerDown(target: Element, x: number, y: number) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
}

function click(target: Element, x = 10, y = 10) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, detail: 1 }))
}

const selectedCount = () => useUIStore.getState().selectedTodoIds.size

beforeEach(() => {
  root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  useUIStore.getState().setScopedSelection('tab', { ids: new Set([1, 2]), anchorKey: 'tab:1', cursorKey: 'tab:2', cursorTodoId: 2 })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('clickKeepsSelection', () => {
  it('keeps on rows, marked areas, menus / dialogs / listboxes and anything outside the app root', () => {
    const row = el('<div data-todo-id="1"><button>⋯</button></div>')
    expect(clickKeepsSelection(row.querySelector('button'), root)).toBe(true)
    expect(clickKeepsSelection(el('<div data-keeps-selection><span>2 selected</span></div>').firstElementChild, root)).toBe(true)
    expect(clickKeepsSelection(el('<div role="menu"><div role="menuitem">x</div></div>').firstElementChild, root)).toBe(true)
    expect(clickKeepsSelection(el('<div role="dialog"><p>x</p></div>').firstElementChild, root)).toBe(true)
    expect(clickKeepsSelection(el('<div>portal</div>', document.body), root)).toBe(true)
  })

  it('clears anywhere else in the app', () => {
    expect(clickKeepsSelection(el('<header><button>New task</button></header>').firstElementChild, root)).toBe(false)
    expect(clickKeepsSelection(el('<div class="workspace"></div>'), root)).toBe(false)
  })
})

describe('useClearSelectionOnOutsideClick', () => {
  it('a click outside the rows clears the selection; a click on a row keeps it', () => {
    renderHook(() => useClearSelectionOnOutsideClick())
    const row = el('<div data-todo-id="1"><span>title</span></div>')
    click(row.firstElementChild!)
    expect(selectedCount()).toBe(2)
    click(el('<div class="header"></div>'))
    expect(selectedCount()).toBe(0)
  })

  it('a click that ends a drag (the pointer moved since it went down) keeps it', () => {
    renderHook(() => useClearSelectionOnOutsideClick())
    const area = el('<div class="workspace"></div>')
    pointerDown(area, 10, 10)
    click(area, 70, 10)
    expect(selectedCount()).toBe(2)
    pointerDown(area, 10, 10)
    click(area, 11, 10)
    expect(selectedCount()).toBe(0)
  })

  it('stops listening on unmount', () => {
    const { unmount } = renderHook(() => useClearSelectionOnOutsideClick())
    unmount()
    click(el('<div class="header"></div>'))
    expect(selectedCount()).toBe(2)
  })
})
