import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore, readStores, type Row } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { drag, seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * Subtasks in a real browser (cr28): the row's `2/5` count opens the
 * checklist popover (placement, focus handoffs and the Esc that must stop
 * there are the browser's), a check inside it updates the count and stamps
 * the task; the editor's section reorders by a trusted-mouse drag and
 * deletes with the undo snackbar.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    {
      title: 'Q4 budget',
      modifiedInDays: -20,
      subtasks: [
        { title: 'Send the template to all leads', done: true },
        { title: 'Headcount from Aisha' },
        { title: 'Get travel actuals from Marco' },
      ],
    },
    { title: 'Bare task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

/** The editor's + Add subtask popover. */
const addPopover = (page: Page) => page.getByRole('dialog', { name: 'Add a subtask' })
const countOf = (row: Locator) => row.locator('[data-subtask-count]')
const popover = (page: Page) => page.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })
const section = (page: Page) => editor(page).getByRole('region', { name: /Subtasks/ })

/** The stored checklist of `title`: `[title, done]` in order. */
async function storedChecklist(page: Page, title: string): Promise<Array<[string, boolean]>> {
  const task = (await readStore<{ id: number; title: string }>(page, 'todos')).find((t) => t.title === title)
  return (await readStore<{ todoId: number; title: string; isCompleted: boolean; sortOrder: number }>(page, 'subtasks'))
    .filter((s) => s.todoId === task?.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => [s.title, s.isCompleted])
}

async function modifiedAt(page: Page, title: string): Promise<number> {
  const task = (await readStore<{ title: string; modifiedAt: Date }>(page, 'todos')).find((t) => t.title === title)
  return new Date(task?.modifiedAt ?? 0).getTime()
}

test('the editor’s + Add subtask matches + Add update, at the right of its heading; ⏎ adds and stays, Esc adds what was typed, Cancel drops it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  await expect(editor(page)).toBeVisible()
  const add = section(page).getByRole('button', { name: '+ Add subtask' })
  const update = editor(page).getByRole('button', { name: '+ Add update' })
  const look = (l: Locator) => l.evaluate((el) => {
    const c = getComputedStyle(el)
    return [c.color, c.fontSize, c.fontWeight, c.height, c.backgroundColor, c.borderRadius]
  })
  expect(await look(add)).toEqual(await look(update))
  // Their right edges line up, and there is no add row taking height.
  const edge = async (l: Locator) => { const b = await l.boundingBox(); return Math.round((b?.x ?? 0) + (b?.width ?? 0)) }
  expect(Math.abs(await edge(add) - await edge(update))).toBeLessThanOrEqual(1)
  await expect(section(page).getByRole('textbox', { name: 'New subtask' })).toHaveCount(0)

  await add.click()
  const field = addPopover(page).getByRole('textbox', { name: 'New subtask' })
  await expect(field).toBeFocused()
  await field.fill('One')
  await field.press('Enter')
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await field.fill('Two')
  await page.keyboard.press('Escape')
  await expect(addPopover(page)).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
  await expect(add).toBeFocused()
  await expect.poll(async () => (await storedChecklist(page, 'Q4 budget')).map((s) => s[0]).slice(-2)).toEqual(['One', 'Two'])

  await add.click()
  await field.fill('Not this')
  await addPopover(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(addPopover(page)).toHaveCount(0)
  expect((await storedChecklist(page, 'Q4 budget')).map((s) => s[0])).not.toContain('Not this')
})

test('the row’s count opens the popover; Space checks the focused subtask, the count and Modified follow; ⏎ adds; Esc closes with the focus back on the count', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = taskRowByTitle(page, 'Q4 budget')
  await expect(countOf(row)).toHaveText('1/3')
  await expect(countOf(taskRowByTitle(page, 'Bare task'))).toHaveCount(0)
  const before = await modifiedAt(page, 'Q4 budget')

  await countOf(row).click()
  await expect(popover(page)).toBeVisible()
  const headcount = popover(page).getByRole('checkbox', { name: 'Check Headcount from Aisha' })
  await expect(headcount).toBeFocused()
  await page.keyboard.press('Space')
  await expect(countOf(row)).toHaveText('2/3')
  await expect(popover(page).getByText('2 of 3')).toBeVisible()
  await expect.poll(() => storedChecklist(page, 'Q4 budget')).toEqual([
    ['Send the template to all leads', true], ['Headcount from Aisha', true], ['Get travel actuals from Marco', false],
  ])
  expect(await modifiedAt(page, 'Q4 budget')).toBeGreaterThan(before)

  const add = popover(page).getByRole('textbox', { name: 'New subtask' })
  await add.click()
  await add.fill('Review with Ben')
  await add.press('Enter')
  await expect(add).toHaveValue('')
  await expect(add).toBeFocused()
  await expect(countOf(row)).toHaveText('2/4')
  await expect.poll(async () => (await storedChecklist(page, 'Q4 budget')).at(-1)).toEqual(['Review with Ben', false])

  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect(countOf(row)).toBeFocused()
  // The row's own double-click (the editor) is not the count's.
  await expect(editor(page)).toHaveCount(0)
})

