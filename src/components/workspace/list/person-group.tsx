import type { TodoGroupBy } from '../../../models/todo-sort-group'
import type { Section } from '../../../services/list-sections'
import { copyTasks } from '../../../services/task-copy'
import { entityMenuEntries, type EntityMenuOffers } from '../../shared/person-menu-entries'
import { CopyIcon } from '../../shared/icons'
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

/**
 * A list group header's menu: a People group's person menu
 * (`entityMenuEntries`: Review with X ·
 * Show tasks · Edit… · Delete…, each where `offers` allows it),
 * then `Copy N tasks` — the group's tasks as one list headed by the
 * group's name.
 */
export function listGroupMenu(section: Section, person: GroupPerson | null, offers: EntityMenuOffers): MenuEntry[] {
  const n = section.todos.length
  const copy: MenuEntry = {
    kind: 'item',
    label: `Copy ${n} ${n === 1 ? 'task' : 'tasks'}`,
    icon: <CopyIcon />,
    onSelect: () => { void copyTasks([{ label: section.label, todos: [...section.todos] }]) },
  }
  return person ? [...entityMenuEntries({ kind: 'person', entity: person }, offers), { kind: 'separator' }, copy] : [copy]
}
