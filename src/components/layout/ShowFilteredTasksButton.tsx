import { useScreenTaskCounts } from '../../hooks/use-screen-task-count'
import { useAppliedLens } from '../../stores/screen-filter'
import { useUIStore } from '../../stores/ui-store'
import { SHOW_FILTERED_TASKS_ATTR } from '../../utils/dom-contract'
import { useTooltip } from '../shared/use-tooltip'
import { shownOfTotalText } from '../shared/filters/lens-text'
import { BadgeCapsule } from '../shared/BadgeCapsule'
import { useSettingsStore } from '../../stores/settings-store'
import { tabBadgeSummary } from '../../utils/tab-badges'
import styles from './TopBar.module.css'

/**
 * The end of the top bar's filter tray while a chip or the top bar's lens
 * hides tasks (and while its panel is open): what they keep of every open
 * task (and of the completed ones the filter admits while it lets them
 * through — `screenTaskCounts`), `61 of 109` — red with the
 * tray while a chip is on, neutral with the lens alone — then, as on a list
 * tab, a badge of the open tasks it keeps that are due / due for a
 * follow-up inside the tab badge ranges (Settings › Tasks). A click opens or
 * closes the filtered-tasks panel under the tray, whose filter the tray
 * edits. Its own component, so only it renders for a task write.
 */
export function ShowFilteredTasksButton({ open }: { open: boolean }) {
  const { shown, total, lensKeeps, withCompleted, badges } = useScreenTaskCounts()
  const badgeRanges = useSettingsStore((s) => s.tabBadges)
  const lens = useAppliedLens()
  const words = shownOfTotalText(shown, total, withCompleted)
  const badgeLines = tabBadgeSummary(badges, badgeRanges)
  const detail = lens
    ? `${lens.name} hides ${total - lensKeeps} · click to list the ${shown}`
    : `Click to list the ${shown}`
  const { triggerProps, tooltip } = useTooltip(open ? null : [words, ...badgeLines, detail].join('\n'), { labelLines: 1 })
  return (
    <>
      <span className={styles.showTasksSeparator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.showTasks} ${open ? styles.showTasksOpen : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${[words, ...badgeLines].join(', ')}. Show them`}
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
        {badgeLines.length > 0 && <BadgeCapsule counts={badges} data-counter-badge="" />}
      </button>
      {tooltip}
    </>
  )
}
