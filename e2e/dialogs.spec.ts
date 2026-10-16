import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The shared dialog frame's contract, per dialog, in a real browser (focus
 * and hit-testing aren't JSDOM's): Esc closes it — focused or with nothing
 * focused; Tab / Shift+Tab wrap inside it; focus returns to the trigger; a
 * press that starts inside the panel and ends on the backdrop keeps it open,
 * a press on the backdrop closes it. And the stacks: the editor over the
 * task dialog, the check-in dialog over the task dialog, the email editor
 * over the check-in dialog, the people editor over Settings, the list editor
 * over the lists editor in Settings, "Continue without a backup?" over the
 * append-import dialog.
 */

const VIEWPORT = { width: 1440, height: 900 }
test.use({ viewport: VIEWPORT })

const SEED: WorkspaceSeed = {
  people: [{ name: 'Alice Chen', email: 'alice@example.com' }, 'Ben Ortiz'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Fix checkout outage', urgent: true, important: true, dueInDays: 0, people: ['Alice Chen', 'Ben Ortiz'] },
    { title: 'Plan the offsite', focus: true, dueInDays: 3, people: ['Alice Chen'] },
    { title: 'Call the plumber', dueInDays: -2, people: ['Ben Ortiz'] },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { listTileIdxs: [] } }] }] },
    ],
  }],
}

const dash = (page: Page) => page.locator('[data-dashboard="dash"]')
const hotTile = (page: Page) => dash(page).locator('[data-dash-tile="hot"]')
const taskDialog = (page: Page) => page.locator('[data-task-dialog]')
const checkin = (page: Page) => page.getByRole('dialog', { name: 'Email task check-ins' })
const editorTitle = (page: Page) => page.getByRole('textbox', { name: 'Task title' })

/** Nothing focused: the next key lands on the page itself. */
async function blurAll(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)
}

const focusInside = (dialog: Locator) => dialog.evaluate((panel) => panel.contains(document.activeElement))

/**
 * Tab / Shift+Tab wrap at the panel's ends, and a full lap of Tab never
 * leaves it. Ends are the rendered controls the frame cycles through.
 */
async function expectFocusTrapped(page: Page, dialog: Locator) {
  const count = await dialog.evaluate((panel) => {
    const sel = 'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const items = Array.from(panel.querySelectorAll<HTMLElement>(sel)).filter((el) => el.getClientRects().length > 0)
    panel.querySelectorAll('[data-e2e-end]').forEach((el) => el.removeAttribute('data-e2e-end'))
    items.at(0)?.setAttribute('data-e2e-end', 'first')
    items.at(-1)?.setAttribute('data-e2e-end', 'last')
    return items.length
  })
  expect(count).toBeGreaterThan(1)
  const first = dialog.locator('[data-e2e-end="first"]')
  const last = dialog.locator('[data-e2e-end="last"]')
  await last.focus()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(last).toBeFocused()
  for (let i = 0; i <= count; i++) {
    await page.keyboard.press('Tab')
    expect(await focusInside(dialog)).toBe(true)
  }
  await first.focus()
}

/** A press inside `grip` dragged out onto the backdrop and released there. */
async function dragOutOfPanel(page: Page, grip: Locator) {
  const box = await grip.boundingBox()
  if (!box) throw new Error('no box')
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(8, VIEWPORT.height - 8, { steps: 6 })
  await page.mouse.up()
}

const pressBackdrop = (page: Page) => page.mouse.click(8, VIEWPORT.height - 8)

interface Contract {
  dialog: Locator
  /** Opens the dialog from `trigger` (and resolves once it shows). */
  open: () => Promise<void>
  trigger: Locator
  /** Plain text inside the panel to start a drag on. */
  inside: Locator
  /** Where focus lands on open. */
  initialFocus: Locator
}

/** The panel sits in the middle of the window (the frame centres it without a transform). */
async function expectCentred(dialog: Locator) {
  const box = await dialog.boundingBox()
  if (!box) throw new Error('no box')
  expect(Math.abs(box.x + box.width / 2 - VIEWPORT.width / 2)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y + box.height / 2 - VIEWPORT.height / 2)).toBeLessThanOrEqual(1)
  expect(box.height).toBeLessThan(VIEWPORT.height)
}

