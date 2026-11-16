import { useTodoStore } from '../stores/todo-store'
import { doneToday } from '../utils/tally'
import { useToday } from './use-today'

/** How many tasks were completed today (the top bar's tally, flair P3); midnight resets it. */
export function useDoneToday(): number {
  const today = useToday()
  return useTodoStore((s) => doneToday(s.todos, today))
}
