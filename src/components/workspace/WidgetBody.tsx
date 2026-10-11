import type { PersistedTodoItem } from '../../models'
import { clampCalendarOffset, type LayoutTab } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { LensSlotContent } from '../canvas/rails/LensSlotContent'
import { CalendarSlotContent } from '../canvas/rails/CalendarSlotContent'
import { NotesSlotContent } from '../canvas/rails/NotesSlotContent'
import { TaskboardSlotContent } from '../canvas/rails/TaskboardSlotContent'
import { StatusSlotContent } from '../canvas/rails/StatusSlotContent'

interface WidgetBodyProps {
  tab: LayoutTab
  /** Lens tabs report their list's name, task count and tasks (for the tab title and "Copy tasks"). */
  onLensResult?: (count: number, todos: PersistedTodoItem[]) => void
}

/** The body of a cell's active tab, by widget kind. */
export function WidgetBody({ tab, onLensResult }: WidgetBodyProps) {
  const patchTabViewState = useWorkspaceStore((s) => s.patchTabViewState)

  switch (tab.kind) {
    case 'lens':
      return (
        <LensSlotContent
          listDefinitionId={tab.config.listDefinitionId}
          onTitleChange={(_name, count, todos) => onLensResult?.(count, todos)}
          runtimeFilterValue={tab.viewState?.runtimeFilterValue}
          onRuntimeFilterChange={(v) => { void patchTabViewState(tab.id, 'lens', { runtimeFilterValue: v }) }}
        />
      )
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
