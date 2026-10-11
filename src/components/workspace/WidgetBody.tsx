import { clampCalendarOffset, type LayoutTab } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { CalendarSlotContent } from '../canvas/rails/CalendarSlotContent'
import { NotesSlotContent } from '../canvas/rails/NotesSlotContent'
import { TaskboardSlotContent } from '../canvas/rails/TaskboardSlotContent'
import { StatusSlotContent } from '../canvas/rails/StatusSlotContent'
import { ListWidget, type ListWidgetResult } from './list/ListWidget'

interface WidgetBodyProps {
  tab: LayoutTab
  /** List tabs report their count label and shown sections (for the tab and "Copy tasks"). */
  onLensResult?: (result: ListWidgetResult) => void
}

/** The body of a cell's active tab, by widget kind. */
export function WidgetBody({ tab, onLensResult }: WidgetBodyProps) {
  const patchTabViewState = useWorkspaceStore((s) => s.patchTabViewState)

  switch (tab.kind) {
    case 'lens':
      return <ListWidget tab={tab} onResult={onLensResult} />
    case 'calendar':
      return (
        <CalendarSlotContent
          orientation="vertical"
          weekOffset={tab.viewState?.offset ?? 0}
          onWeekOffsetChange={(n) => { void patchTabViewState(tab.id, 'calendar', { view: 'week', offset: clampCalendarOffset(n) }) }}
          scope={`ws-${tab.id}`}
        />
      )
    case 'notes':
      return <NotesSlotContent />
    case 'taskboard':
      return <TaskboardSlotContent />
    case 'status':
      return <StatusSlotContent />
  }
}
