import type { ReactElement } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'
import { useUIStore } from '../../stores/ui-store'
import { NotesWidget } from './NotesWidget'
import { CalendarWidget } from './calendar/CalendarWidget'
import { DashboardWidget } from './dashboard/DashboardWidget'
import type { DashboardSummary } from './dashboard/dashboard-summary'
import { EisenhowerWidget } from './eisenhower/EisenhowerWidget'
import { ListWidget, type ListWidgetResult } from './list/ListWidget'

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
  /** Dashboard: "+ Add list tile" opens Customize at its list tiles; absent = no button. */
  onAddListTile?: () => void
}

const NO_SECTIONS: ListWidgetResult['sections'] = []

/** The body of a cell's active tab, by widget kind (a case per kind: a new kind doesn't compile without one). */
export function WidgetBody({ tab, onResult, onAddListTile }: WidgetBodyProps): ReactElement {
  switch (tab.kind) {
    case 'lens':
      return <ListWidget tab={tab} onResult={onResult} />
    case 'calendar':
      return <CalendarWidget tab={tab} />
    case 'notes':
      return <NotesWidget />
    case 'eisenhower':
      return <EisenhowerWidget tab={tab} onResult={onResult ? (r) => onResult({ countLabel: r.countLabel, sections: NO_SECTIONS }) : undefined} />
    case 'dashboard':
      return (
        <DashboardWidget
          tab={tab}
          onResult={onResult ? (r) => onResult({ countLabel: r.countLabel, sections: NO_SECTIONS, summary: r.summary }) : undefined}
          onDrill={(drill) => useUIStore.getState().showTaskDialog({ ...drill, fromTabId: tab.id })}
          onAddListTile={onAddListTile}
        />
      )
  }
}
