import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExternalTaskboardDrop } from '../../hooks/use-external-taskboard-drop'
import { useTaskboardStore } from '../../stores/taskboard-store'

const PANEL_ID = 'dashboard-taskboard-drop-1'

function mountPanel(entryRects: Array<{ top: number; height: number }>): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-taskboard-panel-id', PANEL_ID)
  for (const r of entryRects) {
    const row = document.createElement('div')
    row.setAttribute('data-tbp-entry', '')
    // jsdom's getBoundingClientRect is stubbed per-element.
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ top: r.top, height: r.height, left: 0, right: 0, bottom: r.top + r.height, width: 0, x: 0, y: r.top, toJSON() {} }),
    })
    panel.appendChild(row)
  }
  document.body.appendChild(panel)
  return panel
}

function makeDataTransfer(initial: Record<string, string> = {}, types: string[] = []): DataTransfer {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (fmt: string, data: string) => { store.set(fmt, data) },
    getData: (fmt: string) => store.get(fmt) ?? '',
    clearData: () => store.clear(),
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    types: types as unknown as readonly string[],
    setDragImage: () => {},
  } as unknown as DataTransfer
}

function makeReactDragEvent(
  type: 'dragover' | 'drop' | 'dragleave',
  dataTransfer: DataTransfer,
  clientY: number,
  target: HTMLElement,
  relatedTarget: Node | null = null,
) {
  let defaultPrevented = false
  return {
    type,
    dataTransfer,
    clientY,
    clientX: 0,
    currentTarget: target,
    target,
    relatedTarget,
    preventDefault() { defaultPrevented = true },
    stopPropagation() {},
    get defaultPrevented() { return defaultPrevented },
  } as unknown as React.DragEvent
}

describe('useExternalTaskboardDrop', () => {
  let addAtSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    addAtSpy = vi.fn().mockResolvedValue(undefined)
    // Replace the store's addAt with a spy for this test.
    const patch = { addAt: addAtSpy } as unknown as Parameters<typeof useTaskboardStore.setState>[0]
    useTaskboardStore.setState(patch)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('accepts drag when the external todo MIME is present and computes insertion index from pointerY', () => {
    const panel = mountPanel([
      { top: 0, height: 40 },
      { top: 40, height: 40 },
      { top: 80, height: 40 },
    ])
    const { result } = renderHook(() => useExternalTaskboardDrop(7, PANEL_ID))

    const dt = makeDataTransfer({}, ['application/x-todo-drag'])
    act(() => {
      result.current.onDragOver(makeReactDragEvent('dragover', dt, 70, panel))
    })

    // pointerY = 70 → past midpoint of row 0 (20) and row 1 (60) → index 2.
    expect(result.current.isExternalDragOver).toBe(true)
    expect(result.current.externalInsertIndex).toBe(2)
  })

  it('ignores dragover when the MIME is not present', () => {
    const panel = mountPanel([{ top: 0, height: 40 }])
    const { result } = renderHook(() => useExternalTaskboardDrop(7, PANEL_ID))

    const dt = makeDataTransfer({}, ['text/plain'])
    const evt = makeReactDragEvent('dragover', dt, 10, panel)
    act(() => { result.current.onDragOver(evt) })

    expect(evt.defaultPrevented).toBe(false)
    expect(result.current.isExternalDragOver).toBe(false)
  })

  it('drop parses the JSON payload and calls taskboard addAt(taskboardId, todoId, index)', () => {
    const panel = mountPanel([
      { top: 0, height: 40 },
      { top: 40, height: 40 },
    ])
    const { result } = renderHook(() => useExternalTaskboardDrop(7, PANEL_ID))

    const dt = makeDataTransfer(
      { 'application/x-todo-drag': JSON.stringify({ kind: 'todo', todoId: 99 }) },
      ['application/x-todo-drag'],
    )
    // pointerY = 10 → before midpoint of row 0 (20) → index 0.
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 10, panel)) })

    expect(addAtSpy).toHaveBeenCalledTimes(1)
    expect(addAtSpy).toHaveBeenCalledWith(7, 99, 0)
    expect(result.current.isExternalDragOver).toBe(false)
    expect(result.current.externalInsertIndex).toBe(null)
  })

  it('drop falls back to plain-text todoId payload', () => {
    const panel = mountPanel([])
    const { result } = renderHook(() => useExternalTaskboardDrop(4, PANEL_ID))

    const dt = makeDataTransfer({ 'text/plain': '55' }, ['text/plain'])
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 0, panel)) })

    expect(addAtSpy).toHaveBeenCalledWith(4, 55, 0)
  })

  it('drop is a no-op when taskboardId is null', () => {
    const panel = mountPanel([])
    const { result } = renderHook(() => useExternalTaskboardDrop(null, PANEL_ID))

    const dt = makeDataTransfer(
      { 'application/x-todo-drag': JSON.stringify({ kind: 'todo', todoId: 1 }) },
      ['application/x-todo-drag'],
    )
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 0, panel)) })

    expect(addAtSpy).not.toHaveBeenCalled()
  })

  it('dragleave clears state only when pointer actually leaves the panel', () => {
    const panel = mountPanel([{ top: 0, height: 40 }])
    const child = document.createElement('div')
    panel.appendChild(child)
    const { result } = renderHook(() => useExternalTaskboardDrop(1, PANEL_ID))

    const dt = makeDataTransfer({}, ['application/x-todo-drag'])
    act(() => { result.current.onDragOver(makeReactDragEvent('dragover', dt, 10, panel)) })
    expect(result.current.isExternalDragOver).toBe(true)

    // Leave into a descendant — should remain active.
    act(() => { result.current.onDragLeave(makeReactDragEvent('dragleave', dt, 10, panel, child)) })
    expect(result.current.isExternalDragOver).toBe(true)

    // Leave to a non-descendant — should clear.
    const outside = document.createElement('div')
    act(() => { result.current.onDragLeave(makeReactDragEvent('dragleave', dt, 10, panel, outside)) })
    expect(result.current.isExternalDragOver).toBe(false)
    expect(result.current.externalInsertIndex).toBe(null)
  })
})
