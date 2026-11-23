import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { TallyMarks } from '../../../components/layout/TallyMarks'
import { ThemeSection } from '../../../components/settings/sections/ThemeSection'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'
import { makeTodo, resetDb } from '../../helpers'

/**
 * The top bar's tally (flair P3): drawn in the measured gap between the
 * tray and the right zone, one mark per task completed today; the newest
 * scratches in only when the count rises while shown; off by its setting.
 */

/** Each element's box from its `data-box="left,right"` (viewport px); others' as JSDOM gives. */
const jsdomBox = HTMLElement.prototype.getBoundingClientRect
function stubBoxes() {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const box = this.dataset.box?.split(',').map(Number)
    if (!box) return jsdomBox.call(this)
    const [left = 0, right = 0] = box
    return { left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) }
  }
}

/** A bar 1000px wide: the tray ending at `trayRight`, the right zone starting at 900. */
function Bar({ trayRight }: { trayRight: number }) {
  const bar = useRef<HTMLElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const tray = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  return (
    <header ref={bar} data-box="0,1000">
      <div ref={spacer} data-box="100,200" />
      <div ref={tray} data-box={`200,${trayRight}`} />
      <TallyMarks barRef={bar} spacerRef={spacer} trayRef={tray} rightRef={right} />
      <div ref={right} data-box="900,1000" />
    </header>
  )
}

const todayAt = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d }
const done = (n: number) => Array.from({ length: n }, (_, i) => makeTodo({ id: i + 1, title: `T${i}`, isCompleted: true, completedAt: todayAt(0) }))
const marks = () => Array.from(document.querySelectorAll('[data-tally] path'))
const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })

beforeEach(async () => {
  stubBoxes()
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  HTMLElement.prototype.getBoundingClientRect = jsdomBox
})

describe('TallyMarks', () => {
  it('nothing done today: nothing drawn', async () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Open' })] })
    render(<Bar trayRight={600} />)
    await frame()
    expect(document.querySelector('[data-tally]')).toBeNull()
  })

  it('a mark per task done today, after the tray, named by the count; none scratches in on load', async () => {
    useTodoStore.setState({ todos: done(7) })
    render(<Bar trayRight={600} />)
    await frame()
    const tally = document.querySelector<HTMLElement>('[data-tally]')
    expect(tally?.style.left).toBe('610px')
    expect(screen.getByRole('button', { name: '7 done today. Show them' })).toBeInTheDocument()
    expect(marks()).toHaveLength(7)
    expect(marks().some((p) => /fresh/.test(p.getAttribute('class') ?? ''))).toBe(false)
  })

  it('a click lists today’s tasks in the task dialog', async () => {
    useTodoStore.setState({ todos: done(3) })
    render(<Bar trayRight={600} />)
    await frame()
    fireEvent.click(screen.getByRole('button', { name: '3 done today. Show them' }))
    const dialog = useUIStore.getState().taskDialog
    expect(dialog?.title).toBe('Done today')
    expect(dialog?.source).toEqual({ kind: 'todos', todoIds: expect.arrayContaining(done(3).map((t) => t.id)) })
  })

  it('a task completed while shown scratches in its mark; a reopen takes one away at once', async () => {
    useTodoStore.setState({ todos: done(4) })
    render(<Bar trayRight={600} />)
    await frame()
    act(() => useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 9, title: 'New', isCompleted: true, completedAt: todayAt(1) })] }))
    expect(marks()).toHaveLength(5)
    expect(marks().at(-1)?.getAttribute('class')).toMatch(/fresh/)
    act(() => useTodoStore.setState({ todos: useTodoStore.getState().todos.slice(0, 3) }))
    expect(marks()).toHaveLength(3)
    expect(marks().some((p) => /fresh/.test(p.getAttribute('class') ?? ''))).toBe(false)
  })

  it('no room for one group between the tray and the right zone: nothing', async () => {
    useTodoStore.setState({ todos: done(3) })
    render(<Bar trayRight={880} />)
    await frame()
    expect(document.querySelector('[data-tally]')).toBeNull()
  })

  it('off in Settings: nothing', async () => {
    useTodoStore.setState({ todos: done(3) })
    useSettingsStore.setState({ tallyMarks: false })
    render(<Bar trayRight={600} />)
    await frame()
    expect(document.querySelector('[data-tally]')).toBeNull()
  })
})

describe('Appearance › Theme: Tally of today’s tasks', () => {
  it('on by default; off is stored, on again removes the row', async () => {
    render(<ThemeSection />)
    const sw = screen.getByRole('switch', { name: 'Tally of today’s tasks' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    await waitFor(() => expect(useSettingsStore.getState().tallyMarks).toBe(false))
    await waitFor(async () => expect((await db.settings.get('tallyMarks'))?.value).toBe('false'))
    fireEvent.click(sw)
    await waitFor(async () => expect(await db.settings.get('tallyMarks')).toBeUndefined())
  })
})
