import type { ReactElement } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'
import { useUIStore } from '../../stores/ui-store'
import { NotesWidget } from './NotesWidget'
import { CalendarWidget } from './calendar/CalendarWidget'
import type { GlanceSummary } from './glance/glance-summary'
import { EisenhowerWidget } from './eisenhower/EisenhowerWidget'
import { ListWidget, type ListWidgetResult } from './list/ListWidget'
import { NeglectMapWidget } from './neglect/NeglectMapWidget'
import { GlanceWidget } from './glance/GlanceWidget'
import styles from './WidgetBody.module.css'

/** What a widget reports to its cell (tab count, and what its menu's copy items copy). */
export interface WidgetResult extends ListWidgetResult {
  /** A glance widget: its lines, for "Copy". */
  summary?: GlanceSummary
}

interface WidgetBodyProps {
  tab: LayoutTab
  /**
   * List and Eisenhower tabs report their count label (for the tab); list
   * tabs also their shown sections (for "Copy tasks"), a glance widget its
   * lines (for "Copy").
   */
  onResult?: (result: WidgetResult) => void
}

const NO_SECTIONS: ListWidgetResult['sections'] = []

/** The body of a cell's active tab, by widget kind (a case per kind: a new kind doesn't compile without one; an unknown stored kind gets a note). */
export function WidgetBody({ tab, onResult }: WidgetBodyProps): ReactElement {
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
    case 'neglect':
      return <NeglectMapWidget tab={tab} />
    case 'number':
    case 'trend':
    case 'pulse':
    case 'breakdown':
    case 'pivot':
    case 'statusFlow':
      return (
        <GlanceWidget
          tab={tab}
          onResult={onResult ? (r) => onResult({ sections: NO_SECTIONS, summary: r.summary }) : undefined}
          onDrill={(drill) => useUIStore.getState().showTaskDialog(drill)}
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