test('checking the last open subtask offers Complete task in the snackbar; the task completes only when it is taken', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, tasks: [{ title: 'Q4 budget', subtasks: [{ title: 'only one' }] }] })
  const row = taskRowByTitle(page, 'Q4 budget')
  await countOf(row).click()
  await popover(page).getByRole('checkbox', { name: 'Check only one' }).click()
  await expect(countOf(row)).toHaveText('1/1')
  await expect(countOf(row)).toHaveAttribute('data-all-done', '')
  const offer = page.getByRole('button', { name: 'Complete task' })
  await expect(offer).toBeVisible()
  // The check is stored (with the task's stamp, in its one transaction) and
  // the offer is up, which comes after it: the task is still open.
  await expect.poll(() => storedChecklist(page, 'Q4 budget')).toEqual([['only one', true]])
  expect((await readStore<{ isCompleted: boolean }>(page, 'todos'))[0]?.isCompleted).toBe(false)
  await expect(row.getByRole('checkbox', { name: 'Mark complete' })).not.toBeChecked()
  await offer.click()
  await expect.poll(async () => (await readStore<{ isCompleted: boolean }>(page, 'todos'))[0]?.isCompleted).toBe(true)
})

test('the editor’s section: a drag reorders the checklist, ⋯ › Delete removes with the undo snackbar, Undo puts it back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  await expect(editor(page)).toBeVisible()
  await expect(section(page).getByText('1 of 3')).toBeVisible()
  const items = section(page).getByRole('listitem')
  await expect(items).toHaveText(['Send the template to all leads', 'Headcount from Aisha', 'Get travel actuals from Marco'])

  // Drag the last row's grip above the first.
  const last = items.nth(2)
  await last.hover()
  const grip = last.getByLabel('Move Get travel actuals from Marco')
  const from = await grip.boundingBox()
  const first = await items.nth(0).boundingBox()
  if (!from || !first) throw new Error('rows not laid out')
  await drag(
    page,
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    { x: from.x + from.width / 2, y: first.y + first.height / 2 - 4 },
    {
      lifted: () => expect(last).toHaveAttribute('data-dragging', ''),
      // The first row has made room (dnd-kit moved it down) before the drop: the target is registered.
      during: () => expect(items.nth(0)).not.toHaveCSS('transform', 'none'),
    },
  )
  await expect(items).toHaveText(['Get travel actuals from Marco', 'Send the template to all leads', 'Headcount from Aisha'])
  await expect.poll(() => storedChecklist(page, 'Q4 budget')).toEqual([
    ['Get travel actuals from Marco', false], ['Send the template to all leads', true], ['Headcount from Aisha', false],
  ])

  await items.nth(1).hover()
  await items.nth(1).getByRole('button', { name: 'Subtask menu: Send the template to all leads' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(items).toHaveText(['Get travel actuals from Marco', 'Headcount from Aisha'])
  await expect(section(page).getByText('0 of 2')).toBeVisible()
  await expect(page.getByText('Subtask removed')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(items).toHaveText(['Get travel actuals from Marco', 'Send the template to all leads', 'Headcount from Aisha'])
  await expect(editor(page)).toBeVisible()
})

test('Make subtask of… from the row menu: the picker, the prompt, the row gone and the parent’s count grown; Undo brings it back', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, tasks: [...SEED.tasks!, { title: 'Book travel', dueInDays: 5 }] })
  const row = taskRowByTitle(page, 'Book travel')
  await row.locator('span[data-task-title="Book travel"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Make subtask of…' }).click()
  const picker = page.getByRole('dialog', { name: 'Make “Book travel” a subtask of…' })
  await expect(picker).toBeVisible()
  const search = picker.getByRole('combobox', { name: 'Find a task' })
  await expect(search).toBeFocused()
  await expect(picker.getByRole('option')).toHaveText(['Q4 budget3 subtasks', 'Bare task'])
  await search.fill('q4')
  await search.press('Enter')
  await expect(picker).toHaveCount(0)
  // The task has a due date: the prompt lists it.
  const prompt = page.getByRole('dialog', { name: 'Make “Book travel” a subtask of “Q4 budget”?' })
  await expect(prompt).toBeVisible()
  const due = new Date()
  due.setDate(due.getDate() + 5)
  const dueText = `${String(due.getMonth() + 1).padStart(2, '0')}/${String(due.getDate()).padStart(2, '0')}`
  await expect(prompt).toContainText(`These go with the task: Due ${dueText}.`)
  await prompt.getByRole('button', { name: 'Make subtask' }).click()
  await expect(row).toHaveCount(0)
  await expect(countOf(taskRowByTitle(page, 'Q4 budget'))).toHaveText('1/4')
  await expect.poll(async () => (await storedChecklist(page, 'Q4 budget')).at(-1)).toEqual(['Book travel', false])
  await expect.poll(async () => (await readStore<{ title: string }>(page, 'todos')).map((t) => t.title)).not.toContain('Book travel')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(taskRowByTitle(page, 'Book travel')).toBeVisible()
  await expect(countOf(taskRowByTitle(page, 'Q4 budget'))).toHaveText('1/3')
  // Stored as before: the task back with its due date, the checklist without it.
  await expect.poll(() => storedChecklist(page, 'Q4 budget')).toEqual([
    ['Send the template to all leads', true], ['Headcount from Aisha', false], ['Get travel actuals from Marco', false],
  ])
  const back = (await readStore<{ title: string; dueDate?: Date }>(page, 'todos')).find((t) => t.title === 'Book travel')
  expect(new Date(back?.dueDate ?? 0).setHours(0, 0, 0, 0)).toBe(due.setHours(0, 0, 0, 0))
})

