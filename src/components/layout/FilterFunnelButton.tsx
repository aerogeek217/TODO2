import { clearFilterWithUndo } from '../../services/screen-filter-clear'
import { FunnelIcon } from '../shared/icons'
import { useTooltip } from '../shared/use-tooltip'
import topBarStyles from './TopBar.module.css'

/** The funnel's name and tooltip while a filter is on. */
const CLEAR_FILTER_LABEL = 'Clear the filter'

/**
 * The tray's funnel, at its left: red while a screen filter is on, and a
 * click clears it (`clearFilterWithUndo`). Dim and inert with no filter.
 * Pausing is the field's own toggle at its right end (`TopBarFilterField`).
 */
export function FilterFunnelButton({ active }: { active: boolean }) {
  const { triggerProps, tooltip } = useTooltip(active ? CLEAR_FILTER_LABEL : null)
  return (
    <>
      <button
        type="button"
        className={topBarStyles.funnel}
        aria-label={CLEAR_FILTER_LABEL}
        disabled={!active}
        onClick={clearFilterWithUndo}
        data-clear-filters=""
        {...triggerProps}
      >
        <FunnelIcon size={14} />
      </button>
      {tooltip}
    </>
  )
}
