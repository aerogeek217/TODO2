import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type RefObject } from 'react'
import type { LayoutTab } from '../../../models/workspace-layout'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { widgetElement } from '../../../utils/dom-contract'
import { getTab } from '../../../utils/workspace-layout-queries'
import { numberViews } from '../../../utils/number-views'

/** What a widget editor takes from its host. */
interface WidgetEditorProps<T extends LayoutTab> {
  tab: T
  /** The element it opens beside (found on screen). */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * The host of an open widget editor — the Number's, a chart's, Created vs
 * completed's: `tabId` (the store's open editor) names a
 * tab of the open layout that `isKind` accepts, and the editor opens beside
 * the widget's `anchor` element (`[data-number-body="<tab id>"]`, …), looked
 * for now and over the next 30 frames while the widget mounts (a new one, a
 * tab just shown), and again when the layout or the editor's live preview
 * changes (either may draw it anew). Hosted by the workspace page outside the
 * widget tree, so no key or press in the editor reaches the cell's handlers
 * (React events bubble through portals). It closes (`close`) when the tab
 * leaves the layout, and when the host goes (a route change).
 */
export function WidgetEditorHost<T extends LayoutTab>({ tabId, isKind, anchor, close, Editor }: {
  tabId: string | null
  isKind: (tab: LayoutTab) => tab is T
  /** The data attribute the widget marks its anchor with — or several, the first found on screen taken. */
  anchor: `data-${string}` | ReadonlyArray<`data-${string}`>
  close: () => void
  Editor: ComponentType<WidgetEditorProps<T>>
}) {
  const tab = useWorkspaceStore((s) => {
    // TEMPORARY (`utils/number-views`): a Number's editor finds its view, under the Number's id.
    const found = tabId != null && s.working ? getTab(numberViews(s.working), tabId) : undefined
    return found && isKind(found) ? found : undefined
  })
  const working = useWorkspaceStore((s) => s.working)
  const preview = useWidgetPreviewStore((s) => (tabId != null ? s.configs[tabId] : undefined))
  const anchorRef = useRef<HTMLElement | null>(null)
  const [found, setFound] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!tab) return
    let frames = 0
    let raf = 0
    const look = () => {
      const attrs = typeof anchor === 'string' ? [anchor] : anchor
      let el: HTMLElement | null = null
      for (const attr of attrs) {
        el = widgetElement(tab.id, `[${attr}="${CSS.escape(tab.id)}"]`)
        if (el) break
      }
      anchorRef.current = el
      setFound(el ? tab.id : null)
      if (!el && ++frames < 30) raf = requestAnimationFrame(look)
    }
    look()
    return () => cancelAnimationFrame(raf)
  }, [tab, working, preview, anchor])
  useEffect(() => {
    if (tabId != null && !tab) close()
  }, [tabId, tab, close])
  useEffect(() => () => close(), [close])
  if (!tab || found !== tab.id) return null
  return <Editor key={tab.id} tab={tab} anchorRef={anchorRef} onClose={close} />
}
