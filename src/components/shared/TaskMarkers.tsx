import type { ReactNode } from 'react'
import type { TodoItem } from '../../models'
import { useSettingsStore } from '../../stores/settings-store'
import { urgentByDateReason, urgentMark } from '../../utils/urgency'
import { FocusIcon, ImportantIcon, UrgentClockIcon, UrgentIcon } from './MarkerIcons'

type MarkerFields = Pick<TodoItem, 'urgent' | 'important' | 'focus' | 'dueDate' | 'isCompleted'>

/** One marker glyph with its accessible name, colour and tooltip. Display only. */
function Marker({ label, color, testId, children }: {
  label: string
  color: string
  testId: string
  children: ReactNode
}) {
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId}
      style={{ display: 'inline-flex', flexShrink: 0, lineHeight: 0, color }}
    >
      {children}
    </span>
  )
}

/**
 * A task row's markers, in the fixed order Urgent › Important › Focus, each
 * shown only when set. The Urgent slot shows the clock when only the due date
 * makes the task urgent (`utils/urgency.ts`), the urgent mark when flagged.
 * Renders nothing when the task has no marker. `className` styles the strip
 * (gap, completed dimming); `size` is the glyph size in px.
 */
export function TaskMarkers({ todo, today, size = 14, className }: {
  todo: MarkerFields
  today: Date
  size?: number
  className?: string
}) {
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const urgent = urgentMark(todo, today, range)
  const important = todo.important === true
  const focus = todo.focus === true
  if (!urgent && !important && !focus) return null
  const reason = urgent === 'date' ? urgentByDateReason(todo, today, range) : ''
  return (
    <span className={className} style={{ fontSize: size }} data-testid="task-markers">
      {urgent === 'flag' && (
        <Marker label="Urgent" color="var(--color-marker-urgent)" testId="urgent-marker">
          <UrgentIcon tooltip="Urgent" />
        </Marker>
      )}
      {urgent === 'date' && (
        <Marker label="Urgent: due soon" color="var(--color-marker-urgent)" testId="urgent-clock-marker">
          <UrgentClockIcon tooltip={reason ? `Urgent: due soon\n${reason}` : 'Urgent: due soon'} />
        </Marker>
      )}
      {important && (
        <Marker label="Important" color="var(--color-marker-important)" testId="important-marker">
          <ImportantIcon tooltip="Important" />
        </Marker>
      )}
      {focus && (
        <Marker label="Focus" color="var(--color-marker-focus)" testId="focus-marker">
          <FocusIcon tooltip="Focus" />
        </Marker>
      )}
    </span>
  )
}
