import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { hostedFace, useOpenFullWidget, useWidgetFace, WidgetFaceContext, type WidgetFaceHost } from '../../hooks/use-widget-face'
import type { WidgetFace } from '../../utils/widget-face'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Every element measures `width` × `height` (JSDOM lays nothing out). */
function stubSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
}

function Probe({ seen }: { seen: (face: WidgetFace, open: (() => void) | undefined) => void }) {
  const [ref, face] = useWidgetFace()
  seen(face, useOpenFullWidget())
  return <div ref={ref} data-face={face} />
}

function renderIn(host: WidgetFaceHost) {
  let last: WidgetFace | null = null
  let open: (() => void) | undefined
  render(
    <WidgetFaceContext.Provider value={host}>
      <Probe seen={(f, o) => { last = f; open = o }} />
    </WidgetFaceContext.Provider>,
  )
  return { face: () => last, open: () => open }
}

describe('hostedFace', () => {
  it('unmeasured is large; otherwise widgetFaceFor', () => {
    expect(hostedFace({ width: 0, height: 0 }, {})).toBe('large')
    expect(hostedFace({ width: 400, height: 80 }, {})).toBe('small')
    expect(hostedFace({ width: 400, height: 140 }, {})).toBe('medium')
    expect(hostedFace({ width: 400, height: 400 }, {})).toBe('large')
  })

  it('a header lent to the body is taken off its height first', () => {
    expect(hostedFace({ width: 400, height: 112 }, {})).toBe('medium')
    expect(hostedFace({ width: 400, height: 112 }, { heightAllowancePx: 32 })).toBe('small')
  })

  it('a body sized to its content goes by its width alone', () => {
    expect(hostedFace({ width: 400, height: 60 }, { heightFree: true })).toBe('large')
    expect(hostedFace({ width: 160, height: 600 }, { heightFree: true })).toBe('small')
  })
})

describe('useWidgetFace', () => {
  it('outside a host: the measured face', () => {
    stubSize(400, 80)
    const probe = renderIn({})
    expect(probe.face()).toBe('small')
    expect(probe.open()).toBeUndefined()
  })

  it('a forced face wins over the measured one', () => {
    stubSize(400, 80)
    expect(renderIn({ forced: 'large' }).face()).toBe('large')
  })

  it('the host hears every face it settles on, and offers its full widget', () => {
    stubSize(400, 140)
    const onFace = vi.fn()
    const openFull = vi.fn()
    const probe = renderIn({ onFace, openFull })
    expect(probe.face()).toBe('medium')
    expect(onFace).toHaveBeenLastCalledWith('medium')
    probe.open()?.()
    expect(openFull).toHaveBeenCalledTimes(1)
  })
})
