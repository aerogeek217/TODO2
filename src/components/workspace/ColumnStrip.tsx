import { useMemo, type CSSProperties } from 'react'
import { getActiveTab, type LayoutTab } from '../../models/workspace-layout'
import { afterLeavingEditors } from '../../stores/editor-leave'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { openNumberList, openWidgetLarger } from '../../services/widget-popup'
import { numberTabOf } from '../../utils/number-views'
import type { ColumnStrip as Strip } from '../../utils/workspace-table'
import { OPEN_LARGER_LABEL } from '../shared/widget-kind-menu-entries'
import { TabIcon } from './TabIcon'
import { TrackExpandButton } from './TrackExpandButton'
import { useTabTitles } from './widget-hooks'
import styles from './ColumnStrip.module.css'

/** Opens a strip's widget larger: a Number that follows a list opens that list, as its click does. */
function openLarger(tab: LayoutTab): void {
  // TEMPORARY (`utils/number-views`): a Number is its view.
  if (tab.kind === 'numbers' && numberTabOf(tab)?.config.show === 'list') void openNumberList(tab.id)
  else void openWidgetLarger(tab.id)
}

/**
 * A collapsed column as drawn outside the layout edit mode (`workspace-table
 * .columnStrips`): a strip `COLUMN_STRIP_PX` wide over the cells lying only
 * in collapsed columns, which draw nothing else. At its top **Expand
 * column** (`TrackExpandButton`, as a collapsed row's turned a quarter) expands its columns — view state, as Collapse row's expand;
 * under it each cell's active widget, its icon and name running down, a
 * press opening that widget larger (the widget popup) without expanding the
 * column. An empty cell names nothing.
 */
export function ColumnStrip({ strip, style }: { strip: Strip; style: CSSProperties }) {
  const tabs = useMemo(() => strip.cells.map((c) => getActiveTab(c)).filter((t): t is LayoutTab => t != null), [strip.cells])
  const titles = useTabTitles(tabs)
  const expand = () => afterLeavingEditors(() => { void useWorkspaceStore.getState().setTrackCollapsed(strip.trackIds, false) })
  return (
    <section className={styles.strip} style={style} data-ws-column-strip={strip.trackIds.join(' ')} aria-label="Collapsed column">
      <div className={styles.inner}>
        <TrackExpandButton axis="columns" onClick={expand} />
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            className={styles.widget}
            aria-haspopup="dialog"
            data-tooltip={OPEN_LARGER_LABEL}
            data-ws-strip-tab={tab.id}
            onClick={() => openLarger(tab)}
          >
            <TabIcon tab={tab} size={13} className={styles.icon} />
            <span className={styles.name}>{titles[i] ?? ''}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
