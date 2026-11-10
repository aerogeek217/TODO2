import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { filterChip, openFilterPicker } from './fixtures/filters'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * A change made in a popover either sticks or the user is warned. Esc or a
 * click off saves what was typed; only a Cancel button drops it. Text that
 * can't be saved (a date that isn't one) holds the close once, saying so.
 * Nothing exists yet behind Quick Add and the new-task editor, so they ask
 * instead of creating a task on Esc.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'All' }],
  tasks: [
    {
      title: 'Alpha',
      followupInDays: 3,
      statusUpdates: [{ text: 'old status', inDays: -5 }],
      subtasks: [{ title: 'First sub' }, { title: 'Second sub' }],
    },
    { title: 'Beta' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

test.use({ viewport: { width: 1400, height: 800 } })
test.beforeEach(async ({ page }) => { await seedWorkspace(page, SEED) })

const row = (p: Page) => taskRowByTitle(p, 'Alpha')
const clickOff = (p: Page) => p.mouse.click(6, 780)
const esc = (p: Page) => p.keyboard.press('Escape')
const DISMISS = [['Esc', esc], ['a click off', clickOff]] as const

interface Todo { title: string; nextFollowupAt?: Date; lastFollowupAt?: Date }
const titles = async (p: Page) => (await readStore<Todo>(p, 'todos')).map((t) => t.title)
const alpha = async (p: Page) => (await readStore<Todo>(p, 'todos')).find((t) => t.title === 'Alpha')
const nextDay = async (p: Page) => new Date((await alpha(p))?.nextFollowupAt ?? 0).setHours(0, 0, 0, 0)
const updates = async (p: Page) => (await readStore<{ text: string }>(p, 'statusUpdates')).map((u) => u.text)
const subs = async (p: Page) => (await readStore<{ title: string }>(p, 'subtasks')).map((s) => s.title)
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.setHours(0, 0, 0, 0) }

const followup = (p: Page) => p.getByRole('dialog', { name: 'Follow-up' })
const checklist = (p: Page) => p.getByRole('dialog', { name: 'Subtasks of Alpha' })
const editor = (p: Page) => p.getByRole('dialog', { name: 'Edit task' })
const newTask = (p: Page) => p.getByRole('dialog', { name: 'New task' })
const quickAdd = (p: Page) => p.getByRole('dialog', { name: 'Quick add task' })
const prompt = (p: Page, name: string) => p.getByRole('dialog', { name })

/** The editor's + Add subtask line, 'TYPED' in it, not added. */
const typeSubtask = async (_p: Page, dialog: Locator) => {
  await dialog.getByRole('textbox', { name: 'New subtask' }).fill('TYPED')
}
/** The editor's Status updates add line. */
const addLine = (dialog: Locator) => dialog.getByRole('textbox', { name: 'New status update', exact: true })
const openEditor = async (p: Page) => {
  await row(p).locator('span[data-task-title="Alpha"]').dblclick()
  await expect(editor(p)).toBeVisible()
}
/**
 * Saves a status update `CANARY` from the editor (opened if it isn't) and
 * waits for it in storage. Its write starts after whatever the close before
 * it started, and the database runs them in order, so once it is stored any
 * write that close made has landed too: what is stored then is final (a
 * settle signal, not a timeout that a late write could outlast).
 */
const canaryUpdate = async (p: Page) => {
  if (!(await editor(p).isVisible())) await openEditor(p)
  await addLine(editor(p)).fill('CANARY')
  await addLine(editor(p)).press('Enter')
  await expect.poll(async () => (await updates(p)).includes('CANARY')).toBe(true)
}

for (const [how, dismiss] of DISMISS) {
  test.describe(`${how} saves`, () => {
    test('the follow-up popover: a typed date', async ({ page }) => {
      await row(page).getByRole('button', { name: /^Follow-up:/ }).click()
      await followup(page).getByRole('textbox', { name: 'Next follow-up' }).fill('2w')
      await dismiss(page)
      await expect(followup(page)).toBeHidden()
      await expect.poll(() => nextDay(page)).toBe(inDays(14))
    })

    test('the follow-up popover: a typed status counts as following up', async ({ page }) => {
      await row(page).getByRole('button', { name: /^Follow-up:/ }).click()
      await followup(page).getByRole('textbox', { name: 'Status update' }).fill('TYPED')
      await dismiss(page)
      await expect(followup(page)).toBeHidden()
      await expect.poll(() => updates(page)).toEqual(['old status', 'TYPED'])
      await expect.poll(async () => (await alpha(page))?.lastFollowupAt).toBeTruthy()
    })

    test('the checklist popover: a typed new subtask', async ({ page }) => {
      await row(page).locator('[data-subtask-count]').click()
      await checklist(page).getByRole('textbox', { name: 'New subtask' }).fill('TYPED')
      await dismiss(page)
      await expect(checklist(page)).toBeHidden()
      await expect.poll(() => subs(page)).toEqual(['First sub', 'Second sub', 'TYPED'])
    })

    test('the task editor’s Status updates add line: the editor closing adds what was typed', async ({ page }) => {
      await openEditor(page)
      await addLine(editor(page)).fill('TYPED')
      // Esc: the first leaves the line, the next closes the editor.
      if (how === 'Esc') await esc(page)
      await dismiss(page)
      await expect(editor(page)).toHaveCount(0)
      await expect.poll(() => updates(page)).toEqual(['old status', 'TYPED'])
    })
  })

  test.describe(`${how} on text that can't be saved holds once`, () => {
    test('the follow-up popover: a date that isn’t one; closing again drops it', async ({ page }) => {
      const before = await nextDay(page)
      await row(page).getByRole('button', { name: /^Follow-up:/ }).click()
      await followup(page).getByRole('textbox', { name: 'Next follow-up' }).fill('whenever')
      await dismiss(page)
      await expect(followup(page)).toBeVisible()
      await expect(followup(page).getByText(/close again to discard it/)).toBeVisible()
      await dismiss(page)
      await expect(followup(page)).toBeHidden()
      expect(await nextDay(page)).toBe(before)
    })
  })
}

test('the checklist popover: a rename in progress is saved by a click off (the press closes it before any blur)', async ({ page }) => {
  await row(page).locator('[data-subtask-count]').click()
  await checklist(page).getByRole('listitem').filter({ hasText: 'First sub' }).getByText('First sub').click()
  await checklist(page).getByRole('textbox', { name: 'Subtask title' }).fill('RENAMED')
  await clickOff(page)
  await expect(checklist(page)).toBeHidden()
  await expect.poll(() => subs(page)).toEqual(['RENAMED', 'Second sub'])
})

test('the checklist popover: Esc still cancels a rename, and leaves it open', async ({ page }) => {
  await row(page).locator('[data-subtask-count]').click()
  await checklist(page).getByRole('listitem').filter({ hasText: 'First sub' }).getByText('First sub').click()
  await checklist(page).getByRole('textbox', { name: 'Subtask title' }).fill('RENAMED')
  await esc(page)
  await expect(checklist(page)).toBeVisible()
  await esc(page)
  await expect(checklist(page)).toBeHidden()
  expect(await subs(page)).toEqual(['First sub', 'Second sub'])
})

test('the task editor’s add line: Esc leaves it and the editor stays; nothing is written until ⏎ or the close', async ({ page }) => {
  await openEditor(page)
  await addLine(editor(page)).fill('TYPED')
  await esc(page)
  await expect(editor(page)).toBeVisible()
  await expect(addLine(editor(page))).not.toBeFocused()
  await expect(addLine(editor(page))).toHaveValue('TYPED')
  expect(await updates(page)).toEqual(['old status'])
  await addLine(editor(page)).press('Enter')
  await expect.poll(() => updates(page)).toEqual(['old status', 'TYPED'])
  await expect(addLine(editor(page))).toHaveValue('')
})

test('the task editor closing saves a typed subtask and an entry being edited; Esc on the entry cancels it', async ({ page }) => {
  await openEditor(page)
  await typeSubtask(page, editor(page))
  await editor(page).getByRole('button', { name: /^Edit status update:/ }).click()
  await editor(page).getByRole('textbox', { name: 'Status update', exact: true }).fill('EDITED')
  await clickOff(page)
  await expect(editor(page)).toHaveCount(0)
  await expect.poll(() => subs(page)).toEqual(['First sub', 'Second sub', 'TYPED'])
  await expect.poll(() => updates(page)).toEqual(['EDITED'])

  await openEditor(page)
  await editor(page).getByRole('button', { name: /^Edit status update:/ }).click()
  await editor(page).getByRole('textbox', { name: 'Status update', exact: true }).fill('NOT THIS')
  await esc(page)
  await expect(editor(page)).toBeVisible()
  await clickOff(page)
  await expect(editor(page)).toHaveCount(0)
  await canaryUpdate(page)
  expect(await updates(page)).toEqual(['EDITED', 'CANARY'])
})

test('the date filter: an Is not with no range yet is still chosen when the panel opens again', async ({ page }) => {
  // No range yet, so no filter and no chip: the panel opens from the Filter menu each time.
  const panel = page.getByRole('dialog').first()
  const not = panel.getByRole('radio', { name: 'Is not' }).first()
  await openFilterPicker(page, 'Dates')
  await panel.getByRole('tab', { name: /^Last follow-up/ }).click()
  await not.click()
  await esc(page)
  await expect(filterChip(page, 'Dates')).toHaveCount(0)
  await openFilterPicker(page, 'Dates')
  await panel.getByRole('tab', { name: /^Last follow-up/ }).click()
  await expect(not).toHaveAttribute('aria-checked', 'true')
})

test.describe('Quick Add asks before losing what was typed', () => {
  const open = async (p: Page, text: string) => {
    await p.keyboard.press('Control+Space')
    await quickAdd(p).getByPlaceholder('New task…').fill(text)
  }

  test('nothing typed: Esc closes without asking', async ({ page }) => {
    await page.keyboard.press('Control+Space')
    await expect(quickAdd(page)).toBeVisible()
    await esc(page)
    await expect(quickAdd(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Keep this new task?' })).toHaveCount(0)
  })

  for (const [how, dismiss] of DISMISS) {
    test(`${how}: Keep editing returns to the text`, async ({ page }) => {
      await open(page, 'TYPED TASK')
      await dismiss(page)
      const ask = prompt(page, 'Keep this new task?')
      await ask.getByRole('button', { name: /Keep editing/ }).click()
      await expect(ask).toHaveCount(0)
      await expect(quickAdd(page).getByPlaceholder('New task…')).toHaveValue('TYPED TASK')
      await expect(quickAdd(page).getByPlaceholder('New task…')).toBeFocused()
    })
  }

  test('Create task creates it; Discard drops it', async ({ page }) => {
    await open(page, 'TYPED TASK')
    await esc(page)
    await prompt(page, 'Keep this new task?').getByRole('button', { name: 'Create task' }).click()
    await expect(quickAdd(page)).toHaveCount(0)
    await expect.poll(() => titles(page)).toContain('TYPED TASK')

    await open(page, 'SECOND TASK')
    await esc(page)
    await prompt(page, 'Keep this new task?').getByRole('button', { name: 'Discard' }).click()
    await expect(quickAdd(page)).toHaveCount(0)
    expect(await titles(page)).not.toContain('SECOND TASK')
  })
})

test.describe('the new-task editor asks before losing the form', () => {
  const open = async (p: Page, text: string) => {
    await p.keyboard.press('Control+Space')
    await quickAdd(p).getByPlaceholder('New task…').fill(text)
    await p.keyboard.press('Tab')
    await expect(newTask(p)).toBeVisible()
  }

  test('a click off: Create task, with a subtask typed and not added; Discard', async ({ page }) => {
    await open(page, 'FIRST')
    await typeSubtask(page, newTask(page))
    await clickOff(page)
    await prompt(page, 'Keep this new task?').getByRole('button', { name: 'Create task' }).click()
    await expect(newTask(page)).toHaveCount(0)
    await expect.poll(() => titles(page)).toContain('FIRST')
    await expect.poll(() => subs(page)).toContain('TYPED')

    await open(page, 'SECOND')
    await clickOff(page)
    await prompt(page, 'Keep this new task?').getByRole('button', { name: 'Discard' }).click()
    await expect(newTask(page)).toHaveCount(0)
    expect(await titles(page)).not.toContain('SECOND')
  })

  test('Esc from a field leaves it first; the next Esc asks; Keep editing stays', async ({ page }) => {
    await open(page, 'FIRST')
    await esc(page)
    await expect(prompt(page, 'Keep this new task?')).toHaveCount(0)
    await esc(page)
    await prompt(page, 'Keep this new task?').getByRole('button', { name: /Keep editing/ }).click()
    await expect(newTask(page)).toBeVisible()
  })

  test('its Cancel button discards without asking', async ({ page }) => {
    await open(page, 'FIRST')
    await newTask(page).getByRole('button', { name: /^Cancel/ }).click()
    await expect(newTask(page)).toHaveCount(0)
    await expect(prompt(page, 'Keep this new task?')).toHaveCount(0)
    expect(await titles(page)).not.toContain('FIRST')
  })

  test('a status update typed in its add line and Create pressed right after: it goes with the task', async ({ page }) => {
    await open(page, 'FIRST')
    await addLine(newTask(page)).fill('TYPED')
    await newTask(page).getByRole('button', { name: 'Create task' }).click({ delay: 0 })
    await expect(newTask(page)).toHaveCount(0)
    await expect.poll(() => updates(page)).toContain('TYPED')
  })

  test('Create task with a subtask typed and not added takes it along', async ({ page }) => {
    await open(page, 'FIRST')
    await typeSubtask(page, newTask(page))
    await newTask(page).getByRole('button', { name: 'Create task' }).click()
    await expect(newTask(page)).toHaveCount(0)
    await expect.poll(() => subs(page)).toContain('TYPED')
  })

  test('without a title: asks whether to discard, there being nothing to create', async ({ page }) => {
    await open(page, 'FIRST')
    const title = newTask(page).getByPlaceholder(/New task/)
    await title.fill('')
    await typeSubtask(page, newTask(page))
    await clickOff(page)
    const ask = prompt(page, 'Discard this new task?')
    await expect(ask.getByRole('button', { name: 'Create task' })).toHaveCount(0)
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect(newTask(page)).toHaveCount(0)
    expect(await subs(page)).not.toContain('TYPED')
  })
})