async function checkContract(page: Page, c: Contract) {
  await c.open()
  await expectCentred(c.dialog)
  await expect(c.initialFocus).toBeFocused()
  await expectFocusTrapped(page, c.dialog)
  await page.keyboard.press('Escape')
  await expect(c.dialog).toBeHidden()
  await expect(c.trigger).toBeFocused()

  await c.open()
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(c.dialog).toBeHidden()

  await c.open()
  await dragOutOfPanel(page, c.inside)
  await expect(c.dialog).toBeVisible()
  await pressBackdrop(page)
  await expect(c.dialog).toBeHidden()
  await expect(c.trigger).toBeFocused()
}

/** The person dialog from a list row's avatar (right-click), as the app opens it. */
async function openPersonDialog(page: Page, task: string, person: string) {
  const row = wsListWidget(page, 'list').locator('[data-todo-id]').filter({ hasText: task })
  await row.locator('[class*="peopleGroup"]').getByTitle(person).click({ button: 'right' })
  await expect(taskDialog(page).getByRole('heading')).toHaveText(person)
}

test('task dialog: Esc, focus trap and return, backdrop press', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const dialog = taskDialog(page)
  await checkContract(page, {
    dialog,
    open: async () => {
      await hotTile(page).click()
      await expect(dialog).toBeVisible()
    },
    trigger: hotTile(page),
    inside: dialog.getByRole('heading'),
    initialFocus: dialog,
  })
})

test('task dialog → editor: the editor owns Esc, focused or not; then Esc closes the dialog', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await hotTile(page).click()
  const dialog = taskDialog(page)
  await dialog.locator('[data-todo-id]').filter({ hasText: 'Plan the offsite' }).locator('span[title="Plan the offsite"]').click()
  await expect(editorTitle(page)).toBeVisible()

  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(editorTitle(page)).toBeVisible()

  await editorTitle(page).focus()
  for (let i = 0; i < 3 && await editorTitle(page).isVisible(); i++) {
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
  }
  await expect(editorTitle(page)).toHaveCount(0)
  // Focus is back in the dialog, so the next Esc is its own.
  expect(await focusInside(dialog)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('check-in dialog over the task dialog: contract; focus back to Email check-in; Esc with nothing focused closes only the top one', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openPersonDialog(page, 'Plan the offsite', 'Alice Chen')
  const trigger = taskDialog(page).locator('[data-task-dialog-checkin]')
  await checkContract(page, {
    dialog: checkin(page),
    open: async () => {
      await trigger.click()
      await expect(checkin(page)).toBeVisible()
    },
    trigger,
    inside: checkin(page).getByRole('heading', { name: 'Email task check-ins' }),
    initialFocus: checkin(page),
  })
  // Every close above left the task dialog open underneath.
  await expect(taskDialog(page)).toBeVisible()

  await trigger.click()
  await expect(checkin(page)).toBeVisible()
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(checkin(page)).toBeHidden()
  await expect(taskDialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(taskDialog(page)).toBeHidden()
})

test('check-in → the email editor owns Esc; after it closes, Esc closes the check-in dialog', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await openPersonDialog(page, 'Call the plumber', 'Ben Ortiz')
  await taskDialog(page).locator('[data-task-dialog-checkin]').click()
  const dialog = checkin(page)
  await dialog.getByRole('button', { name: 'Add email for Ben Ortiz' }).click()
  const email = page.getByRole('textbox', { name: 'Email' })
  await expect(email).toBeFocused()

  // Esc in the field cancels the edit, nothing else.
  await page.keyboard.press('Escape')
  await expect(email).toHaveCount(0)
  await expect(dialog).toBeVisible()
  // The editor is still open: Esc with nothing focused is still its.
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  const peopleSearch = page.getByPlaceholder('Search people...')
  await expect(peopleSearch).toBeVisible()

  // The editor's own × (the first in its panel; rows' delete buttons follow).
  await peopleSearch.locator('xpath=..').getByRole('button', { name: '×' }).first().click()
  await expect(peopleSearch).toHaveCount(0)
  await expect.poll(() => focusInside(dialog)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(taskDialog(page)).toBeVisible()
})

test('check-in import: Esc, focus trap and return, backdrop press', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const dialog = page.getByRole('dialog', { name: 'Import task update' })
  const trigger = page.getByRole('button', { name: 'New task' })
  await checkContract(page, {
    dialog,
    // Opened with the trigger focused (the palette's own input goes away).
    open: async () => {
      await trigger.focus()
      await page.evaluate(async () => {
        const mod = (await import(/* @vite-ignore */ '/src/stores/ui-store.ts')) as {
          useUIStore: { getState: () => { openCheckinImport: () => void } }
        }
        mod.useUIStore.getState().openCheckinImport()
      })
      await expect(dialog).toBeVisible()
    },
    trigger,
    inside: dialog.getByRole('heading', { name: 'Import task update' }),
    initialFocus: dialog.getByRole('textbox', { name: 'Paste the reply here' }),
  })
})

test('Customize dashboard: contract; Esc during a keyboard reorder cancels the move, not the dialog', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const dialog = page.getByRole('dialog', { name: 'Customize dashboard' })
  const trigger = dash(page).getByRole('button', { name: 'Add list tile' })
  await checkContract(page, {
    dialog,
    open: async () => {
      await trigger.click()
      await expect(dialog).toBeVisible()
    },
    trigger,
    inside: dialog.getByRole('heading', { name: 'Customize dashboard' }),
    initialFocus: dialog.getByRole('button', { name: /Add a saved list/ }),
  })

  await trigger.click()
  const grip = dialog.getByRole('button', { name: 'Move Open' })
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(grip).not.toHaveAttribute('aria-pressed', 'true')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('Settings: contract; the people editor owns Esc, focused or not', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  const trigger = page.getByRole('button', { name: 'Settings', exact: true })
  await checkContract(page, {
    dialog,
    open: async () => {
      await trigger.click()
      await expect(dialog).toBeVisible()
    },
    trigger,
    inside: dialog.getByRole('heading', { level: 1, name: 'Settings' }),
    initialFocus: dialog,
  })

  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage people…' }).click()
  const search = page.getByPlaceholder('Search people...')
  await search.focus()
  await page.keyboard.press('Escape')
  await expect(settings).toBeVisible()
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(settings).toBeVisible()
  await expect(search).toBeVisible()
})

test('list editor over the lists editor in Settings: contract; Esc closes only it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage lists…' }).click()
  const gear = page.getByTitle('Edit list').first()
  await expect(gear).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Edit list: Team' })
  await checkContract(page, {
    dialog,
    open: async () => {
      await gear.click()
      await expect(dialog).toBeVisible()
    },
    trigger: gear,
    inside: dialog.getByText('Edit list', { exact: true }),
    initialFocus: dialog,
  })
  // The lists editor and Settings stayed open through every close.
  await expect(gear).toBeVisible()
  await expect(settings).toBeVisible()
})

