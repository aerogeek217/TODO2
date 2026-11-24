import { useMemo } from 'react'
import type { TodoPredicate } from '../../../models/filter-predicate'
import { expressionNamesOf } from '../../../utils/filter-chips'
import { printExpression, wholeExpression } from '../../../utils/filter-expression'
import { ExpressionWords } from '../../shared/filters/ExpressionWords'
import { useChipNames } from '../../shared/filters/filter-menu'
import { FunnelIcon } from '../../shared/icons'
import { openPlannerSettings, UNPLANNED_FILTER_LABEL } from './open-planner-settings'
import styles from './PlannerWidget.module.css'

/**
 * The Planner's Unplanned filter **read back in words** under the Unplanned
 * heading (board E): the funnel, then the filter as a list's filter line
 * reads it (`wholeExpression` → `ExpressionWords`: `/focus, or #errands`,
 * fading with `+N more`, the exact text in the tooltip) — or `Nothing joins
 * on its own` for an empty one. A click opens the Planner settings
 * (`openPlannerSettings`). It is the settings' anchor
 * (`data-planner-filter-line`).
 */
export function PlannerFilterLine({ tabId, filter }: { tabId: string; filter: TodoPredicate }) {
  const names = useChipNames()
  const expression = useMemo(() => wholeExpression(filter), [filter])
  const text = useMemo(() => (expression ? printExpression(expression, false, expressionNamesOf(names)) : ''), [expression, names])
  const open = () => openPlannerSettings(tabId)
  return (
    <div className={styles.filterLine} data-planner-filter-line={tabId}>
      {expression ? (
        <ExpressionWords expression={expression} text={text} onOpen={open} lead={<FunnelIcon size={12} />} name={UNPLANNED_FILTER_LABEL} />
      ) : (
        <button
          type="button"
          className={styles.filterNone}
          aria-label={`${UNPLANNED_FILTER_LABEL}: nothing joins`}
          data-tooltip="Unplanned stays empty · click to edit"
          data-testid="planner-filter-none"
          onClick={open}
        >
          <FunnelIcon size={12} />
          <span className={styles.filterNoneWords}>Nothing joins</span>
        </button>
      )}
    </div>
  )
}
