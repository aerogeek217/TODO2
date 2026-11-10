import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, seedTaskList, seedWorkspace, wsRow } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'
import { readStore } from './fixtures/db'

/**
 * Notes → tasks in a real browser: the toolbar's Convert (preview dialog,
 * draft editor stacked on it, remove / keep prompt) and Alt+T (the task
 * popup). Real-browser because it hands focus between the editor and
 * stacked dialogs, keeps the editor's selection when the button is
 * pressed, and its Esc must close only the top layer.
 */

const NOTES_LAYOUT = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] })] }] }],
  people: [{ name: 'Ben Ortiz', initials: 'BO' }],
  tags: ['planning'],
}

const NOTE = [
  '# Weekly sync',
  '- Draft homepage copy #planning',
  '- [ ] Ask for analytics access @Ben /urgent',
  'Random thought: maybe switch CDN?',
  '- Book venue for team dinner /important',
  '- [x] Send recap email',
].join('\n')

function storedTodos(page: Page): Promise<Array<{ title: string; urgent?: boolean; important?: boolean }>> {
  return readStore(page, 'todos')
}

const quickAddInput = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' }).getByPlaceholder('New task…')

async function noteLines(editor: Locator): Promise<string[]> {
  return await editor.locator('.cm-line').allTextContents()
}

/** Opens the Notes widget and replaces the note with `text`. */
async function writeNote(page: Page, text: string): Promise<Locator> {
  await seedWorkspace(page, NOTES_LAYOUT)
  const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
  await editor.click()
  await page.keyboard.insertText(text)
  await expect(editor.locator('.cm-line')).toHaveCount(text.split('\n').length)
  return editor
}

