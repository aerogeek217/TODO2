import { useMemo, type ReactNode } from 'react'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { TodoPredicate } from '../../../models/filter-predicate'
import { useQuietLensSwitch } from '../../../hooks/use-widget-lens'
import { useUIStore } from '../../../stores/ui-store'
import { expressionNamesOf } from '../../../utils/filter-chips'
import { printExpression, wholeExpression } from '../../../utils/filter-expression'
import { groupSortSummary } from '../../../utils/list-options'
import { ChevronDownIcon } from '../../shared/icons'
import type { ListLensMark } from './ListWidget'
import { LensSwitch } from '../../shared/LensSwitch'
import { ExpressionWords } from '../../shared/filters/ExpressionWords'
import { useChipNames } from '../../shared/filters/filter-menu'
import { EDIT_LIST_KEEP_ATTR, requestEditListClose } from './edit-list-keep'
import { openEditList } from '../widget-hooks'
import { WidgetTopLine } from '../WidgetTopLine'
import chipStyles from '../../shared/filters/ListFilterChips.module.css'
import styles from './ListFilterRow.module.css'

interface ListFilterRowProps {
  /** The tab showing the list (Edit list opens beside its panel). */
  tabId: string
  /** The list as shown: Edit list's draft while it is open on it, else the saved list. */
  definition: PersistedListDefinition
  /** A list widget's count (`shown of total`) while the screen filter or the lens narrows it, before group · sort. */
  count?: string
  /** The top bar's lens on this list (while it hides something here, or the list ignores it): its switch, at the line's end (G3). */
  lens?: ListLensMark
  /** Turns the lens off / on for this list (saved at once). */
  onToggleLens?: () => void
  /**
   * It is its list widget's top line (D26 AA1): alone in its cell it starts
   * with `lead` (the list's name and badge) and ends with the
   * cell's controls (`WidgetTopLine`).
   */
  topLine?: { lead: ReactNode }
}

/**
 * A list's top line: in a widget its filter read in words (UX cleanup 2A —
 * `ListFilterWords`; a click opens Edit list, where it is edited; the top
 * bar's chips are not repeated here), then the list's count while the
 * screen filter or the lens narrows it (`22 of 23`, else none), the group ·
 * sort summary that opens Edit list; it ends with the top bar's lens switch
 * (while it hides something here, or the list ignores it; the standard
 * switch, G3, quiet in a desktop cell), before the cell's ⋯. Used by list
 * widgets. Phones (a `data-touch-chips` ancestor) get touch sizes.
 *
 * A list set not to show it (`showFilterLine: false`) shows nothing in its
 * widgets; Edit list stays in the ⋯ menu.
 */
export function ListFilterRow(props: ListFilterRowProps) {
  if (props.definition.showFilterLine === false) return null
  return <FilterRowBody {...props} />
}

function FilterRowBody({ tabId, definition, count, lens, onToggleLens, topLine }: ListFilterRowProps) {
  const editorOpen = useUIStore((s) => s.listEditor?.tabId === tabId)
  const quietLens = useQuietLensSwitch()
  const id = definition.id
  // Opens Edit list beside the tab (asks it to close while open — Save / Discard / Keep editing with changes): the summary's and the words' click.
  const toggleEditor = () => {
    if (editorOpen) requestEditListClose()
    else openEditList(tabId, id)
  }

  const content = (
    <>
      <div className={styles.words} {...{ [EDIT_LIST_KEEP_ATTR]: id }}>
        <ListFilterWords predicate={definition.membership.predicate} onOpen={toggleEditor} />
      </div>
      {count != null && <ListCount label={count} />}
      <button
        type="button"
        className={`${chipStyles.summary} ${editorOpen ? chipStyles.summaryOpen : ''}`}
        aria-haspopup="dialog"
        aria-expanded={editorOpen}
        title={`Edit list “${definition.name.trim() || 'List'}”`}
        data-testid="list-summary"
        {...{ [EDIT_LIST_KEEP_ATTR]: id }}
        onClick={toggleEditor}
      >
        {groupSortSummary(definition.grouping, definition.sort, definition.sortDirection)}
        <ChevronDownIcon />
      </button>
      {lens && onToggleLens && <LensSwitch lens={lens} onToggle={onToggleLens} noun="list" quiet={quietLens} />}
    </>
  )
  return topLine
    ? <WidgetTopLine className={styles.filterRow} lead={topLine.lead} data-testid="list-filter-row">{content}</WidgetTopLine>
    : <div className={styles.filterRow} data-testid="list-filter-row">{content}</div>
}

/**
 * A widget's filter line read in words (UX cleanup 2A, review finding 6):
 * the list's whole filter — its chips or its expression — as one expression
 * (`wholeExpression`) read back by `ExpressionWords` (muted, one line,
 * fading with `+N more`, the exact text in the tooltip); `Every open task`
 * (`Every task` while it shows completed ones) when it narrows by nothing.
 * A click opens Edit list (`onOpen`), where it is edited.
 */
function ListFilterWords({ predicate, onOpen }: { predicate: TodoPredicate; onOpen?: () => void }) {
  const names = useChipNames()
  const expression = useMemo(() => wholeExpression(predicate), [predicate])
  const text = useMemo(() => (expression ? printExpression(expression, false, expressionNamesOf(names)) : ''), [expression, names])
  if (expression) return <ExpressionWords expression={expression} text={text} onOpen={onOpen} />
  const label = predicate.showCompleted === true ? 'Every task' : 'Every open task'
  return onOpen
    ? <button type="button" className={styles.everyTask} title="Click to edit" data-testid="list-filter-every" onClick={onOpen}>{label}</button>
    : <span className={styles.everyTask} data-testid="list-filter-every">{label}</span>
}

/** The list's count on its line, `32 of 40` (the shown number stronger). */
function ListCount({ label }: { label: string }) {
  const at = label.indexOf(' of ')
  return (
    <span className={styles.count} data-testid="list-count">
      {at < 0 ? <b>{label}</b> : <><b>{label.slice(0, at)}</b>{label.slice(at)}</>}
    </span>
  )
}