test('Make a task from the popover’s ⋯: a new row with the parent’s people; the subtask leaves the checklist', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, people: [{ name: 'Ben Ortiz', initials: 'BO' }], tags: ['finance'], tasks: [{ ...SEED.tasks![0]!, people: ['Ben Ortiz'], tags: ['finance'] }] })
  const row = taskRowByTitle(page, 'Q4 budget')
  await countOf(row).click()
  const item = popover(page).getByRole('listitem').filter({ hasText: 'Get travel actuals from Marco' })
  await item.hover()
  await item.getByRole('button', { name: 'Subtask menu: Get travel actuals from Marco' }).click()
  await page.getByRole('menuitem', { name: 'Make a task' }).click()
  const made = taskRowByTitle(page, 'Get travel actuals from Marco')
  await expect(made).toBeVisible()
  await expect(made.getByRole('img', { name: /Ben Ortiz/ }).or(made.getByText('BO'))).toBeVisible()
  await expect(countOf(row)).toHaveText('1/2')
  await expect(page.getByText('Made “Get travel actuals from Marco” a task')).toBeVisible()
  // Stored: the new task with the parent's person and tag, the line gone from the checklist.
  const assigned = async () => {
    const { todos, todoPeople, people, todoTags, tags } = await readStores(page, ['todos', 'todoPeople', 'people', 'todoTags', 'tags'])
    const id = todos.find((t) => t.title === 'Get travel actuals from Marco')?.id
    const names = (links: Row[], key: string, rows: Row[]) =>
      links.filter((l) => l.todoId === id).map((l) => rows.find((r) => r.id === l[key])?.name)
    return id === undefined ? null : { people: names(todoPeople, 'personId', people), tags: names(todoTags, 'tagId', tags) }
  }
  await expect.poll(assigned).toEqual({ people: ['Ben Ortiz'], tags: ['finance'] })
  expect(await storedChecklist(page, 'Q4 budget')).toEqual([['Send the template to all leads', true], ['Headcount from Aisha', false]])
})

