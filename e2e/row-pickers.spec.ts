import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The row and bulk-bar pickers (status menu, people / tag pickers) are placed
 * by `usePopoverAnchor`: below the trigger, flipped above it near the bottom
 * edge and to its right edge near the right one, always inside the viewport;
 * they follow the trigger while the list scrolls and re-place themselves when
 * they change size. A click on the trigger toggles the picker, an outside
 * click closes it, and Esc closes it without reaching anything behind.
 * Placement and focus are layout-dependent, so a real browser is the
 * authoritative surface.
 */

const MARGIN = 8
const FILLERS = Array.from({ length: 30 }, (_, n) => ({ title: `Filler task ${n + 1}` }))

/** The list in the right-hand column, so its rows' trailing pills sit near the window's right edge. */
function seed(tasks: WorkspaceSeed['tasks']): WorkspaceSeed {
  return {
    listDefinitions: [{ name: 'Tasks' }],
    people: ['Alice', 'Bob', 'Carol'],
    tags: ['home', 'work', 'errands'],
    statuses: ['Doing', 'Waiting'],
    tasks,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'n1', tabs: [{ id: 'notes1', kind: 'notes' }] }] },
        { id: 'c2', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] },
      ],
    }],
  }
}

async function open(page: Page, tasks: WorkspaceSeed['tasks']): Promise<Locator> {
  await seedWorkspace(page, seed(tasks))
  const widget = wsListWidget(page, 'tasks')
  await widget.waitFor({ state: 'visible' })
  return widget
}

const picker = (page: Page) => page.locator('[data-anchored-picker]')

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

async function expectInsideViewport(page: Page, panel: Locator): Promise<void> {
  const vp = page.viewportSize()
  if (!vp) throw new Error('no viewport')
  const p = await box(panel)
  expect(p.x).toBeGreaterThanOrEqual(MARGIN - 0.5)
  expect(p.y).toBeGreaterThanOrEqual(MARGIN - 0.5)
  expect(p.x + p.width).toBeLessThanOrEqual(vp.width - MARGIN + 0.5)
  expect(p.y + p.height).toBeLessThanOrEqual(vp.height - MARGIN + 0.5)
}

/** A real mousedown outside any popover: the notes column. */
async function clickOutside(page: Page): Promise<void> {
  await page.mouse.click(40, 400)
}

test.describe('status menu', () => {
  test('near the right edge it ends at the status pill; the pill toggles it, Esc and an outside click close it', async ({ page }) => {
    await open(page, [{ title: 'Top task', status: 'Doing' }])
    const trigger = taskRowByTitle(page, 'Top task').getByRole('button', { name: 'Status: Doing' })
    await trigger.click()
    const menu = picker(page)
    await expect(menu.getByRole('button', { name: 'No Status' })).toBeVisible()
    await expectInsideViewport(page, menu)
    const t = await box(trigger)
    const m = await box(menu)
    // Start-aligned at the pill, it would have crossed the right edge: it ends at the pill's right edge, below it.
    expect(t.x + m.width).toBeGreaterThan((page.viewportSize()?.width ?? 0) - MARGIN)
    expect(Math.abs(m.x + m.width - (t.x + t.width))).toBeLessThan(1)
    expect(m.y).toBeGreaterThanOrEqual(t.y + t.height)

    await trigger.click()
    await expect(menu).toHaveCount(0)

    await trigger.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await trigger.click()
    await expect(menu).toBeVisible()
    await clickOutside(page)
    await expect(menu).toHaveCount(0)
  })

  test('near the bottom it opens above the pill, and a pick sets the status', async ({ page }) => {
    await open(page, [...FILLERS, { title: 'Last task' }])
    const row = taskRowByTitle(page, 'Last task')
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    const trigger = row.getByRole('button', { name: 'Set status' })
    await trigger.click()
    const menu = picker(page)
    await expect(menu).toBeVisible()
    await expectInsideViewport(page, menu)
    expect((await box(menu)).y + (await box(menu)).height).toBeLessThanOrEqual((await box(trigger)).y)
    await menu.getByRole('button', { name: 'Waiting' }).click()
    await expect(menu).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Status: Waiting' })).toBeVisible()
  })
})

