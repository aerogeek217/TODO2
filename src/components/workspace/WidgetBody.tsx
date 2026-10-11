import type { LayoutTab } from '../../models/workspace-layout'
import { NotesSlotContent } from '../canvas/rails/NotesSlotContent'
import { StatusSlotContent } from '../canvas/rails/StatusSlotContent'
import { CalendarWidget } from './calendar/CalendarWidget'
import { ListWidget, type ListWidgetResult } from './list/ListWidget'

interface WidgetBodyProps {
  tab: LayoutTab
  /** List tabs report their count label and shown sections (for the tab and "Copy tasks"). */
  onLensResult?: (result: ListWidgetResult) => void
}

/** The body of a cell's active tab, by widget kind. */
export function WidgetBody({ tab, onLensResult }: WidgetBodyProps) {
  switch (tab.kind) {
    case 'lens':
      return <ListWidget tab={tab} onResult={onLensResult} />
    case 'calendar':
      return <CalendarWidget tab={tab} />
    case 'notes':
      return <NotesSlotContent />
    case 'status':
      return <StatusSlotContent />
  }
}
