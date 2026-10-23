import { useScreenTaskCount } from '../../hooks/use-screen-task-count'
import { screenTaskDialog, showTasksLabel } from '../../services/task-dialog'
import { useUIStore } from '../../stores/ui-store'
import { useTooltip } from '../shared/use-tooltip'
import styles from './TopBar.module.css'

/**
 * The end of the top bar's filter tray while a screen filter is on: how
 * many tasks it matches (open ones, completed too under Show completed); a
 * click opens them in the task dialog, whose filter bar edits the screen
 * filter itself. Its own component, so only it renders for a task write.
 */
export function ShowFilteredTasksButton() {
  const count = useScreenTaskCount()
  const { triggerProps, tooltip } = useTooltip('Show the tasks matching the filter')
  return (
    <>
      <span className={styles.showTasksSeparator} aria-hidden="true" />
      <button
        type="button"
        className={styles.showTasks}
        onClick={() => useUIStore.getState().showTaskDialog(screenTaskDialog())}
        data-show-filtered-tasks=""
        {...triggerProps}
      >
        {showTasksLabel(count)}
      </button>
      {tooltip}
    </>
  )
}
