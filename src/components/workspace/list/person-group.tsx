import type { TodoGroupBy } from '../../../models/todo-sort-group'
import type { Section } from '../../../services/list-sections'
import { sendPersonCheckin } from '../../../services/checkin-email/person-checkin'
import { personTaskDialog } from '../../../services/task-dialog'
import { copyTasks } from '../../../services/task-copy'
import { useUIStore } from '../../../stores/ui-store'
import { AtIcon, CopyIcon, EnvelopeIcon } from '../../shared/icons'
import type { MenuEntry } from '../../shared/MenuPopover'

/** The person a People group stands for. */
export interface GroupPerson {
  id: number
  name: string
}

const PERSON_KEY = /^person-(\d+)$/

/** The person behind a People group; null for other groupings and for Unassigned. */
export function groupPerson(groupBy: TodoGroupBy, section: Section): GroupPerson | null {
  if (groupBy !== 'people') return null
  const m = PERSON_KEY.exec(section.key)
  return m ? { id: Number(m[1]), name: section.label } : null
}

/** Emails the person their check-in at once (the dialog opens instead when it can't). */
export function emailPersonCheckin(person: GroupPerson): void {
  void sendPersonCheckin(person.id)
}

/** A People group header's menu: email the person a check-in, or show all their tasks. */
export function personGroupMenu(person: GroupPerson): MenuEntry[] {
  return [
    { kind: 'item', label: `Email check-in: ${person.name}`, icon: <EnvelopeIcon />, onSelect: () => emailPersonCheckin(person) },
    {
      kind: 'item',
      label: `Show all of ${person.name}’s tasks`,
      icon: <AtIcon />,
      onSelect: () => useUIStore.getState().showTaskDialog(personTaskDialog(person)),
    },
  ]
}

/**
 * A list group header's menu: `Copy N tasks` — the group's tasks as one list
 * headed by the group's name — after a People group's own two items.
 */
export function listGroupMenu(section: Section, person: GroupPerson | null): MenuEntry[] {
  const n = section.todos.length
  const copy: MenuEntry = {
    kind: 'item',
    label: `Copy ${n} ${n === 1 ? 'task' : 'tasks'}`,
    icon: <CopyIcon />,
    onSelect: () => { void copyTasks([{ label: section.label, todos: [...section.todos] }]) },
  }
  return person ? [...personGroupMenu(person), { kind: 'separator' }, copy] : [copy]
}
