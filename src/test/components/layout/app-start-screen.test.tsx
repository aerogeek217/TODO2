import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import type { LaunchStep } from '../../../services/app-startup'

// The app's two launch gates — the version check, then `runAppStartup` —
// both show the start screen, which names the part under way once it has
// taken long. Here neither gate ever finishes on its own.

const gate = vi.hoisted(() => ({
  versionChecked: null as null | (() => void),
  onStep: null as null | ((step: LaunchStep) => void),
}))

vi.mock('../../../services/migration-check', () => ({
  checkTooOldDB: () => new Promise<null>((resolve) => { gate.versionChecked = () => resolve(null) }),
  checkTooNewDB: () => Promise.resolve(null),
}))

vi.mock('../../../services/app-startup', () => ({
  runAppStartup: (opts: { onStep?: (step: LaunchStep) => void }) => {
    gate.onStep = opts.onStep ?? null
    opts.onStep?.('database')
    return new Promise(() => {})
  },
}))

const { default: App } = await import('../../../App')
const { START_SCREEN_EXPLAIN_MS } = await import('../../../components/layout/start-screen')
const { useFileStorageStore } = await import('../../../services/file-storage-store')

beforeEach(() => {
  gate.versionChecked = null
  gate.onStep = null
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent)

describe('App — the start screen at each launch gate', () => {
  it('the version check that never answers: Loading…, then the database step named, Reload only', () => {
    render(<App />)
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)
    wait(START_SCREEN_EXPLAIN_MS - 1)
    expect(buttons()).toEqual([])
    wait(1)
    expect(screen.getByRole('heading', { name: 'Still opening the database…' })).toBeInTheDocument()
    expect(buttons()).toEqual(['Reload'])
  })

  it('launch itself: the step it reports is the one named, with that step’s ways out', async () => {
    const skip = vi.fn()
    useFileStorageStore.setState({ skipLaunchFile: skip })
    render(<App />)
    await act(async () => { gate.versionChecked?.() })
    expect(gate.onStep).not.toBeNull()
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)

    // The database opened quickly; the sync file's step then never ends.
    wait(START_SCREEN_EXPLAIN_MS - 1)
    act(() => {
      gate.onStep?.('sync-file')
      useFileStorageStore.setState({ launchWait: 'file' })
    })
    wait(START_SCREEN_EXPLAIN_MS - 1)
    expect(buttons()).toEqual([])
    wait(1)
    expect(screen.getByRole('heading', { name: 'Still checking the sync file…' })).toBeInTheDocument()
    expect(buttons()).toEqual(['Reload', 'Forget the sync file…', 'Continue without the file'])
    fireEvent.click(screen.getByRole('button', { name: 'Continue without the file' }))
    expect(skip).toHaveBeenCalledTimes(1)

    // On to the stores: quiet again, then its own words.
    act(() => {
      gate.onStep?.('tasks')
      useFileStorageStore.setState({ launchWait: null })
    })
    expect(screen.getByTestId('start-screen')).toHaveTextContent(/^Loading…$/)
    wait(START_SCREEN_EXPLAIN_MS)
    expect(screen.getByRole('heading', { name: 'Still loading tasks…' })).toBeInTheDocument()
    expect(buttons()).toEqual(['Reload'])
  })
})
