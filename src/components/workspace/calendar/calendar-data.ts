import { useContext, useMemo } from 'react'
import type { CalendarTab } from '../../../models/workspace-layout'
import { useScreenTasks } from '../../../hooks/use-glance-data'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useToday } from '../../../hooks/use-today'
import { buildEntries, type CalendarEntry } from '../../../services/calendar-entries'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import type { WeekStart } from '../../../utils/effective-date'
import { calendarScope, PendingCalendarDropContext } from './calendar-drag'
import { type DayContext, useTaskDrag } from './calendar-day'

/**
 * What the full calendar and its faces (D25 R) share: the day, the week's
 * start, and the context every day cell takes — its drag, its pending drop,
 * its date types and the editor it opens.
 */
export interface CalendarSetup {
  ctx: DayContext
  today: Date
  weekStartsOn: WeekStart
  isMobile: boolean
}

export function useCalendarSetup(tab: CalendarTab): CalendarSetup {
  const isMobile = useIsMobile()
  const today = useToday()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const pending = useContext(PendingCalendarDropContext)
  const drag = useTaskDrag()
  const dateTypes = tab.config.dateTypes
  const scope = calendarScope(tab.id)
  const ctx = useMemo<DayContext>(() => ({
    tabId: tab.id,
    scope,
    dateTypes,
    today,
    drag,
    pendingMs: pending?.scope === scope ? pending.dateMs : null,
    noDrag: isMobile,
    onOpen: openEditPopup,
  }), [tab.id, scope, dateTypes, today, drag, pending, isMobile, openEditPopup])
  return { ctx, today, weekStartsOn, isMobile }
}

/**
 * The entries on `days` of the tasks the screen filter shows
 * (`useScreenTasks`: the glance widgets' shared base, so every calendar on
 * screen reads the one filtered list), by day key, of the tab's date types.
 */
export function useCalendarEntries(tab: CalendarTab, days: readonly Date[]): Map<string, CalendarEntry[]> {
  const shown = useScreenTasks()
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const dateTypes = tab.config.dateTypes
  return useMemo(
    () => buildEntries(shown, days, { assignedPeopleMap, statuses, dateTypes }),
    [shown, days, assignedPeopleMap, statuses, dateTypes],
  )
}
