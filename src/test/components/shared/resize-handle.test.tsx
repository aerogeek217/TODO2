import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { ResizeHandle } from '../../../components/shared/ResizeHandle'

// jsdom doesn't implement setPointerCapture / hasPointerCapture / releasePointerCapture
// on Element. Polyfill them as no-ops so the primitive's pointer-capture path
// runs without throwing.
beforeEach(() => {
  if (!Element.prototype.setPointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Element.prototype as any).setPointerCapture = function () { /* noop */ }
  }
  if (!Element.prototype.hasPointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Element.prototype as any).hasPointerCapture = function () { return false }
  }
  if (!Element.prototype.releasePointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Element.prototype as any).releasePointerCapture = function () { /* noop */ }
  }
})

afterEach(() => {
  cleanup()
})

function Wrapper({ children }: { children: ReactNode }) {
  // Resolves the `useReactFlow` hook used inside `<ResizeHandle>` for `getZoom`.
  return <ReactFlowProvider>{children}</ReactFlowProvider>
}

function firePointerDown(el: Element, clientX: number, clientY: number) {
  fireEvent.pointerDown(el, {
    pointerId: 1, isPrimary: true, button: 0, bubbles: true, clientX, clientY,
  })
}

function firePointerMoveOnHandle(el: Element, clientX: number, clientY: number) {
  // The primitive listens on the handle element directly (pointer capture);
  // window pointermove never fires onMove. Use a real PointerEvent dispatch
  // so the captured listener picks it up.
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX, clientY, bubbles: true }))
}

function firePointerUpOnHandle(el: Element, clientX: number, clientY: number) {
  el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX, clientY, bubbles: true }))
}

describe('<ResizeHandle>', () => {
  it('clamps width to minW on the X axis (default DOM-write path)', () => {
    const onResize = vi.fn()
    const { container } = render(
      <Wrapper>
        <div className="parent">
          {/* The primitive walks `closest('.react-flow__node')` for the body
              selector. Add a marker class so the test target resolves. */}
          <div className="react-flow__node">
            <div className="body" style={{ width: 200, height: 100 }} />
            <ResizeHandle
              axis="x"
              width={200}
              height={100}
              minW={150}
              className="rh"
              bodySelector=".body"
              onResize={onResize}
            />
          </div>
        </div>
      </Wrapper>,
    )
    const handle = container.querySelector('.rh')!
    firePointerDown(handle, 100, 50)
    // Drag far left of start — raw width would be 200 + (-200/zoom1) = 0;
    // the floor clamps to minW=150.
    firePointerUpOnHandle(handle, -100, 50)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(150, 100)
  })

  it('clamps height to minH on the Y axis', () => {
    const onResize = vi.fn()
    const { container } = render(
      <Wrapper>
        <div className="react-flow__node">
          <div className="body" style={{ width: 200, height: 200 }} />
          <ResizeHandle
            axis="y"
            width={200}
            height={200}
            minH={120}
            className="rh"
            bodySelector=".body"
            onResize={onResize}
          />
        </div>
      </Wrapper>,
    )
    const handle = container.querySelector('.rh')!
    firePointerDown(handle, 50, 100)
    firePointerUpOnHandle(handle, 50, -100)
    expect(onResize).toHaveBeenCalledWith(200, 120)
  })

  it('writes width + height live to bodySelector during pointermove', () => {
    const { container } = render(
      <Wrapper>
        <div className="react-flow__node">
          <div className="body" style={{ width: 200, height: 200 }} />
          <ResizeHandle
            axis="xy"
            width={200}
            height={200}
            minW={100}
            minH={100}
            className="rh"
            bodySelector=".body"
            onResize={() => {}}
          />
        </div>
      </Wrapper>,
    )
    const handle = container.querySelector('.rh')!
    const body = container.querySelector('.body') as HTMLElement
    firePointerDown(handle, 0, 0)
    firePointerMoveOnHandle(handle, 50, 30)
    expect(body.style.width).toBe('250px')
    expect(body.style.height).toBe('230px')
    firePointerUpOnHandle(handle, 50, 30)
  })

  it('threads onPreview-returned overrides into onResize (snap)', () => {
    const onResize = vi.fn()
    const onPreview = vi.fn().mockReturnValue({ w: 400 })
    const { container } = render(
      <Wrapper>
        <div className="react-flow__node">
          <ResizeHandle
            axis="x"
            width={300}
            height={100}
            className="rh"
            onPreview={onPreview}
            onResize={onResize}
          />
        </div>
      </Wrapper>,
    )
    const handle = container.querySelector('.rh')!
    firePointerDown(handle, 100, 50)
    firePointerUpOnHandle(handle, 250, 50)
    // Raw width = 300 + 150 = 450. onPreview override 400 wins.
    expect(onResize).toHaveBeenCalledWith(400, 100)
  })

  it('does not attach window pointer listeners (pointer capture on handle only)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { container } = render(
      <Wrapper>
        <div className="react-flow__node">
          <div className="body" />
          <ResizeHandle
            axis="xy"
            width={200}
            height={200}
            className="rh"
            bodySelector=".body"
            onResize={() => {}}
          />
        </div>
      </Wrapper>,
    )
    const handle = container.querySelector('.rh')!
    firePointerDown(handle, 0, 0)
    const windowMoves = addSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((e) => e === 'pointermove' || e === 'pointerup' || e === 'mousemove' || e === 'mouseup')
    expect(windowMoves.length).toBe(0)
    firePointerUpOnHandle(handle, 0, 0)
    addSpy.mockRestore()
  })

  it('fires onEnd after onResize on pointerup', () => {
    const onResize = vi.fn()
    const onEnd = vi.fn()
    const { container } = render(
      <Wrapper>
        <div className="react-flow__node">
          <ResizeHandle
            axis="x"
            width={200}
            height={100}
            className="rh"
            onResize={onResize}
            onEnd={onEnd}
          />
        </div>
      </Wrapper>,
    )
    const handle = container.querySelector('.rh')!
    firePointerDown(handle, 50, 50)
    firePointerUpOnHandle(handle, 100, 50)
    expect(onResize).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledOnce()
    // onEnd ordering: after onResize.
    expect(onEnd.mock.invocationCallOrder[0])
      .toBeGreaterThan(onResize.mock.invocationCallOrder[0])
  })
})
