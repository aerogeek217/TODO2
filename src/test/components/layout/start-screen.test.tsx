import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { StartScreen } from '../../../components/layout/StartScreen'
import { START_SCREEN_EXPLAIN_MS, startScreenCopy } from '../../../components/layout/start-screen'
import { useFileStorageStore } from '../../../services/file-storage-store'
import { FILE_LINK_TIMEOUT_MS, type SyncConflictInfo } from '../../../services/file-storage'
import { useUIStore } from '../../../stores/ui-store'
import type { LaunchStep } from '../../../services/app-startup'

// The start screen says nothing but Loading… until one part of launch has
// taken long; then it names that part and offers the ways out that are safe
// there. None of them touches a task.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent)
const explained = () => screen.getByTestId('start-screen').getAttribute('data-slow-step')

function stubActions() {
  const skip = vi.fn()
  const forget = vi.fn()
  useFileStorageStore.setState({ skipLaunchFile: skip, forgetLaunchFile: forget })
  return { skip, forget }
}

describe('StartScreen — the delay', () => {
  it('is longer than the sync file’s timed checks, so a check that times out goes on first', () => {
    expect(START_SCREEN_EXPLAIN_MS).toBeGreaterThan(FILE_LINK_TIMEOUT_MS)
  })

  it.each<[LaunchStep, string]>([
    ['database', 'Still opening the database…'],
    ['sync-file', 'Still checking the sync file…'],
    ['tasks', 'Still loading tasks…'],
  ])('%s: Loading… and nothing else before the delay; its step named after it', (step, title) => {
    render(<StartScreen step={step} />)
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)
    wait(START_SCREEN_EXPLAIN_MS - 1)
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)
    expect(buttons()).toEqual([])
    expect(explained()).toBeNull()

    wait(1)
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(title)
    expect(explained()).toBe(step)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('each step is timed from its own start', () => {
    const view = render(<StartScreen step="database" />)
    wait(START_SCREEN_EXPLAIN_MS - 1)
    view.rerender(<StartScreen step="sync-file" />)
    wait(START_SCREEN_EXPLAIN_MS - 1)
    expect(explained()).toBeNull()
    wait(1)
    expect(explained()).toBe('sync-file')
    // The next step starts quiet again.
    view.rerender(<StartScreen step="tasks" />)
    expect(explained()).toBeNull()
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)
  })
})

describe('StartScreen — the ways out', () => {
  it('opening the database and loading tasks: Reload only', () => {
    for (const step of ['database', 'tasks'] as const) {
      useFileStorageStore.setState({ launchWait: 'link' })
      render(<StartScreen step={step} />)
      wait(START_SCREEN_EXPLAIN_MS)
      expect(buttons()).toEqual(['Reload'])
      cleanup()
    }
  })

  it('the sync file, while launch waits for the browser: Reload, Forget the sync file…, Continue without the file', () => {
    const { skip, forget } = stubActions()
    useFileStorageStore.setState({ launchWait: 'file' })
    render(<StartScreen step="sync-file" />)
    wait(START_SCREEN_EXPLAIN_MS)
    expect(buttons()).toEqual(['Reload', 'Forget the sync file…', 'Continue without the file'])
    expect(screen.getByRole('status')).toHaveTextContent('nothing is written to the file')

    fireEvent.click(screen.getByRole('button', { name: 'Continue without the file' }))
    expect(skip).toHaveBeenCalledTimes(1)
    expect(forget).not.toHaveBeenCalled()
  })

  it('Forget the sync file… asks first, saying the tasks and the file stay; Cancel is the default and forgets nothing', () => {
    const { skip, forget } = stubActions()
    useFileStorageStore.setState({ launchWait: 'permission' })
    render(<StartScreen step="sync-file" />)
    wait(START_SCREEN_EXPLAIN_MS)

    fireEvent.click(screen.getByRole('button', { name: 'Forget the sync file…' }))
    const confirm = screen.getByRole('dialog', { name: 'Forget the sync file?' })
    expect(confirm).toHaveTextContent('Your tasks and the file itself stay as they are.')
    expect(forget).not.toHaveBeenCalled()
    const cancel = screen.getByRole('button', { name: /Cancel/ })
    expect(cancel).toHaveFocus()
    fireEvent.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(forget).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Forget the sync file…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forget the sync file' }))
    expect(forget).toHaveBeenCalledTimes(1)
    expect(skip).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the sync file, once the browser answered (its data is being loaded): Reload only, and an open confirm closes', () => {
    stubActions()
    useFileStorageStore.setState({ launchWait: 'file' })
    render(<StartScreen step="sync-file" />)
    wait(START_SCREEN_EXPLAIN_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Forget the sync file…' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => { useFileStorageStore.setState({ launchWait: null }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(buttons()).toEqual(['Reload'])
    expect(screen.getByRole('status')).toHaveTextContent('TODO2 is loading the sync file’s data.')
  })

  it('no step’s words or actions speak of deleting anything', () => {
    for (const step of ['database', 'sync-file', 'tasks'] as const) {
      for (const waiting of [true, false]) {
        const copy = startScreenCopy(step, waiting)
        expect(`${copy.title} ${copy.body}`).not.toMatch(/delet|clear|reset|eras/i)
        expect(copy.actions).toContain('reload')
        if (step !== 'sync-file' || !waiting) expect(copy.actions).toEqual(['reload'])
      }
    }
  })
})

describe('StartScreen — while a question is up', () => {
  it('the launch question: blank, however long it waits', () => {
    useFileStorageStore.setState({ pendingLaunchPermission: { fileName: 'todo2.json', phase: 'ask' } })
    render(<StartScreen step="sync-file" />)
    wait(START_SCREEN_EXPLAIN_MS * 3)
    expect(screen.getByTestId('start-screen')).toBeEmptyDOMElement()
  })

  it('a sync conflict or a confirm prompt: the spinner alone; the wait after the answer is timed anew', () => {
    useFileStorageStore.setState({ pendingConflict: { fileName: 'todo2.json' } as SyncConflictInfo })
    render(<StartScreen step="sync-file" />)
    wait(START_SCREEN_EXPLAIN_MS * 3)
    expect(explained()).toBeNull()
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)

    act(() => { useFileStorageStore.setState({ pendingConflict: null }) })
    wait(START_SCREEN_EXPLAIN_MS - 1)
    expect(explained()).toBeNull()
    wait(1)
    expect(explained()).toBe('sync-file')

    // A question asked once the step was already slow: quiet again, and anew after it.
    act(() => { void useUIStore.getState().askConfirmation({ title: 'Continue without a backup?', message: 'm', confirmLabel: 'Continue' }) })
    expect(explained()).toBeNull()
    act(() => { useUIStore.getState().answerConfirmation(false) })
    expect(explained()).toBeNull()
    wait(START_SCREEN_EXPLAIN_MS)
    expect(explained()).toBe('sync-file')
  })
})
