import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The shared dialog frame's contract, per dialog, in a real browser (focus
 * and hit-testing aren't JSDOM's): Esc closes it — focused or with nothing
 * focused; Tab / Shift+Tab wrap inside it; focus returns to the trigger; a
 * press that starts inside the panel and ends on the backdrop keeps it open,
 * a press on the backdrop closes it. And the stacks: the editor over the
 * task dialog, the check-in dialog over the task dialog, the email editor
 * over the check-in dialog, the people editor over Settings, "Continue without
 * a backup?" over the append-import dialog.
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

/**
 * The clipboard refuses every write: a person's Email check-in then can't
 * send at once and opens the check-in dialog over the task dialog instead.
 */
async function refuseClipboard(page: Page) {
  await page.evaluate(() => {
    const refuse = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: refuse })
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: refuse })
  })
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
    items.at(-1)?.setAttribute('data-e2e-end', items.length === 1 ? 'first last' : 'last')
    return items.length
  })
  expect(count).toBeGreaterThan(0)
  const first = dialog.locator('[data-e2e-end~="first"]')
  const last = dialog.locator('[data-e2e-end~="last"]')
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
  /** Where focus goes back on close, when not the trigger (it kept the focus where it was). */
  focusReturnsTo?: Locator
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
  await expect(c.focusReturnsTo ?? c.trigger).toBeFocused()

  await c.open()
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(c.dialog).toBeHidden()

  await c.open()
  await dragOutOfPanel(page, c.inside)
  await expect(c.dialog).toBeVisible()
  await pressBackdrop(page)
  await expect(c.dialog).toBeHidden()
  await expect(c.focusReturnsTo ?? c.trigger).toBeFocused()
}

