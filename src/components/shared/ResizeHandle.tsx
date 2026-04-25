import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import { REACT_FLOW_NODE_SELECTOR } from '../../utils/react-flow-dom'

export type ResizeAxis = 'x' | 'y' | 'xy'

export interface ResizeHandleProps {
  axis: ResizeAxis
  width: number
  height: number
  minW?: number
  minH?: number
  className: string
  /**
   * CSS selector queried relative to the closest `.react-flow__node`. The
   * matched element receives `width` / `height` style writes during drag for
   * live preview (axis-aware — only the active dimensions are written).
   * Pass `undefined` and supply `onPreview` for non-default targets (e.g.
   * writing `maxHeight` to a body element, or updating two elements at once).
   */
  bodySelector?: string
  /**
   * Custom preview hook. Called continuously during drag with the current
   * (min-clamped) candidate dimensions. The caller writes DOM. May return
   * `{ w?, h? }` overrides that replace the raw values for both subsequent
   * preview frames and the eventual `onResize` commit — used for snapping.
   */
  onPreview?: (w: number, h: number) => { w?: number; h?: number } | void
  /** Fired on pointerup with the final (post-`onPreview`) dimensions. */
  onResize: (w: number, h: number) => void
  /** Fired on pointerup AND pointercancel after `onResize`. Used for cleanup like clearing alignment lines. */
  onEnd?: () => void
}

export function ResizeHandle({
  axis,
  width,
  height,
  minW = 0,
  minH = 0,
  className,
  bodySelector,
  onPreview,
  onResize,
  onEnd,
}: ResizeHandleProps) {
  const { getZoom } = useReactFlow()
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { cleanupRef.current?.() }, [])

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    cleanupRef.current?.()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    try { handle.setPointerCapture(pointerId) } catch { /* noop */ }

    const startX = e.clientX
    const startY = e.clientY
    const startW = width
    const startH = height
    const zoom = getZoom()
    const targetEl = bodySelector
      ? (handle.closest(REACT_FLOW_NODE_SELECTOR)?.querySelector(bodySelector) as HTMLElement | null)
      : null
    let active = true

    const compute = (clientX: number, clientY: number) => {
      let w = startW
      let h = startH
      if (axis !== 'y') w = Math.max(minW, startW + (clientX - startX) / zoom)
      if (axis !== 'x') h = Math.max(minH, startH + (clientY - startY) / zoom)
      return { w, h }
    }

    const adjust = (raw: { w: number; h: number }) => {
      if (onPreview) {
        const overrides = onPreview(raw.w, raw.h)
        return overrides ? { w: overrides.w ?? raw.w, h: overrides.h ?? raw.h } : raw
      }
      if (targetEl) {
        if (axis !== 'y') targetEl.style.width = `${raw.w}px`
        if (axis !== 'x') targetEl.style.height = `${raw.h}px`
      }
      return raw
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (!active) return
      adjust(compute(ev.clientX, ev.clientY))
    }

    const onPointerUp = (ev: PointerEvent) => {
      if (!active) return
      const final = adjust(compute(ev.clientX, ev.clientY))
      onResize(final.w, final.h)
      onEnd?.()
      cleanup()
    }

    const onPointerCancel = () => {
      if (!active) return
      onEnd?.()
      cleanup()
    }

    const cleanup = () => {
      active = false
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', onPointerUp)
      handle.removeEventListener('pointercancel', onPointerCancel)
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch { /* noop */ }
      cleanupRef.current = null
    }
    cleanupRef.current = cleanup
    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', onPointerUp)
    handle.addEventListener('pointercancel', onPointerCancel)
  }

  return <div className={className} onPointerDown={handlePointerDown} />
}