test.describe('people picker', () => {
  test('near the bottom it opens above the @ trigger and stays there as its list narrows', async ({ page }) => {
    await open(page, [...FILLERS, { title: 'Last task' }])
    const row = taskRowByTitle(page, 'Last task')
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    const trigger = row.getByRole('button', { name: '@', exact: true })
    await trigger.click()
    const panel = picker(page)
    await expect(panel.getByRole('combobox')).toBeFocused()
    await expectInsideViewport(page, panel)
    const t = await box(trigger)
    const before = await box(panel)
    expect(before.y + before.height).toBeLessThanOrEqual(t.y)

    // Typing narrows the list: the panel shrinks and is re-placed against the trigger.
    await page.keyboard.type('Carol')
    await expect(panel.getByRole('option')).toHaveCount(1)
    await expect.poll(async () => Math.round((await box(trigger)).y - ((await box(panel)).y + (await box(panel)).height))).toBe(4)
    expect((await box(panel)).height).toBeLessThan(before.height)
  })

  test('the trigger toggles it; Esc and an outside click close it', async ({ page }) => {
    await open(page, [{ title: 'Top task', people: ['Alice'] }])
    const trigger = taskRowByTitle(page, 'Top task').getByRole('button', { name: '1 person assigned' })
    await trigger.click()
    const panel = picker(page)
    await expect(panel.getByRole('combobox')).toBeFocused()
    await trigger.click()
    await expect(panel).toHaveCount(0)

    await trigger.click()
    await expect(panel.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    await trigger.click()
    await expect(panel).toBeVisible()
    await clickOutside(page)
    await expect(panel).toHaveCount(0)
  })

  test('follows the trigger when the list scrolls', async ({ page }) => {
    await open(page, [{ title: 'Top task', people: ['Alice'] }, ...FILLERS])
    const trigger = taskRowByTitle(page, 'Top task').getByRole('button', { name: '1 person assigned' })
    await trigger.click()
    const panel = picker(page)
    await expect(panel).toBeVisible()
    const before = await box(trigger)
    await trigger.evaluate((el) => {
      let node: HTMLElement | null = el.parentElement
      while (node && !(node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible')) {
        node = node.parentElement
      }
      if (!node) throw new Error('no scrolling ancestor')
      node.scrollTop += 30
    })
    await expect.poll(async () => (await box(trigger)).y).toBeLessThan(before.y - 10)
    await expect(panel).toBeVisible()
    const t = await box(trigger)
    await expect.poll(async () => Math.round((await box(panel)).y - (t.y + t.height))).toBe(4)
  })
})

test.describe('tag picker', () => {
  test('near the bottom it opens above the # trigger; Esc in its search closes it', async ({ page }) => {
    await open(page, [...FILLERS, { title: 'Last task' }])
    const row = taskRowByTitle(page, 'Last task')
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    const trigger = row.getByRole('button', { name: 'Add tag' })
    await trigger.click()
    const panel = picker(page)
    await expect(panel.getByRole('combobox')).toBeFocused()
    await expectInsideViewport(page, panel)
    expect((await box(panel)).y + (await box(panel)).height).toBeLessThanOrEqual((await box(trigger)).y)

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })

  test('a tag chip toggles it; an outside click closes it', async ({ page }) => {
    await open(page, [{ title: 'Top task', tags: ['home'] }])
    const chip = taskRowByTitle(page, 'Top task').getByRole('button', { name: '#home' })
    await chip.click()
    const panel = picker(page)
    await expect(panel).toBeVisible()
    await chip.click()
    await expect(panel).toHaveCount(0)
    await chip.click()
    await expect(panel).toBeVisible()
    await clickOutside(page)
    await expect(panel).toHaveCount(0)
  })
})

test.describe('bulk bar pickers', () => {
  async function selectTwo(page: Page): Promise<Locator> {
    await taskRowByTitle(page, 'one').locator('span[title="one"]').click()
    await taskRowByTitle(page, 'two').locator('span[title="two"]').click({ modifiers: ['Shift'] })
    const bar = page.getByTestId('list-bulk-bar')
    await expect(bar).toBeVisible()
    return bar
  }

  for (const [name, label] of [['people', 'Assign people'], ['tags', 'Add tag']] as const) {
    test(`${name}: opens above its button inside the viewport; the button toggles it, Esc and an outside click close it`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 560 })
      await open(page, [{ title: 'one' }, { title: 'two' }])
      const bar = await selectTwo(page)
      const button = bar.getByRole('button', { name: label })
      await button.click()
      const panel = picker(page)
      await expect(panel.getByRole('combobox')).toBeFocused()
      await expectInsideViewport(page, panel)
      // The bar sits at the bottom of the widget: the picker opens above the button, not over it.
      expect((await box(panel)).y + (await box(panel)).height).toBeLessThanOrEqual((await box(button)).y)

      await button.click()
      await expect(panel).toHaveCount(0)

      await button.click()
      await expect(panel.getByRole('combobox')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      // Esc in the picker doesn't also clear the selection.
      await expect(bar).toBeVisible()

      await button.click()
      await expect(panel).toBeVisible()
      await clickOutside(page)
      await expect(panel).toHaveCount(0)
    })
  }
})

