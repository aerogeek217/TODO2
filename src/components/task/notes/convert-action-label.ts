/** `2 tasks` / `1 task`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * What confirming the preview does, in the words of its button: `Create 2 tasks`,
 * `Create 2 tasks, remove 1 line`, `Remove 1 line`. With `removeConverted` (the
 * setting) the lines of the tasks go too, so the button counts them.
 */
export function convertActionLabel(rows: readonly { checked?: boolean }[], removeConverted = false): string {
  const cleared = rows.filter((r) => r.checked === true).length
  const tasks = rows.length - cleared
  if (tasks === 0 && cleared > 0) return `Remove ${plural(cleared, 'line', 'lines')}`
  const create = `Create ${plural(tasks, 'task', 'tasks')}`
  const removed = removeConverted ? rows.length : cleared
  return removed > 0 ? `${create}, remove ${plural(removed, 'line', 'lines')}` : create
}
