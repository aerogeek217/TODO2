import { expect, test, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { readStore, readStores } from './fixtures/db'

/**
 * `@`-mention picker in QuickAddBar: substring-matches people, writes the
 * picked name (quoted when it contains a space), and submit assigns the
 * person via a `todoPeople` join.
 *
 *   1. Open QuickAddBar (Ctrl+Space).
 *   2. Type `@acme` — the popup (header "People") narrows to the person whose
 *      name contains "acme" (`Org: Acme`, a person carrying a color).
 *   3. Press Enter — picker writes `@"Org: Acme"`.
 *   4. Submit; assert a Dexie `todoPeople` row links the new task to that
 *      person.
 *
 * JSDOM is unauthoritative for the popup positioning + caret-relative
 * placement (`useNlpAutocomplete`'s `measureCanvas` reads computed style)
 * and for the chained focus reclaim across the input → popup mousedown.
 */

const PERSON_NAME = 'Alice Smith'
const TARGET_NAME = 'Org: Acme'
const OTHER_NAME = 'Org: Globex'

async function readPersonIdByName(page: Page, name: string): Promise<number | null> {
  return (await readStore<{ id: number; name: string }>(page, 'people')).find((r) => r.name === name)?.id ?? null
}

async function readTodoPeopleForTitle(page: Page, title: string): Promise<Array<{ todoId: number; personId: number }>> {
  const { todos, todoPeople } = await readStores(page, ['todos', 'todoPeople'])
  const todo = todos?.find((r) => r.title === title)
  if (!todo) return []
  return (todoPeople ?? []).filter((j) => j.todoId === todo.id) as Array<{ todoId: number; personId: number }>
}

test.describe('QuickAddBar @ mention picker', () => {
  test('@acme finds the matching person; picking it submits with a todoPeople join', async ({ page }) => {
    await seedTaskList(page, {
      people: [
        { name: PERSON_NAME, initials: 'AS' },
        { name: TARGET_NAME, initials: 'AC', color: '#f28c4e' },
        { name: OTHER_NAME, initials: 'GX' },
      ],
    })

    // The top bar's People filter renders only when
    // `usePersonStore.people.length > 0`, so its visibility is the cheapest
    // signal that the person store has loaded. `seedTaskList` reloads the page
    // after writing IDB, but the app's init chain races the test's first `@`
    // keystroke; without this gate the autocomplete filters an empty list and
    // the popup never opens.
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()

    // Open QuickAddBar via the global hotkey.
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    await expect(dialog).toBeVisible()

    const input = dialog.getByPlaceholder('New task…')
    await expect(input).toBeFocused()

    // Type the title, then `@acme` to invoke the autocomplete picker.
    await page.keyboard.type('demo task ')
    await page.keyboard.type('@acme')

    const popup = page.getByRole('listbox', { name: 'People' })
    await expect(popup).toBeVisible()
    await expect(popup.getByText('People', { exact: true })).toBeVisible()

    // Substring match: only the person whose name contains "acme" surfaces,
    // then the Create row (no one is named exactly "acme").
    const targetOption = popup.getByRole('option', { name: `@${TARGET_NAME}` })
    await expect(targetOption).toBeVisible()
    await expect(targetOption).toHaveAttribute('aria-selected', 'true')
    await expect(popup.getByRole('option')).toHaveText([`@${TARGET_NAME}`, /Create @acme/])

    // Tab picks (⏎ would add the task at once, with the same match).
    await page.keyboard.press('Tab')

    // Picker dismisses; the name contains a space, so the token is quoted.
    // The chip preview renders via the parser+resolver path.
    await expect(popup).toBeHidden()
    await expect(input).toHaveValue(`demo task @"${TARGET_NAME}" `)
    await expect(dialog.getByText(`@${TARGET_NAME}`, { exact: true })).toBeVisible()

    // Submit — the bar closes and `applyNlpMetadata` writes the person join.
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()

    const targetId = await readPersonIdByName(page, TARGET_NAME)
    expect(targetId).not.toBeNull()

    // Exactly one `todoPeople` row for the new task, pointing at the picked
    // person.
    await expect.poll(async () => {
      const rows = await readTodoPeopleForTitle(page, 'demo task')
      return rows.length
    }).toBe(1)
    const rows = await readTodoPeopleForTitle(page, 'demo task')
    expect(rows[0]?.personId).toBe(targetId)
  })
})

test.describe('QuickAddBar @ popup: the highlighted row is what you get', () => {
  test('the pointer moves the highlight; a space typed after @Fr completes to the highlighted person', async ({ page }) => {
    await seedTaskList(page, { people: [{ name: 'Fred', initials: 'FR' }, { name: 'Frida', initials: 'FA' }] })
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    const input = dialog.getByPlaceholder('New task…')
    await input.pressSequentially('Call @Fr')
    const popup = page.getByRole('listbox', { name: 'People' })
    const fred = popup.getByRole('option', { name: /@Fred$/ })
    const frida = popup.getByRole('option', { name: /@Frida$/ })
    await expect(fred).toHaveAttribute('aria-selected', 'true')

    // One highlighted row: the pointer moves it.
    await frida.hover()
    await expect(frida).toHaveAttribute('aria-selected', 'true')
    await expect(fred).toHaveAttribute('aria-selected', 'false')
    await fred.hover()
    await expect(fred).toHaveAttribute('aria-selected', 'true')

    // Typing on without picking uses the highlighted row.
    await input.press('Space')
    await expect(input).toHaveValue('Call @Fred ')
    await expect(popup).toHaveCount(0)
  })
})

test.describe('QuickAddBar @ popup: the Create row', () => {
  test('@Ed with Fred stored: Fred highlighted, ↓ to Create "Ed", Tab makes Ed at once; the task gets Ed', async ({ page }) => {
    await seedTaskList(page, { people: [{ name: 'Fred', initials: 'FR' }] })
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    const input = dialog.getByPlaceholder('New task…')
    await input.pressSequentially('Call @Ed')
    const popup = page.getByRole('listbox', { name: 'People' })
    await expect(popup.getByRole('option')).toHaveText(['@Fred', /Create @Ed/])
    await expect(popup.getByRole('option', { name: '@Fred' })).toHaveAttribute('aria-selected', 'true')

    await input.press('ArrowDown')
    await expect(popup.getByRole('option', { name: /Create @Ed/ })).toHaveAttribute('aria-selected', 'true')
    await input.press('Tab')
    await expect(input).toHaveValue('Call @Ed ')
    await expect.poll(() => readPersonIdByName(page, 'Ed')).not.toBeNull()

    await input.press('Enter')
    await expect(dialog).toHaveCount(0)
    const ed = await readPersonIdByName(page, 'Ed')
    await expect.poll(async () => (await readTodoPeopleForTitle(page, 'Call')).map((j) => j.personId)).toEqual([ed])
  })
})

test.describe('QuickAddBar # popup: a tag no bare #slug can spell', () => {
  test('R&D: typing #R& offers it; Tab writes #"R&D"; the task gets R&D and no tag "R" is made', async ({ page }) => {
    await seedTaskList(page, { people: [{ name: 'Fred', initials: 'FR' }], tags: ['R&D', 'rd'] })
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    const input = dialog.getByPlaceholder('New task…')
    await input.pressSequentially('Plan #R&')
    const popup = page.getByRole('listbox', { name: 'Tags' })
    await expect(popup.getByRole('option')).toHaveText(['#R&D'])
    await input.press('Tab')
    await expect(input).toHaveValue('Plan #"R&D" ')

    // Typed and completed with a space (the other way in) gives the same token.
    await input.pressSequentially('#R& ')
    await expect(input).toHaveValue('Plan #"R&D" #"R&D" ')

    await input.press('Enter')
    await expect(dialog).toHaveCount(0)
    const { todos, tags, todoTags } = await readStores(page, ['todos', 'tags', 'todoTags'])
    const rd = (tags ?? []).find((t) => t.name === 'R&D')
    const task = (todos ?? []).find((t) => t.title === 'Plan')
    expect(task).toBeDefined()
    expect((todoTags ?? []).filter((j) => j.todoId === task?.id).map((j) => j.tagId)).toEqual([rd?.id])
    expect((tags ?? []).map((t) => t.name).sort()).toEqual(['R&D', 'rd'])
  })
})
