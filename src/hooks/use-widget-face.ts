import { widgetFaceFor, type WidgetFace } from '../utils/widget-face'
import { useElementSize } from './use-element-size'

/**
 * The face (D25 R) of the widget whose body gets the returned callback ref:
 * `small` / `medium` / `large` from the body's measured size, kept current as
 * the cell resizes (`utils/widget-face.widgetFaceFor`).
 */
export function useWidgetFace(): [(el: HTMLElement | null) => void, WidgetFace] {
  const [ref, size] = useElementSize()
  return [ref, widgetFaceFor(size)]
}