test.describe('mobile row people picker', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Assign people… with nobody assigned opens it under the row; a tap on the row closes it', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Tasks' }],
      people: ['Alice'],
      tasks: [{ title: 'Pay the bill' }],
      layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] }] }],
    })
    const row = page.locator('[data-todo-id]').filter({ hasText: 'Pay the bill' })
    await expect(row).toBeVisible()
    // Mobile browsers turn a long press into `contextmenu`.
    await row.dispatchEvent('contextmenu')
    await page.getByRole('menuitem', { name: 'Assign people…' }).click()
    const panel = picker(page)
    await expect(panel).toBeVisible()
    await expectInsideViewport(page, panel)
    const r = await box(row)
    expect((await box(panel)).y).toBeGreaterThanOrEqual(r.y)

    // The row is only where it sits, not its trigger: a tap on it closes the picker.
    await page.mouse.click(r.x + r.width - 30, r.y + 8)
    await expect(panel).toHaveCount(0)
  })
})

/**
 * Both rows open the same pickers through one hook: the menu's Assign people…
 * and Add tag…, the follow-up flag and the notes icon do the same on the
 * desktop and the phone row.
 */
for (const phone of [false, true]) {
  test.describe(phone ? 'phone row pickers' : 'desktop row pickers', () => {
    if (phone) test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('Assign people…, Add tag…, the follow-up flag and the notes icon', async ({ page }) => {
      await seedWorkspace(page, {
        listDefinitions: [{ name: 'Tasks' }],
        people: ['Alice'],
        tags: ['home'],
        tasks: [{ title: 'Pay the bill', notes: 'Account 42' }],
        layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] }] }],
      })
      const row = page.locator('[data-todo-id]').filter({ hasText: 'Pay the bill' })
      await expect(row).toBeVisible()
      const openMenu = () => (phone ? row.dispatchEvent('contextmenu') : row.click({ button: 'right' }))

      await openMenu()
      await page.getByRole('menuitem', { name: 'Assign people…' }).click()
      await expect(picker(page)).toBeVisible()
      await picker(page).getByText('Alice', { exact: true }).click()
      await expect(row.getByTitle('Alice')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(picker(page)).toHaveCount(0)

      await openMenu()
      await page.getByRole('menuitem', { name: 'Add tag…' }).click()
      await expect(picker(page)).toBeVisible()
      await picker(page).getByText('home', { exact: true }).click()
      await expect(row.getByText('#home')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(picker(page)).toHaveCount(0)

      const flag = row.getByRole('button', { name: 'Set follow-up' })
      if (!phone) await row.hover()
      await flag.click()
      await expect(page.getByRole('dialog', { name: 'Follow-up' })).toBeVisible()
      await expect(flag).toHaveAttribute('aria-expanded', 'true')
      await flag.click()
      await expect(page.getByRole('dialog', { name: 'Follow-up' })).toHaveCount(0)

      const notesIcon = row.getByRole('button', { name: 'Edit notes' })
      await notesIcon.click()
      await expect(page.getByRole('dialog', { name: 'Task notes' })).toContainText('Account 42')
      await notesIcon.click()
      await expect(page.getByRole('dialog', { name: 'Task notes' })).toHaveCount(0)
    })
  })
}
