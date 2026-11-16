import type { ComponentPropsWithRef } from 'react'
import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../../models/todo-sort-group'
import { groupSortSummary } from '../../utils/list-options'
import { ChevronDownIcon } from './icons'
import chipStyles from './filters/ListFilterChips.module.css'

interface GroupSortButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  grouping: TodoGroupBy
  sort: TodoSortBy
  sortDirection?: TodoSortDirection
  /** What it opens is open (its pressed look and `aria-expanded`). */
  open: boolean
}

/**
 * The group · sort summary as a button — `People · Due date ▾`
 * (`groupSortSummary`): a list's filter line (it opens Edit list) and the
 * popup task lists' header (`GroupSortControl`: it opens their Group by and
 * Sort by). Every other prop goes to the button.
 */
export function GroupSortButton({ grouping, sort, sortDirection, open, className, ...props }: GroupSortButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`${chipStyles.summary} ${open ? chipStyles.summaryOpen : ''} ${className ?? ''}`}
      aria-expanded={open}
    >
      {groupSortSummary(grouping, sort, sortDirection)}
      <ChevronDownIcon />
    </button>
  )
}
