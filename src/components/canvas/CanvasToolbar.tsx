import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import type { RailSide } from '../../models/canvas-rails'
import styles from './CanvasToolbar.module.css'

const RAIL_SIDES: readonly RailSide[] = ['left', 'right', 'top', 'bottom']

/**
 * Lower-left floating canvas toolbar (T5 of triage-2026-04-26). Provides:
 * - Fit-all-to-view: dispatches the same `canvas-fit-view` CustomEvent that
 *   `App.fitView` (Ctrl+0) and the command palette use; CanvasPage owns the
 *   listener and calls `rfInstance.fitView`.
 * - Collapse / Expand all rails: previously lived in `Sidebar.bottomIcons`;
 *   moved here so the canvas owns canvas-scoped actions and the sidebar stays
 *   limited to view nav + theme + settings.
 */
export function CanvasToolbar() {
  const rails = useCanvasRailsStore((s) => s.rails)
  const setAllRailsCollapsed = useCanvasRailsStore((s) => s.setAllRailsCollapsed)

  const presentSides = RAIL_SIDES.filter((side) => rails[side] != null)
  const hasAnyRail = presentSides.length > 0
  const allCollapsed = hasAnyRail && presentSides.every((side) => rails.collapsed?.[side] === true)

  const handleFitView = () => {
    window.dispatchEvent(new CustomEvent('canvas-fit-view'))
  }

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Canvas toolbar">
      <button
        type="button"
        className={styles.button}
        onClick={handleFitView}
        title="Fit all to view"
        aria-label="Fit all to view"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 8 4 4 8 4" />
          <polyline points="20 8 20 4 16 4" />
          <polyline points="4 16 4 20 8 20" />
          <polyline points="20 16 20 20 16 20" />
        </svg>
      </button>
      {hasAnyRail && (
        <button
          type="button"
          className={styles.button}
          onClick={() => setAllRailsCollapsed(!allCollapsed)}
          title={allCollapsed ? 'Expand all rails' : 'Collapse all rails'}
          aria-label={allCollapsed ? 'Expand all rails' : 'Collapse all rails'}
        >
          {allCollapsed ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="10" y1="10" x2="3" y2="3" />
              <polyline points="3 7 3 3 7 3" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <polyline points="21 7 21 3 17 3" />
              <line x1="10" y1="14" x2="3" y2="21" />
              <polyline points="3 17 3 21 7 21" />
              <line x1="14" y1="14" x2="21" y2="21" />
              <polyline points="21 17 21 21 17 21" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="3" x2="10" y2="10" />
              <polyline points="10 6 10 10 6 10" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <polyline points="14 6 14 10 18 10" />
              <line x1="3" y1="21" x2="10" y2="14" />
              <polyline points="10 18 10 14 6 14" />
              <line x1="21" y1="21" x2="14" y2="14" />
              <polyline points="14 18 14 14 18 14" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}
