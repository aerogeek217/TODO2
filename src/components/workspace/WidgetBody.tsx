import type { LayoutTab } from '../../models/workspace-layout'
import { NotesWidget } from './NotesWidget'
import { StatusWidget } from './StatusWidget'
import { CalendarWidget } from './calendar/CalendarWidget'
import { EisenhowerWidget } from './eisenhower/EisenhowerWidget'
import { ListWidget, type ListWidgetResult } from './list/ListWidget'

interface WidgetBodyProps {
  tab: LayoutTab
  /**
   * List and Eisenhower tabs report their count label (for the tab); list
   * tabs also their shown sections (for "Copy tasks").
   */
  onResult?: (result: ListWidgetResult) => void
}

const NO_SECTIONS: ListWidgetResult['sections'] = []

/** The body of a cell's active tab, by widget kind. */
export function WidgetBody({ tab, onResult }: WidgetBodyProps) {
  switch (tab.kind) {
    case 'lens':
      return <ListWidget tab={tab} onResult={onResult} />
    case 'calendar':
      return <CalendarWidget tab={tab} />
    case 'notes':
      return <NotesWidget />
    case 'eisenhower':
      return <EisenhowerWidget tab={tab} onResult={onResult ? (r) => onResult({ countLabel: r.countLabel, sections: NO_SECTIONS }) : undefined} />
    case 'status':
      return <StatusWidget />
  }
}
