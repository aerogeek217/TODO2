import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ListWidget, type ListWidgetResult } from '../../../components/workspace/list/ListWidget'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { emptyPredicate } from '../../../models'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { LensTab } from '../../../models/workspace-layout'
import type { Person } from '../../../models'
import { db } from '../../../data/database'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * A list's switch for the top bar's lens (its filter line's glasses and
 * `−N` — on desktop hidden at rest while the lens hides nothing here — and
 * the list's count while narrowed): what the lens hides here, turned off and on
 * for this list alone, saved at once on the saved list — never a draft
 * edit. With the line hidden, the tab carries the count and the lens.
 */

const alice: Person = { id: 1, name: 'Alice', initials: 'AL' }
const bob: Person = { id: 2, name: 'Bob', initials: 'BO' }

function def(over: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 7, name: 'Team', sortOrder: 0,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'manual', grouping: 'none',
    ...over,
  }
}

const tab: LensTab = { id: 't1', kind: 'lens', config: { listDefinitionId: 7 } }

async function setup(d: PersistedListDefinition) {
  await db.listDefinitions.put(d)
  useListDefinitionStore.setState({ listDefinitions: [d] })
  let result: ListWidgetResult | undefined
  render(
    <DndContext>
      <ListWidget tab={tab} onResult={(r) => { result = r }} />
    </DndContext>,
  )
  return { result: () => result }
}

const titles = () => Array.from(document.querySelectorAll('[data-todo-id]')).map((el) => el.querySelector('[data-task-title]')?.getAttribute('data-task-title'))
const lensSwitch = () => screen.queryByTestId('lens-switch')
const count = () => screen.queryByTestId('list-count')?.textContent ?? null

/** Picks a lens keeping Alice's tasks (it hides Bob's). */
function pickAliceLens(predicate = { ...emptyPredicate(), personIds: [1] }) {
  useSettingsStore.setState({ lenses: [{ id: 'lens-a', name: 'Alice only', predicate }], activeLensId: 'lens-a' })
}

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useListDraftStore.setState({ drafts: {} })
  useListWidgetStore.setState({ picks: {}, collapsed: {} })
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
  usePersonStore.setState({ people: [alice, bob], assignedPeopleMap: new Map([[1, [alice]], [2, [bob]], [3, [alice, bob]]]) })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Alice task', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Bob task', sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Shared task', sortOrder: 3 }),
    ],
  })
})

afterEach(async () => {
  cleanup()
  await db.listDefinitions.clear()
})

