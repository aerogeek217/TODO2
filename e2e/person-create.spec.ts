import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * People on the fly in a real browser: the person picker (popover anchored
 * under the row's `@` slot, focus in its search, ↑/↓ + ⏎, Create "<name>"
 * that keeps the picker open with the new person checked, Esc handing focus
 * back to the task menu's ⋯ when opened from Assign people…; on a phone row
 * with nobody assigned it anchors to the row), and Quick Add's
 * `@name` create row plus create-on-submit. JSDOM is not authoritative for
 * popover placement or focus handoffs.
 */

type PersonRow = { id: number; name: string; initials: string; color?: string }

async function readPeople(page: Page): Promise<PersonRow[]> {
  return page.evaluate(() => new Promise<PersonRow[]>((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const all = idb.transaction(['people'], 'readonly').objectStore('people').getAll()
      all.onsuccess = () => { resolve(all.result as PersonRow[]); idb.close() }
      all.onerror = () => { idb.close(); reject(all.error) }
    }
    req.onerror = () => reject(req.error)
  }))
}

/** Names of the people assigned to the task with this title. */
async function readAssignedNames(page: Page, title: string): Promise<string[]> {
  return page.evaluate((target) => new Promise<string[]>((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const tx = idb.transaction(['todos', 'todoPeople', 'people'], 'readonly')
      const todos = tx.objectStore('todos').getAll()
      const joins = tx.objectStore('todoPeople').getAll()
      const people = tx.objectStore('people').getAll()
      tx.oncomplete = () => {
        const todo = (todos.result as Array<{ id: number; title: string }>).find((t) => t.title === target)
        const byId = new Map((people.result as PersonRow[]).map((p) => [p.id, p.name]))
        const names = (joins.result as Array<{ todoId: number; personId: number }>)
          .filter((j) => j.todoId === todo?.id)
          .map((j) => byId.get(j.personId) ?? '?')
        idb.close()
        resolve(names.sort())
      }
      tx.onerror = () => { idb.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }), title)
}

const activeOptionName = (page: Page) => page.evaluate(() => {
  const input = document.activeElement
  const id = input?.getAttribute('aria-activedescendant')
  return id ? document.getElementById(id)?.textContent ?? null : null
})

test.describe('person picker — lookup or create', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, {
      people: [{ name: 'Dana Kim', initials: 'DK' }, { name: 'Priya Nair', initials: 'PN', color: '#5b6abf' }],
      tasks: [{ title: 'vendor contract' }],
    })
  })

  test('opens under the @ slot with focus in the search; Create keeps it open with the person checked', async ({ page }) => {
    const row = taskRowByTitle(page, 'vendor contract')
    await row.hover()
    const trigger = row.getByRole('button', { name: '@', exact: true })
    await trigger.click()

    const search = page.getByPlaceholder('Search or create people…')
    await expect(search).toBeFocused()
    const listbox = page.getByRole('listbox')
    // Anchored below the trigger.
    const tb = (await trigger.boundingBox())!
    const lb = (await search.boundingBox())!
    expect(lb.y).toBeGreaterThanOrEqual(tb.y + tb.height)
    await expect(listbox.getByRole('option')).toHaveText(['DDana Kim', 'PPriya Nair'])

    // No match: Create is the only row and active.
    await page.keyboard.type('Marco Rossi')
    await expect(listbox.getByRole('option')).toHaveCount(1)
    await expect(listbox.getByRole('option', { name: 'Create "Marco Rossi"' })).toBeVisible()
    expect(await activeOptionName(page)).toContain('Create "Marco Rossi"')
    await page.keyboard.press('Enter')

    // The query clears, the picker stays open with focus, the new person is checked in place.
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await expect(listbox.getByRole('option')).toHaveCount(3)
    await expect(listbox.getByRole('option', { name: 'Marco Rossi' })).toHaveAttribute('aria-selected', 'true')
    await expect(listbox.getByRole('option').nth(1)).toHaveAccessibleName('Marco Rossi')
    await expect.poll(() => readAssignedNames(page, 'vendor contract')).toEqual(['Marco Rossi'])
    const marco = (await readPeople(page)).find((p) => p.name === 'Marco Rossi')
    expect(marco).toMatchObject({ initials: 'MR' })
    expect(marco?.color).toBeUndefined()

    // An exact match in another case offers no create; ⏎ toggles that person.
    await page.keyboard.type('MARCO ROSSI')
    await expect(listbox.getByRole('option', { name: /Create/ })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(listbox.getByRole('option', { name: 'Marco Rossi' })).toHaveAttribute('aria-selected', 'false')
    await expect.poll(() => readAssignedNames(page, 'vendor contract')).toEqual([])
    expect((await readPeople(page)).filter((p) => p.name.toLowerCase() === 'marco rossi')).toHaveLength(1)

    // ↑/↓ wrap; ⏎ toggles the active person.
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('ArrowUp')
    expect(await activeOptionName(page)).toContain('Priya Nair')
    await page.keyboard.press('Enter')
    await expect.poll(() => readAssignedNames(page, 'vendor contract')).toEqual(['Priya Nair'])

    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
  })

  test('Assign people… from the task menu: focus lands in the search; Esc hands it back to ⋯', async ({ page }) => {
    const row = taskRowByTitle(page, 'vendor contract')
    await row.hover()
    const more = row.getByRole('button', { name: 'Task actions' })
    await more.click()
    await page.getByRole('menuitem', { name: 'Assign people…' }).click()
    const search = page.getByPlaceholder('Search or create people…')
    await expect(search).toBeFocused()
    await page.keyboard.type('Sam')
    await page.keyboard.press('Enter')
    await expect.poll(() => readAssignedNames(page, 'vendor contract')).toEqual(['Sam'])
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
    await expect(more).toBeFocused()
  })
})

