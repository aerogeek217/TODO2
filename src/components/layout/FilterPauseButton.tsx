import { useFilterStore } from '../../stores/filter-store'
import { FunnelIcon, FunnelOffIcon } from '../shared/icons'
import { useTooltip } from '../shared/use-tooltip'
import topBarStyles from './TopBar.module.css'
import styles from './FilterPause.module.css'

/** The funnel's tooltip while the filter applies. */
const PAUSE_FILTER_TIP = 'Pause the filter: show every task · click again to resume'
/** …and while it is paused. */
const RESUME_FILTER_TIP = 'Resume the filter'

/**
 * The tray's funnel, at its left (feedback 2026-11-15): a pause toggle. Red
 * while a screen filter is on — chips, the typed expression, text, Show
 * completed —; a click pauses it (`filter-store.paused`: the filter stays,
 * nothing applies it, every widget shows every task) and the funnel is
 * slashed, unfilled, in a softer red ring; a click again resumes it. Dim
 * and inert with no filter. A toggle button: `Pause the filter`, pressed
 * while paused. Clearing is the field's × and the Filter menu's.
 */
export function FilterPauseButton({ active }: { active: boolean }) {
  const paused = useFilterStore((s) => s.paused)
  const { triggerProps, tooltip } = useTooltip(active ? (paused ? RESUME_FILTER_TIP : PAUSE_FILTER_TIP) : null)
  return (
    <>
      <button
        type="button"
        className={`${topBarStyles.funnel} ${paused ? styles.paused : ''}`}
        aria-label="Pause the filter"
        aria-pressed={active ? paused : undefined}
        disabled={!active}
        onClick={() => useFilterStore.getState().setPaused(!paused)}
        data-filter-pause=""
        data-paused={paused || undefined}
        {...triggerProps}
      >
        {paused ? <FunnelOffIcon size={14} /> : <FunnelIcon size={14} />}
      </button>
      {tooltip}
    </>
  )
}