describe('a list’s lens switch', () => {
  it('no lens: no switch and no count; a lens that hides nothing here: the switch kept in place, hidden at rest (2A)', async () => {
    const { result } = await setup(def())
    expect(lensSwitch()).toBeNull()
    expect(count()).toBeNull()
    expect(result()?.countLabel).toBeUndefined()
    act(() => pickAliceLens({ ...emptyPredicate(), personIds: [1, 2] }))
    expect(lensSwitch()).toHaveAttribute('data-quiet')
    expect(lensSwitch()).toHaveAttribute('data-lens-hides', '0')
    expect(count()).toBeNull()
  })

  it('shows what the lens hides here; a click turns it off for this list, saved at once — and back on', async () => {
    pickAliceLens()
    await setup(def())
    expect(titles()).toEqual(['Alice task', 'Shared task'])
    expect(count()).toBe('2 of 3')
    const on = lensSwitch()!
    expect(on).toHaveAttribute('aria-pressed', 'true')
    // It has an effect here: shown at rest with its `−N` (not quiet).
    expect(on).toHaveTextContent('−1')
    expect(on).not.toHaveAttribute('data-quiet')
    expect(on).toHaveAttribute('data-lens-hides', '1')
    expect(on).toHaveAccessibleName('Apply the lens “Alice only” here')

    fireEvent.click(on)
    await waitFor(() => expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task']))
    expect(count()).toBeNull()
    const off = lensSwitch()!
    expect(off).toHaveAttribute('aria-pressed', 'false')
    // The same name: a toggle's state is its `aria-pressed` alone (U7).
    expect(off).toHaveAccessibleName('Apply the lens “Alice only” here')
    expect(off).not.toHaveTextContent('−')
    // Saved, not a draft: the list isn't unsaved, and the row is stored.
    expect(useListDraftStore.getState().drafts[7]).toBeUndefined()
    expect(within(screen.getByTestId('list-filter-row')).queryByRole('button', { name: /Save/ })).toBeNull()
    expect(useListDefinitionStore.getState().listDefinitions[0]?.ignoreLens).toBe(true)
    await waitFor(async () => expect((await db.listDefinitions.get(7))?.ignoreLens).toBe(true))

    fireEvent.click(lensSwitch()!)
    await waitFor(() => expect(titles()).toEqual(['Alice task', 'Shared task']))
    await waitFor(async () => expect('ignoreLens' in ((await db.listDefinitions.get(7)) ?? {})).toBe(false))
  })

  it('a click that leaves the lens nothing to hide here keeps the switch, and the focus on it (U7)', async () => {
    // Alice or Bob: hides nothing here; the list ignores it, so the switch shows to turn it back on.
    pickAliceLens({ ...emptyPredicate(), personIds: [1, 2] })
    await setup(def({ ignoreLens: true }))
    const off = lensSwitch()!
    expect(off).toHaveAttribute('aria-pressed', 'false')
    off.focus()
    fireEvent.click(off)
    await waitFor(() => expect(useListDefinitionStore.getState().listDefinitions[0]?.ignoreLens).toBeUndefined())
    const on = lensSwitch()
    expect(on).toBe(off)
    expect(on).toHaveAttribute('aria-pressed', 'true')
    expect(on).toHaveAttribute('data-lens-hides', '0')
    // Nothing hidden here: quiet (hidden at rest), but the same element under the focus.
    expect(on).toHaveAttribute('data-quiet')
    expect(document.activeElement).toBe(on)
    // Another lens picked that hides nothing here: still in place, quiet.
    act(() => useSettingsStore.setState({
      lenses: [{ id: 'lens-b', name: 'Everyone', predicate: { ...emptyPredicate(), personIds: [1, 2] } }],
      activeLensId: 'lens-b',
    }))
    expect(lensSwitch()).toHaveAttribute('data-quiet')
  })

  it('off, the chips still apply; the lens lifted at the top bar shows no switch', async () => {
    pickAliceLens()
    await setup(def({ ignoreLens: true }))
    act(() => useFilterStore.getState().setPersonIds(new Set([2])))
    expect(titles()).toEqual(['Bob task', 'Shared task'])
    expect(lensSwitch()).toHaveAttribute('aria-pressed', 'false')
    act(() => useFilterStore.getState().clearAll())
    act(() => useSettingsStore.setState({ activeLensId: null }))
    expect(lensSwitch()).toBeNull()
  })

  it('Edit list’s Save keeps the saved list’s switch (written at once, meanwhile)', async () => {
    pickAliceLens()
    await setup(def())
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, name: 'Team renamed' })))
    fireEvent.click(lensSwitch()!)
    await waitFor(() => expect(useListDefinitionStore.getState().listDefinitions[0]?.ignoreLens).toBe(true))
    // Still the draft's list, still a draft by its name alone.
    expect(useListDraftStore.getState().drafts[7]?.name).toBe('Team renamed')
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    await act(() => useListDefinitionStore.getState().editList(7, () => useListDraftStore.getState().drafts[7]!, 'Edited list'))
    const saved = useListDefinitionStore.getState().listDefinitions[0]
    expect(saved).toMatchObject({ name: 'Team renamed', ignoreLens: true })
  })

  it('with the filter line hidden, the tab gets the count and the lens (its menu switch)', async () => {
    pickAliceLens()
    const { result } = await setup(def({ showFilterLine: false }))
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
    expect(result()).toMatchObject({ countLabel: '2 of 3', lens: { name: 'Alice only', ignored: false, hides: 1, listId: 7 } })
    // Following the lens, the tab's count says it: no lens mark on the tab.
    expect(result()?.tabLens).toBeUndefined()
  })

  it('with the filter line hidden, a list that ignores the lens marks its tab, with no count', async () => {
    pickAliceLens()
    const { result } = await setup(def({ showFilterLine: false, ignoreLens: true }))
    expect(result()?.countLabel).toBeUndefined()
    expect(result()?.tabLens).toMatchObject({ name: 'Alice only', ignored: true })
  })
})