test.describe('Quick Add @ — create on submit', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, { people: [{ name: 'Dana Kim', initials: 'DK' }] })
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
  })

  test('nothing matches: ⏎ on the create row inserts the token; submit creates and assigns the person', async ({ page }) => {
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    const input = dialog.getByPlaceholder('New task…')
    await expect(input).toBeFocused()
    await page.keyboard.type('Call legal @Marco')

    const popup = page.getByRole('listbox', { name: 'People' })
    const create = popup.getByRole('option', { name: 'Press ⏎ to create @Marco' })
    await expect(create).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(popup).toBeHidden()
    await expect(input).toHaveValue('Call legal @Marco ')
    await expect(dialog.getByText('New person:')).toBeVisible()

    // A quoted multi-word name that matches nobody is created too.
    await page.keyboard.type('@"Ana Lopez" @dana')
    await expect(popup.getByRole('option', { name: '@Dana Kim' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(dialog.getByText('@Marco @Ana Lopez')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()

    await expect.poll(() => readAssignedNames(page, 'Call legal')).toEqual(['Ana Lopez', 'Dana Kim', 'Marco'])
    const people = await readPeople(page)
    expect(people.map((p) => p.name).sort()).toEqual(['Ana Lopez', 'Dana Kim', 'Marco'])
    expect(people.find((p) => p.name === 'Ana Lopez')?.initials).toBe('AL')
    // The new row shows its people.
    await expect(taskRowByTitle(page, 'Call legal')).toBeVisible()
  })
})

test('phone: Assign people… on a task with nobody assigned opens the picker on screen; Create assigns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await seedTaskList(page, { people: [{ name: 'Dana Kim', initials: 'DK' }], tasks: [{ title: 'vendor contract' }] })
  await page.getByText('vendor contract', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Assign people…' }).click()
  const search = page.getByPlaceholder('Search or create people…')
  await expect(search).toBeFocused()
  await expect(search).toBeInViewport()
  await page.keyboard.type('Marco')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option', { name: 'Marco' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => readAssignedNames(page, 'vendor contract')).toEqual(['Marco'])
})
