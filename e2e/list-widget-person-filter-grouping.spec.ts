import { expect, test } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'

/**
 * Locks in the visible-groups intersection rule for `grouping === 'people'`
 * on a list whose own filter names people.
 *
 * - Filter people `[Alice, Bob]`, group by people.
 * - T1 {Alice, Charlie} → emits under Alice only; Charlie is outside the
 *   filter set, so no Charlie section appears.
 * - T2 {Bob}            → emits under Bob.
 * - T3 {Charlie}        → filtered out (no filtered person on it).
 * - Sections follow filter-set order: Alice, then Bob.
 *
 * Without the restriction, Charlie's group leaked through even though the
 * list filtered it out, and T1 rendered twice (once under Alice, once under
 * Charlie).
 */

test.describe('list widget — visible-groups intersection', () => {
  test('filter [Alice, Bob] + group by people: Alice and Bob sections only, no Charlie', async ({ page }) => {
    const widget = await seedTaskList(page, {
      people: ['Alice', 'Bob', 'Charlie'],
      tasks: [
        { title: 'T1 Alice and Charlie', people: ['Alice', 'Charlie'] },
        { title: 'T2 Bob only', people: ['Bob'] },
        { title: 'T3 Charlie only', people: ['Charlie'] },
      ],
      list: { name: 'People grouping', grouping: 'people', people: ['Alice', 'Bob'] },
    })

    const t1Row = widget.locator('[data-todo-id]').filter({ hasText: 'T1 Alice and Charlie' })
    const t2Row = widget.locator('[data-todo-id]').filter({ hasText: 'T2 Bob only' })
    const t3Row = widget.locator('[data-todo-id]').filter({ hasText: 'T3 Charlie only' })

    await expect(t1Row, 'T1 should appear exactly once (under Alice)').toHaveCount(1)
    await expect(t2Row, 'T2 should appear exactly once (under Bob)').toHaveCount(1)
    await expect(t3Row, 'T3 is filtered out — no filtered person on it').toHaveCount(0)
    // Charlie's section must NOT appear; sections follow filter-set order.
    await expect(widget.getByTestId('list-group-name')).toHaveText(['Alice', 'Bob'])

    // T1 lands between Alice's header and Bob's; T2 lands below Bob's.
    const [aliceHeader, bobHeader] = [widget.getByTestId('list-group-name').nth(0), widget.getByTestId('list-group-name').nth(1)]
    const aliceY = (await aliceHeader.boundingBox())!.y
    const bobY = (await bobHeader.boundingBox())!.y
    const t1Y = (await t1Row.boundingBox())!.y
    const t2Y = (await t2Row.boundingBox())!.y
    expect(t1Y).toBeGreaterThan(aliceY)
    expect(t1Y).toBeLessThan(bobY)
    expect(t2Y).toBeGreaterThan(bobY)
  })
})
