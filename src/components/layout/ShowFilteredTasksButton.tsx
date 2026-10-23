import { useScreenTaskCount } from '../../hooks/use-screen-task-count'
import { showTasksLabel } from '../../services/task-dialog'
import { useUIStore } from '../../stores/ui-store'
import { SHOW_FILTERED_TASKS_ATTR } from '../../utils/dom-contract'
import { useTooltip } from '../shared/use-tooltip'
import styles from './TopBar.module.css'

/**
 * The end of the top bar's filter tray while a screen filter is on (and
 * while its panel is open): how many tasks it matches (open ones, completed
 * too under Show completed); a click opens or closes the filtered-tasks
 * panel under the tray, whose filter the tray edits. Its own component, so
 * only it renders for a task write.
 */
export function ShowFilteredTasksButton({ open }: { open: boolean }) {
  const count = useScreenTaskCount()
  const { triggerProps, tooltip } = useTooltip(open ? null : 'Show the tasks matching the filter')
  return (
    <>
      <span className={styles.showTasksSeparator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.showTasks} ${open ? styles.showTasksOpen : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const ui = useUIStore.getState()
          if (open) ui.closeFilterPanel()
          else ui.openFilterPanel()
        }}
        {...{ [SHOW_FILTERED_TASKS_ATTR]: '' }}
        {...triggerProps}
      >
        {showTasksLabel(count)}
      </button>
      {tooltip}
    </>
  )
}
