import { useScreenTaskCounts } from '../../hooks/use-screen-task-count'
import { useAppliedLens } from '../../stores/screen-filter'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { SHOW_FILTERED_TASKS_ATTR } from '../../utils/dom-contract'
import { useTooltip } from '../shared/use-tooltip'
import { shownOfTotalText } from '../shared/filters/lens-text'
import styles from './TopBar.module.css'

/**
 * The end of the top bar's filter tray while a chip or the layout's lens
 * hides tasks (and while its panel is open): what they keep of every open
 * task (completed ones too under Show completed), `61 of 109` — red with the
 * tray while a chip is on, neutral with the lens alone. A click opens or
 * closes the filtered-tasks panel under the tray, whose filter the tray
 * edits. Its own component, so only it renders for a task write.
 */
export function ShowFilteredTasksButton({ open }: { open: boolean }) {
  const { shown, total, lensKeeps } = useScreenTaskCounts()
  const lens = useAppliedLens()
  const showCompleted = useFilterStore((s) => s.filters.showCompleted)
  const words = shownOfTotalText(shown, total, showCompleted)
  const detail = lens
    ? `${lens.name} hides ${total - lensKeeps} · click to list the ${shown}`
    : `Click to list the ${shown}`
  const { triggerProps, tooltip } = useTooltip(open ? null : `${words}\n${detail}`, { labelLines: 1 })
  return (
    <>
      <span className={styles.showTasksSeparator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.showTasks} ${open ? styles.showTasksOpen : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${words}. Show them`}
        onClick={() => {
          const ui = useUIStore.getState()
          if (open) ui.closeFilterPanel()
          else ui.openFilterPanel()
        }}
        {...{ [SHOW_FILTERED_TASKS_ATTR]: '' }}
        {...triggerProps}
      >
        <span className={styles.showTasksShown}>{shown}</span>
        <span className={styles.showTasksOf}>of {total}</span>
      </button>
      {tooltip}
    </>
  )
}
