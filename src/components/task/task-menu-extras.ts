import { createContext } from 'react'
import type { PersistedTodoItem } from '../../models'
import type { MenuEntry } from '../shared/MenuPopover'

/**
 * What the surface around a row adds to its task menu, for the one task it
 * was opened on (`TaskMenu` reads it, so every row kind — desktop row, line,
 * phone row — gets it): the entries lead the menu's dates group, before Set
 * due date… — the Planner's Plan for day ›. Null: nothing. A menu acting on
 * several tasks shows none.
 */
export const TaskMenuExtrasContext = createContext<((todo: PersistedTodoItem) => readonly MenuEntry[]) | null>(null)