test('the top bar’s search finds a task by a subtask’s words, under a Subtasks group with the line as a snippet', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, tasks: [...SEED.tasks!, { title: 'Travel budget review' }] })
  const search = page.locator('header').getByRole('textbox', { name: 'Search tasks' })
  await search.click()
  await search.fill('travel')
  const listbox = page.getByRole('listbox', { name: /search results/i })
  await expect(listbox).toBeVisible()
  const group = listbox.getByRole('group', { name: 'Subtasks' })
  await expect(group.getByRole('option')).toHaveCount(1)
  await expect(group).toContainText('Q4 budget')
  await expect(group).toContainText('☐ Get travel actuals from Marco')
  await expect(listbox.getByRole('group', { name: 'Title' })).toContainText('Travel budget review')
  // The screen filter keeps the task too: the list shows both.
  await search.press('Enter')
  await expect(taskRowByTitle(page, 'Q4 budget')).toBeVisible()
  await expect(taskRowByTitle(page, 'Bare task')).toHaveCount(0)
})

test('notes → tasks: the indented lines under a bullet become its task’s subtasks', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    tasks: [],
    layouts: [{ name: 'Main', columns: [
      { id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'n', rows: [wsRow({ id: 'nk', tabs: [{ id: 'notes', kind: 'notes' }] })] },
    ] }],
  })
  const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
  await editor.click()
  await page.keyboard.insertText('- Offsite\n  - Book the venue\n  - [x] Pick a date\n- Other')
  await page.getByRole('button', { name: /^Convert 2 / }).click()
  const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
  await expect(preview.getByRole('list', { name: 'Subtasks of Offsite' }).getByRole('listitem')).toHaveText(['☐ Book the venue', '☑ Pick a date'])
  await preview.getByRole('button', { name: 'Create 2 tasks' }).click()
  await page.getByRole('dialog', { name: 'Remove 2 converted lines from the note?' }).getByRole('button', { name: 'Remove 2 lines' }).click()
  await expect(countOf(taskRowByTitle(page, 'Offsite'))).toHaveText('1/2')
  await expect.poll(() => storedChecklist(page, 'Offsite')).toEqual([['Book the venue', false], ['Pick a date', true]])
  await expect(editor.locator('.cm-line')).toHaveText([''])
})

test('a renamed subtask: ⏎ saves, Esc on the field cancels without closing the editor', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  await section(page).getByRole('button', { name: 'Rename Headcount from Aisha' }).click()
  const field = section(page).getByRole('textbox', { name: 'Subtask title' })
  await expect(field).toBeFocused()
  await field.fill('Headcount from Aisha and Ben')
  await field.press('Enter')
  await expect(section(page).getByRole('button', { name: 'Rename Headcount from Aisha and Ben' })).toBeVisible()
  await section(page).getByRole('button', { name: 'Rename Headcount from Aisha and Ben' }).click()
  await section(page).getByRole('textbox', { name: 'Subtask title' }).fill('dropped')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toBeVisible()
  await expect(section(page).getByRole('button', { name: 'Rename Headcount from Aisha and Ben' })).toBeVisible()
  expect((await storedChecklist(page, 'Q4 budget')).map(([t]) => t)).toContain('Headcount from Aisha and Ben')
})