test.describe('notes → tasks', () => {
  test('preview → edit a draft → create → remove the converted lines', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    const convert = page.getByRole('button', { name: 'Convert 3 bullet lines to tasks' })
    await convert.hover()
    await expect(editor.locator('.cm-convert-scope')).toHaveCount(3)
    await convert.click()

    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview).toBeVisible()
    await expect(preview.getByText('3 drafts')).toBeVisible()
    await expect(preview.getByText(/From the note "Weekly sync"/)).toBeVisible()
    const rows = preview.getByRole('listitem')
    await expect(rows).toHaveCount(3)
    // The first row has focus.
    await expect(rows.first()).toBeFocused()

    // Edit the second draft in the draft editor stacked on the preview.
    await rows.nth(1).locator('[data-task-title]').dblclick()
    const title = page.getByRole('textbox', { name: /^New task…/ })
    await expect(title).toHaveValue('Ask for analytics access')
    await expect(page.getByText('Nothing is saved until you create the tasks')).toBeVisible()
    await expect(page.getByLabel('Last follow-up')).toHaveCount(0)
    await title.fill('Ask for analytics access today')
    // Esc in the title only leaves the field; a second Esc closes the editor, not the preview.
    await title.press('Escape')
    await expect(title).toBeVisible()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(title).toBeHidden()
    await expect(preview).toBeVisible()
    const edited = preview.getByRole('listitem', { name: 'Ask for analytics access today' })
    await expect(edited).toBeFocused()

    // Remove the first draft with Del, then create with Ctrl+Enter.
    await rows.first().focus()
    await page.keyboard.press('Delete')
    await expect(rows).toHaveCount(2)
    await expect(preview.getByText('1 line left out')).toBeVisible()
    expect(await storedTodos(page)).toEqual([])
    await page.keyboard.press('Control+Enter')

    const prompt = page.getByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    await expect(prompt).toBeVisible()
    await expect(page.getByText('Created 2 tasks')).toBeVisible()
    const todos = await storedTodos(page)
    expect(todos.map((t) => t.title).sort()).toEqual(['Ask for analytics access today', 'Book venue for team dinner'])
    expect(todos.find((t) => t.title.startsWith('Ask'))?.urgent).toBe(true)
    expect(todos.find((t) => t.title.startsWith('Book'))?.important).toBe(true)

    await prompt.getByRole('button', { name: 'Remove 2 lines' }).click()
    await expect(prompt).toBeHidden()
    expect(await noteLines(editor)).toEqual([
      '# Weekly sync',
      '- Draft homepage copy #planning',
      'Random thought: maybe switch CDN?',
      '- [x] Send recap email',
    ])
    // One Ctrl+Z in the note brings the lines back; the tasks stay.
    await expect(editor).toBeFocused()
    await page.keyboard.press('Control+z')
    expect(await noteLines(editor)).toEqual(NOTE.split('\n'))
    expect(await storedTodos(page)).toHaveLength(2)
  })

  test('a selection scopes the convert; Keep (Esc) marks the lines ✓', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    // Select from inside line 3 to inside line 5 (the plain line between is skipped).
    await editor.locator('.cm-line').nth(2).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    const convert = page.getByRole('button', { name: 'Convert 2 selected lines to tasks' })
    await expect(convert).toBeVisible()
    await convert.click()
    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview.getByText(/From your selection in "Weekly sync"/)).toBeVisible()
    await expect(preview.getByRole('listitem')).toHaveCount(2)
    await preview.getByRole('button', { name: 'Create 2 tasks' }).click()
    const prompt = page.getByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    await expect(prompt).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(prompt).toBeHidden()
    expect(await noteLines(editor)).toEqual([
      '# Weekly sync',
      '- Draft homepage copy #planning',
      '✓ Ask for analytics access',
      'Random thought: maybe switch CDN?',
      '✓ Book venue for team dinner',
      '- [x] Send recap email',
    ])
  })

  test('hovering the drafts changes no sizes: the rows, the list and the dialog stay put', async ({ page }) => {
    await writeNote(page, [
      '- Draft with a fairly long title that goes on for a good while to fill the row @Ben #planning',
      '- Short one',
      '- With a subtask',
      '  - a sub line',
      '- Medium length draft due friday /urgent',
    ].join('\n'))
    await page.getByRole('button', { name: /^Convert \d+ bullet lines? to tasks/ }).click()
    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview).toBeVisible()
    const rows = preview.locator('[data-draft-row]')
    const sizes = () => preview.evaluate((dialog) => JSON.stringify([dialog, ...dialog.querySelectorAll('[data-draft-row]')]
      .map((el) => { const b = el.getBoundingClientRect(); return [b.width, b.height, b.top] })))
    // Off every row, the first (focused on open) showing its buttons either way.
    await page.mouse.move(2, 2)
    const before = await sizes()
    for (let i = 0; i < await rows.count(); i++) {
      await rows.nth(i).hover()
      await expect(rows.nth(i).getByRole('button', { name: /^Remove/ })).toBeVisible()
      expect(await sizes()).toBe(before)
    }
  })

  test.describe('draft rows', () => {
    const LINES = ['- Draft homepage copy', '- Ask for analytics access', '- Book venue', 'plain'].join('\n')
    const preview = (page: Page) => page.getByRole('dialog', { name: 'Convert to tasks' })
    const open = async (page: Page, text = LINES) => {
      const editor = await writeNote(page, text)
      await page.getByRole('button', { name: /^Convert \d+ bullet lines? to tasks/ }).click()
      await expect(preview(page)).toBeVisible()
      return editor
    }
    const row = (page: Page, name: string) => preview(page).getByRole('listitem', { name })
    const stored = async (page: Page) => (await storedTodos(page)).map((t) => t.title).sort()

    test('a click on the title renames in place; a double-click opens the editor; Esc in the rename stays in the dialog', async ({ page }) => {
      await open(page)
      await row(page, 'Book venue').locator('[data-task-title]').click()
      const field = preview(page).getByRole('textbox', { name: 'Draft title' })
      await field.fill('Book the venue')
      await field.press('Enter')
      await expect(row(page, 'Book the venue')).toBeVisible()

      await row(page, 'Book the venue').locator('[data-task-title]').click()
      await field.fill('Not this')
      await field.press('Escape')
      await expect(preview(page)).toBeVisible()
      await expect(row(page, 'Book the venue')).toBeVisible()
      await expect(page.getByRole('dialog', { name: /Keep your changes/ })).toHaveCount(0)

      await row(page, 'Book the venue').locator('[data-task-title]').dblclick()
      await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible()
      await page.getByRole('button', { name: /^Cancel/ }).last().click()

      await preview(page).getByRole('button', { name: /^Create 3 tasks/ }).click()
      await page.getByRole('button', { name: 'Keep' }).click()
      expect(await stored(page)).toEqual(['Ask for analytics access', 'Book the venue', 'Draft homepage copy'])
    })

    test('the cells edit the draft, and it is created with them; nothing is stored before', async ({ page }) => {
      await open(page)
      const r = row(page, 'Draft homepage copy')
      await r.locator('[data-row-cell="people"]').click()
      await page.getByRole('option', { name: /Ben Ortiz/ }).click()
      await page.keyboard.press('Escape')
      await expect(preview(page)).toBeVisible()

      await r.locator('[data-row-cell="tags"]').click()
      await page.getByRole('option', { name: /planning/ }).click()
      await page.keyboard.press('Escape')
      await expect(preview(page)).toBeVisible()

      await r.locator('[data-row-cell="followup"]').click()
      const follow = page.getByRole('dialog', { name: 'Next follow-up' })
      await follow.getByRole('button', { name: 'Follow up in 2 weeks' }).click()
      await expect(follow).toHaveCount(0)
      await expect(preview(page)).toBeVisible()
      expect(await stored(page)).toEqual([])

      await preview(page).getByRole('button', { name: /^Create 3 tasks/ }).click()
      await page.getByRole('button', { name: 'Keep' }).click()
      const made = (await readStore<{ id: number; title: string; nextFollowupAt?: Date }>(page, 'todos')).find((t) => t.title === 'Draft homepage copy')
      expect(made?.nextFollowupAt).toBeTruthy()
      const links = await readStore<{ todoId: number }>(page, 'todoPeople')
      expect(links.map((l) => l.todoId)).toContain(made?.id)
      const tagLinks = await readStore<{ todoId: number }>(page, 'todoTags')
      expect(tagLinks.map((l) => l.todoId)).toContain(made?.id)
    })

    test('a person who doesn’t exist yet is created only with the task', async ({ page }) => {
      await open(page)
      await row(page, 'Book venue').locator('[data-row-cell="people"]').click()
      await page.getByRole('combobox').or(page.getByPlaceholder(/Search or create people/)).first().fill('Zed Newman')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      const names = async () => (await readStore<{ name: string }>(page, 'people')).map((p) => p.name)
      expect(await names()).not.toContain('Zed Newman')
      await preview(page).getByRole('button', { name: /^Create 3 tasks/ }).click()
      await page.getByRole('button', { name: 'Keep' }).click()
      await expect.poll(names).toContain('Zed Newman')
    })

    test('checking off only marks a draft until the dialog is confirmed; unchecking takes it back; one Ctrl+Z restores the note', async ({ page }) => {
      const editor = await open(page)
      const r = row(page, 'Draft homepage copy')
      const box = r.getByRole('checkbox')
      await box.click()
      await expect(box).toBeChecked()
      // Still in the list and the note.
      await expect(r).toBeVisible()
      await expect(editor.locator('.cm-line').first()).toHaveText('- Draft homepage copy')
      const button = preview(page).getByRole('button', { name: 'Create 2 tasks, remove 1 line' })
      await expect(button).toBeVisible()
      await box.click()
      await expect(preview(page).getByRole('button', { name: 'Create 3 tasks' })).toBeVisible()
      await box.click()

      await button.click()
      const ask = page.getByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
      await expect(ask.getByText(/1 line you checked off goes either way/)).toBeVisible()
      await ask.getByRole('button', { name: 'Keep' }).click()
      await expect(editor.locator('.cm-line')).toHaveText(['✓ Ask for analytics access', '✓ Book venue', 'plain'])
      expect(await stored(page)).toEqual(['Ask for analytics access', 'Book venue'])

      await editor.click()
      await page.keyboard.press('Control+z')
      await expect(editor.locator('.cm-line')).toHaveText(LINES.split('\n'))
    })

    test('only checked drafts: no prompt, no tasks, the lines go; Ctrl+Z brings them back', async ({ page }) => {
      const editor = await open(page, '- One\n- Two\nplain')
      await row(page, 'One').getByRole('checkbox').click()
      await row(page, 'Two').getByRole('checkbox').click()
      await preview(page).getByRole('button', { name: 'Remove 2 lines' }).click()
      await expect(preview(page)).toHaveCount(0)
      await expect(editor.locator('.cm-line')).toHaveText(['plain'])
      expect(await stored(page)).toEqual([])
      await editor.click()
      await page.keyboard.press('Control+z')
      await expect(editor.locator('.cm-line')).toHaveText(['- One', '- Two', 'plain'])
    })

    test('× leaves the line in the note and makes no task; a checked line’s subtask lines go with it', async ({ page }) => {
      const editor = await open(page, '- Parent\n  - child\n- Stays\n- Made')
      await preview(page).getByRole('button', { name: 'Remove "Stays"' }).click()
      await row(page, 'Parent').getByRole('checkbox').click()
      await preview(page).getByRole('button', { name: 'Create 1 task, remove 1 line' }).click()
      await page.getByRole('button', { name: 'Keep' }).click()
      await expect(editor.locator('.cm-line')).toHaveText(['- Stays', '✓ Made'])
      expect(await stored(page)).toEqual(['Made'])
    })

    test('Esc or the backdrop with changes asks; with none it closes; Cancel never asks', async ({ page }) => {
      const editor = await open(page)
      await row(page, 'Book venue').getByRole('checkbox').click()
      // Focus is on the checkbox: Esc is the dialog's.
      await page.keyboard.press('Escape')
      const ask = page.getByRole('dialog', { name: 'Keep your changes to these drafts?' })
      await ask.getByRole('button', { name: /Keep editing/ }).click()
      await expect(preview(page)).toBeVisible()
      await expect(row(page, 'Book venue').getByRole('checkbox')).toBeChecked()

      await page.keyboard.press('Escape')
      await ask.getByRole('button', { name: 'Discard' }).click()
      await expect(preview(page)).toHaveCount(0)
      await expect(editor.locator('.cm-line')).toHaveText(LINES.split('\n'))
      expect(await stored(page)).toEqual([])

      await page.getByRole('button', { name: /^Convert \d+ bullet lines? to tasks/ }).click()
      await row(page, 'Book venue').getByRole('checkbox').click()
      await preview(page).getByRole('button', { name: /^Cancel/ }).click()
      await expect(preview(page)).toHaveCount(0)
      await expect(ask).toHaveCount(0)
    })

    test('a picker’s arrow keys stay in the picker; the row’s Del still removes it', async ({ page }) => {
      await open(page)
      const r = row(page, 'Ask for analytics access')
      await r.locator('[data-row-cell="tags"]').click()
      await page.keyboard.press('ArrowDown')
      await expect(page.getByPlaceholder('Search tags...')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(preview(page)).toBeVisible()
      await r.focus()
      await page.keyboard.press('Delete')
      await expect(r).toHaveCount(0)
      await expect(preview(page).getByText('1 line left out')).toBeVisible()
    })

    test('the dashed square and × always shown; pickers open above the dialog', async ({ page }) => {
      await open(page)
      const r = row(page, 'Book venue')
      await expect(r.getByRole('checkbox')).toHaveCSS('border-top-style', 'dashed')
      const remove = r.getByRole('button', { name: 'Remove "Book venue"' })
      await expect(remove).toBeVisible()
      // Prominent at rest: a filled button, not a faint glyph; the pencil is touch-only.
      await page.mouse.move(2, 2)
      await expect(remove).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(r.getByRole('button', { name: 'Edit "Book venue"' })).toBeHidden()
      await r.getByRole('checkbox').click()
      await expect(r.getByRole('checkbox')).toHaveCSS('border-top-style', 'solid')
      // A real click, so hit-testing proves the status menu is on top.
      await r.locator('[data-row-cell="status"]').click()
      await page.getByRole('button', { name: 'No Status' }).click()
      await expect(page.getByRole('button', { name: 'No Status' })).toHaveCount(0)
      await expect(preview(page)).toBeVisible()
    })

    test('an edit leaves the focus where it is', async ({ page }) => {
      await open(page)
      await row(page, 'Book venue').getByRole('checkbox').click()
      await expect(row(page, 'Book venue').getByRole('checkbox')).toBeFocused()
    })

    test.describe('at phone width, on a touch screen', () => {
      test.use({ viewport: { width: 390, height: 800 }, hasTouch: true })
      test('the dialog fits; × and the pencil are in it; the pencil opens the editor', async ({ page }) => {
        await open(page)
        const r = row(page, 'Book venue')
        const dialog = await preview(page).boundingBox()
        const right = (dialog?.x ?? 0) + (dialog?.width ?? 0)
        expect(right).toBeLessThanOrEqual(390)
        for (const name of ['Remove "Book venue"', 'Edit "Book venue"']) {
          const box = await r.getByRole('button', { name }).boundingBox()
          expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(right)
        }
        await expect(r.getByRole('checkbox')).toBeVisible()
        await r.getByRole('button', { name: 'Edit "Book venue"' }).click()
        await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible()
      })
    })
  })

  test.describe('the caret around list markers', () => {
    const caret = (page: Page) => page.evaluate(() => {
      const box = getSelection()?.getRangeAt(0).getClientRects()[0]
      return { x: box?.x ?? 0, height: box?.height ?? 0 }
    })
    const lineEnd = (line: Locator) => line.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return r.getBoundingClientRect().right
    })

    test('a click right of a list line lands at its end, at any height of the line', async ({ page }) => {
      const editor = await writeNote(page, ['first', '  - nested item', '- [ ] box item', '  - [ ] nested box', '- tagged #planning and more', 'last'].join('\n'))
      for (const n of [1, 2, 3, 4]) {
        const line = editor.locator('.cm-line').nth(n)
        const box = await line.boundingBox()
        if (!box) throw new Error('no line')
        const end = await lineEnd(line)
        for (const dy of [2, box.height / 2, box.height - 2]) {
          await page.mouse.click(box.x + box.width - 40, box.y + dy)
          expect(Math.abs((await caret(page)).x - end)).toBeLessThan(2)
        }
      }
    })

    test('an empty item shows the caret, however it got there: Enter, a click on it, a click below', async ({ page }) => {
      const editor = await writeNote(page, 'one\n- two')
      await page.keyboard.press('Enter')
      await expect(editor.locator('.cm-line')).toHaveCount(3)
      const empty = await caret(page)
      expect(empty.height).toBeGreaterThan(10)
      // After the symbol, where the text of the line above starts.
      const above = await editor.locator('.cm-line').nth(1).evaluate((el) => {
        const r = document.createRange()
        r.selectNodeContents(el.lastChild as Node)
        return r.getBoundingClientRect().x
      })
      expect(Math.abs(empty.x - above)).toBeLessThan(2)
      await editor.locator('.cm-line').first().click()
      await editor.locator('.cm-line').last().click()
      expect((await caret(page)).height).toBeGreaterThan(10)
      await editor.locator('.cm-line').first().click()
      await page.mouse.click(600, 500)
      expect((await caret(page)).height).toBeGreaterThan(10)
      await page.keyboard.type('x')
      await expect(editor.locator('.cm-line').last()).toHaveText('- x')
    })

    test('Home stops after the marker, typing there keeps it; ← goes on to the line before', async ({ page }) => {
      const editor = await writeNote(page, 'one\n- [ ] box')
      await page.keyboard.press('Home')
      await page.keyboard.press('Home')
      await page.keyboard.type('X')
      await expect(editor.locator('.cm-line').last()).toHaveText('- [ ] Xbox')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.type('Y')
      await expect(editor.locator('.cm-line')).toHaveText(['oneY', '- [ ] Xbox'])
      // → from the end of the line above lands after the marker too.
      await page.keyboard.press('ArrowRight')
      await page.keyboard.type('Z')
      await expect(editor.locator('.cm-line')).toHaveText(['oneY', '- [ ] ZXbox'])
      // ↑ and ↓ never rest inside one.
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.type('W')
      await expect(editor.locator('.cm-line').last()).toHaveText('- [ ] WZXbox')
    })

    test('a press in the side margin stays on that line; below the text it goes to the end of the note', async ({ page }) => {
      // ✓ lines: the icon sits in the margin of any line it can convert.
      const editor = await writeNote(page, ['✓ one', 'two', '', '✓ four', 'last'].join('\n'))
      const head = () => editor.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? getSelection()?.anchorNode?.textContent)
      const box = await editor.locator('.cm-line').first().boundingBox()
      if (!box) throw new Error('no line')
      await page.mouse.click(box.x - 12, box.y + box.height / 2)
      expect(await head()).toBe('✓ one')
      const done = await editor.locator('.cm-line').nth(3).boundingBox()
      if (!done) throw new Error('no line')
      await page.mouse.click(done.x - 12, done.y + done.height / 2)
      expect(await head()).toBe('✓ four')
      await page.mouse.click(600, 600)
      await page.keyboard.type('!')
      await expect(editor.locator('.cm-line').last()).toHaveText('last!')
    })
  })

  test.describe('list markers shown as symbols', () => {
    const marker = (editor: Locator, n: number) => editor.locator('.cm-line').nth(n).locator('.cm-list-marker')
    const symbol = (l: Locator) => l.evaluate((el) => getComputedStyle(el, '::before').content)
    const markerText = (l: Locator) => l.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return [...r.getClientRects()].reduce((w, b) => Math.max(w, b.width), 0)
    })

    test('•, ☐ and ☑ in place of the characters; plain lines and code blocks are left alone; the note’s text is unchanged', async ({ page }) => {
      const text = ['- bullet', '- [ ] open', '- [x] done', '[ ] bare', '* star', 'plain', '-no space', '```', '- in code', '```'].join('\n')
      const editor = await writeNote(page, text)
      expect(await symbol(marker(editor, 0))).toBe('"•"')
      expect(await symbol(marker(editor, 1))).toBe('"☐"')
      expect(await symbol(marker(editor, 2))).toBe('"☑"')
      expect(await symbol(marker(editor, 3))).toBe('"☐"')
      expect(await symbol(marker(editor, 4))).toBe('"•"')
      for (const n of [5, 6, 8]) await expect(marker(editor, n)).toHaveCount(0)
      // The characters take no room: both kinds of marker are the symbol's width.
      const bullet = await markerText(marker(editor, 0))
      const box = await markerText(marker(editor, 1))
      expect(Math.abs(bullet - box)).toBeLessThan(1)
      expect(await editor.locator('.cm-line').allTextContents()).toEqual(text.split('\n'))
    })

    test('Enter continues the list and shows the symbol; Enter on an empty item ends it; Backspace takes the marker off', async ({ page }) => {
      const editor = await writeNote(page, '- [ ] one')
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('two')
      await expect(editor.locator('.cm-line')).toHaveText(['- [ ] one', '- [ ] two'])
      expect(await symbol(marker(editor, 1))).toBe('"☐"')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(editor.locator('.cm-line').last()).toHaveText('')
      await page.keyboard.type('- three')
      // Its characters are at no size, so the marker has no height of its own.
      await expect(marker(editor, 2)).toHaveCount(1)
      // Home lands after the marker, so typing never goes in front of it.
      await page.keyboard.press('Home')
      await page.keyboard.type('X')
      await expect(editor.locator('.cm-line').last()).toHaveText('- Xthree')
      // One step right past the X, one left, Backspace at the marker takes the marker off.
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await expect(editor.locator('.cm-line').last()).toHaveText('three')
    })

    test('the toolbar’s buttons change what a line has: the symbol follows, the caret stays in the text', async ({ page }) => {
      const editor = await writeNote(page, '- item')
      const bullet = page.getByRole('button', { name: 'Bullet list' })
      const box = page.getByRole('button', { name: 'Checkbox' })
      await box.click()
      await expect(editor.locator('.cm-line')).toHaveText('- [ ] item')
      expect(await symbol(marker(editor, 0))).toBe('"☐"')
      await bullet.click()
      await expect(editor.locator('.cm-line')).toHaveText('- item')
      expect(await symbol(marker(editor, 0))).toBe('"•"')
      await bullet.click()
      await expect(editor.locator('.cm-line')).toHaveText('item')
      await expect(editor.locator('.cm-list-marker')).toHaveCount(0)
      await page.keyboard.type('!')
      await expect(editor.locator('.cm-line')).toHaveText('item!')
    })

    test('the toolbar’s bullet and checkbox show as symbols; typing `- ` turns into a bullet at once', async ({ page }) => {
      const editor = await writeNote(page, 'plain')
      await page.getByRole('button', { name: 'Checkbox' }).click()
      await expect(editor.locator('.cm-line').first()).toHaveText('- [ ] plain')
      expect(await symbol(marker(editor, 0))).toBe('"☐"')
      await editor.locator('.cm-line').first().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('two')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(editor.locator('.cm-line')).toHaveCount(3)
      await page.keyboard.type('- ')
      await expect(editor.locator('.cm-list-marker')).toHaveCount(3)
      expect(await symbol(editor.locator('.cm-list-marker').last())).toBe('"•"')
    })
  })

  test.describe('the hover icon', () => {
    const icon = (page: Page) => page.locator('.cm-line-convert')
    const lineOf = (editor: Locator, n: number) => editor.locator('.cm-line').nth(n)

    test('beside any line with text, in a narrow margin; not on a blank line, a bare marker or a ✓ line', async ({ page }) => {
      const editor = await writeNote(page, ['# Title', '- bullet', '- [ ] box', 'plain', '[ ] bare box', '  - [ ] nested box', '', '- [x] done', '✓ converted', '- [ ] '].join('\n'))
      for (const n of [0, 1, 2, 3, 4, 5, 7]) {
        await lineOf(editor, n).hover()
        await expect(icon(page)).toBeVisible()
        const line = await lineOf(editor, n).boundingBox()
        const box = await icon(page).boundingBox()
        // In the left margin, level with the line.
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(line?.x ?? 0)
        expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - ((line?.y ?? 0) + (line?.height ?? 0) / 2))).toBeLessThan(3)
      }
      for (const n of [6, 8, 9]) {
        await lineOf(editor, n).hover()
        await expect(icon(page)).toBeHidden()
      }
      const margin = await page.locator('.cm-scroller').evaluate((el) => parseInt(getComputedStyle(el).paddingLeft, 10))
      expect(margin).toBeLessThanOrEqual(26)
    })

    test('a click opens Quick Add on that line without moving the caret; ⏎ marks it ✓', async ({ page }) => {
      const editor = await writeNote(page, ['- first', '- second', '- third'].join('\n'))
      await lineOf(editor, 1).hover()
      await icon(page).hover()
      await expect(editor.locator('.cm-convert-scope')).toHaveCount(1)
      await icon(page).click()
      const title = quickAddInput(page)
      await expect(title).toHaveValue('second')
      await expect(title).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(title).toBeHidden()
      await expect(editor.locator('.cm-line')).toHaveText(['- first', '✓ second', '- third'])
      await expect(editor.locator('.cm-convert-scope')).toHaveCount(0)
      expect((await storedTodos(page)).map((t) => t.title)).toEqual(['second'])
    })

    test('in a task’s notes too, on box lines as on bullets: the editor and the row’s popover', async ({ page }) => {
      await seedTaskList(page, { tasks: [{ title: 'alpha', notes: '- [ ] confirm owner\n- bullet\n[ ] bare box' }] })
      await taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Edit status and notes' }).click()
      const popover = page.getByRole('dialog', { name: 'Status and notes' })
      for (const n of [0, 1, 2]) {
        await lineOf(popover.locator('.cm-content'), n).hover()
        await expect(icon(page)).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
      await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
      const content = page.locator('.cm-content')
      await lineOf(content, 2).scrollIntoViewIfNeeded()
      for (const n of [0, 1, 2]) {
        await lineOf(content, n).hover()
        await expect(icon(page)).toBeVisible()
      }
    })

    test('a heading and a done box convert too, their titles without the markup', async ({ page }) => {
      const editor = await writeNote(page, ['# Plan the offsite', '- [x] Book room', 'last'].join('\n'))
      for (const [n, title] of [[0, 'Plan the offsite'], [1, 'Book room']] as const) {
        await lineOf(editor, n).hover()
        await icon(page).click()
        await expect(quickAddInput(page)).toHaveValue(title)
        await page.keyboard.press('Enter')
        await expect(quickAddInput(page)).toBeHidden()
        await expect(lineOf(editor, n)).toHaveText(`✓ ${title}`)
      }
      expect((await storedTodos(page)).map((t) => t.title).sort()).toEqual(['Book room', 'Plan the offsite'])
    })

    test('stays level with its line when the note scrolls', async ({ page }) => {
      const editor = await writeNote(page, Array.from({ length: 60 }, (_, i) => `- line ${i}`).join('\n'))
      await page.locator('.cm-scroller').evaluate((el) => { el.scrollTop = 400 })
      const line = editor.locator('.cm-line', { hasText: 'line 30' }).first()
      await line.hover()
      await expect(icon(page)).toBeVisible()
      const a = await line.boundingBox()
      const b = await icon(page).boundingBox()
      expect(Math.abs((b?.y ?? 0) + (b?.height ?? 0) / 2 - ((a?.y ?? 0) + (a?.height ?? 0) / 2))).toBeLessThan(3)
    })
  })

  test.describe('the hover icon on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } })
    test('no icon and no margin', async ({ page }) => {
      await writeNote(page, '- bullet')
      await expect(page.locator('.cm-line-convert')).toBeHidden()
      const margin = await page.locator('.cm-scroller').evaluate((el) => parseInt(getComputedStyle(el).paddingLeft, 10))
      expect(margin).toBe(12)
    })
  })

  test('Esc in the preview cancels: nothing created, the note unchanged', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    await page.getByRole('button', { name: /^Convert 3/ }).click()
    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    expect(await storedTodos(page)).toEqual([])
    expect(await noteLines(editor)).toEqual(NOTE.split('\n'))
    await expect(editor).toBeFocused()
  })

  test('Alt+T opens Quick Add on the line; Esc leaves the note, asking nothing; ⏎ marks the line', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    await editor.locator('.cm-line').nth(4).click()
    await page.keyboard.press('Alt+t')
    const title = quickAddInput(page)
    await expect(title).toHaveValue('Book venue for team dinner /important')
    await expect(title).toBeFocused()
    await expect(page.getByRole('group', { name: 'What the task gets' })).toContainText('Important')
    await page.keyboard.press('Escape')
    await expect(title).toBeHidden()
    await expect(editor).toBeFocused()
    expect(await storedTodos(page)).toEqual([])
    expect(await noteLines(editor)).toEqual(NOTE.split('\n'))

    await editor.locator('.cm-line').nth(4).click()
    await page.keyboard.press('Alt+t')
    await expect(title).toHaveValue('Book venue for team dinner /important')
    await page.keyboard.press('Enter')
    await expect(title).toBeHidden()
    await expect(editor.locator('.cm-line').nth(4)).toHaveText('✓ Book venue for team dinner')
    const stored = await storedTodos(page)
    expect(stored.map((t) => t.title)).toEqual(['Book venue for team dinner'])
    expect(stored[0]?.important).toBe(true)
  })

  test('Quick Add from a line: Details hands off to the editor, which marks the line; changed text asks before closing', async ({ page }) => {
    const editor = await writeNote(page, ['- Book venue', '  - call them', '  - [x] pick a date', '- other'].join('\n'))
    await editor.locator('.cm-line').first().click()
    await page.keyboard.press('Alt+t')
    const title = quickAddInput(page)
    await expect(page.getByRole('group', { name: 'What the task gets' })).toContainText('With 2 subtasks')
    await title.fill('Book the venue')
    await page.keyboard.press('Escape')
    const ask = page.getByRole('dialog', { name: 'Keep this new task?' })
    await ask.getByRole('button', { name: 'Keep editing' }).click()
    await expect(title).toHaveValue('Book the venue')
    await title.press('Tab')
    await expect(title).toBeHidden()
    const full = page.getByRole('textbox', { name: /^New task…/ })
    await expect(full).toHaveValue('Book the venue')
    await expect(page.getByRole('dialog').getByText('call them')).toBeVisible()
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(editor.locator('.cm-line')).toHaveText(['✓ Book the venue', '- other'])
    expect((await storedTodos(page)).map((t) => t.title)).toEqual(['Book the venue'])
  })

  test('Settings’ Remove note lines after converting: the lines go, asking nothing; Ctrl+Z brings them back', async ({ page }) => {
    const text = ['- first', '- second', 'plain'].join('\n')
    const editor = await writeNote(page, text)
    const settings = await openSettings(page, 'New tasks')
    const setting = settings.getByRole('switch', { name: 'Remove note lines after converting' })
    await setting.click()
    await expect(setting).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(setting).toBeHidden()

    await page.getByRole('button', { name: 'Convert 2 bullet lines to tasks' }).click()
    await page.getByRole('dialog', { name: 'Convert to tasks' }).getByRole('button', { name: 'Create 2 tasks, remove 2 lines' }).click()
    await expect(editor.locator('.cm-line')).toHaveText(['plain'])
    await expect(page.getByRole('dialog', { name: /from the note/ })).toHaveCount(0)
    expect((await storedTodos(page)).map((t) => t.title).sort()).toEqual(['first', 'second'])
    await editor.click()
    await page.keyboard.press('Control+z')
    await expect(editor.locator('.cm-line')).toHaveText(text.split('\n'))
  })

  test('Quick Add from a line with subtasks: ⏎ makes them the task’s; their lines go', async ({ page }) => {
    const editor = await writeNote(page, ['- Book venue', '  - call them', '- other'].join('\n'))
    await editor.locator('.cm-line').first().click()
    await page.keyboard.press('Alt+t')
    await expect(quickAddInput(page)).toHaveValue('Book venue')
    await page.keyboard.press('Enter')
    await expect(editor.locator('.cm-line')).toHaveText(['✓ Book venue', '- other'])
    expect((await readStore<{ title: string }>(page, 'subtasks')).map((s) => s.title)).toEqual(['call them'])
  })

  test('row notes popover: Convert makes the task’s subtasks and stays open', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'alpha', notes: '- one\n- two' }] })
    await taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Edit status and notes' }).click()
    const popover = page.getByRole('dialog', { name: 'Status and notes' })
    const convert = popover.getByRole('button', { name: 'Convert 2 bullet lines to subtasks' })
    await expect(convert).toBeVisible()
    // The popover is narrower than 360px: glyph + count only.
    await expect(convert.getByText('Convert', { exact: true })).toBeHidden()
    await convert.click()
    await expect(popover.locator('.cm-line')).toHaveText(['✓ one', '✓ two'])
    await expect(popover).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Convert to tasks' })).toHaveCount(0)
    await expect.poll(async () => (await readStore<{ title: string }>(page, 'subtasks')).map((s) => s.title)).toEqual(['one', 'two'])
    expect((await storedTodos(page)).map((t) => t.title)).toEqual(['alpha'])
  })

  test('task editor notes: Alt+T makes a subtask with the line as its plain title, no Quick Add', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'alpha', notes: 'Call vendor /urgent' }] })
    await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
    const editTitle = page.getByRole('textbox', { name: 'Task title' })
    await expect(editTitle).toBeVisible()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Alt+t')
    await expect(page.locator('.cm-content')).toHaveText('✓ Call vendor /urgent')
    await expect(quickAddInput(page)).toHaveCount(0)
    await expect(editTitle).toBeVisible()
    await expect.poll(async () => (await readStore<{ title: string }>(page, 'subtasks')).map((s) => s.title)).toEqual(['Call vendor /urgent'])
    expect((await storedTodos(page)).map((t) => t.title)).toEqual(['alpha'])
  })
})
