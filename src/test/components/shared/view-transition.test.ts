import { describe, it, expect, vi, afterEach } from 'vitest'
import { transitionName, withViewTransition } from '../../../components/shared/view-transition'

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

  it('names are custom idents built from the ids', () => {
    expect(transitionName('ws-cell', 'cell-1')).toBe('ws-cell-cell-1')
    expect(transitionName('ws-group', 't 1', 'status:3')).toBe('ws-group-t_1-status_3')
  })
})