test('a rename ended by ⏎ or Esc hands the focus back to its title; Esc in an emptied field cancels only the rename (cr31 T7, M2)', async ({ page }) => {
  await seedWorkspace(page, SEED)
  // The editor: ⏎, then Esc — the focus is back on the title each time.
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  await section(page).getByRole('button', { name: 'Rename Headcount from Aisha' }).click()
  await section(page).getByRole('textbox', { name: 'Subtask title' }).fill('Headcount')
  await page.keyboard.press('Enter')
  await expect(section(page).getByRole('button', { name: 'Rename Headcount', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await section(page).getByRole('textbox', { name: 'Subtask title' }).fill('')
  await page.keyboard.press('Escape')
  await expect(section(page).getByRole('button', { name: 'Rename Headcount', exact: true })).toBeFocused()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)

  // The row's popover: Esc in an emptied rename field leaves the popover open.
  await countOf(taskRowByTitle(page, 'Q4 budget')).click()
  await popover(page).getByRole('button', { name: 'Rename Headcount', exact: true }).click()
  await popover(page).getByRole('textbox', { name: 'Subtask title' }).fill('')
  await page.keyboard.press('Escape')
  await expect(popover(page)).toBeVisible()
  await expect(popover(page).getByRole('button', { name: 'Rename Headcount', exact: true })).toBeFocused()
  expect((await storedChecklist(page, 'Q4 budget')).map(([t]) => t)).toContain('Headcount')
})

test('a task’s notes convert to its subtasks at once, in the editor and the popover; Undo takes both back', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    tasks: [{ title: 'Offsite', notes: '- Book the venue\n  - [x] Pick a date\n- Send invites\nA thought' }, { title: 'Popover task', notes: 'One line' }],
  })
  const row = taskRowByTitle(page, 'Offsite')
  await row.locator('span[data-task-title="Offsite"]').dblclick()
  const dialog = editor(page)
  await dialog.getByRole('button', { name: /^Convert 2 bullet lines to subtasks/ }).click()

  await expect(dialog.locator('.cm-line')).toHaveText(['✓ Book the venue', '✓ Send invites', 'A thought'])
  await expect(page.getByRole('dialog', { name: 'Convert to tasks' })).toHaveCount(0)
  await expect(section(page).getByRole('button', { name: 'Rename Pick a date' })).toBeVisible()
  await expect.poll(() => storedChecklist(page, 'Offsite')).toEqual([['Book the venue', false], ['Pick a date', true], ['Send invites', false]])
  await expect(dialog).toBeVisible()
  expect((await readStore<{ title: string }>(page, 'todos')).map((t) => t.title).sort()).toEqual(['Offsite', 'Popover task'])

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(dialog.locator('.cm-line')).toHaveText(['- Book the venue', '  - [x] Pick a date', '- Send invites', 'A thought'])
  await expect.poll(() => storedChecklist(page, 'Offsite')).toEqual([])
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await expect(dialog).toHaveCount(0)

  // The notes popover: Alt+T on the caret's line, and it stays open.
  await taskRowByTitle(page, 'Popover task').getByRole('button', { name: 'Edit status and notes' }).click()
  const pop = page.getByRole('dialog', { name: 'Status and notes' })
  await pop.locator('.cm-content').click()
  await page.keyboard.press('Alt+t')
  await expect(pop.locator('.cm-line')).toHaveText(['✓ One line'])
  await expect.poll(() => storedChecklist(page, 'Popover task')).toEqual([['One line', false]])
  await expect(pop).toBeVisible()
})

test('a new task’s notes convert to its pending subtasks, stored with the task', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await page.keyboard.press('Control+Space')
  const quick = page.getByRole('dialog', { name: 'Quick add task' })
  await quick.getByPlaceholder('New task…').pressSequentially('Brand new')
  await page.keyboard.press('Tab')
  await expect(quick).toBeHidden()

  const notes = page.getByRole('dialog', { name: /task/i }).locator('.cm-content')
  await notes.click()
  await page.keyboard.insertText('- First\n- Second')
  await page.getByRole('button', { name: /^Convert 2 bullet lines to subtasks/ }).click()
  await expect(notes.locator('.cm-line')).toHaveText(['✓ First', '✓ Second'])
  expect((await readStore<{ title: string }>(page, 'todos')).map((t) => t.title)).not.toContain('Brand new')

  await page.getByRole('button', { name: 'Create task' }).click()
  await expect.poll(() => storedChecklist(page, 'Brand new')).toEqual([['First', false], ['Second', false]])
})
