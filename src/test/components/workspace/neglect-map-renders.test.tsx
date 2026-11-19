import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { NeglectMapWidget } from '../../../components/workspace/neglect/NeglectMapWidget'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import type { NeglectTab } from '../../../models/workspace-layout'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * What the Neglect map renders while a lasso is dragged (cr34 G9): the
 * rectangle alone. Every dot calls `useTooltip` once per render with its own
 * two lines, so counting those calls counts the dots' renders.
 */

const dotRenders = vi.hoisted(() => ({ byTitle: new Map<string, number>() }))

vi.mock('../../../components/shared/use-tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../components/shared/use-tooltip')>()
  return {
    ...actual,
    useTooltip: (text: string | null, opts?: Parameters<typeof actual.useTooltip>[1]) => {
      // A dot's tooltip: its title, then its zone line.
      const [title, meta] = (text ?? '').split('\n')
      if (title && meta) dotRenders.byTitle.set(title, (dotRenders.byTitle.get(title) ?? 0) + 1)
      return actual.useTooltip(text, opts)
    },
  }
})

const TODAY = new Date(2026, 10, 10, 10)
const day = (offset: number, hour = 0) => new Date(2026, 10, 10 + offset, hour)
const TAB: NeglectTab = { id: 'map', kind: 'neglect', config: { colourBy: { kind: 'none' }, untouchedDays: 14 } }
const TITLES = ['Late and old', 'Soon and old', 'Late but fresh', 'Later and fresh', 'No date, old']

const chart = () => document.querySelector<HTMLElement>('[data-neglect-chart]')!
const lasso = () => document.querySelector('[data-testid="neglect-lasso"]')
const renders = () => TITLES.map((t) => dotRenders.byTitle.get(t) ?? 0)
const at = (x: number, y: number) => ({ pointerId: 1, button: 0, clientX: x, clientY: y })

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: TITLES[0], modifiedAt: day(-26, 9), dueDate: day(-4), sortOrder: 1 }),
      makeTodo({ id: 2, title: TITLES[1], modifiedAt: day(-30, 9), dueDate: day(2), sortOrder: 2 }),
      makeTodo({ id: 3, title: TITLES[2], modifiedAt: day(-2, 9), dueDate: day(-1), sortOrder: 3 }),
      makeTodo({ id: 4, title: TITLES[3], modifiedAt: day(-1, 9), dueDate: day(12), sortOrder: 4 }),
      makeTodo({ id: 5, title: TITLES[4], modifiedAt: day(-50, 9), sortOrder: 5 }),
    ],
  })
  dotRenders.byTitle.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Neglect map while a lasso is dragged (cr34 G9)', () => {
  it('each move draws the rectangle alone: no dot renders again until the drag ends', () => {
    render(<NeglectMapWidget tab={TAB} />)
    const mounted = renders()
    expect(mounted.every((n) => n >= 1)).toBe(true)

    // Under the drag threshold: no rectangle yet.
    fireEvent.pointerDown(chart(), at(0, 0))
    fireEvent.pointerMove(chart(), at(2, 2))
    expect(lasso()).toBeNull()
    // Past it: the rectangle, following each move.
    for (const [x, y] of [[20, 20], [40, 30], [60, 60], [80, 90], [120, 140]] as const) {
      fireEvent.pointerMove(chart(), at(x, y))
      expect(lasso()).not.toBeNull()
      expect((lasso() as HTMLElement).style.width).toBe(`${x}px`)
      expect((lasso() as HTMLElement).style.height).toBe(`${y}px`)
    }
    expect(renders()).toEqual(mounted)

    // Released: the dots inside are selected (JSDOM lays every dot out at the chart's corner, inside the rectangle).
    fireEvent.pointerUp(chart(), at(120, 140))
    expect(lasso()).toBeNull()
    expect(useUIStore.getState().selectionScope).toBe('map')
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([1, 2, 3, 4, 5])
    for (const dot of document.querySelectorAll<HTMLElement>('[data-neglect-dot]')) expect(dot.dataset.selected).toBe('true')
  })

  it('a selection change renders only the dots it changes', () => {
    render(<NeglectMapWidget tab={TAB} />)
    const mounted = renders()
    const dotOf = (title: string) => [...document.querySelectorAll<HTMLElement>('[data-neglect-dot]')].find((d) => d.getAttribute('aria-label')?.startsWith(`${title}:`))!
    act(() => { fireEvent.click(dotOf(TITLES[1]!), { ctrlKey: true }) })
    expect(dotOf(TITLES[1]!).dataset.selected).toBe('true')
    const after = renders()
    // The clicked dot rendered again; the four others didn't.
    expect(after[1]).toBeGreaterThan(mounted[1]!)
    expect(after.filter((_, i) => i !== 1)).toEqual(mounted.filter((_, i) => i !== 1))
  })

  it('a drag cancelled (the pointer lost) removes the rectangle and selects nothing', () => {
    render(<NeglectMapWidget tab={TAB} />)
    fireEvent.pointerDown(chart(), at(0, 0))
    fireEvent.pointerMove(chart(), at(50, 50))
    expect(lasso()).not.toBeNull()
    fireEvent.pointerCancel(chart(), at(50, 50))
    expect(lasso()).toBeNull()
    expect(useUIStore.getState().selectionScope).not.toBe('map')
    // The next press starts afresh: a move under the threshold draws nothing.
    fireEvent.pointerDown(chart(), at(10, 10))
    fireEvent.pointerMove(chart(), at(12, 11))
    expect(lasso()).toBeNull()
  })
})
