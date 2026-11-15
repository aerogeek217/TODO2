import { describe, it, expect, vi, afterEach } from 'vitest'
import { transitionName, viewTransition, withViewTransition } from '../../../components/shared/view-transition'

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition')
  vi.unstubAllGlobals()
})

describe('withViewTransition (D19)', () => {
  it('without the API the change just happens', () => {
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('with the API the change runs inside a transition', async () => {
    stubReducedMotion(false)
    const update = vi.fn()
    const start = vi.fn((cb: () => Promise<void>) => cb())
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    withViewTransition(update)
    expect(start).toHaveBeenCalledTimes(1)
    await start.mock.results[0]!.value
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('under reduced motion no transition starts: a plain swap', () => {
    stubReducedMotion(true)
    const update = vi.fn()
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    withViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })

  // cr34 H4: a caller with work to do after the change shows (a layout switch) waits on `viewTransition`.
  it('viewTransition resolves once the change has run inside the transition, not before', async () => {
    stubReducedMotion(false)
    const order: string[] = []
    let run: () => Promise<void> = async () => {}
    const start = vi.fn((cb: () => Promise<void>) => { run = cb })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    const done = viewTransition(() => { order.push('update') }).then(() => { order.push('resolved') })
    await Promise.resolve()
    expect(order).toEqual([])
    await run()
    await done
    expect(order).toEqual(['update', 'resolved'])
  })

  it('viewTransition resolves even when the change throws (the error stays the transition’s)', async () => {
    stubReducedMotion(false)
    let failed: unknown
    const start = vi.fn((cb: () => Promise<void>) => { cb().catch((err: unknown) => { failed = err }) })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    await viewTransition(() => { throw new Error('boom') })
    await Promise.resolve()
    expect(failed).toEqual(new Error('boom'))
  })

  it('viewTransition without the API runs the change at once and resolves', async () => {
    const update = vi.fn()
    const done = viewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    await expect(done).resolves.toBeUndefined()
  })

  it('names are custom idents built from the ids', () => {
    expect(transitionName('ws-cell', 'cell-1')).toBe('ws-cell-cell-1')
    expect(transitionName('ws-group', 't 1', 'status:3')).toBe('ws-group-t_1-status_3')
  })
})
