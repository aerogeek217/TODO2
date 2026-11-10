import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { TodoPredicate } from '../../../models/filter-predicate'
import { useQuietLensSwitch } from '../../../hooks/use-widget-lens'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import { expressionNamesOf, predicateLineItems } from '../../../utils/filter-chips'
import { printExpression, wholeExpression } from '../../../utils/filter-expression'
import { groupSortSummary } from '../../../utils/list-options'
import { ChevronDownIcon } from '../../shared/icons'
import type { ListLensMark } from './ListWidget'
import { LensSwitch } from '../../shared/LensSwitch'
import { ExpressionWords } from '../../shared/filters/ExpressionWords'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { EDIT_LIST_KEEP_ATTR, requestEditListClose } from './edit-list-keep'
import { openEditList } from '../widget-hooks'
import { WidgetTopLine } from '../WidgetTopLine'
import chipStyles from '../../shared/filters/ListFilterChips.module.css'
import styles from './ListFilterRow.module.css'

interface ListFilterRowProps {
  /**
   * The tab showing the list (Edit list opens beside its panel). Absent
   * outside a widget (Settings › Tasks › Eisenhower): no summary.
   */
  tabId?: string
  /** The list as shown: Edit list's draft while it is open on it, else the saved list. */
  definition: PersistedListDefinition
  /** The group · sort summary that opens Edit list (off where the list's group and sort don't apply). */
  summary?: boolean
  /**
   * Inside a modal (Settings): shown whatever the list's Show filter line
   * (that switch is about its widgets), and a filter picker's Esc closes
   * only the picker.
   */
  inDialog?: boolean
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
  /** At the line's end, before the cell's ⋯: the Eisenhower's lens switch in a cell of several widgets (G3). */
  trailing?: ReactNode
}

/**
 * A list's top line: in a widget its filter read in words (UX cleanup 2A —
 * `ListFilterWords`; a click opens Edit list, where it is edited; the top
 * bar's chips are not repeated here), then the list's count while the
 * screen filter or the lens narrows it (`22 of 23`, else none), the group ·
 * sort summary that opens Edit list; it ends with the top bar's lens switch
 * (while it hides something here, or the list ignores it; the standard
 * switch, G3, quiet in a desktop cell), before the cell's ⋯. Used by list
 * widgets, by the Eisenhower widget (its own list, without the summary) and
 * by Settings › Tasks › Eisenhower (`inDialog`: the same list, its filter
 * as editable chips with + Filter, each change saved at once as an undo
 * step). Phones (a `data-touch-chips` ancestor) get touch sizes.
 *
 * A list set not to show it (`showFilterLine: false`) shows nothing in its
 * widgets; Edit list stays in the ⋯ menu.
 */
export function ListFilterRow(props: ListFilterRowProps) {
  if (props.definition.showFilterLine === false && !props.inDialog) return null
  return <FilterRowBody {...props} />
}

function FilterRowBody({ tabId, definition, summary = true, inDialog = false, count, lens, onToggleLens, topLine, trailing }: ListFilterRowProps) {
  const editorOpen = useUIStore((s) => tabId != null && s.listEditor?.tabId === tabId)
  const quietLens = useQuietLensSwitch()
  const id = definition.id
  // Opens Edit list beside the tab (asks it to close while open — Save / Discard / Keep editing with changes): the summary's and the words' click.
  const toggleEditor = tabId != null
    ? () => {
        if (editorOpen) requestEditListClose()
        else openEditList(tabId, id)
      }
    : undefined

  const content = (
    <>
      {inDialog
        ? <EditableChips definition={definition} />
        : (
            <div className={styles.words} {...{ [EDIT_LIST_KEEP_ATTR]: id }}>
              <ListFilterWords predicate={definition.membership.predicate} onOpen={toggleEditor} />
            </div>
          )}
      {count != null && <ListCount label={count} />}
      {summary && toggleEditor && (
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
      )}
      {lens && onToggleLens && <LensSwitch lens={lens} onToggle={onToggleLens} noun="list" quiet={quietLens} />}
      {trailing}
    </>
  )
  return topLine
    ? <WidgetTopLine className={styles.filterRow} lead={topLine.lead} data-testid="list-filter-row">{content}</WidgetTopLine>
    : <div className={styles.filterRow} data-testid="list-filter-row">{content}</div>
}

/**
 * The list's filter as editable chips (Settings › Tasks › Eisenhower, which
 * saves at once as its panes do): each change is written for good as one
 * undo step (`Changed the Eisenhower’s filter`); `No filters` when there
 * are none; + Filter adds one.
 */
/** The undo step of a change to the Eisenhower list's filter in Settings. */
const EISENHOWER_FILTER_STEP = 'Changed the Eisenhower’s filter'

function EditableChips({ definition }: { definition: PersistedListDefinition }) {
  const names = useChipNames()
  const predicate = definition.membership.predicate
  const hasListChips = useMemo(() => predicateLineItems(predicate, names).length > 0, [predicate, names])
  const chipsRef = useRef<HTMLDivElement>(null)
  const chipsOverflow = useOverflowsX(chipsRef)
  const id = definition.id
  return (
    <div ref={chipsRef} className={`${styles.chips} ${chipsOverflow ? styles.chipsClipped : ''}`}>
      <PredicateChips
        predicate={predicate}
        onChange={(next) => {
          void useListDefinitionStore.getState().editList(id, (d) => ({ ...d, membership: { kind: 'custom', predicate: next } }), EISENHOWER_FILTER_STEP)
        }}
        inDialog
        before={hasListChips ? undefined : <span className={styles.noFilters}>No filters</span>}
      />
    </div>
  )
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

/** Whether the element's content is wider than it (re-checked on resize and content changes). */
function useOverflowsX(ref: React.RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref])
  return overflows
}
