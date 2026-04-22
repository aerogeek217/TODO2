import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExternalTaskboardDrop } from '../../hooks/use-external-taskboard-drop'
import { useTaskboardStore } from '../../stores/taskboard-store'
import type { Taskboard, TaskboardEntry } from '../../models'

const PANEL_ID = 'dashboard-taskboard-drop-1'

function mountPanel(
  entryRects: Array<{ top: number; height: number; todoId?: number }>,
): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-taskboard-panel-id', PANEL_ID)
  for (const r of entryRects) {
    const row = document.createElement('div')
    row.setAttribute('data-tbp-entry', '')
    if (r.todoId != null) row.setAttribute('data-todo-id', String(r.todoId))
    // jsdom's getBoundingClientRect is stubbed per-element.
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ top: r.top, height: r.height, left: 0, right: 0, bottom: r.top + r.height, width: 0, x: 0, y: r.top, toJSON() {} }),
    })
    panel.appendChild(row)
  }
  document.body.appendChild(panel)
  return panel
}

function seedBoard(entries: TaskboardEntry[]): void {
  const board: Taskboard = {
    id: 1,
    entries,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Taskboard
  useTaskboardStore.setState({ board })
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
    // Replace the store's addAt with a spy and reset the board so previous
    // tests' seeded entries don't leak.
    const patch = { addAt: addAtSpy, board: null } as unknown as Parameters<typeof useTaskboardStore.setState>[0]
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
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

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
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

    const dt = makeDataTransfer({}, ['text/plain'])
    const evt = makeReactDragEvent('dragover', dt, 10, panel)
    act(() => { result.current.onDragOver(evt) })

    expect(evt.defaultPrevented).toBe(false)
    expect(result.current.isExternalDragOver).toBe(false)
  })

  it('drop parses the JSON payload and calls taskboard addAt(todoId, index)', () => {
    seedBoard([
      { todoId: 100, sortOrder: 1000 },
      { todoId: 200, sortOrder: 2000 },
    ])
    const panel = mountPanel([
      { top: 0, height: 40, todoId: 100 },
      { top: 40, height: 40, todoId: 200 },
    ])
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

    const dt = makeDataTransfer(
      { 'application/x-todo-drag': JSON.stringify({ kind: 'todo', todoId: 99 }) },
      ['application/x-todo-drag'],
    )
    // pointerY = 10 → before midpoint of row 0 (20); row 0 → todoId 100 → full index 0.
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 10, panel)) })

    expect(addAtSpy).toHaveBeenCalledTimes(1)
    expect(addAtSpy).toHaveBeenCalledWith(99, 0)
    expect(result.current.isExternalDragOver).toBe(false)
    expect(result.current.externalInsertIndex).toBe(null)
  })

  it('drop maps visible-row position back to its slot in the full entries array', () => {
    // Full entries: 4 items, but row 200 is filtered out of the rendered DOM
    // (e.g. completed + showCompleted=false). Indicator at the gap between
    // visible rows 300 and 400 must call addAt with the *full* index of 400
    // (3), not the visible index (2) — otherwise the new entry lands above
    // 300 instead of between 300 and 400.
    seedBoard([
      { todoId: 100, sortOrder: 1000 },
      { todoId: 200, sortOrder: 2000 },
      { todoId: 300, sortOrder: 3000 },
      { todoId: 400, sortOrder: 4000 },
    ])
    const panel = mountPanel([
      { top: 0, height: 40, todoId: 100 },
      { top: 40, height: 40, todoId: 300 },
      { top: 80, height: 40, todoId: 400 },
    ])
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

    const dt = makeDataTransfer(
      { 'application/x-todo-drag': JSON.stringify({ kind: 'todo', todoId: 99 }) },
      ['application/x-todo-drag'],
    )
    // pointerY = 70 → past row 0 / row 1 midpoints, before row 2 (midpoint 100)
    // → visible row at index 2 = todoId 400 → full index 3.
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 70, panel)) })

    expect(addAtSpy).toHaveBeenCalledWith(99, 3)
  })

  it('drop past the last visible row appends to the end of the full array', () => {
    seedBoard([
      { todoId: 100, sortOrder: 1000 },
      { todoId: 200, sortOrder: 2000 },
      { todoId: 300, sortOrder: 3000 },
    ])
    const panel = mountPanel([
      { top: 0, height: 40, todoId: 100 },
      { top: 40, height: 40, todoId: 300 },
    ])
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

    const dt = makeDataTransfer(
      { 'application/x-todo-drag': JSON.stringify({ kind: 'todo', todoId: 99 }) },
      ['application/x-todo-drag'],
    )
    // pointerY = 200 → past every visible row's midpoint → append at full length 3.
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 200, panel)) })

    expect(addAtSpy).toHaveBeenCalledWith(99, 3)
  })

  it('drop falls back to plain-text todoId payload', () => {
    const panel = mountPanel([])
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

    const dt = makeDataTransfer({ 'text/plain': '55' }, ['text/plain'])
    act(() => { result.current.onDrop(makeReactDragEvent('drop', dt, 0, panel)) })

    expect(addAtSpy).toHaveBeenCalledWith(55, 0)
  })

  it('dragleave clears state only when pointer actually leaves the panel', () => {
    const panel = mountPanel([{ top: 0, height: 40 }])
    const child = document.createElement('div')
    panel.appendChild(child)
    const { result } = renderHook(() => useExternalTaskboardDrop(PANEL_ID))

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
