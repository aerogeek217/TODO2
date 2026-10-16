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

    // Substring match: only the person whose name contains "acme" surfaces.
    const targetOption = popup.getByRole('option', { name: `@${TARGET_NAME}` })
    await expect(targetOption).toBeVisible()
    await expect(targetOption).toHaveAttribute('aria-selected', 'true')
    await expect(popup.getByRole('option')).toHaveCount(1)

    await page.keyboard.press('Enter')

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
