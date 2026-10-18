import { MARKER_KEYS, type MarkerKey, type PersistedTodoItem } from '../../models'
import { isEffectivelyUrgent, type UrgentDueWithinDays } from '../../utils/urgency'
import { MARKER_COLOR, MARKER_LABELS, MARKERS_LABEL } from '../../utils/markers'
import {
  addFollowupInterval,
  describeFollowupInterval,
  formatFollowupDate,
  formatFollowupDay,
  isFollowedUpToday,
  QUICK_FOLLOWUP_INTERVALS,
} from '../../utils/followup'
import type { MenuEntry } from '../shared/MenuPopover'
import { CheckCircleIcon, CloseIcon, FlagIcon, HashIcon, OpenIcon, PersonIcon, TrashIcon, WidgetKindIcon } from '../shared/icons'
import { FollowedUpIcon } from '../shared/FollowupIcons'
import { FocusIcon, ImportantIcon, UrgentIcon } from '../shared/MarkerIcons'
import { StatusIcon } from '../shared/StatusIcon'

/**
 * What the task menu's items do. Optional handlers drop their item (a surface
 * without the picker leaves it out). Every handler acts on the clicked task —
 * or the selection it belongs to — through the surface's bulk-aware path.
 */
export interface TaskMenuHandlers {
  /** "Open" (single task only). */
  onOpen?: () => void
  onToggleComplete: () => void
  /** "Set due date…": opens the due date picker. */
  onSetDueDate?: () => void
  /** Follow-up submenu: sets the next follow-up to the given day. */
  onSetFollowup: (date: Date | null) => void
  /** "Pick a date or interval…": opens the follow-up popover. */
  onPickFollowup?: () => void
  onFollowedUp: () => void
  /** "Assign people…": opens the person picker. */
  onAssignPeople?: () => void
  /** "Add tag…": opens the tag picker. */
  onAddTag?: () => void
  /** A Markers item: `on` = set it on every task, off = clear it on every task. */
  onSetMarker: (marker: MarkerKey, on: boolean) => void
  onDelete: () => void
}

export interface BuildTaskMenuOpts {
  /** The task the menu was opened on. */
  todo: PersistedTodoItem
  /** The tasks the menu acts on: the selection the task is part of, or just the task. */
  targets: readonly PersistedTodoItem[]
  today: Date
  urgentRange: UrgentDueWithinDays
  handlers: TaskMenuHandlers
}

const MARKER_ICON: Record<MarkerKey, React.ReactNode> = {
  focus: <FocusIcon />,
  urgent: <UrgentIcon />,
  important: <ImportantIcon outline />,
}

/** The menu's marker items, in display order. */
const MARKERS = MARKER_KEYS.map((key) => ({ key, label: MARKER_LABELS[key], icon: MARKER_ICON[key], color: MARKER_COLOR[key] }))

function markerCount(key: MarkerKey, targets: readonly PersistedTodoItem[], today: Date, range: UrgentDueWithinDays): number {
  return targets.filter((t) => {
    if (key === 'urgent') return isEffectivelyUrgent(t, today, range)
    return t[key] === true
  }).length
}

/**
 * Markers group shared by the task menu and the list bulk bar's ⋯ More:
 * checkbox items per marker. Some of several tasks = mixed (`1 of 3` + a
 * dash); a click on an unchecked or mixed item turns the marker on for all,
 * on a checked one off for all. Urgent counts tasks urgent by due date
 * (turning it off asks about those dates).
 */
export function markerMenuEntries(
  targets: readonly PersistedTodoItem[],
  today: Date,
  range: UrgentDueWithinDays,
  onSetMarker: (marker: MarkerKey, on: boolean) => void,
): MenuEntry[] {
  const n = targets.length
  return [
    { kind: 'label', text: MARKERS_LABEL },
    ...MARKERS.map(({ key, label, icon, color }): MenuEntry => {
      const count = markerCount(key, targets, today, range)
      const checked = n > 0 && count === n ? true : count > 0 ? 'mixed' : false
      return {
        kind: 'item',
        label,
        icon: <span style={{ display: 'inline-flex', color }}>{icon}</span>,
        checkbox: true,
        checked,
        note: checked === 'mixed' ? `${count} of ${n}` : undefined,
        onSelect: () => onSetMarker(key, checked !== true),
      }
    }),
  ]
}

