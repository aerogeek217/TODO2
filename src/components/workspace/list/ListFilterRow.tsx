import { useEffect, useMemo, useRef, useState } from 'react'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { useIsListDirty } from '../../../hooks/use-list-draft'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useUIStore } from '../../../stores/ui-store'
import { chipKey, filterChips, type FilterChip } from '../../../utils/filter-chips'
import { groupSortSummary } from '../../../utils/list-options'
import { ChevronDownIcon, FunnelIcon } from '../../shared/icons'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { ListDraftButtons } from './ListDraftButtons'
import { EDIT_LIST_KEEP_ATTR } from './edit-list-keep'
import { useScreenChips } from './use-screen-chips'
import { openEditList } from '../widget-hooks'
import chipStyles from '../../shared/filters/ListFilterChips.module.css'
import styles from './ListFilterRow.module.css'

/** Value-only text for a screen chip (dates keep their field name). */
function screenChipText(chip: FilterChip): string {
  return chip.field === 'dates' ? `${chip.label} ${chip.value}` : chip.value
}

interface ListFilterRowProps {
  /**
   * The tab showing the list (Edit list opens beside its panel). Absent
   * outside a widget (Settings › Tasks › Eisenhower): no summary.
   */
  tabId?: string
  /** The list as shown: its unsaved draft, else the saved list. */
  definition: PersistedListDefinition
  /** The group · sort summary that opens Edit list (off where the list's group and sort don't apply). */
  summary?: boolean
  /**
   * Inside a modal (Settings): shown whatever the list's Show filter line
   * (that switch is about its widgets), and a filter picker's Esc closes
   * only the picker.
   */
  inDialog?: boolean
}

/**
 * A list's top line (the way in to setting its filters): screen filter
 * chips (read-only, set in the top bar), then the list's own filter chips
 * (editing them makes the list unsaved; `No filters` when there are none),
 * + Filter, the group · sort summary that opens Edit list,
 * and — while the list is unsaved — Revert · Save. Used by list widgets, by
 * the Eisenhower widget (its own list, without the summary) and by Settings
 * › Tasks › Eisenhower (the same list and draft). Phones (a
 * `data-touch-chips` ancestor) get touch sizes.
 *
 * A list set not to show it (`showFilterLine: false`) shows nothing in its
 * widgets — but the whole line while it is unsaved, so Revert · Save are
 * there; Edit list stays in the tab menu.
 */
export function ListFilterRow(props: ListFilterRowProps) {
  const unsaved = useIsListDirty(props.definition.id)
  if (props.definition.showFilterLine === false && !unsaved && !props.inDialog) return null
  return <FilterRowBody {...props} unsaved={unsaved} />
}

function FilterRowBody({ tabId, definition, summary = true, inDialog = false, unsaved }: ListFilterRowProps & { unsaved: boolean }) {
  const editorOpen = useUIStore((s) => tabId != null && s.listEditor?.tabId === tabId)
  const names = useChipNames()
  const screenChips = useScreenChips()
  const predicate = definition.membership.predicate
  const hasListChips = useMemo(() => filterChips(predicate, names).length > 0, [predicate, names])
  const chipsRef = useRef<HTMLDivElement>(null)
  const chipsOverflow = useOverflowsX(chipsRef)
  const id = definition.id

  return (
    <div className={styles.filterRow} data-testid="list-filter-row">
      <div ref={chipsRef} className={`${styles.chips} ${chipsOverflow ? styles.chipsClipped : ''}`}>
        <PredicateChips
          predicate={predicate}
          onChange={(next) => useListDraftStore.getState().edit(id, (d) => ({ ...d, membership: { kind: 'custom', predicate: next } }))}
          inDialog={inDialog}
          before={(
            <>
              {screenChips.map((chip) => (
                <span key={`screen-${chipKey(chip)}`} className={chipStyles.screenChip} title={chip.tooltip ? `${chip.tooltip}\nScreen filter · set in the top bar` : 'Screen filter · set in the top bar'} data-testid="screen-filter-chip">
                  <FunnelIcon />
                  {screenChipText(chip)}
                </span>
              ))}
              {screenChips.length > 0 && hasListChips && <span className={styles.chipSep} aria-hidden="true" />}
              {screenChips.length === 0 && !hasListChips && <span className={styles.noFilters}>No filters</span>}
            </>
          )}
        />
      </div>
      {summary && tabId != null && (
        <button
          type="button"
          className={`${chipStyles.summary} ${editorOpen ? chipStyles.summaryOpen : ''}`}
          aria-haspopup="dialog"
          aria-expanded={editorOpen}
          title={`Edit list “${definition.name.trim() || 'List'}”`}
          data-testid="list-summary"
          {...{ [EDIT_LIST_KEEP_ATTR]: id }}
          onClick={() => {
            if (editorOpen) useUIStore.getState().requestCloseListEditor()
            else openEditList(tabId, id)
          }}
        >
          {groupSortSummary(definition.grouping, definition.sort, definition.sortDirection)}
          <ChevronDownIcon />
        </button>
      )}
      {unsaved && <ListDraftButtons listDefinitionId={id} />}
    </div>
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
