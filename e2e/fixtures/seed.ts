import type { Page, Locator } from '@playwright/test'

/** Locator for a list widget row wrapper by its visible title. Each list
 *  widget row is wrapped in `[data-row-key]`; the inner TaskRow also carries
 *  `data-todo-id`, so anchoring on `[data-row-key]` keeps counts accurate
 *  (one element per row) and clicks bubble down to the inner row's onClick.
 *  Assumes one list widget on screen (`seedTaskList`). */
export function taskRowByTitle(page: Page, title: string): Locator {
  return page.locator('[data-row-key]').filter({ hasText: title })
}

/** Click a task row's title span to fire `onSelect`. Clicking the row wrapper's
 *  bbox center can land on a chip popover trigger (`#`/`@`/date/status), so
 *  callers that need selection must aim at the title text. The title span
 *  carries `title={todo.title}` for tooltip parity, which we use as a stable
 *  selector that only fires the row's onSelect. */
export async function selectTaskRowByTitle(page: Page, title: string): Promise<void> {
  await taskRowByTitle(page, title).locator(`span[title="${title}"]`).click()
}

/** The titles of the task rows in `scope` (a widget, a quadrant, a group), top to bottom. */
export async function rowTitles(scope: Locator): Promise<string[]> {
  return scope.locator('[data-todo-id]').evaluateAll(
    (els) => els.map((el) => el.querySelector('span[title]')?.getAttribute('title') ?? ''),
  )
}
