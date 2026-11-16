/** The counter's words: `61 of 109 open tasks shown` (`tasks` under Show completed). */
export function shownOfTotalText(shown: number, total: number, showCompleted: boolean): string {
  return `${shown} of ${total} ${showCompleted ? 'tasks' : 'open tasks'} shown`
}
