/**
 * Where the keyboard focus goes after a Planner row's own control moved the
 * row: Snooze, Unplan and a fix remount the row under another group (or
 * unmount the control that was pressed), which would drop the focus on the
 * page's body. After the write the focus goes to **the row at its new
 * place**; when the row left the view, to the row that took its place in
 * the group it was in; with none, to that group's heading.
 */

const HOST = '[data-planner]'
const GROUP = '[data-planner-group]'
const ROW = '[data-planner-row]'
/** A group's heading (`PlannerWidget`'s group header: focusable from here, never a tab stop). */
export const PLANNER_HEADING_ATTR = 'data-planner-heading'

const rowsOf = (group: Element): HTMLElement[] => Array.from(group.querySelectorAll<HTMLElement>(ROW))
const rowOf = (host: Element, todoId: number): HTMLElement | null => host.querySelector<HTMLElement>(`${ROW}[data-planner-row="${todoId}"]`)

/**
 * What takes the focus in a row: the control pressed (`cell`, its
 * `data-row-cell`) when the row still has it, else its Snooze button (a
 * row in Unplanned: its Today button), else its checkbox, a line's own stop, or whatever it has that takes focus.
 */
function rowTarget(row: Element, cell: string | null): HTMLElement | null {
  const picks = [
    cell ? `[data-row-cell="${cell}"]` : null,
    '[data-row-cell="planner-snooze"]',
    '[data-row-cell="planner-today"]',
    'input[type="checkbox"]',
    '[data-task-line]',
    'button, [tabindex]',
  ]
  for (const pick of picks) {
    const el = pick ? row.querySelector<HTMLElement>(pick) : null
    if (el) return el
  }
  return null
}

const nextFrame = (): Promise<void> => new Promise((resolve) => { requestAnimationFrame(() => resolve()) })

/**
 * Runs `write` — a move of the row of task `todoId`, made from the control
 * `from` inside it — and then puts the focus where the row went (above).
 * Only when the focus was lost: one that sits on a live element after the
 * write (the row didn't move, the user went elsewhere) is left alone.
 */
export async function keepPlannerRowFocus(from: Element, todoId: number, write: () => Promise<void>): Promise<void> {
  const host = from.closest<HTMLElement>(HOST)
  const group = from.closest<HTMLElement>(GROUP)
  const cell = from.closest('[data-row-cell]')?.getAttribute('data-row-cell') ?? null
  const index = group ? rowsOf(group).findIndex((row) => row.getAttribute('data-planner-row') === String(todoId)) : -1
  await write()
  await nextFrame()
  if (!host?.isConnected) return
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected) return
  const moved = rowOf(host, todoId)
  if (moved) {
    rowTarget(moved, cell)?.focus()
    return
  }
  // It left the view: the row that took its place in its group, else the group's heading.
  const left = group?.isConnected ? group : null
  const rows = left ? rowsOf(left) : []
  const taker = rows[Math.min(Math.max(index, 0), rows.length - 1)]
  const heading = (left ?? host).querySelector<HTMLElement>(`[${PLANNER_HEADING_ATTR}]`)
  ;(taker ? rowTarget(taker, cell) : heading)?.focus()
}