/** "Followed up" — dimmed when every task was already followed up today. */
export function followedUpMenuEntry(
  targets: readonly PersistedTodoItem[],
  today: Date,
  onFollowedUp: () => void,
): MenuEntry {
  const doneToday = targets.length > 0 && targets.every((t) => isFollowedUpToday(t, today))
  return {
    kind: 'item',
    label: 'Followed up',
    icon: <FollowedUpIcon />,
    dim: doneToday,
    note: doneToday ? 'Today' : undefined,
    onSelect: onFollowedUp,
  }
}

/**
 * The one task menu (a row's right-click / context-menu key, long-press, search result):
 * Open · Mark complete | Set due date… · Follow-up › · Followed up · Assign
 * people… · Add tag… | Markers | Delete. With several tasks a `N tasks` label
 * replaces Open, Delete names the count, and the markers can be mixed.
 */
export function buildTaskMenuEntries({ todo, targets, today, urgentRange, handlers }: BuildTaskMenuOpts): MenuEntry[] {
  const several = targets.length > 1
  const h = handlers
  const hasFollowup = several ? targets.some((t) => t.nextFollowupAt) : !!todo.nextFollowupAt

  const followupChildren: MenuEntry[] = [
    ...QUICK_FOLLOWUP_INTERVALS.map((interval): MenuEntry => {
      const date = addFollowupInterval(today, interval)
      return {
        kind: 'item',
        label: describeFollowupInterval(interval),
        note: formatFollowupDate(date, today),
        onSelect: () => h.onSetFollowup(date),
      }
    }),
    ...(h.onPickFollowup || hasFollowup ? [{ kind: 'separator' } as const] : []),
    ...(h.onPickFollowup ? [{
      kind: 'item', label: 'Pick a date or interval…', icon: <WidgetKindIcon kind="calendar" />, onSelect: h.onPickFollowup,
    } as const] : []),
    ...(hasFollowup ? [{
      kind: 'item', label: 'Clear follow-up', icon: <CloseIcon size={14} strokeWidth={1.6} />, onSelect: () => h.onSetFollowup(null),
    } as const] : []),
  ]

  const entries: MenuEntry[] = []
  if (several) entries.push({ kind: 'label', text: `${targets.length} tasks` })
  else if (h.onOpen) entries.push({ kind: 'item', label: 'Open', icon: <OpenIcon />, onSelect: h.onOpen })
  entries.push(
    {
      kind: 'item',
      label: todo.isCompleted ? 'Mark incomplete' : 'Mark complete',
      icon: <CheckCircleIcon />,
      kbd: 'Space',
      onSelect: h.onToggleComplete,
    },
    { kind: 'separator' },
  )
  if (h.onSetDueDate) {
    entries.push({
      kind: 'item',
      label: 'Set due date…',
      icon: <StatusIcon icon="calendar" />,
      note: !several && todo.dueDate ? formatFollowupDay(todo.dueDate, today) : undefined,
      onSelect: h.onSetDueDate,
    })
  }
  entries.push(
    {
      kind: 'item',
      label: 'Follow-up',
      icon: <FlagIcon />,
      note: !several && todo.nextFollowupAt ? formatFollowupDay(todo.nextFollowupAt, today) : undefined,
      children: followupChildren,
      childrenWidth: 232,
    },
    followedUpMenuEntry(targets, today, h.onFollowedUp),
  )
  if (h.onAssignPeople) entries.push({ kind: 'item', label: 'Assign people…', icon: <PersonIcon />, onSelect: h.onAssignPeople })
  if (h.onAddTag) entries.push({ kind: 'item', label: 'Add tag…', icon: <HashIcon />, onSelect: h.onAddTag })
  entries.push(
    { kind: 'separator' },
    ...markerMenuEntries(targets, today, urgentRange, h.onSetMarker),
    { kind: 'separator' },
    {
      kind: 'item',
      label: several ? `Delete ${targets.length} tasks` : 'Delete',
      icon: <TrashIcon />,
      danger: true,
      kbd: 'Del',
      onSelect: h.onDelete,
    },
  )
  return entries
}
