import { createContext, useContext, useLayoutEffect } from 'react'
import { widgetFaceFor, type WidgetFace } from '../utils/widget-face'
import { useElementSize } from './use-element-size'

/**
 * What the cell a widget renders in tells its face (D25 R), and hears back.
 * Outside a cell (a test, a dialog) every field is absent: the face is the
 * body's measured one.
 */
export interface WidgetFaceHost {
  /** Render at this face whatever the size: the small face's popover (`large`), a fit row (`small`). */
  forced?: WidgetFace
  /** The body's height is its content's (a phone cell that isn't a page): the face goes by the width alone. */
  heightFree?: boolean
  /** Hears the face the widget shows (the click that opens the full widget). */
  onFace?: (face: WidgetFace) => void
  /** Opens the full widget over the cell (a face's "+N more"); absent where there is none. */
  openFull?: () => void
}

const NO_HOST: WidgetFaceHost = {}

/** The face host of the widget rendered inside (`WorkspaceCell`, `MobileCell`, the face popover). */
export const WidgetFaceContext = createContext<WidgetFaceHost>(NO_HOST)

/**
 * The face (D25 R) of the widget whose body gets the returned callback ref:
 * `small` / `medium` / `large` from the body's measured size, kept current as
 * the cell resizes (`utils/widget-face.widgetFaceFor`) — or the face its
 * host forces (`WidgetFaceContext`). The host hears every face it settles on.
 * `faceFor`: a widget's own thresholds (the Review widget's, item 12).
 */
export function useWidgetFace(faceFor: FaceFor = widgetFaceFor): [(el: HTMLElement | null) => void, WidgetFace] {
  const host = useContext(WidgetFaceContext)
  const [ref, size] = useElementSize()
  const face = host.forced ?? hostedFace(size, host, faceFor)
  const onFace = host.onFace
  // Before paint, so the cell's small-face click follows in the same frame.
  useLayoutEffect(() => { onFace?.(face) }, [face, onFace])
  return [ref, face]
}

/** The face for a body's size. */
type FaceFor = (size: { width: number; height: number }) => WidgetFace

/** The face of a body of `size` in `host` (unmeasured is `large`). */
export function hostedFace(size: { width: number; height: number }, host: Pick<WidgetFaceHost, 'heightFree'>, faceFor: FaceFor = widgetFaceFor): WidgetFace {
  if (size.width <= 0 && size.height <= 0) return 'large'
  const height = host.heightFree ? Number.POSITIVE_INFINITY : size.height
  return faceFor({ width: size.width, height })
}

/** Opens the full widget over its cell, where the host has one (`WidgetFaceHost.openFull`). */
export function useOpenFullWidget(): (() => void) | undefined {
  return useContext(WidgetFaceContext).openFull
}
