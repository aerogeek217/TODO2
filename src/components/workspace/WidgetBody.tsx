import type { ReactElement } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'
import { useUIStore } from '../../stores/ui-store'
import { NotesWidget } from './NotesWidget'
import { CalendarWidget } from './calendar/CalendarWidget'
import { DashboardWidget } from './dashboard/DashboardWidget'
import type { DashboardSummary } from './dashboard/dashboard-summary'
import { EisenhowerWidget } from './eisenhower/EisenhowerWidget'
import { ListWidget, type ListWidgetResult } from './list/ListWidget'
import styles from './WidgetBody.module.css'

/** What a widget reports to its cell (tab count, and what its menu's copy items copy). */
export interface WidgetResult extends ListWidgetResult {
  /** Dashboard: its counts, for "Copy summary". */
  summary?: DashboardSummary
}

interface WidgetBodyProps {
  tab: LayoutTab
  /**
   * List, Eisenhower and Dashboard tabs report their count label (for the
   * tab); list tabs also their shown sections (for "Copy tasks"), a
   * dashboard its summary (for "Copy summary").
   */
  onResult?: (result: WidgetResult) => void
  /** Dashboard: its gear opens Customize; absent = no gear. */
  onCustomize?: () => void
}

const NO_SECTIONS: ListWidgetResult['sections'] = []

/** The body of a cell's active tab, by widget kind (a case per kind: a new kind doesn't compile without one; an unknown stored kind gets a note). */
export function WidgetBody({ tab, onResult, onCustomize }: WidgetBodyProps): ReactElement {
  switch (tab.kind) {
    case 'lens':
      return <ListWidget tab={tab} onResult={onResult} />
    case 'calendar':
      return <CalendarWidget tab={tab} />
    case 'notes':
      return <NotesWidget />
    case 'eisenhower':
      return (
        <EisenhowerWidget
          tab={tab}
          onResult={onResult ? (r) => onResult({ countLabel: r.countLabel, sections: NO_SECTIONS }) : undefined}
        />
      )
    case 'dashboard':
      return (
        <DashboardWidget
          tab={tab}
          onResult={onResult ? (r) => onResult({ countLabel: r.countLabel, sections: NO_SECTIONS, summary: r.summary }) : undefined}
          onDrill={(drill) => useUIStore.getState().showTaskDialog({ ...drill, fromTabId: tab.id })}
          onCustomize={onCustomize}
        />
      )
    default: {
      // Every kind has its case above (`never` here), but stored data isn't
      // typed: a kind this build doesn't know (the layout load repair drops
      // such tabs; this is a last guard) renders a note, not a crash.
      const unknown: never = tab
      return (
        <div className={styles.unknown} data-unknown-widget={String((unknown as { kind?: unknown }).kind)}>
          This widget can't be shown in this version of TODO2.
        </div>
      )
    }
  }
}
