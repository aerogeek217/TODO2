import { expect, test, type Page } from '@playwright/test'
import { seedTaskList, seedWorkspace, wsListWidget } from './fixtures/workspace'

/**
 * RuntimeFilterPicker (a list widget's prompt row): the panel portals to
 * `document.body` and flips above the field when there is no room below,
 * and removing the last picked chip returns the widget to its prompt.
 *
 * JSDOM is unauthoritative — the panel's positioning rides
 * `usePopoverAnchor`'s `getBoundingClientRect` reads of the field and the
 * viewport, which only resolve correctly under a real DOM.
 */

interface PanelGeom { left: number; top: number; right: number; bottom: number; width: number; height: number; portaled: boolean }

/**
 * Finds the portaled `RuntimeFilterPicker` panel by walking up from a known
 * option button (one with `name` text) to the `document.body` direct child
 * that wraps it. The panel sets `position: fixed` inline + portals to body.
 */
async function findPanelRect(page: Page, optionName: string): Promise<PanelGeom | null> {
  return await page.evaluate((target) => {
    const buttons = Array.from(document.body.querySelectorAll('button[type="button"]'))
    for (const btn of buttons) {
      if (!btn.textContent?.includes(target)) continue
      if (btn.closest('[data-list-widget]')) continue
      let el: HTMLElement | null = btn as HTMLElement
      // Climb to the direct child of <body>.
      while (el && el.parentElement && el.parentElement !== document.body) {
        el = el.parentElement
      }
      if (!el) continue
      if (el.style.position !== 'fixed') continue
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, portaled: el.parentElement === document.body }
    }
    return null
  }, optionName)
}

test('panel portals to body and flips above the field when the widget sits at the viewport bottom', async ({ page }) => {
  // The list widget is the short bottom cell of a column, so its prompt
  // field sits near the viewport bottom: the default bottom-start placement
  // would overflow → `usePopoverAnchor`'s flip lands the panel above.
  await seedWorkspace(page, {
    people: ['Ada', 'Bob', 'Cy', 'Di'],
    listDefinitions: [{ name: 'Person picker', runtimeFilter: { field: 'person' } }],
    layouts: [{
      name: 'Main',
      columns: [{
        id: 'col',
        cells: [
          { id: 'top', weight: 5, tabs: [{ id: 'notesTab', kind: 'notes' }] },
          { id: 'bottom', weight: 1, tabs: [{ id: 'listTab', kind: 'lens', listDefIdx: 0 }] },
        ],
      }],
    }],
  })

  const input = wsListWidget(page, 'listTab').getByLabel('Filter tasks by person')
  await expect(input).toBeVisible()
  await input.click()
  await expect(page.getByRole('button', { name: 'Ada', exact: true })).toBeVisible()

  const panel = await findPanelRect(page, 'Ada')
  expect(panel).not.toBeNull()
  if (!panel) return
  expect(panel.portaled).toBe(true)
  expect(panel.height).toBeGreaterThan(0)

  const vh = await page.evaluate(() => window.innerHeight)
  const vw = await page.evaluate(() => window.innerWidth)
  const inputBox = await input.boundingBox()
  if (!inputBox) throw new Error('no input box')
  // The field is low enough that the panel can't fit below it.
  expect(inputBox.y + inputBox.height + 4 + panel.height).toBeGreaterThan(vh - 8)

  // Inside the viewport (8 px margin per usePopoverAnchor).
  expect(panel.top).toBeGreaterThanOrEqual(8)
  expect(panel.bottom).toBeLessThanOrEqual(vh - 8)
  expect(panel.left).toBeGreaterThanOrEqual(8)
  expect(panel.right).toBeLessThanOrEqual(vw - 8)

  // Flip happened: panel is above the input rect.
  expect(panel.bottom).toBeLessThanOrEqual(inputBox.y + 1)
})

test('removing the last picked chip returns the widget to its prompt', async ({ page }) => {
  const widget = await seedTaskList(page, {
    people: ['Ada'],
    tasks: [{ title: 'Ada task', people: ['Ada'] }, { title: 'Other task' }],
    list: { name: 'Clear chip', runtimeFilter: { field: 'person' } },
  })
  const rows = widget.locator('[data-todo-id]')
  await expect(widget).toContainText('Pick a person to show this list')
  await expect(rows).toHaveCount(0)

  const input = widget.getByLabel('Filter tasks by person')
  await input.click()
  await page.getByRole('button', { name: 'Ada', exact: true }).click()
  await page.keyboard.press('Escape')
  const removeChip = widget.getByRole('button', { name: 'Remove Ada' })
  await expect(removeChip).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('Ada task')

  // × on the only chip: the pick is empty again, so the prompt is back.
  await removeChip.click()
  await expect(removeChip).toHaveCount(0)
  await expect(rows).toHaveCount(0)
  await expect(widget).toContainText('Pick a person to show this list')
})
