import { useSettingsStore } from '../../../stores/settings-store'
import {
  GROUP_LABEL,
  LIST_GROUP_CHOICES,
  LIST_SORT_CHOICES,
  SORT_LABEL,
  choicesWith,
  sortOrderWords,
} from '../../../utils/list-options'
import { TODO_SORT_DIRECTIONS, isTodoGroupBy, isTodoSortBy, sortDirectionOnPick, sortHasDirection } from '../../../models/todo-sort-group'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/**
 * Tasks › New lists: what a new blank list (adding a List widget, or a tab
 * switched to List) starts sorted (and which way, for a sort with a
 * direction) and grouped by. Each change is one undo step.
 */
export function NewListsSection() {
  const sort = useSettingsStore((s) => s.newListSort)
  const direction = useSettingsStore((s) => s.newListSortDirection)
  const group = useSettingsStore((s) => s.newListGroup)
  const setSort = useSettingsStore((s) => s.setNewListSort)
  const setGroup = useSettingsStore((s) => s.setNewListGroup)
  return (
    <div className={styles.section}>
      <SettingRow label="New lists sort by" help="A list you create starts sorted this way. Edit list changes its own.">
        <select
          className={styles.select}
          aria-label="New lists sort by"
          value={sort}
          // A direction carries over to another sort with one, or the sort starts in its own (as in Edit list).
          onChange={(e) => { if (isTodoSortBy(e.target.value)) void setSort(e.target.value, sortDirectionOnPick(e.target.value, direction)) }}
        >
          {choicesWith(LIST_SORT_CHOICES, sort).map((choice) => (
            <option key={choice} value={choice}>{SORT_LABEL[choice]}</option>
          ))}
        </select>
        {sortHasDirection(sort) && (
          <select
            className={styles.select}
            aria-label="New lists sort order"
            value={direction}
            onChange={(e) => void setSort(sort, e.target.value === 'desc' ? 'desc' : 'asc')}
          >
            {TODO_SORT_DIRECTIONS.map((dir) => (
              <option key={dir} value={dir}>{sortOrderWords(sort, dir)}</option>
            ))}
          </select>
        )}
      </SettingRow>
      <SettingRow label="New lists group by" help="A list you create starts grouped this way.">
        <select
          className={styles.select}
          aria-label="New lists group by"
          value={group}
          onChange={(e) => { if (isTodoGroupBy(e.target.value)) void setGroup(e.target.value) }}
        >
          {choicesWith(LIST_GROUP_CHOICES, group).map((choice) => (
            <option key={choice} value={choice}>{GROUP_LABEL[choice]}</option>
          ))}
        </select>
      </SettingRow>
    </div>
  )
}