test('“Continue without a backup?” over the append-import dialog: Esc, focused or not, closes only the prompt', async ({ page }) => {
  const FILE = 'e2e-dialogs-append.json'
  await page.addInitScript((name) => {
    const handle = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: handle, configurable: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await handle()], configurable: true })
    const w = window as unknown as { __e2eFailBackups?: boolean }
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      const req = add.apply(this, args)
      if (this.name === 'backups' && w.__e2eFailBackups) this.transaction.abort()
      return req
    }
  }, FILE)
  await seedWorkspace(page, SEED)
  // The startup backup is in before backups start failing.
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const r = req.result.transaction('backups').objectStore('backups').count()
      r.onsuccess = () => { req.result.close(); resolve(r.result) }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }))).toBeGreaterThan(0)

  const settings = await openSettings(page, 'Import / Export')
  await settings.getByRole('button', { name: 'Export JSON' }).click()
  await expect(settings.getByText('Exported!')).toBeVisible()
  await settings.getByRole('button', { name: 'Import tasks (append)…' }).click()
  const picker = page.getByRole('dialog', { name: `Import tasks from ${FILE}` })
  await expect(picker).toBeVisible()
  // Every task is already here: import them as new anyway.
  await picker.getByRole('button', { name: 'Import as new', exact: true }).first().click()
  await page.evaluate(() => { (window as unknown as { __e2eFailBackups?: boolean }).__e2eFailBackups = true })

  const prompt = page.getByRole('dialog', { name: 'Continue without a backup?' })
  for (const unfocused of [false, true]) {
    await picker.getByRole('button', { name: /^Import \d+ tasks?$/ }).click()
    await expect(prompt).toBeVisible()
    await expectCentred(prompt)
    await expect(prompt.getByRole('button', { name: 'Cancel' })).toBeFocused()
    if (unfocused) await blurAll(page)
    await page.keyboard.press('Escape')
    await expect(prompt).toBeHidden()
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('alert')).toHaveText('Nothing was imported — the backup could not be saved.')
    await expect(settings).toBeVisible()
  }
})

test('a modal keeps app shortcuts out: Ctrl+F and Ctrl+K do nothing inside Settings', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const settings = await openSettings(page)
  await page.keyboard.press('Control+f')
  expect(await focusInside(settings)).toBe(true)
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder(/Search tasks, commands/)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder(/Search tasks, commands/)).toBeVisible()
})