/** The person dialog from a list row's avatar (right-click › Show tasks), as the app opens it. */
async function openPersonDialog(page: Page, task: string, person: string) {
  const row = wsListWidget(page, 'list').locator('[data-todo-id]').filter({ hasText: task })
  await row.locator(`[data-person-avatar="${person}"]`).click({ button: 'right' })
  await page.getByRole('menu', { name: `@${person}` }).getByRole('menuitem', { name: 'Show tasks' }).click()
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
  await dialog.locator('[data-todo-id]').filter({ hasText: 'Plan the offsite' }).locator('span[data-task-title="Plan the offsite"]').click()
  await expect(editorTitle(page)).toBeVisible()

  // With nothing focused, Esc is the topmost dialog's — the editor's: it
  // closes the editor, not the task dialog under it.
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(editorTitle(page)).toHaveCount(0)
  await expect(dialog).toBeVisible()

  await dialog.locator('[data-todo-id]').filter({ hasText: 'Plan the offsite' }).locator('span[data-task-title="Plan the offsite"]').click()
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
  await refuseClipboard(page)
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

test('check-in → the email editor: Esc cancels its edit, then closes it (focused or not); the check-in dialog stays', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await refuseClipboard(page)
  await openPersonDialog(page, 'Call the plumber', 'Ben Ortiz')
  await taskDialog(page).locator('[data-task-dialog-checkin]').click()
  const dialog = checkin(page)
  await dialog.getByRole('button', { name: 'Add email for Ben Ortiz' }).click()
  const email = page.getByRole('textbox', { name: 'Email' })
  await expect(email).toBeFocused()

  // Esc in the field cancels the edit, nothing else.
  const people = page.getByRole('dialog', { name: 'People' })
  await page.keyboard.press('Escape')
  await expect(email).toHaveCount(0)
  await expect(people).toBeVisible()
  await expect(dialog).toBeVisible()
  // The editor is the top dialog: Esc with nothing focused closes it, only it.
  await blurAll(page)
  await page.keyboard.press('Escape')
  await expect(people).toBeHidden()
  await expect(dialog).toBeVisible()

  // Again from its ×; focus comes back to the check-in dialog, whose Esc closes it.
  await dialog.getByRole('button', { name: 'Add email for Ben Ortiz' }).click()
  await expect(people).toBeVisible()
  await people.getByRole('button', { name: '×' }).first().click()
  await expect(people).toBeHidden()
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
        const mod = (await import(/* @vite-ignore */ '/src/stores/ui-store.ts' as string)) as {
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
    initialFocus: dialog.getByRole('button', { name: /Add a list/ }),
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

test('Settings: contract; Esc over it closes the people editor only, focused or not', async ({ page }) => {
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
  const people = page.getByRole('dialog', { name: 'People' })
  for (const unfocused of [false, true]) {
    await settings.getByRole('button', { name: 'Manage people…' }).click()
    await expect(people).toBeVisible()
    if (unfocused) await blurAll(page)
    await page.keyboard.press('Escape')
    await expect(people).toBeHidden()
    await expect(settings).toBeVisible()
  }
  // An inline edit's Esc cancels the edit, not the editor.
  await settings.getByRole('button', { name: 'Manage people…' }).click()
  await people.getByText('Alice Chen', { exact: true }).click()
  const name = people.getByPlaceholder('Name')
  await expect(name).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(name).toHaveCount(0)
  await expect(people).toBeVisible()
})

test('Settings: Esc in the follow-up interval reverts the typed value and keeps Settings; the next Esc closes it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const settings = await openSettings(page, 'Task defaults')
  const interval = settings.getByRole('textbox', { name: 'Follow-up interval' })
  const stored = await interval.inputValue()
  await interval.fill('3w')
  await page.keyboard.press('Escape')
  await expect(interval).toHaveValue(stored)
  await expect(settings).toBeVisible()
  await expect(interval).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
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
  await expect.poll(async () => (await readStore(page, 'backups')).length).toBeGreaterThan(0)

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

/** The Settings editors and the notes → tasks preview: the frame's contract, and their stacks. */
test.describe('editor modals', () => {
  const editors = [
    { button: 'Manage people…', title: 'People' },
    { button: 'Manage statuses…', title: 'Statuses' },
    { button: 'Manage tags…', title: 'Tags' },
  ]
  for (const { button, title } of editors) {
    test(`${title}: Esc, focus trap and return, backdrop press; Settings stays`, async ({ page }) => {
      await seedWorkspace(page, SEED)
      const settings = await openSettings(page, 'People, statuses & tags')
      const dialog = page.getByRole('dialog', { name: title, exact: true })
      const trigger = settings.getByRole('button', { name: button })
      await checkContract(page, {
        dialog,
        open: async () => {
          await trigger.click()
          await expect(dialog).toBeVisible()
        },
        trigger,
        inside: dialog.getByText(title, { exact: true }).first(),
        initialFocus: dialog.getByRole('button', { name: '×' }).first(),
      })
      await expect(settings).toBeVisible()
    })
  }

  test('Theme colors and Quick-Add syntax: Esc, focus trap and return, backdrop press', async ({ page }) => {
    await seedWorkspace(page, SEED)
    for (const [section, button, title] of [
      ['Appearance', 'Customize colors…', /^Theme Colors/],
      ['Keyboard shortcuts', 'Show syntax…', 'Quick-Add Syntax'],
    ] as const) {
      const settings = await openSettings(page, section)
      const dialog = page.getByRole('dialog', { name: title })
      const trigger = settings.getByRole('button', { name: button })
      await checkContract(page, {
        dialog,
        open: async () => {
          await trigger.click()
          await expect(dialog).toBeVisible()
        },
        trigger,
        inside: dialog.getByText(title).first(),
        initialFocus: dialog.getByRole('button', { name: '×' }).first(),
      })
      await expect(settings).toBeVisible()
    }
  })

  test('Keyboard shortcuts (?): Esc, focus trap and return, backdrop press', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    const trigger = page.getByRole('button', { name: 'New task' })
    await checkContract(page, {
      dialog,
      open: async () => {
        await trigger.focus()
        await page.keyboard.press('?')
        await expect(dialog).toBeVisible()
      },
      trigger,
      inside: dialog.getByText('Keyboard Shortcuts', { exact: true }),
      initialFocus: dialog.getByRole('button', { name: '×' }),
    })
  })

  test('notes → tasks preview: Esc, focus trap and return, backdrop press; its draft editor owns Esc', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' }] }] }] }],
    })
    const note = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
    await note.click()
    await page.keyboard.insertText('- First line\n- Second line')
    await expect(note.locator('.cm-line')).toHaveCount(2)
    const trigger = page.getByRole('button', { name: 'Convert 2 bullet lines to tasks' })
    const dialog = page.getByRole('dialog', { name: 'Convert to tasks' })
    await checkContract(page, {
      dialog,
      open: async () => {
        await trigger.click()
        await expect(dialog).toBeVisible()
      },
      trigger,
      inside: dialog.getByRole('heading', { name: 'Convert to tasks' }),
      initialFocus: dialog.locator('[data-draft-row]').first(),
      // Convert keeps the note focused (and its selection): focus goes back there.
      focusReturnsTo: note,
    })
    // A draft opens the editor on top; Esc closes only the editor.
    await trigger.click()
    await dialog.locator('[data-draft-row]').first().press('Enter')
    const title = page.getByRole('textbox', { name: /^New task/ })
    await expect(title).toBeVisible()
    for (let i = 0; i < 3 && await title.isVisible(); i++) await page.keyboard.press('Escape')
    await expect(title).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test('task editor from a list row: on the frame, 12vh from the top; Tab kept inside; Esc leaves the title, then closes; focus back to the row', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const title = wsListWidget(page, 'list').locator('[data-todo-id]').filter({ hasText: 'Plan the offsite' }).locator('span[data-task-title="Plan the offsite"]')
  await title.dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  expect(await focusInside(editor)).toBe(true)
  const box = await editor.boundingBox()
  const vh = page.viewportSize()?.height ?? 0
  expect(Math.abs((box?.y ?? 0) - vh * 0.12)).toBeLessThan(2)
  await expectFocusTrapped(page, editor)

  await editorTitle(page).focus()
  await page.keyboard.press('Escape')
  await expect(editorTitle(page)).not.toBeFocused()
  await expect(editor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true)
})
