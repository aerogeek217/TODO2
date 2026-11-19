import { useMemo } from 'react'
import { useFilterStore } from '../../../stores/filter-store'
import { expressionNamesOf } from '../../../utils/filter-chips'
import { printExpression } from '../../../utils/filter-expression'
import { CloseIcon } from '../icons'
import { ExpressionWords } from './ExpressionWords'
import { useChipNames } from './filter-menu'
import styles from './ScreenExpression.module.css'

/**
 * The phone's view of a filter typed into the desktop top bar's field that
 * no chip says (feedback P2: the screen filter's `expression`, ANDed with
 * the chips): read-only, in words (`ExpressionWords`), with a × that clears
 * it and leaves the chips. Nothing while there is none. The phone's own
 * field and sections edit the chips only.
 */
export function ScreenExpression({ className }: { className?: string }) {
  const expression = useFilterStore((s) => s.filters.expression)
  const names = useChipNames()
  const text = useMemo(() => (expression ? printExpression(expression, false, expressionNamesOf(names)) : ''), [expression, names])
  if (!expression) return null
  return (
    <div className={`${styles.row} ${className ?? ''}`} data-screen-expression="">
      <span className={styles.label}>Also</span>
      <ExpressionWords expression={expression} text={text} />
      <button
        type="button"
        className={styles.clear}
        aria-label="Clear the typed filter"
        data-tooltip="Clear the typed filter"
        onClick={() => {
          const { filters, setAllFilters } = useFilterStore.getState()
          const { expression: _expression, ...chips } = filters
          void _expression
          setAllFilters(chips)
        }}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  )
}
