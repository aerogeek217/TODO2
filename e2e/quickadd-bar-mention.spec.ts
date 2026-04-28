import { expect, test, type Page } from '@playwright/test'
import { seedCanvas } from './fixtures/seed'

/**
 * triage-2026-04-27-batch2 P9 — `@`-mention picker offers people AND orgs.
 *
 * Item 15 ("Can't enter order with @ using NLP") clarified to: `@` should
 * resolve to person OR org. The picker, parser, and resolver have already
 * been wired (the `@` autocomplete added orgs in `b068965`; resolver does
 * person-first / org-fallback) — this spec locks the user-facing flow:
 *
 *   1. Open QuickAddBar (Ctrl+Space).
 *   2. Type `@` and observe the popup header reads "People & Orgs", and that
 *      both kinds appear (orgs labelled `(org)`).
 *   3. Arrow-down to the org row, press Enter — picker writes `@"Org Name"`.
 *   4. Submit; assert the Dexie `todoOrgs` join row exists for the new task.
 *
 * JSDOM is unauthoritative for the popup positioning + caret-relative
 * placement (`useNlpAutocomplete`'s `measureCanvas` reads computed style)
 * and for the chained focus reclaim across the input → popup mousedown.
 */

const PERSON_NAME = 'Alice Smith'
const ORG_NAME = 'Acme Corp'
const SECOND_ORG_NAME = 'Globex'

async function readTodoOrgsForTitle(
  page: Page,
  title: string,
): Promise<Array<{ todoId: number; orgId: number }>> {
  return await page.evaluate(async (target) => {
    return await new Promise<Array<{ todoId: number; orgId: number }>>(
      (resolve, reject) => {
        const req = indexedDB.open('todo2')
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(['todos', 'todoOrgs'], 'readonly')
          const todos = tx.objectStore('todos').getAll()
          const joins = tx.objectStore('todoOrgs').getAll()
          let todoId: number | null = null
          let allJoins: Array<{ todoId: number; orgId: number }> = []
          let pending = 2
          const finish = () => {
            if (--pending !== 0) return
            const matched = todoId == null
              ? []
              : allJoins.filter((row) => row.todoId === todoId)
            idb.close()
            resolve(matched)
          }
          todos.onsuccess = () => {
            const rows = todos.result as Array<{ id: number; title: string }>
            const found = rows.find((r) => r.title === target)
            if (found) todoId = found.id
            finish()
          }
          todos.onerror = () => { idb.close(); reject(todos.error) }
          joins.onsuccess = () => {
            allJoins = joins.result as Array<{ todoId: number; orgId: number }>
            finish()
          }
          joins.onerror = () => { idb.close(); reject(joins.error) }
        }
        req.onerror = () => reject(req.error)
      },
    )
  }, title)
}

test.describe('QuickAddBar @ mention picker', () => {
  test('@ shows people + orgs, picking an org submits with todoOrgs join', async ({ page }) => {
    await seedCanvas(page, {
      people: [{ name: PERSON_NAME, initials: 'AS' }],
      orgs: [
        { name: ORG_NAME, initials: 'AC', color: '#ffaa33' },
        { name: SECOND_ORG_NAME, initials: 'GX', color: '#3399ff' },
      ],
    })

    // The TopBar's `@ Org ▾` filter renders only when `useOrgStore.orgs.length > 0`,
    // so its visibility is the cheapest signal that `loadOrgs()` settled —
    // `seedCanvas` reloads the page after writing IDB, but the app's init
    // promise chain (`ensureDefault → initFileStorage → loadOrgs …`) races
    // the test's first `@` keystroke. Without this gate `useNlpAutocomplete`
    // captures a stale empty `orgs` array and the popup shows only people.
    await expect(page.getByRole('button', { name: /@ Org/ })).toBeVisible()

    // Open QuickAddBar via the global hotkey.
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    await expect(dialog).toBeVisible()

    const input = dialog.getByPlaceholder('New task…')
    await expect(input).toBeFocused()

    // Type the title, then `@` to invoke the autocomplete picker.
    await page.keyboard.type('demo task ')
    await page.keyboard.type('@')

    const popup = page.getByRole('listbox', { name: 'People & Orgs' })
    await expect(popup).toBeVisible()

    // Person + both orgs surfaced; orgs are labelled "(org)".
    await expect(popup.getByRole('option', { name: `@${PERSON_NAME}` })).toBeVisible()
    await expect(
      popup.getByRole('option', { name: `@${ORG_NAME} (org)` }),
    ).toBeVisible()
    await expect(
      popup.getByRole('option', { name: `@${SECOND_ORG_NAME} (org)` }),
    ).toBeVisible()

    // ArrowDown twice → land on Globex (third item, since people sort first
    // then orgs in store order). Confirm the selected option moves before
    // committing — the popup uses `aria-selected` on the highlighted row.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    const targetOption = popup.getByRole('option', { name: `@${SECOND_ORG_NAME} (org)` })
    await expect(targetOption).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Enter')

    // Picker dismisses; the input value gets the bare token (Globex has no
    // space, so no quoting). The chip preview renders via the parser+resolver
    // path — assert the org chip surface is visible.
    await expect(popup).toBeHidden()
    await expect(input).toHaveValue(`demo task @${SECOND_ORG_NAME} `)
    await expect(dialog.getByText(`@${SECOND_ORG_NAME}`)).toBeVisible()

    // Submit — the bar closes and `applyNlpMetadata` writes the org join.
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()

    // Confirm exactly one `todoOrgs` row was written for the new task and it
    // points at the second org id (the autoincrement makes Acme=1, Globex=2).
    await expect.poll(async () => {
      const rows = await readTodoOrgsForTitle(page, 'demo task')
      return rows.length
    }).toBe(1)
    const rows = await readTodoOrgsForTitle(page, 'demo task')
    expect(rows[0]?.orgId).toBe(2)
  })
})
