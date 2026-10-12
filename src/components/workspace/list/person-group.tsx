import type { TodoGroupBy } from '../../../models/todo-sort-group'
import type { Section } from '../../../services/list-sections'
import { personTaskDialog } from '../../../services/task-dialog'
import { useUIStore } from '../../../stores/ui-store'
import { AtIcon, EnvelopeIcon } from '../icons'
import type { MenuEntry } from '../MenuPopover'

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

/** Opens the email check-in dialog with the person ticked. */
export function openPersonCheckin(person: GroupPerson): void {
  useUIStore.getState().openCheckinDialog([person.id])
}

/** A People group header's menu: email the person a check-in, or show all their tasks. */
export function personGroupMenu(person: GroupPerson): MenuEntry[] {
  return [
    { kind: 'item', label: `Email check-in: ${person.name}`, icon: <EnvelopeIcon />, onSelect: () => openPersonCheckin(person) },
    {
      kind: 'item',
      label: `Show all of ${person.name}’s tasks`,
      icon: <AtIcon />,
      onSelect: () => useUIStore.getState().showTaskDialog(personTaskDialog(person)),
    },
  ]
}
